/**
 * Auth-gate tests for api/grocery-list.js (Vercel serverless handler).
 * PRD-001 P1.6.
 *
 * The shared createGroceryListHandler doesn't do auth — that's applied by
 * Express middleware (api-server.mjs) and by each Vercel handler wrapper.
 * These tests verify the Vercel wrapper's auth behavior in isolation by
 * mocking requireAuth and the shared handler factory.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Module-level mocks (hoisted before any imports) ───────────────────────────

// verifyAuth: control whether auth passes or fails.
const mockRequireAuth = vi.hoisted(() => vi.fn())
vi.mock('../../../api/_lib/verifyAuth.js', () => {
  class AuthError extends Error {
    constructor(message, status) { super(message); this.name = 'AuthError'; this.status = status }
  }
  return { requireAuth: mockRequireAuth, AuthError }
})

// Stub anthropic so createGroceryListHandler doesn't need real credentials.
vi.mock('../../../api/_lib/anthropic.js', () => ({ anthropic: {} }))

// Stub the shared handler — we're only testing the Vercel wrapper's auth layer.
const mockHandleInner = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../../../api/_lib/groceryListHandler.js', () => ({
  createGroceryListHandler: () => mockHandleInner,
}))

// Import AFTER mocks are registered.
import { default as vercelHandler } from '../../../api/grocery-list.js'
import { AuthError } from '../../../api/_lib/verifyAuth.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function mockRes() {
  const res = { statusCode: 200, body: undefined }
  res.status = vi.fn(code => { res.statusCode = code; return res })
  res.json = vi.fn(payload => { res.body = payload; return res })
  res.setHeader = vi.fn()
  return res
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('api/grocery-list.js Vercel handler — auth gate', () => {
  beforeEach(() => {
    mockRequireAuth.mockReset()
    mockHandleInner.mockReset()
  })

  it('returns 405 for non-POST requests (no auth check)', async () => {
    const res = mockRes()
    await vercelHandler({ method: 'GET', headers: {} }, res)
    expect(res.statusCode).toBe(405)
    expect(mockRequireAuth).not.toHaveBeenCalled()
  })

  it('returns 401 when Authorization header is missing', async () => {
    mockRequireAuth.mockRejectedValue(new AuthError('unauthenticated', 401))
    const res = mockRes()
    await vercelHandler({ method: 'POST', headers: {} }, res)
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'unauthenticated' })
    expect(mockHandleInner).not.toHaveBeenCalled()
  })

  it('returns 401 when JWT is invalid', async () => {
    mockRequireAuth.mockRejectedValue(new AuthError('invalid_session', 401))
    const res = mockRes()
    await vercelHandler({ method: 'POST', headers: { authorization: 'Bearer bad' } }, res)
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'invalid_session' })
  })

  it('returns 503 when auth is misconfigured', async () => {
    mockRequireAuth.mockRejectedValue(new AuthError('auth_misconfigured', 503))
    const res = mockRes()
    await vercelHandler({ method: 'POST', headers: { authorization: 'Bearer tok' } }, res)
    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ error: 'auth_misconfigured' })
    expect(mockHandleInner).not.toHaveBeenCalled()
  })

  it('delegates to the shared handler on valid auth', async () => {
    mockRequireAuth.mockResolvedValue({ user: { id: 'u1', email: 'u@test.com' } })
    const req = { method: 'POST', headers: { authorization: 'Bearer valid' }, body: {} }
    const res = mockRes()
    await vercelHandler(req, res)
    expect(mockHandleInner).toHaveBeenCalledOnce()
    expect(req.user).toEqual({ id: 'u1', email: 'u@test.com' })
  })
})
