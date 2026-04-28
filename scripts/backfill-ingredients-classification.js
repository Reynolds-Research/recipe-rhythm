/**
 * PRD-004 Phase A (P0.3): bulk-backfill ingredients_classified for every
 * existing vault row.
 *
 * Run via: `node scripts/backfill-ingredients-classification.js`
 *
 * Idempotent by construction — the WHERE clause excludes rows that already
 * have a non-null ingredients_classified, so re-running only retries
 * unfinished rows. Per-row failures log + continue. Three consecutive 5xx
 * responses from Anthropic trigger a hard stop (signal: API outage; user
 * should re-run later).
 *
 * Implementation note (vault shape): the vault has no free-form
 * `ingredients` column. The categorical tag arrays (proteins, vegetables,
 * fruits, dairy_components) plus the main_carb scalar ARE the ingredient-
 * name signal for this app — those are exactly the fields the current
 * preferenceFilter haystack scans for excluded-ingredient substrings.
 * `normalizeVaultRowToIngredients` collects + dedupes them into the
 * string[] the classifier expects. dietary_tags (gluten-free, etc.) are
 * deliberately excluded — those are dietary flags, not ingredient names.
 *
 * Service-role key is read from SUPABASE_SERVICE_ROLE_KEY at process start
 * and used to bypass RLS for the cross-user backfill. The key is NEVER
 * referenced from any browser-side code or VITE_-prefixed env var.
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { classifyIngredients } from '../src/lib/classifyIngredients.js'

const VAULT_INGREDIENT_FIELDS = ['proteins', 'main_carb', 'vegetables', 'fruits', 'dairy_components']

const SELECT_COLUMNS = `id, name, cuisine_type, ${VAULT_INGREDIENT_FIELDS.join(', ')}`

/**
 * Collect the ingredient-name string[] from a vault row's categorical
 * fields. Trims, drops empties, and dedupes case-insensitively while
 * preserving the first-seen casing.
 */
export function normalizeVaultRowToIngredients(row) {
  const seen = new Set()
  const out = []
  const push = (v) => {
    if (typeof v !== 'string') return
    const trimmed = v.trim()
    if (!trimmed) return
    const key = trimmed.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(trimmed)
  }
  for (const field of VAULT_INGREDIENT_FIELDS) {
    const v = row?.[field]
    if (Array.isArray(v)) v.forEach(push)
    else push(v)
  }
  return out
}

/**
 * Classify one vault row and persist the result. Pure-ish: every dependency
 * (Supabase client, classifier, Anthropic client, logger) is injected so
 * the unit test can drive it with mocks.
 *
 * Returns `{ ok, count? , reason?, error?, status? }`. Never throws — the
 * caller decides how to react to errors.
 */
export async function processRow({
  row,
  classifyImpl,
  anthropicClient,
  supabase,
  logger = console,
}) {
  const ingredients = normalizeVaultRowToIngredients(row)

  if (ingredients.length === 0) {
    // Persist [] so the row stops matching `ingredients_classified IS NULL`
    // on subsequent runs. Per PRD-004 OQ.A: empty == "no essential
    // ingredients" — the filter passes such recipes through.
    const { error } = await supabase
      .from('vault')
      .update({ ingredients_classified: [] })
      .eq('id', row.id)
    if (error) {
      logger.error(`[FAIL] ${row.id} ${row.name} update-empty: ${error.message || error}`)
      return { ok: false, reason: 'update', error }
    }
    logger.log(`[OK] ${row.id} ${row.name} (no ingredients — wrote [])`)
    return { ok: true, count: 0 }
  }

  let classifications
  try {
    const result = await classifyImpl({
      ingredients,
      recipeName: row.name,
      cuisine: row.cuisine_type ?? null,
      anthropicClient,
    })
    classifications = result.classifications
  } catch (err) {
    logger.error(`[FAIL] ${row.id} ${row.name} classify: ${err?.message || err}`)
    return { ok: false, reason: 'classify', error: err, status: err?.status }
  }

  const { error } = await supabase
    .from('vault')
    .update({ ingredients_classified: classifications })
    .eq('id', row.id)
  if (error) {
    logger.error(`[FAIL] ${row.id} ${row.name} update: ${error.message || error}`)
    return { ok: false, reason: 'update', error }
  }
  logger.log(`[OK] ${row.id} ${row.name} (${classifications.length} ingredients classified)`)
  return { ok: true, count: classifications.length }
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
    .select(SELECT_COLUMNS)
    .is('ingredients_classified', null)
    .order('id', { ascending: true })

  if (queryError) {
    console.error('Supabase query failed:', queryError.message || queryError)
    process.exit(1)
  }

  console.log(`Found ${rows.length} unclassified vault row(s).`)
  if (rows.length === 0) {
    console.log('Nothing to do.')
    process.exit(0)
  }

  let succeeded = 0
  let failed = 0
  let consecutive5xx = 0

  for (const row of rows) {
    const result = await processRow({
      row,
      classifyImpl: classifyIngredients,
      anthropicClient,
      supabase,
    })
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
