/**
 * Shared request handler for /api/normalize-meal-name.
 *
 * Spell-checks + Title-cases a single meal name via Haiku 4.5. Both
 * api-server.mjs (Express) and api/normalize-meal-name.js (Vercel mirror)
 * delegate here so prompt + cache logic live in exactly one place.
 *
 * ADR-004: cache-aware. Before calling Anthropic we look the normalized
 * input up in meal_name_normalizations_cache; on miss we call AI and
 * write the (input_norm → corrected) pair back. supabase=null disables
 * caching entirely (graceful degrade for missing env vars).
 *
 * The shape `(req, res) => Promise<void>` matches both runtimes — Express
 * 5 and Vercel both expose req.body (JSON-parsed by the framework) and a
 * Node-style res with .status().json(). Method-not-allowed handling stays
 * in the Vercel mirror; Express dispatches by method already.
 */
import { parseJsonLoose, sendUpstreamError } from './anthropic.js'
import { normalizeForCache } from './supabaseAdmin.js'

const CACHE_TABLE = 'meal_name_normalizations_cache'
const MODEL = 'claude-haiku-4-5-20251001'
const MAX_INPUT_LEN = 200

const PROMPT_TEMPLATE = (raw) => `You normalize meal/recipe names. Given the user's input, return ONLY a JSON object of the form {"corrected": "<name>"} with no markdown, no commentary.

Rules:
1. Fix obvious spelling mistakes (e.g. "spagheti" -> "spaghetti", "carbonera" -> "carbonara"). Preserve the user's intended dish; do not invent a different dish.
2. Apply Title Case: capitalize the first letter of each word, except keep articles/conjunctions/short prepositions lowercase mid-name (a, an, and, as, at, but, by, for, if, in, of, on, or, the, to, vs, via, with). Always capitalize the first and last word.
3. Preserve well-known acronyms in caps (BBQ, BLT, NY, LA).
4. Preserve proper nouns that name cuisines, regions, or people (Thai, Italian, Cajun, Caesar, Alfredo).
5. Do NOT add ingredients, descriptors, or punctuation that weren't in the input. Only fix typos and casing.
6. If the input is already correct, return it unchanged (still in Title Case).

Input: "${raw}"`

/**
 * Read-side cache lookup. Returns the cached `corrected` value, or null on
 * miss / error / supabase unavailable. Errors are logged and swallowed so
 * the request never fails from a cache problem.
 */
async function readCache(supabase, inputNorm) {
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .from(CACHE_TABLE)
      .select('corrected')
      .eq('input_norm', inputNorm)
      .maybeSingle()
    if (error) {
      console.error('[normalize-meal-name] cache read error:', error.message)
      return null
    }
    return data && typeof data.corrected === 'string' ? data.corrected : null
  } catch (err) {
    console.error('[normalize-meal-name] cache read threw:', err?.message || err)
    return null
  }
}

/**
 * Write-side cache write. Honors first-answer-wins via ON CONFLICT DO
 * NOTHING (ignoreDuplicates: true on upsert). Errors are logged and
 * swallowed.
 */
async function writeCache(supabase, inputNorm, corrected) {
  if (!supabase) return
  try {
    const { error } = await supabase
      .from(CACHE_TABLE)
      .upsert(
        [{ input_norm: inputNorm, corrected }],
        { onConflict: 'input_norm', ignoreDuplicates: true },
      )
    if (error) {
      console.error('[normalize-meal-name] cache write error:', error.message)
    }
  } catch (err) {
    console.error('[normalize-meal-name] cache write threw:', err?.message || err)
  }
}

export function createNormalizeMealNameHandler({ anthropic, supabase = null, tag = 'normalize-meal-name' } = {}) {
  return async function normalizeMealNameHandler(req, res) {
    if (!anthropic) return res.status(503).json({ error: 'api_key_missing' })

    const raw = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    if (!raw) return res.status(400).json({ error: 'name_required' })
    if (raw.length > MAX_INPUT_LEN) return res.status(400).json({ error: 'name_too_long' })

    // === Cache lookup ===
    const inputNorm = normalizeForCache(raw)
    if (inputNorm) {
      const cached = await readCache(supabase, inputNorm)
      if (cached) {
        return res.json({ corrected: cached })
      }
    }

    // === Cache miss → call Anthropic ===
    try {
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 100,
        messages: [{ role: 'user', content: PROMPT_TEMPLATE(raw) }],
      })
      const text = msg.content?.[0]?.text ?? ''
      const parsed = parseJsonLoose(text, /\{[\s\S]*\}/)
      if (!parsed || typeof parsed.corrected !== 'string' || !parsed.corrected.trim()) {
        return res.status(502).json({ error: 'parse_failed' })
      }
      const corrected = parsed.corrected.trim()

      // === Cache write — fire-and-await but never block the response on errors ===
      if (inputNorm) {
        await writeCache(supabase, inputNorm, corrected)
      }

      return res.json({ corrected })
    } catch (err) {
      return sendUpstreamError(res, err, tag)
    }
  }
}
