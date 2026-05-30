/**
 * JWT verification middleware/helper for all /api/* endpoints.
 *
 * Two exports for two runtimes:
 *   - requireAuth(req) → Promise<{user}>   — called directly in Vercel handlers
 *   - requireAuthMiddleware(req, res, next) — Express middleware for api-server.mjs
 *
 * Uses the Supabase anon key (SUPABASE_ANON_KEY + SUPABASE_URL) to call
 * auth.getUser(token), which verifies the JWT and returns the user. This is
 * the correct pattern — the service-role key in supabaseAdmin.js must NOT be
 * used here (it's for DB writes only, not JWT verification).
 *
 * Graceful degrade: if env vars are missing, every request returns 503 and
 * a one-time warning is emitted at module load (mirrors supabaseAdmin.js).
 */
import { createClient } from '@supabase/supabase-js'

export class AuthError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

// Lazy singleton — created once on first use, reused across the process lifetime.
// Env vars are read lazily so they're picked up correctly in all environments,
// including Vercel where they may not be available at module parse time.
let _supabaseAnon = null
let _warnedMissingEnv = false

function getAnonClient() {
  if (_supabaseAnon) return _supabaseAnon
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) {
    if (!_warnedMissingEnv) {
      _warnedMissingEnv = true
      console.warn(
        '[api] verifyAuth: SUPABASE_URL or SUPABASE_ANON_KEY is missing — all /api/* requests will return 503. ' +
        'Set both vars in your .env (and in Vercel env settings for Preview + Production).',
      )
    }
    return null
  }
  _supabaseAnon = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession:   false,
    },
  })
  return _supabaseAnon
}

/**
 * Core auth check. Returns `{ user: { id, email } }` on success.
 * Throws AuthError with .status 401 or 503 on failure.
 *
 * Intended for Vercel serverless handlers which call this directly:
 *   try { const { user } = await requireAuth(req); req.user = user }
 *   catch (err) { return res.status(err.status ?? 500).json({ error: err.message }) }
 *
 * @param {object} req - Express/Vercel request with req.headers.authorization
 * @returns {Promise<{user: {id: string, email: string}}>}
 */
export async function requireAuth(req) {
  const client = getAnonClient()
  if (!client) throw new AuthError('auth_misconfigured', 503)

  const header = req.headers?.authorization
  if (!header || !header.startsWith('Bearer ')) {
    throw new AuthError('unauthenticated', 401)
  }
  const token = header.slice(7)

  const { data, error } = await client.auth.getUser(token)
  if (error || !data?.user) {
    throw new AuthError('invalid_session', 401)
  }

  return { user: { id: data.user.id, email: data.user.email } }
}

/**
 * Express middleware wrapping requireAuth. Attaches req.user on success.
 * Intended for api-server.mjs:
 *   app.post('/api/foo', requireAuthMiddleware, handler)
 */
export function requireAuthMiddleware(req, res, next) {
  return requireAuth(req)
    .then(({ user }) => {
      req.user = user
      next()
    })
    .catch(err => {
      const status = err instanceof AuthError ? err.status : 500
      res.status(status).json({ error: err.message })
    })
}
