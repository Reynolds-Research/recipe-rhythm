/**
 * Unit tests for api/_lib/rateLimit.js (PRD-001 P1.6 Phase 2).
 *
 * Tests the createRateLimiter factory and RateLimitError class.
 * Supabase RPC is mocked so no real DB calls are made.
 * Date.now is mocked for deterministic window boundary tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRateLimiter, RateLimitError, ENDPOINT_LIMITS } from '../../../api/_lib/rateLimit.js'

// ── helpers ──────────────────────────────────────────────────────────────────

function makeSupabase(rpcResult) {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
  }
}

// ── ENDPOINT_LIMITS constants ─────────────────────────────────────────────────

describe('ENDPOINT_LIMITS', () => {
  it('has all five endpoints', () => {
    const keys = Object.keys(ENDPOINT_LIMITS)
    expect(keys).toContain('analyze-recipe')
    expect(keys).toContain('swap-suggestions')
    expect(keys).toContain('classify-ingredients')
    expect(keys).toContain('grocery-list')
    expect(keys).toContain('normalize-meal-name')
  })

  it('analyze-recipe has a lower limit than Haiku endpoints', () => {
    expect(ENDPOINT_LIMITS['analyze-recipe']).toBeLessThan(ENDPOINT_LIMITS['grocery-list'])
  })
})

// ── createRateLimiter ─────────────────────────────────────────────────────────

describe('createRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Pin time to a stable moment: 2026-05-30T06:00:30.000Z
    // (30 seconds into a 60-second window that started at :00)
    vi.setSystemTime(new Date('2026-05-30T06:00:30.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves without throwing when count is at the limit', async () => {
    const supabase = makeSupabase({ data: 20, error: null })
    const checkLimit = createRateLimiter({ supabase, maxRequests: 20 })
    await expect(checkLimit('user-1', 'analyze-recipe')).resolves.toBeUndefined()
  })

  it('resolves without throwing when count is below the limit', async () => {
    const supabase = makeSupabase({ data: 1, error: null })
    const checkLimit = createRateLimiter({ supabase, maxRequests: 20 })
    await expect(checkLimit('user-1', 'analyze-recipe')).resolves.toBeUndefined()
  })

  it('throws RateLimitError when count exceeds maxRequests', async () => {
    const supabase = makeSupabase({ data: 21, error: null })
    const checkLimit = createRateLimiter({ supabase, maxRequests: 20 })
    await expect(checkLimit('user-1', 'analyze-recipe')).rejects.toBeInstanceOf(RateLimitError)
  })

  it('RateLimitError has correct status (429)', async () => {
    const supabase = makeSupabase({ data: 61, error: null })
    const checkLimit = createRateLimiter({ supabase, maxRequests: 60 })
    const err = await checkLimit('user-1', 'grocery-list').catch(e => e)
    expect(err.status).toBe(429)
  })

  it('RateLimitError.retryAfter is seconds until end of current window', async () => {
    // Time is 30 seconds into a 60-second window.
    // Window end is at :01:00. Retry after = 30 seconds.
    const supabase = makeSupabase({ data: 25, error: null })
    const checkLimit = createRateLimiter({ supabase, maxRequests: 20 })
    const err = await checkLimit('user-1', 'analyze-recipe').catch(e => e)
    expect(err.retryAfter).toBe(30)
  })

  it('passes the correct window_start to the RPC', async () => {
    // Time pinned to 2026-05-30T06:00:30Z → window started at 2026-05-30T06:00:00Z
    const supabase = makeSupabase({ data: 1, error: null })
    const checkLimit = createRateLimiter({ supabase, maxRequests: 60 })
    await checkLimit('user-abc', 'grocery-list')
    expect(supabase.rpc).toHaveBeenCalledWith('increment_api_rate_limit', {
      p_user_id:      'user-abc',
      p_endpoint:     'grocery-list',
      p_window_start: '2026-05-30T06:00:00.000Z',
    })
  })

  it('second call in same window increments (mocked as count=2)', async () => {
    const supabase = makeSupabase({ data: 2, error: null })
    const checkLimit = createRateLimiter({ supabase, maxRequests: 60 })
    await checkLimit('user-1', 'grocery-list')
    // Both calls share the same window_start.
    expect(supabase.rpc).toHaveBeenCalledOnce()
  })

  it('fails open (no throw) when supabase is null', async () => {
    const checkLimit = createRateLimiter({ supabase: null, maxRequests: 20 })
    await expect(checkLimit('user-1', 'analyze-recipe')).resolves.toBeUndefined()
  })

  it('fails open (no throw) when RPC returns an error', async () => {
    const supabase = makeSupabase({ data: null, error: { message: 'connection reset' } })
    const checkLimit = createRateLimiter({ supabase, maxRequests: 20 })
    await expect(checkLimit('user-1', 'analyze-recipe')).resolves.toBeUndefined()
  })

  it('handles data returned as a string (coerces to number)', async () => {
    const supabase = makeSupabase({ data: '25', error: null })
    const checkLimit = createRateLimiter({ supabase, maxRequests: 20 })
    await expect(checkLimit('user-1', 'analyze-recipe')).rejects.toBeInstanceOf(RateLimitError)
  })

  it('uses the windowSeconds parameter for boundary calculation', async () => {
    // 120-second window: starts at :00:00, ends at :02:00
    // Time is at :00:30 → retryAfter = 90 seconds
    const supabase = makeSupabase({ data: 5, error: null })
    const checkLimit = createRateLimiter({ supabase, windowSeconds: 120, maxRequests: 4 })
    const err = await checkLimit('user-1', 'analyze-recipe').catch(e => e)
    expect(err.retryAfter).toBe(90)
  })
})

// ── RateLimitError ────────────────────────────────────────────────────────────

describe('RateLimitError', () => {
  it('is an instance of Error', () => {
    expect(new RateLimitError(30)).toBeInstanceOf(Error)
  })

  it('has status 429 and the given retryAfter', () => {
    const err = new RateLimitError(45)
    expect(err.status).toBe(429)
    expect(err.retryAfter).toBe(45)
    expect(err.message).toBe('rate_limited')
  })
})
