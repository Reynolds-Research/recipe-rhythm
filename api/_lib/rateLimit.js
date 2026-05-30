/**
 * Per-user API rate limiter (PRD-001 P1.6 Phase 2).
 *
 * Uses a Postgres table (api_rate_limits) as the counter store. Each
 * (user_id, endpoint, window_start) triple is upserted atomically via the
 * increment_api_rate_limit RPC. Requires the service-role Supabase client
 * (supabaseAdmin) — never called with the anon client.
 *
 * Limits (per minute per user):
 *   analyze-recipe:       20  (Sonnet 4.6 — most expensive)
 *   swap-suggestions:     60  (Haiku 4.5)
 *   classify-ingredients: 60  (Haiku 4.5)
 *   grocery-list:         60  (Haiku 4.5)
 *   normalize-meal-name:  60  (Haiku 4.5)
 *
 * Graceful degrade: if supabase is null (env vars missing) or the DB
 * returns an error, the check is skipped — we fail open rather than
 * block legitimate users due to an infra hiccup.
 */

export class RateLimitError extends Error {
  constructor(retryAfter) {
    super('rate_limited')
    this.name = 'RateLimitError'
    this.status = 429
    this.retryAfter = retryAfter
  }
}

const WINDOW_SECONDS = 60

export const ENDPOINT_LIMITS = {
  'analyze-recipe':       20,
  'swap-suggestions':     60,
  'classify-ingredients': 60,
  'grocery-list':         60,
  'normalize-meal-name':  60,
}

/**
 * Creates a rate-limit checker for a specific endpoint / max-requests pair.
 *
 * @param {object} opts
 * @param {object|null} opts.supabase      Service-role Supabase client (or null to skip).
 * @param {number}      [opts.windowSeconds=60]  Window length in seconds.
 * @param {number}      opts.maxRequests   Max requests per window.
 * @returns {(userId: string, endpoint: string) => Promise<void>}
 *   Resolves when the request is within the limit. Throws RateLimitError when
 *   the limit is exceeded.
 */
export function createRateLimiter({ supabase, windowSeconds = WINDOW_SECONDS, maxRequests }) {
  return async function checkLimit(userId, endpoint) {
    if (!supabase) return

    const now = Date.now()
    const windowMs = windowSeconds * 1000
    const windowStart = new Date(Math.floor(now / windowMs) * windowMs).toISOString()
    const windowEndMs = (Math.floor(now / windowMs) + 1) * windowMs
    const retryAfter = Math.ceil((windowEndMs - now) / 1000)

    const { data, error } = await supabase.rpc('increment_api_rate_limit', {
      p_user_id:      userId,
      p_endpoint:     endpoint,
      p_window_start: windowStart,
    })

    if (error) {
      console.error('[rateLimit] DB error — failing open:', error.message)
      return
    }

    const count = typeof data === 'number' ? data : Number(data)
    if (count > maxRequests) throw new RateLimitError(retryAfter)
  }
}
