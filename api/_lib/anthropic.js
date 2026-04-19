/**
 * Shared Anthropic client + helpers for Vercel serverless functions.
 *
 * Mirrors the setup in api-server.mjs (used for local dev via
 * `npm run dev`). Both paths must stay in sync — if you change prompt
 * text, models, or response shape here, update api-server.mjs too.
 *
 * Files under api/_lib/ are not routable (Vercel convention: leading
 * underscore excludes from routes).
 */
import Anthropic from '@anthropic-ai/sdk'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

export const anthropic = ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  : null

export function parseJsonLoose(text, fallbackPattern) {
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(fallbackPattern)
    if (!match) return null
    try { return JSON.parse(match[0]) } catch { return null }
  }
}

export function sendUpstreamError(res, err, tag) {
  console.error(`[api] ${tag} upstream error:`, err?.status || '', err?.message || err)
  return res.status(502).json({ error: 'upstream_failed' })
}
