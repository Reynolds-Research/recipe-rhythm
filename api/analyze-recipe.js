/**
 * POST /api/analyze-recipe — Vercel serverless port of the Express route
 * in api-server.mjs. Keep the two in sync when changing prompt/model.
 */
import { anthropic, parseJsonLoose, sendUpstreamError } from './_lib/anthropic.js'
import { buildAnalyzeRecipePromptBlock } from '../src/lib/constants.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
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
}
