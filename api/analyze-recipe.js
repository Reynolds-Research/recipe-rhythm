/**
 * POST /api/analyze-recipe — Vercel serverless port of the Express route
 * in api-server.mjs. Keep the two in sync when changing prompt/model.
 *
 * PRD-006 P0.2: logic lives in api/_lib/analyzeRecipeHandler.js so this
 * file and api-server.mjs stay in lockstep automatically.
 */
import { anthropic } from './_lib/anthropic.js'
import { supabaseAdmin } from './_lib/supabaseAdmin.js'
import { createAnalyzeRecipeHandler } from './_lib/analyzeRecipeHandler.js'
import { requireAuth, AuthError } from './_lib/verifyAuth.js'
import { createRateLimiter, ENDPOINT_LIMITS, RateLimitError } from './_lib/rateLimit.js'

// ADR-004: pass the Supabase service-role client so analyze-recipe's
// internal call to classifyIngredientsCached can read/write the cross-user
// classification cache. Null when env vars aren't set ⇒ caching disabled,
// AI still works.
const handler = createAnalyzeRecipeHandler({ anthropic, supabase: supabaseAdmin })
const checkLimit = createRateLimiter({ supabase: supabaseAdmin, maxRequests: ENDPOINT_LIMITS['analyze-recipe'] })

export default async function analyzeRecipeServerless(req, res) {
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
    await checkLimit(req.user.id, 'analyze-recipe')
  } catch (err) {
    if (err instanceof RateLimitError) {
      return res.status(429).setHeader('Retry-After', String(err.retryAfter))
        .json({ error: 'rate_limited', retry_after_seconds: err.retryAfter })
    }
  }
  return handler(req, res)
}
