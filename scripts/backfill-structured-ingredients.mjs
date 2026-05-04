/**
 * PRD-006 Bite β: bulk-backfill ingredients_structured and servings for
 * existing vault rows where ingredients_structured is still NULL.
 *
 * Run via: `node scripts/backfill-structured-ingredients.mjs`
 *
 * Idempotent — the WHERE clause filters `ingredients_structured IS NULL AND
 * deleted_at IS NULL`, so re-running only retries unfinished/failed rows.
 * Per-row failures log + continue. Three consecutive 5xx responses from
 * Anthropic trigger a hard stop (signal: API outage; re-run later).
 *
 * Uses Haiku 4.5 — cheaper than Sonnet 4.6 and sufficient for structured
 * parsing of an existing ingredient list.
 *
 * Service-role key is read from SUPABASE_SERVICE_ROLE_KEY and used to bypass
 * RLS for the cross-user backfill. Never referenced in browser code.
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-haiku-4-5-20251001'

/**
 * Build the focused Anthropic prompt for a single vault row.
 * The response shape is a strict subset of /api/analyze-recipe: only
 * `servings` and `ingredients_structured` — the other fields are already
 * populated for existing vault recipes.
 */
export function buildBackfillPrompt(row) {
  const ingredientsList =
    Array.isArray(row.ingredients) && row.ingredients.length > 0
      ? row.ingredients.join('\n')
      : '(no ingredients listed)'

  return `Parse the ingredient list for this recipe and return ONLY a JSON object — no prose, no markdown fences.

Recipe: ${row.name}
Ingredients:
${ingredientsList}

Return exactly:
{
  "servings": integer number of portions this recipe yields (from the recipe text), or null if not stated,
  "ingredients_structured": [
    {"name": "ingredient name", "quantity": "measurement as written or null", "unit": "unit if separable from quantity or null", "notes": "prep/handling notes or null"}
  ]
}`
}

/**
 * Analyze one vault row and persist the result. Pure-ish: every external
 * dependency (Anthropic client, Supabase client, logger) is injected so
 * the unit test can drive it with mocks.
 *
 * Returns `{ ok, count?, reason?, error?, status? }`. Never throws — the
 * caller decides how to react.
 */
export async function processRow({ row, anthropicClient, supabase, logger = console }) {
  let parsed
  try {
    const response = await anthropicClient.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: buildBackfillPrompt(row) }],
    })
    const text = response.content.find(b => b.type === 'text')?.text ?? ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null
  } catch (err) {
    logger.error(`[FAIL] ${row.id} ${row.name} analyze: ${err?.message || err}`)
    return { ok: false, reason: 'analyze', error: err, status: err?.status }
  }

  if (!parsed || !Array.isArray(parsed.ingredients_structured)) {
    logger.error(`[FAIL] ${row.id} ${row.name} parse: unexpected shape`)
    return { ok: false, reason: 'parse' }
  }

  const servings =
    Number.isInteger(parsed.servings) && parsed.servings > 0 ? parsed.servings : null

  const { error } = await supabase
    .from('vault')
    .update({ ingredients_structured: parsed.ingredients_structured, servings })
    .eq('id', row.id)

  if (error) {
    logger.error(`[FAIL] ${row.id} ${row.name} update: ${error.message || error}`)
    return { ok: false, reason: 'update', error }
  }

  logger.log(`[OK] ${row.id} ${row.name} (${parsed.ingredients_structured.length} ingredients)`)
  return { ok: true, count: parsed.ingredients_structured.length }
}

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

  const missing = []
  if (!SUPABASE_URL) missing.push('SUPABASE_URL (or VITE_SUPABASE_URL)')
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY')
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(', ')}`)
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const anthropicClient = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

  const { data: rows, error: queryError } = await supabase
    .from('vault')
    .select('id, name, ingredients')
    .is('ingredients_structured', null)
    .is('deleted_at', null)
    .order('id', { ascending: true })

  if (queryError) {
    console.error('Supabase query failed:', queryError.message || queryError)
    process.exit(1)
  }

  console.log(`Found ${rows.length} unstructured vault row(s).`)
  if (rows.length === 0) {
    console.log('Nothing to do.')
    process.exit(0)
  }

  let succeeded = 0
  let failed = 0
  let consecutive5xx = 0

  for (const row of rows) {
    const result = await processRow({ row, anthropicClient, supabase })
    if (result.ok) {
      succeeded++
      consecutive5xx = 0
      continue
    }
    failed++
    const status = result.status
    if (typeof status === 'number' && status >= 500 && status < 600) {
      consecutive5xx++
      if (consecutive5xx >= 3) {
        console.error('Three consecutive 5xx responses from Anthropic — aborting. Re-run later.')
        break
      }
    } else {
      consecutive5xx = 0
    }
  }

  console.log(`Backfill complete. ${succeeded} succeeded, ${failed} failed. Re-run to retry failures.`)
  process.exit(succeeded > 0 ? 0 : 1)
}

// Only run when invoked directly (preserves importability for tests).
const invokedPath = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : ''
if (import.meta.url === invokedPath) {
  main().catch(err => {
    console.error('Fatal:', err)
    process.exit(1)
  })
}
