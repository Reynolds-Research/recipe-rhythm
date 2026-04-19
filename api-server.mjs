/**
 * Recipe Rhythm — server-side Anthropic proxy.
 *
 * Exists so the Anthropic API key never reaches the browser. The client
 * posts to /api/* and this process forwards to Anthropic.
 *
 * TODO(deploy): this is a standalone Node process. Production options:
 *   - Render / Fly.io / Railway — run `node api-server.mjs` as a service.
 *   - Vercel / Netlify / Cloudflare functions — port each route to a
 *     serverless function; the shape of the handlers here is deliberately
 *     thin so that conversion is mostly copy/paste.
 *   Either way, set ANTHROPIC_API_KEY as a server-only env var (no VITE_
 *   prefix) and tighten the CORS origin (see `corsOrigin` below) to the
 *   production client origin.
 *
 * TODO(security): these endpoints are currently open — anyone who can
 * reach the server can spend the Anthropic budget. Before public deploy,
 * add rate limiting (express-rate-limit) and session auth (e.g. verify a
 * Supabase JWT on each request).
 */

import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'
import 'dotenv/config'

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

  textPrompt += `\n
{
  "cuisine_type": one of [American, Chinese, French, Greek, Indian, Italian, Japanese, Korean, Mexican, Middle Eastern, Spanish, Thai, Vietnamese, Other] or null,
  "flavor_profile": one of [Savory, Spicy, Umami, Fresh, Rich, Sweet, Tangy] or null,
  "proteins": array from [Chicken, Beef, Pork, Fish, Shrimp/Seafood, Tofu, Eggs, Beans/Lentils, Lamb, Turkey, Duck, None],
  "cooking_method": one of [Grilled, Baked, Roasted, Stir-fried, Braised, Soup/Stew, Fried, Steamed, Raw/Salad, Pan-seared, Slow-cooked, Smoked] or null,
  "main_carb": one of [Rice, Pasta, Noodles, Bread, Potato, Quinoa, Couscous, Polenta, Tortilla/Wrap, None] or null,
  "dietary_tags": array from [Vegetarian, Vegan, Gluten-Free, Dairy-Free, Low-Carb, High-Protein, Nut-Free, Paleo],
  "dairy_components": array from [Cheese, Cream, Butter, Milk, Yogurt, Parmesan, Mozzarella, None],
  "vegetables": array from [Tomato, Spinach/Greens, Mushrooms, Bell Peppers, Onion/Garlic, Broccoli, Zucchini, Eggplant, Carrot, Corn, Peas, Cucumber, Asparagus, Sweet Potato, Cauliflower, Brussels Sprouts, Celery, Cabbage],
  "fruits": array from [Avocado, Lemon/Lime, Orange, Apple, Mango, Pineapple, Berries, Banana, Coconut, Peach, Pomegranate, Grapes]
}`

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

app.post('/api/swap-suggestions', async (req, res) => {
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
})

app.listen(API_PORT, () => {
  console.log(`[api-server] listening on :${API_PORT} (CORS origin: ${corsOrigin})`)
})
