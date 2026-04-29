/**
 * POST /api/normalize-meal-name — Vercel serverless port of the Express
 * route in api-server.mjs. Keep the two in sync when changing prompt/model.
 *
 * Spell-checks + Title-cases a single meal name before persistence (Vault
 * add and LogMode save).
 */
import { anthropic, parseJsonLoose, sendUpstreamError } from './_lib/anthropic.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
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
}
