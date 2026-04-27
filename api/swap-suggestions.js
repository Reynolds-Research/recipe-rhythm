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

  // PRD-002 P0.9: `count` is optional. Single-day swaps still send no count
  // (default 1); the full-grid recommender sends count=AI_CANDIDATE_COUNT to
  // pull a small batch of AI candidates. Clamp to [1, 5] so a runaway client
  // can't ask for an unbounded number.
  const {
    planNames = '',
    recentNames = '',
    excludeNames = [],
    count = 1,
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

  const exampleArr = Array.from({ length: requestedCount }, (_, i) => `"Recipe ${i + 1}"`).join(', ')
  const noun = requestedCount === 1 ? 'recipe' : 'recipes'
  const arrNoun = requestedCount === 1 ? 'recipe name string' : 'recipe name strings'
  const prompt = `Suggest ${requestedCount} specific, well-known dinner ${noun} different from what's already planned. Return ONLY a JSON array of ${requestedCount} ${arrNoun}, no markdown.

Already in plan: ${planNames || 'none'}
Recently eaten: ${recentNames || 'none'}
${excludeBullets}
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
}
