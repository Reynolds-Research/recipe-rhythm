/**
 * PRD-004 Phase B (P0.4): build a ground-truth fixture for the
 * ingredient-classification accuracy eval.
 *
 * Run via:
 *   node scripts/build-classification-truth-set.js \
 *     [--count 25 | --max-available] \
 *     [--include-ids id1,id2,...] \
 *     [--from-existing path/to/old-truth.json] \
 *     [--out tests/fixtures/ingredient-classification-truth.json] \
 *     [--force]
 *
 * Reads non-deleted vault rows (service-role, bypasses RLS), dedupes by
 * recipe name (case-insensitive, preferring populated rows over empty
 * ones), random-samples --count of them, and writes a JSON fixture with
 * each ingredient's `essentiality` set to null. The user fills those
 * nulls in manually before running the eval — the eval script fails
 * loudly if any null remains.
 *
 * --from-existing copies labels from a prior truth file by
 * (recipe_name, ingredient_name) match. Lets you grow the eval set
 * without re-labeling the recipes you already labeled.
 *
 * --max-available uses every unique recipe in the vault (after dedup),
 * useful when the vault doesn't have enough rows to support the
 * default count.
 *
 * Important: this script does NOT call the AI. Including AI predictions
 * in the template would bias the user's ground-truth labels.
 *
 * Refuses to overwrite an existing output file unless --force is passed,
 * so a partially-filled truth set isn't accidentally clobbered on re-run.
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { normalizeVaultRowToIngredients } from './backfill-ingredients-classification.js'

const VAULT_INGREDIENT_FIELDS = ['proteins', 'main_carb', 'vegetables', 'fruits', 'dairy_components']
const SELECT_COLUMNS = `id, name, cuisine_type, deleted_at, ${VAULT_INGREDIENT_FIELDS.join(', ')}`

const DEFAULT_OUT = 'tests/fixtures/ingredient-classification-truth.json'
const DEFAULT_COUNT = 25

const INSTRUCTIONS =
  "Set each ingredient's essentiality to either 'essential' or 'omittable'. " +
  "Do NOT consult the AI's classification while filling this in — that biases the eval. " +
  'The eval script will fail with a clear error if any null values remain.'

export function parseArgs(argv) {
  const out = {
    count: DEFAULT_COUNT,
    maxAvailable: false,
    includeIds: [],
    fromExisting: null,
    outPath: DEFAULT_OUT,
    force: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--count') {
      out.count = Number(argv[++i])
    } else if (a === '--max-available') {
      out.maxAvailable = true
    } else if (a === '--include-ids') {
      out.includeIds = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean)
    } else if (a === '--from-existing') {
      out.fromExisting = argv[++i]
    } else if (a === '--out') {
      out.outPath = argv[++i]
    } else if (a === '--force') {
      out.force = true
    }
  }
  if (!out.maxAvailable && (!Number.isFinite(out.count) || out.count <= 0)) {
    throw new Error(`--count must be a positive number (got ${out.count})`)
  }
  return out
}

/**
 * Fisher-Yates shuffle. Returns a new array; doesn't mutate the input.
 */
function shuffled(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const lower = (s) => String(s ?? '').trim().toLowerCase()

/**
 * Dedupe vault rows by recipe name (case-insensitive). When multiple rows
 * share a name, prefer:
 *   1. rows whose vault_id is in `priorityIds` (e.g. the previously-labeled
 *      copy, if --from-existing is in play)
 *   2. rows with more populated ingredient cells (drop empty-ingredient
 *      junk rows in favor of useful ones)
 *   3. lowest vault_id alphabetically (deterministic tiebreak)
 *
 * Returns at most one row per unique lowercased+trimmed `name`.
 */
export function dedupeByName(rows, { priorityIds = [] } = {}) {
  const priority = new Set(priorityIds)
  const groups = new Map()
  for (const row of rows) {
    const key = lower(row.name)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  const out = []
  for (const [, group] of groups) {
    group.sort((a, b) => {
      const aPri = priority.has(a.id) ? 1 : 0
      const bPri = priority.has(b.id) ? 1 : 0
      if (aPri !== bPri) return bPri - aPri
      const aLen = normalizeVaultRowToIngredients(a).length
      const bLen = normalizeVaultRowToIngredients(b).length
      if (aLen !== bLen) return bLen - aLen
      return String(a.id).localeCompare(String(b.id))
    })
    out.push(group[0])
  }
  return out
}

/**
 * Pick `count` rows from `dedupedRows`, always including any row whose
 * id is in `includeIds`. If includeIds alone exceeds count, returns all
 * of them. If `maxAvailable` is true, returns every row in the input
 * (count is ignored).
 */
export function pickSample({ dedupedRows, count, includeIds, maxAvailable = false }) {
  if (maxAvailable) return shuffled(dedupedRows)

  const byId = new Map(dedupedRows.map(r => [r.id, r]))
  const forced = includeIds.map(id => byId.get(id)).filter(Boolean)
  const forcedIds = new Set(forced.map(r => r.id))

  const pool = dedupedRows.filter(r => !forcedIds.has(r.id))
  const remaining = Math.max(0, count - forced.length)
  const extra = shuffled(pool).slice(0, remaining)

  return [...forced, ...extra]
}

/**
 * Read a prior truth-set file and build a lookup:
 *   Map<lower(recipe_name), Map<lower(ingredient_name), essentiality>>
 *
 * Returns an empty map and the empty array of priority IDs when the path
 * is null or the file is missing/malformed (callers can ignore those
 * cases — the new fixture will just have all nulls).
 */
export function loadExistingLabels(filePath) {
  if (!filePath) return { labels: new Map(), priorityIds: [] }
  const abs = path.resolve(filePath)
  if (!fs.existsSync(abs)) {
    console.warn(`--from-existing: ${filePath} does not exist; ignoring.`)
    return { labels: new Map(), priorityIds: [] }
  }
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch (err) {
    console.warn(`--from-existing: failed to parse ${filePath}: ${err.message}; ignoring.`)
    return { labels: new Map(), priorityIds: [] }
  }
  if (!parsed || !Array.isArray(parsed.recipes)) {
    return { labels: new Map(), priorityIds: [] }
  }
  const labels = new Map()
  const priorityIds = []
  for (const r of parsed.recipes) {
    if (r?.vault_id) priorityIds.push(r.vault_id)
    const nameKey = lower(r?.recipe_name)
    if (!nameKey) continue
    const inner = labels.get(nameKey) ?? new Map()
    for (const ing of (r.ingredients || [])) {
      const ingKey = lower(ing?.name)
      if (!ingKey) continue
      // First occurrence wins. Skip explicit nulls so a partially-filled
      // prior fixture doesn't overwrite a labeled ingredient with null.
      if (inner.has(ingKey)) continue
      if (ing.essentiality !== 'essential' && ing.essentiality !== 'omittable') continue
      inner.set(ingKey, {
        essentiality: ing.essentiality,
        borderline: typeof ing.borderline === 'string' ? ing.borderline : null,
      })
    }
    labels.set(nameKey, inner)
  }
  return { labels, priorityIds }
}

export function buildFixture({ rows, generatedAt = new Date().toISOString(), existingLabels = new Map() }) {
  const recipes = rows.map(row => {
    const names = normalizeVaultRowToIngredients(row).map(n => n.toLowerCase().trim())
    const labelMap = existingLabels.get(lower(row.name)) ?? new Map()
    return {
      vault_id: row.id,
      recipe_name: row.name,
      cuisine: row.cuisine_type ?? null,
      ingredients: names.map(name => {
        const prior = labelMap.get(name)
        const out = { name, essentiality: null }
        if (prior && (prior.essentiality === 'essential' || prior.essentiality === 'omittable')) {
          out.essentiality = prior.essentiality
          if (prior.borderline) out.borderline = prior.borderline
        }
        return out
      }),
    }
  })
  return {
    generated_at: generatedAt,
    count: recipes.length,
    instructions: INSTRUCTIONS,
    recipes,
  }
}

/**
 * Count how many ingredient cells in the fixture are still null
 * (need labeling).
 */
export function countUnfilled(fixture) {
  let n = 0
  for (const r of (fixture?.recipes || [])) {
    for (const i of (r.ingredients || [])) {
      if (i.essentiality !== 'essential' && i.essentiality !== 'omittable') n++
    }
  }
  return n
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const missing = []
  if (!SUPABASE_URL) missing.push('SUPABASE_URL (or VITE_SUPABASE_URL)')
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(', ')}`)
    process.exit(1)
  }

  const outAbs = path.resolve(args.outPath)
  if (fs.existsSync(outAbs) && !args.force) {
    console.error(
      `Refusing to overwrite ${args.outPath} (pass --force to clobber it).\n` +
      'A partially-filled truth set is the most likely cause of this file existing.',
    )
    process.exit(1)
  }

  const { labels: existingLabels, priorityIds } = loadExistingLabels(args.fromExisting)
  if (args.fromExisting) {
    console.log(`Loaded ${existingLabels.size} recipe label group(s) from ${args.fromExisting}`)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: rows, error } = await supabase
    .from('vault')
    .select(SELECT_COLUMNS)
    .is('deleted_at', null)
    .order('id', { ascending: true })

  if (error) {
    console.error('Supabase query failed:', error.message || error)
    process.exit(1)
  }
  if (!rows || rows.length === 0) {
    console.error('No active vault rows found. Nothing to sample.')
    process.exit(1)
  }

  const deduped = dedupeByName(rows, { priorityIds })
  console.log(`Vault: ${rows.length} non-deleted rows → ${deduped.length} unique recipe names after dedup.`)

  if (!args.maxAvailable && args.count > deduped.length) {
    console.warn(
      `Requested --count ${args.count} but only ${deduped.length} unique recipes available. ` +
      `Capping at ${deduped.length}. (Pass --max-available to silence this warning.)`,
    )
  }

  const sample = pickSample({
    dedupedRows: deduped,
    count: args.count,
    includeIds: args.includeIds,
    maxAvailable: args.maxAvailable,
  })
  if (sample.length === 0) {
    console.error('Sample is empty after applying filters; aborting.')
    process.exit(1)
  }

  const fixture = buildFixture({ rows: sample, existingLabels })

  fs.mkdirSync(path.dirname(outAbs), { recursive: true })
  fs.writeFileSync(outAbs, JSON.stringify(fixture, null, 2) + '\n', 'utf8')

  const totalIngredients = fixture.recipes.reduce((n, r) => n + r.ingredients.length, 0)
  const unfilled = countUnfilled(fixture)
  const preserved = totalIngredients - unfilled
  console.log(`Wrote ${args.outPath}`)
  console.log(`  ${fixture.count} recipe(s), ${totalIngredients} ingredient(s) total.`)
  if (args.fromExisting) {
    console.log(`  ${preserved} label(s) preserved from --from-existing, ${unfilled} new label(s) needed.`)
  } else {
    console.log(`  ${unfilled} ingredient(s) to label.`)
  }
  console.log('Next: open the file, set every essentiality to "essential" or "omittable", then run')
  console.log('  node scripts/eval-classification-accuracy.js')
}

const invokedPath = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : ''
if (import.meta.url === invokedPath) {
  main().catch(err => {
    console.error('Fatal:', err)
    process.exit(1)
  })
}
