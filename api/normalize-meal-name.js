/**
 * POST /api/normalize-meal-name — Vercel serverless port of the Express
 * route in api-server.mjs. Both delegate to the shared handler so prompt,
 * model, and cache logic stay in lockstep automatically.
 *
 * ADR-004: server-side cache via classifyIngredientsCached's sister table
 * meal_name_normalizations_cache. supabaseAdmin is null when env vars
 * aren't configured ⇒ uncached pass-through (still functional).
 */
import { anthropic } from './_lib/anthropic.js'
import { supabaseAdmin } from './_lib/supabaseAdmin.js'
import { createNormalizeMealNameHandler } from './_lib/normalizeMealNameHandler.js'
import { requireAuth, AuthError } from './_lib/verifyAuth.js'
import { createRateLimiter, ENDPOINT_LIMITS, RateLimitError } from './_lib/rateLimit.js'

const handle = createNormalizeMealNameHandler({ anthropic, supabase: supabaseAdmin })
const checkLimit = createRateLimiter({ supabase: supabaseAdmin, maxRequests: ENDPOINT_LIMITS['normalize-meal-name'] })

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  try {
    const { user } = await requireAuth(req)
    req.user = user
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500
    return res.status(status).json({ error: err.message })
  }
  try {
    await checkLimit(req.user.id, 'normalize-meal-name')
  } catch (err) {
    if (err instanceof RateLimitError) {
      return res.status(429).setHeader('Retry-After', String(err.retryAfter))
        .json({ error: 'rate_limited', retry_after_seconds: err.retryAfter })
    }
  }
  return handle(req, res)
}
