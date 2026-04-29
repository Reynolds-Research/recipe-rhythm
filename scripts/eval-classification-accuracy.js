/**
 * PRD-004 Phase B (P0.5): runs the AI classifier against a hand-labeled
 * ground-truth set and reports precision / recall on the 'essential' call.
 *
 * Run via:
 *   node scripts/eval-classification-accuracy.js \
 *     [--truth tests/fixtures/ingredient-classification-truth.json] \
 *     [--report eval-report.json]
 *
 * No Supabase. Reads the local truth fixture, calls
 * src/lib/classifyIngredients.js (the same helper the endpoint uses) once
 * per recipe, and computes per-ingredient agreement.
 *
 * Threshold: precision on 'essential' must be ≥ 85% (false-essentials are
 * what cause wrongful hiding — the exact problem PRD-004 is solving).
 *
 * Exit code: 0 if precision ≥ threshold, 1 otherwise.
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { classifyIngredients } from '../src/lib/classifyIngredients.js'

const DEFAULT_TRUTH = 'tests/fixtures/ingredient-classification-truth.json'
const DEFAULT_REPORT = 'eval-report.json'
const ESSENTIAL_PRECISION_THRESHOLD = 0.85
// If too many ingredients can't be matched between truth and AI output
// (because the AI normalized names differently), the precision metric is
// computed on a small sample and stops being meaningful. Gate match-rate
// alongside precision so silent name-canonicalization regressions can't
// hide behind a passing precision number.
const MATCH_RATE_THRESHOLD = 0.80

export function parseArgs(argv) {
  const out = { truthPath: DEFAULT_TRUTH, reportPath: DEFAULT_REPORT }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--truth') out.truthPath = argv[++i]
    else if (a === '--report') out.reportPath = argv[++i]
  }
  return out
}

/**
 * Validate that every truth-set ingredient has an essentiality value set.
 * Returns { ok: true } or { ok: false, unfilled: [{recipe, ingredient}] }.
 */
export function validateTruthSet(truth) {
  const unfilled = []
  if (!truth || !Array.isArray(truth.recipes)) {
    return { ok: false, unfilled, fatal: 'truth file missing `recipes` array' }
  }
  for (const recipe of truth.recipes) {
    if (!Array.isArray(recipe.ingredients)) continue
    for (const ing of recipe.ingredients) {
      if (ing.essentiality !== 'essential' && ing.essentiality !== 'omittable') {
        unfilled.push({ recipe: recipe.recipe_name, ingredient: ing.name })
      }
    }
  }
  return { ok: unfilled.length === 0, unfilled }
}

const norm = (s) => String(s || '').toLowerCase().trim()

/**
 * Build per-ingredient comparison records for one recipe.
 * Truth ingredients without a matching AI classification are recorded as
 * `ai = null` (counted in `unmatched`, not in the confusion matrix).
 * AI classifications without a matching truth entry are recorded as
 * `truth = null`.
 */
export function compareRecipe({ truthRecipe, aiClassifications }) {
  const truthByName = new Map(
    (truthRecipe.ingredients || []).map(i => [norm(i.name), i]),
  )
  const aiByName = new Map(
    (aiClassifications || []).map(c => [norm(c.name), c]),
  )

  const records = []
  const truthKeys = Array.from(truthByName.keys())
  const aiKeys = Array.from(aiByName.keys())
  const seen = new Set()

  for (const key of truthKeys) {
    seen.add(key)
    const truth = truthByName.get(key)
    const ai = aiByName.get(key)
    records.push({
      recipe_name: truthRecipe.recipe_name,
      vault_id: truthRecipe.vault_id,
      ingredient: truth.name,
      truth: truth.essentiality,
      ai: ai ? ai.essentiality : null,
      agree: ai ? ai.essentiality === truth.essentiality : null,
    })
  }
  for (const key of aiKeys) {
    if (seen.has(key)) continue
    const ai = aiByName.get(key)
    records.push({
      recipe_name: truthRecipe.recipe_name,
      vault_id: truthRecipe.vault_id,
      ingredient: ai.name,
      truth: null,
      ai: ai.essentiality,
      agree: null,
    })
  }
  return records
}

/**
 * Pure metric calculator. Takes per-ingredient records (from compareRecipe)
 * and returns the confusion matrix + derived precision/recall/accuracy.
 *
 * Records where `truth` or `ai` is null are excluded from the confusion
 * matrix and counted under `unmatched` instead.
 *
 * Edge case: when a denominator is zero (e.g. AI never said 'essential'),
 * the corresponding precision/recall is `null` rather than NaN. The
 * `passes` flag treats `null` precision as a failure — better to surface
 * than silently call it a pass.
 */
export function computeMetrics(records) {
  const matrix = { aiE_truthE: 0, aiE_truthO: 0, aiO_truthE: 0, aiO_truthO: 0 }
  let unmatched = 0
  for (const r of records) {
    if (r.truth == null || r.ai == null) { unmatched++; continue }
    if (r.ai === 'essential' && r.truth === 'essential') matrix.aiE_truthE++
    else if (r.ai === 'essential' && r.truth === 'omittable') matrix.aiE_truthO++
    else if (r.ai === 'omittable' && r.truth === 'essential') matrix.aiO_truthE++
    else if (r.ai === 'omittable' && r.truth === 'omittable') matrix.aiO_truthO++
  }

  const matched = matrix.aiE_truthE + matrix.aiE_truthO + matrix.aiO_truthE + matrix.aiO_truthO
  const div = (n, d) => (d === 0 ? null : n / d)

  const precisionEssential = div(matrix.aiE_truthE, matrix.aiE_truthE + matrix.aiE_truthO)
  const recallEssential    = div(matrix.aiE_truthE, matrix.aiE_truthE + matrix.aiO_truthE)
  const precisionOmittable = div(matrix.aiO_truthO, matrix.aiO_truthO + matrix.aiO_truthE)
  const recallOmittable    = div(matrix.aiO_truthO, matrix.aiO_truthO + matrix.aiE_truthO)
  const accuracy           = div(matrix.aiE_truthE + matrix.aiO_truthO, matched)
  const matchRate          = div(matched, records.length)

  const precisionPasses =
    precisionEssential != null && precisionEssential >= ESSENTIAL_PRECISION_THRESHOLD
  const matchRatePasses =
    matchRate != null && matchRate >= MATCH_RATE_THRESHOLD
  const passes = precisionPasses && matchRatePasses

  return {
    total: records.length,
    matched,
    unmatched,
    matrix,
    precisionEssential,
    recallEssential,
    precisionOmittable,
    recallOmittable,
    accuracy,
    matchRate,
    precisionThreshold: ESSENTIAL_PRECISION_THRESHOLD,
    matchRateThreshold: MATCH_RATE_THRESHOLD,
    threshold: ESSENTIAL_PRECISION_THRESHOLD,
    precisionPasses,
    matchRatePasses,
    passes,
  }
}

const fmtPct = (v) => (v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`)

export function renderReport({ metrics, records }) {
  const lines = []
  const verdict = metrics.passes ? 'PASS' : 'FAIL'
  const precisionVerdict = metrics.precisionPasses ? 'pass' : 'FAIL'
  const matchVerdict = metrics.matchRatePasses ? 'pass' : 'FAIL'
  lines.push('')
  lines.push('=== Ingredient Classification Eval ===')
  lines.push(`Overall: ${verdict}`)
  lines.push(
    `  Precision on 'essential': ${fmtPct(metrics.precisionEssential)} ` +
    `(threshold ${fmtPct(metrics.precisionThreshold)}) — ${precisionVerdict}`,
  )
  lines.push(
    `  Match rate (truth ↔ AI):  ${fmtPct(metrics.matchRate)} ` +
    `(threshold ${fmtPct(metrics.matchRateThreshold)}) — ${matchVerdict}`,
  )
  lines.push('')
  lines.push('Confusion matrix (rows = AI, cols = truth):')
  lines.push('              truth=essential  truth=omittable')
  lines.push(`  ai=essential  ${String(metrics.matrix.aiE_truthE).padStart(15)}  ${String(metrics.matrix.aiE_truthO).padStart(15)}`)
  lines.push(`  ai=omittable  ${String(metrics.matrix.aiO_truthE).padStart(15)}  ${String(metrics.matrix.aiO_truthO).padStart(15)}`)
  lines.push('')
  lines.push(`Total ingredients: ${metrics.total}  (matched: ${metrics.matched}, unmatched: ${metrics.unmatched})`)
  lines.push(`Overall accuracy:        ${fmtPct(metrics.accuracy)}`)
  lines.push(`Precision (essential):   ${fmtPct(metrics.precisionEssential)}`)
  lines.push(`Recall    (essential):   ${fmtPct(metrics.recallEssential)}`)
  lines.push(`Precision (omittable):   ${fmtPct(metrics.precisionOmittable)}`)
  lines.push(`Recall    (omittable):   ${fmtPct(metrics.recallOmittable)}`)
  lines.push('')

  const errors = records
    .filter(r => r.agree === false)
    .sort((a, b) => a.recipe_name.localeCompare(b.recipe_name))
    .slice(0, 10)
  if (errors.length) {
    lines.push('Top errors (up to 10, sorted by recipe):')
    for (const e of errors) {
      lines.push(`  [${e.recipe_name}] '${e.ingredient}': you said ${e.truth}, AI said ${e.ai}`)
    }
  } else {
    lines.push('No disagreements 🎉')
  }
  if (metrics.unmatched > 0) {
    const unmatched = records.filter(r => r.truth == null || r.ai == null)
    lines.push('')
    lines.push(`Unmatched ingredients (${unmatched.length}) — names did not align between truth and AI:`)
    for (const u of unmatched.slice(0, 10)) {
      const where = u.truth == null ? 'AI-only' : 'truth-only'
      lines.push(`  [${u.recipe_name}] '${u.ingredient}' (${where})`)
    }
    if (unmatched.length > 10) lines.push(`  ... ${unmatched.length - 10} more`)
  }
  lines.push('')
  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  if (!ANTHROPIC_API_KEY) {
    console.error('Missing required env: ANTHROPIC_API_KEY')
    process.exit(1)
  }

  const truthAbs = path.resolve(args.truthPath)
  if (!fs.existsSync(truthAbs)) {
    console.error(
      `Truth file not found at ${args.truthPath}.\n` +
      'Run `node scripts/build-classification-truth-set.js` first, then fill in essentialities.',
    )
    process.exit(1)
  }
  let truth
  try {
    truth = JSON.parse(fs.readFileSync(truthAbs, 'utf8'))
  } catch (err) {
    console.error(`Failed to parse ${args.truthPath}: ${err.message}`)
    process.exit(1)
  }

  const validation = validateTruthSet(truth)
  if (!validation.ok) {
    if (validation.fatal) {
      console.error(`Truth file invalid: ${validation.fatal}`)
      process.exit(1)
    }
    console.error(`Truth file has ${validation.unfilled.length} unfilled ingredient(s):`)
    for (const u of validation.unfilled) {
      console.error(`  [${u.recipe}] '${u.ingredient}' — essentiality is null`)
    }
    console.error('\nFill these in (essential | omittable) and re-run.')
    process.exit(1)
  }

  const anthropicClient = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

  const allRecords = []
  for (const recipe of truth.recipes) {
    const ingredientNames = recipe.ingredients.map(i => i.name)
    if (ingredientNames.length === 0) continue
    let aiClassifications = []
    try {
      const result = await classifyIngredients({
        ingredients: ingredientNames,
        recipeName: recipe.recipe_name,
        cuisine: recipe.cuisine ?? null,
        anthropicClient,
      })
      aiClassifications = result.classifications
    } catch (err) {
      console.error(`[FAIL] classify ${recipe.recipe_name}: ${err?.message || err}`)
      // Record all truth ingredients as unmatched so they show up in the report.
      aiClassifications = []
    }
    const records = compareRecipe({ truthRecipe: recipe, aiClassifications })
    allRecords.push(...records)
  }

  const metrics = computeMetrics(allRecords)
  console.log(renderReport({ metrics, records: allRecords }))

  const reportAbs = path.resolve(args.reportPath)
  fs.writeFileSync(
    reportAbs,
    JSON.stringify({
      generated_at: new Date().toISOString(),
      truth_file: args.truthPath,
      threshold: ESSENTIAL_PRECISION_THRESHOLD,
      metrics,
      records: allRecords,
    }, null, 2) + '\n',
    'utf8',
  )
  console.log(`Wrote structured report: ${args.reportPath}`)

  process.exit(metrics.passes ? 0 : 1)
}

const invokedPath = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : ''
if (import.meta.url === invokedPath) {
  main().catch(err => {
    console.error('Fatal:', err)
    process.exit(1)
  })
}
