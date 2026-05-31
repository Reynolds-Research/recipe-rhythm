/**
 * Unit tests for api/_lib/verifyAuth.js (PRD-001 P1.6).
 *
 * Covers requireAuth() and requireAuthMiddleware() via module-level mocking
 * of @supabase/supabase-js so no real network calls are made.
 *
 * Strategy:
 *   - Most tests import the module directly (cheap, fast).
 *   - Env-var tests (503 case) use vi.resetModules() + dynamic import because
 *     the singleton reads env vars lazily on first call, and the singleton must
 *     be reset between env-state tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// --- Hoist the mock so it's in place before any import of verifyAuth.js ---
const mockGetUser = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}))

// Import with env vars pre-set so the module's lazy singleton initializes correctly.
process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_ANON_KEY = 'test-anon-key'

// Static import — used for the majority of tests (no env var changes needed).
import { requireAuth, requireAuthMiddleware, AuthError } from '../../../api/_lib/verifyAuth.js'

// ── helpers ──────────────────────────────────────────────────────────────────

function mockRes() {
  const res = { statusCode: 200, body: undefined, headers: {} }
  res.status = vi.fn(code => { res.statusCode = code; return res })
  res.json = vi.fn(payload => { res.body = payload; return res })
  res.setHeader = vi.fn((k, v) => { res.headers[k] = v })
  return res
}

// ── requireAuth ───────────────────────────────────────────────────────────────

describe('requireAuth', () => {
  beforeEach(() => { mockGetUser.mockReset() })

  it('throws AuthError 401 when Authorization header is missing', async () => {
    await expect(requireAuth({ headers: {} }))
      .rejects.toMatchObject({ status: 401, message: 'unauthenticated' })
  })

  it('throws AuthError 401 when header is not Bearer format', async () => {
    await expect(requireAuth({ headers: { authorization: 'Basic abc123' } }))
      .rejects.toMatchObject({ status: 401, message: 'unauthenticated' })
  })

  it('throws AuthError 401 when token prefix is missing', async () => {
    await expect(requireAuth({ headers: { authorization: 'just-a-token' } }))
      .rejects.toMatchObject({ status: 401, message: 'unauthenticated' })
  })

  it('throws AuthError 401 when getUser returns no user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    await expect(requireAuth({ headers: { authorization: 'Bearer some-token' } }))
      .rejects.toMatchObject({ status: 401, message: 'invalid_session' })
  })

  it('throws AuthError 401 when getUser returns an error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'JWT expired' } })
    await expect(requireAuth({ headers: { authorization: 'Bearer expired' } }))
      .rejects.toMatchObject({ status: 401, message: 'invalid_session' })
  })

  it('returns { user } when JWT is valid', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'uid-1', email: 'user@example.com' } },
      error: null,
    })
    const result = await requireAuth({ headers: { authorization: 'Bearer valid-jwt' } })
    expect(result).toEqual({ user: { id: 'uid-1', email: 'user@example.com' } })
  })

  it('passes the raw token (without "Bearer ") to getUser', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u2', email: 'b@c.com' } },
      error: null,
    })
    await requireAuth({ headers: { authorization: 'Bearer my-raw-jwt' } })
    expect(mockGetUser).toHaveBeenCalledWith('my-raw-jwt')
  })

  it('returned errors are instances of AuthError', async () => {
    await expect(requireAuth({ headers: {} })).rejects.toBeInstanceOf(AuthError)
  })
})

// ── 503 env-var tests (require module reload) ─────────────────────────────────
// vi.resetModules() clears the module cache but NOT the mock registry, so
// the @supabase/supabase-js mock defined at top level persists — no need to
// re-call vi.mock inside these tests.

describe('requireAuth — 503 when env vars missing', () => {
  afterEach(() => {
    vi.resetModules()
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'test-anon-key'
  })

  it('throws 503 when both env vars are missing', async () => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_ANON_KEY
    vi.resetModules()
    const { requireAuth: freshRequireAuth } = await import('../../../api/_lib/verifyAuth.js')
    await expect(freshRequireAuth({ headers: { authorization: 'Bearer tok' } }))
      .rejects.toMatchObject({ status: 503, message: 'auth_misconfigured' })
  })

  it('throws 503 when SUPABASE_ANON_KEY is missing', async () => {
    delete process.env.SUPABASE_ANON_KEY
    vi.resetModules()
    const { requireAuth: freshRequireAuth } = await import('../../../api/_lib/verifyAuth.js')
    await expect(freshRequireAuth({ headers: { authorization: 'Bearer tok' } }))
      .rejects.toMatchObject({ status: 503, message: 'auth_misconfigured' })
  })
})

// ── production-throw via assertProductionConfig ───────────────────────────────
// These tests verify that importing verifyAuth.js in a Vercel production
// environment with missing env vars throws at module load time (cold-start),
// rather than degrading silently per-request.

describe('production throw at module import', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('throws at import when VERCEL_ENV=production and SUPABASE_URL is missing', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon-key')
    vi.resetModules()
    await expect(import('../../../api/_lib/verifyAuth.js'))
      .rejects.toThrow('[config] verifyAuth')
  })

  it('throws at import when VERCEL_ENV=production and SUPABASE_ANON_KEY is missing', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_ANON_KEY', '')
    vi.resetModules()
    await expect(import('../../../api/_lib/verifyAuth.js'))
      .rejects.toThrow('[config] verifyAuth')
  })

  it('does not throw at import when VERCEL_ENV=production and both vars are present', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon-key')
    vi.resetModules()
    await expect(import('../../../api/_lib/verifyAuth.js')).resolves.toBeDefined()
  })
})

// ── requireAuthMiddleware ─────────────────────────────────────────────────────

describe('requireAuthMiddleware', () => {
  beforeEach(() => { mockGetUser.mockReset() })

  it('attaches req.user and calls next() on success', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'uid-42', email: 'hi@test.com' } },
      error: null,
    })
    const req = { headers: { authorization: 'Bearer good-token' } }
    const res = mockRes()
    const next = vi.fn()
    await requireAuthMiddleware(req, res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(req.user).toEqual({ id: 'uid-42', email: 'hi@test.com' })
    expect(res.statusCode).toBe(200)
  })

  it('returns 401 and does NOT call next() when header is missing', async () => {
    const req = { headers: {} }
    const res = mockRes()
    const next = vi.fn()
    await requireAuthMiddleware(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'unauthenticated' })
  })

  it('returns 401 when session is invalid', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad token' } })
    const req = { headers: { authorization: 'Bearer bad' } }
    const res = mockRes()
    const next = vi.fn()
    await requireAuthMiddleware(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
  })
})
