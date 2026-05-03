/**
 * Recipe Rhythm — server-side Anthropic proxy (LOCAL DEV ONLY).
 *
 * Exists so the Anthropic API key never reaches the browser. The client
 * posts to /api/* and this process forwards to Anthropic.
 *
 * Production (Vercel) uses the serverless functions under `api/` instead.
 * If you change a prompt, model, or response shape here, update the
 * matching file in `api/` too.
 *
 * TODO(security): these endpoints are currently open — anyone who can
 * reach the server can spend the Anthropic budget. Before public deploy,
 * add rate limiting (express-rate-limit) and session auth (e.g. verify a
 * Supabase JWT on each request). Applies to the `api/` serverless
 * versions as well.
 */

import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'
import 'dotenv/config'
import { buildAnalyzeRecipePromptBlock } from './src/lib/constants.js'
import { createClassifyIngredientsHandler } from './api/_lib/classifyHandler.js'
import { createGroceryListHandler } from './api/_lib/groceryListHandler.js'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const API_PORT = Number(process.env.API_PORT || 3001)

// Dev-only CORS: Vite serves the client on :5173. In production the
// proxy and client would share an origin (or this list would be replaced
// with the deployed client origin).
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173'

if (!ANTHROPIC_API_KEY) {
  console.warn('[api-server] ANTHROPIC_API_KEY is not set — AI endpoints will return 503.')
}

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null

const app = express()
app.use(cors({ origin: corsOrigin }))
app.use(express.json({ limit: '10mb' }))

// Request logger — logs one line per request with method, path, status, duration.
app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    const ms = Date.now() - start
    console.log(`[api-server] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`)
  })
  next()
})

function parseJsonLoose(text, fallbackPattern) {
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(fallbackPattern)
    if (!match) return null
    try { return JSON.parse(match[0]) } catch { return null }
  }
}

function sendUpstreamError(res, err, tag) {
  // Log the real error internally; return a generic one to the client.
  console.error(`[api-server] ${tag} upstream error:`, err?.status || '', err?.message || err)
  return res.status(502).json({ error: 'upstream_failed' })
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.post('/api/analyze-recipe', async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'api_key_missing' })

  const { name = '', url = '', imageBase64 = null, mediaType = null } = req.body || {}

  const content = []
  if (imageBase64 && mediaType) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: imageBase64 },
    })
  }

  let textPrompt = `Analyze this meal/recipe and return a JSON object with its components. Return ONLY valid JSON with no markdown or explanation.\n`
  if (name) textPrompt += `\nRecipe Name: "${name}"`
  if (url) textPrompt += `\nRecipe URL: "${url}"`
  if (imageBase64) textPrompt += `\n(See attached image)`

  textPrompt += '\n\n' + buildAnalyzeRecipePromptBlock()

  content.push({ type: 'text', text: textPrompt })

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 350,
      messages: [{ role: 'user', content }],
    })
    const text = msg.content?.[0]?.text ?? ''
    const parsed = parseJsonLoose(text, /\{[\s\S]*\}/)
    if (!parsed) return res.status(502).json({ error: 'parse_failed' })
    return res.json({ components: parsed })
  } catch (err) {
    return sendUpstreamError(res, err, 'analyze-recipe')
  }
})

// PRD-002 P0.3: render the household preferences as a structured prompt block.
// Returns '' when the field is missing or every sub-list is empty/null, so the
// upstream prompt is byte-for-byte unchanged for users without preferences.
// MUST stay in lockstep with api/swap-suggestions.js.
function buildPreferencesBlock(preferences) {
  if (!preferences || typeof preferences !== 'object') return ''
  const dietary = Array.isArray(preferences.dietary_restrictions)
    ? preferences.dietary_restrictions.filter(s => typeof s === 'string' && s.trim())
    : []
  const cuisines = Array.isArray(preferences.excluded_cuisines)
    ? preferences.excluded_cuisines.filter(s => typeof s === 'string' && s.trim())
    : []
  const ingredients = Array.isArray(preferences.excluded_ingredients)
    ? preferences.excluded_ingredients.filter(s => typeof s === 'string' && s.trim())
    : []
  const maxPrep = preferences.max_prep_time_minutes
  const hasMaxPrep = typeof maxPrep === 'number' && Number.isFinite(maxPrep) && maxPrep > 0
  if (
    dietary.length === 0 &&
    cuisines.length === 0 &&
    ingredients.length === 0 &&
    !hasMaxPrep
  ) {
    return ''
  }
  const fmt = (arr) => (arr.length ? arr.join(', ') : 'none')
  return `\nUser preferences (do not suggest recipes that violate any of these):
- Dietary restrictions: ${fmt(dietary)}
- Excluded cuisines: ${fmt(cuisines)}
- Excluded ingredients: ${fmt(ingredients)}
- Maximum prep time: ${hasMaxPrep ? `${maxPrep} minutes` : 'none'}\n`
}

app.post('/api/swap-suggestions', async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'api_key_missing' })

  // PRD-002 P0.9: `count` is optional. Single-day swaps still send no count
  // (default 1); the full-grid recommender sends count=AI_CANDIDATE_COUNT to
  // pull a small batch of AI candidates. Clamp to [1, 5] so a runaway client
  // can't ask for an unbounded number.
  const {
    planNames = '',
    recentNames = '',
    excludeNames = [],
    count = 1,
    preferences = null,
  } = req.body || {}
  const requestedCount = Math.max(1, Math.min(5, Number(count) || 1))

  // PRD-002 P0.8: excludeNames is the canonical string[] form. Accept a
  // comma-separated string for back-compat with older clients.
  const excludeArr = Array.isArray(excludeNames)
    ? excludeNames
    : String(excludeNames).split(',')
  const excludeList = excludeArr.map(n => String(n).trim()).filter(Boolean)
  const excludeBullets = excludeList.length
    ? `\nDo not suggest any of the following recipes (the user has just seen them):\n${excludeList.map(n => `- ${n}`).join('\n')}\n`
    : ''

  const preferencesBlock = buildPreferencesBlock(preferences)

  const exampleArr = Array.from({ length: requestedCount }, (_, i) => `"Recipe ${i + 1}"`).join(', ')
  const noun = requestedCount === 1 ? 'recipe' : 'recipes'
  const arrNoun = requestedCount === 1 ? 'recipe name string' : 'recipe name strings'
  const prompt = `Suggest ${requestedCount} specific, well-known dinner ${noun} different from what's already planned. Return ONLY a JSON array of ${requestedCount} ${arrNoun}, no markdown.

Already in plan: ${planNames || 'none'}
Recently eaten: ${recentNames || 'none'}
${excludeBullets}${preferencesBlock}
[${exampleArr}]`

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 60 + 40 * requestedCount,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = msg.content?.[0]?.text ?? ''
    const parsed = parseJsonLoose(text, /\[[\s\S]*\]/)
    if (!Array.isArray(parsed)) return res.status(502).json({ error: 'parse_failed' })

    // PRD-002 P0.8 belt-and-suspenders: drop any name the LLM still echoes back.
    const excludeSet = new Set(excludeList.map(n => n.toLowerCase()))
    const filtered = parsed.filter(
      n => typeof n === 'string' && !excludeSet.has(n.trim().toLowerCase()),
    )
    return res.json({ names: filtered.slice(0, requestedCount) })
  } catch (err) {
    return sendUpstreamError(res, err, 'swap-suggestions')
  }
})

// PRD-004 Phase A (P0.2): /api/classify-ingredients (Haiku 4.5).
// Validation + prompt + parse logic lives in api/_lib/classifyHandler.js so
// this route + the Vercel mirror in api/classify-ingredients.js stay in
// lockstep. Reuses the module-scoped `anthropic` client.
app.post('/api/classify-ingredients', createClassifyIngredientsHandler({ anthropic }))

// PRD-003 P0.3 (Bite B): /api/grocery-list (Haiku 4.5). Validation + prompt
// + parse logic lives in api/_lib/groceryListHandler.js so this route + the
// Vercel mirror in api/grocery-list.js stay in lockstep.
app.post('/api/grocery-list', createGroceryListHandler({ anthropic }))

// Spell-check + title-case a single meal/recipe name. Used by Vault add and
// LogMode save to standardize names before they're persisted. Haiku 4.5 —
// cheap, fast, and good enough for this kind of light correction. MUST stay
// in lockstep with api/normalize-meal-name.js.
app.post('/api/normalize-meal-name', async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'api_key_missing' })

  const raw = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!raw) return res.status(400).json({ error: 'name_required' })
  if (raw.length > 200) return res.status(400).json({ error: 'name_too_long' })

  const prompt = `You normalize meal/recipe names. Given the user's input, return ONLY a JSON object of the form {"corrected": "<name>"} with no markdown, no commentary.

Rules:
1. Fix obvious spelling mistakes (e.g. "spagheti" -> "spaghetti", "carbonera" -> "carbonara"). Preserve the user's intended dish; do not invent a different dish.
2. Apply Title Case: capitalize the first letter of each word, except keep articles/conjunctions/short prepositions lowercase mid-name (a, an, and, as, at, but, by, for, if, in, of, on, or, the, to, vs, via, with). Always capitalize the first and last word.
3. Preserve well-known acronyms in caps (BBQ, BLT, NY, LA).
4. Preserve proper nouns that name cuisines, regions, or people (Thai, Italian, Cajun, Caesar, Alfredo).
5. Do NOT add ingredients, descriptors, or punctuation that weren't in the input. Only fix typos and casing.
6. If the input is already correct, return it unchanged (still in Title Case).

Input: "${raw}"`

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = msg.content?.[0]?.text ?? ''
    const parsed = parseJsonLoose(text, /\{[\s\S]*\}/)
    if (!parsed || typeof parsed.corrected !== 'string' || !parsed.corrected.trim()) {
      return res.status(502).json({ error: 'parse_failed' })
    }
    return res.json({ corrected: parsed.corrected.trim() })
  } catch (err) {
    return sendUpstreamError(res, err, 'normalize-meal-name')
  }
})

app.listen(API_PORT, () => {
  console.log(`[api-server] listening on :${API_PORT} (CORS origin: ${corsOrigin})`)
})
