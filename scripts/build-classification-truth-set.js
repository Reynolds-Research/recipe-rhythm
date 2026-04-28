/**
 * PRD-004 Phase B (P0.4): build a ground-truth fixture for the
 * ingredient-classification accuracy eval.
 *
 * Run via:
 *   node scripts/build-classification-truth-set.js \
 *     [--count 25] \
 *     [--include-ids id1,id2,...] \
 *     [--out tests/fixtures/ingredient-classification-truth.json] \
 *     [--force]
 *
 * Reads non-deleted vault rows (service-role, bypasses RLS), random-samples
 * --count of them (always including any --include-ids), and writes a JSON
 * fixture with each ingredient's `essentiality` set to null. The user fills
 * those nulls in manually before running the eval — the eval script fails
 * loudly if any null remains.
 *
 * Important: this script does NOT call the AI. Including AI predictions in
 * the template would bias the user's ground-truth labels.
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
    includeIds: [],
    outPath: DEFAULT_OUT,
    force: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--count') {
      out.count = Number(argv[++i])
    } else if (a === '--include-ids') {
      out.includeIds = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean)
    } else if (a === '--out') {
      out.outPath = argv[++i]
    } else if (a === '--force') {
      out.force = true
    }
  }
  if (!Number.isFinite(out.count) || out.count <= 0) {
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

/**
 * Pick `count` rows from `all`, always including any row whose id is in
 * `includeIds`. If includeIds alone exceeds count, returns those.
 */
export function pickSample({ all, count, includeIds }) {
  const byId = new Map(all.map(r => [r.id, r]))
  const forced = includeIds
    .map(id => byId.get(id))
    .filter(Boolean)
  const forcedIds = new Set(forced.map(r => r.id))

  const pool = all.filter(r => !forcedIds.has(r.id))
  const remaining = Math.max(0, count - forced.length)
  const extra = shuffled(pool).slice(0, remaining)

  return [...forced, ...extra]
}

export function buildFixture({ rows, generatedAt = new Date().toISOString() }) {
  const recipes = rows.map(row => {
    const names = normalizeVaultRowToIngredients(row).map(n => n.toLowerCase().trim())
    return {
      vault_id: row.id,
      recipe_name: row.name,
      cuisine: row.cuisine_type ?? null,
      ingredients: names.map(name => ({ name, essentiality: null })),
    }
  })
  return {
    generated_at: generatedAt,
    count: recipes.length,
    instructions: INSTRUCTIONS,
    recipes,
  }
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

  const sample = pickSample({ all: rows, count: args.count, includeIds: args.includeIds })
  if (sample.length === 0) {
    console.error('Sample is empty after applying filters; aborting.')
    process.exit(1)
  }

  const fixture = buildFixture({ rows: sample })

  fs.mkdirSync(path.dirname(outAbs), { recursive: true })
  fs.writeFileSync(outAbs, JSON.stringify(fixture, null, 2) + '\n', 'utf8')

  const totalIngredients = fixture.recipes.reduce((n, r) => n + r.ingredients.length, 0)
  console.log(`Wrote ${args.outPath}`)
  console.log(`  ${fixture.count} recipe(s), ${totalIngredients} ingredient(s) to label.`)
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
