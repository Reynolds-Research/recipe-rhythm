/**
 * Unit tests for the shared /api/normalize-meal-name request handler
 * (api/_lib/normalizeMealNameHandler.js). Covers cache hit, cache miss,
 * graceful degrade, and validation paths. No real Anthropic, no real Supabase.
 *
 * Lives under src/lib/__tests__/ so Vitest's `src/**\/*.test.js` include glob
 * picks it up — same convention as classifyIngredientsHandler.test.js.
 */
import { describe, it, expect, vi } from 'vitest'
import { createNormalizeMealNameHandler } from '../../../api/_lib/normalizeMealNameHandler.js'

function mockRes() {
  const res = { statusCode: 200, body: undefined, headers: {} }
  res.status    = vi.fn(code => { res.statusCode = code; return res })
  res.json      = vi.fn(payload => { res.body = payload; return res })
  res.setHeader = vi.fn((k, v) => { res.headers[k] = v })
  return res
}

/**
 * Tiny chained Supabase mock supporting:
 *   .from(t).select(...).eq(c, v).maybeSingle() → { data, error }
 *   .from(t).upsert(rows, opts)                  → { error }
 */
function makeSupabaseMock({ readData = null, readError = null, writeError = null } = {}) {
  const upsertSpy      = vi.fn(async () => ({ error: writeError }))
  const maybeSingleSpy = vi.fn(async () => ({ data: readData, error: readError }))
  const eqSpy = vi.fn(() => ({ maybeSingle: maybeSingleSpy }))

  const fromSpy = vi.fn(() => ({
    select: vi.fn(() => ({ eq: eqSpy })),
    upsert: upsertSpy,
  }))
  return { from: fromSpy, _spies: { fromSpy, eqSpy, upsertSpy, maybeSingleSpy } }
}

function makeAnthropicMock(corrected = 'Spaghetti Carbonara') {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: 'text', text: JSON.stringify({ corrected }) }],
      })),
    },
  }
}

describe('createNormalizeMealNameHandler', () => {
  it('returns 503 when no anthropic client is configured', async () => {
    const handler = createNormalizeMealNameHandler({ anthropic: null })
    const res = mockRes()
    await handler({ body: { name: 'spagheti' } }, res)
    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ error: 'api_key_missing' })
  })

  it('returns 400 when name is empty', async () => {
    const handler = createNormalizeMealNameHandler({ anthropic: makeAnthropicMock() })
    const res = mockRes()
    await handler({ body: { name: '   ' } }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'name_required' })
  })

  it('returns 400 when name exceeds 200 chars', async () => {
    const handler = createNormalizeMealNameHandler({ anthropic: makeAnthropicMock() })
    const res = mockRes()
    await handler({ body: { name: 'x'.repeat(201) } }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'name_too_long' })
  })

  it('returns cached value without calling Anthropic on cache hit', async () => {
    const anthropic = makeAnthropicMock()
    const supabase  = makeSupabaseMock({ readData: { corrected: 'Spaghetti Carbonara' } })
    const handler = createNormalizeMealNameHandler({ anthropic, supabase })
    const res = mockRes()

    await handler({ body: { name: 'spagheti carbonera' } }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ corrected: 'Spaghetti Carbonara' })
    expect(anthropic.messages.create).not.toHaveBeenCalled()
    expect(supabase._spies.upsertSpy).not.toHaveBeenCalled()
  })

  it('calls Anthropic and writes to cache on cache miss', async () => {
    const anthropic = makeAnthropicMock('Spaghetti Carbonara')
    const supabase  = makeSupabaseMock({ readData: null }) // miss
    const handler = createNormalizeMealNameHandler({ anthropic, supabase })
    const res = mockRes()

    await handler({ body: { name: '  spagheti carbonera  ' } }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ corrected: 'Spaghetti Carbonara' })
    expect(anthropic.messages.create).toHaveBeenCalledOnce()
    expect(supabase._spies.upsertSpy).toHaveBeenCalledOnce()
    const [rows, opts] = supabase._spies.upsertSpy.mock.calls[0]
    expect(rows).toEqual([{ input_norm: 'spagheti carbonera', corrected: 'Spaghetti Carbonara' }])
    expect(opts).toEqual({ onConflict: 'input_norm', ignoreDuplicates: true })
  })

  it('still returns success when cache write fails', async () => {
    const anthropic = makeAnthropicMock('Spaghetti Carbonara')
    const supabase  = makeSupabaseMock({ readData: null, writeError: { message: 'boom' } })
    const handler = createNormalizeMealNameHandler({ anthropic, supabase })
    const res = mockRes()

    await handler({ body: { name: 'spagheti' } }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.corrected).toBe('Spaghetti Carbonara')
  })

  it('falls through to AI when supabase is null (caching disabled)', async () => {
    const anthropic = makeAnthropicMock('Spaghetti')
    const handler = createNormalizeMealNameHandler({ anthropic, supabase: null })
    const res = mockRes()

    await handler({ body: { name: 'spagheti' } }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ corrected: 'Spaghetti' })
    expect(anthropic.messages.create).toHaveBeenCalledOnce()
  })

  it('returns 502 when AI response is unparseable', async () => {
    const anthropic = {
      messages: {
        create: vi.fn(async () => ({ content: [{ type: 'text', text: 'not-json' }] })),
      },
    }
    const handler = createNormalizeMealNameHandler({ anthropic })
    const res = mockRes()

    await handler({ body: { name: 'spagheti' } }, res)

    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: 'parse_failed' })
  })
})
