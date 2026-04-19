/**
 * POST /api/swap-suggestions — Vercel serverless port of the Express route
 * in api-server.mjs. Keep the two in sync when changing prompt/model.
 */
import { anthropic, parseJsonLoose, sendUpstreamError } from './_lib/anthropic.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  if (!anthropic) return res.status(503).json({ error: 'api_key_missing' })

  const { planNames = '', recentNames = '' } = req.body || {}

  const prompt = `Suggest 3 specific, well-known dinner recipes different from what's already planned. Return ONLY a JSON array of 3 recipe name strings, no markdown.

Already in plan: ${planNames || 'none'}
Recently eaten: ${recentNames || 'none'}

["Recipe 1", "Recipe 2", "Recipe 3"]`

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = msg.content?.[0]?.text ?? ''
    const parsed = parseJsonLoose(text, /\[[\s\S]*\]/)
    if (!Array.isArray(parsed)) return res.status(502).json({ error: 'parse_failed' })
    return res.json({ names: parsed.slice(0, 3) })
  } catch (err) {
    return sendUpstreamError(res, err, 'swap-suggestions')
  }
}
