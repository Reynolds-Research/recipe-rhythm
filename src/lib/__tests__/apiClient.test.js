/**
 * Unit tests for src/lib/apiClient.js (PRD-001 P1.6).
 *
 * Verifies that apiFetch injects the Authorization header when a session
 * is active, and omits it when there is no session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted ensures the mock value is available before vi.mock() is called
// (vi.mock calls are hoisted to the top of the file, before variable declarations).
const mockGetSession = vi.hoisted(() => vi.fn())
vi.mock('../supabase.js', () => ({
  supabase: { auth: { getSession: mockGetSession } },
}))

// Mock the global fetch.
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Import after mocks are set up.
import { apiFetch } from '../apiClient.js'

describe('apiFetch', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockGetSession.mockReset()
    mockFetch.mockResolvedValue({ ok: true, status: 200 })
  })

  it('injects Authorization header when session has access_token', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'jwt-abc' } },
    })
    await apiFetch('/api/grocery-list', { method: 'POST', body: '{}' })
    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Authorization']).toBe('Bearer jwt-abc')
  })

  it('includes content-type: application/json by default', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    await apiFetch('/api/foo', { method: 'POST', body: '{}' })
    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['content-type']).toBe('application/json')
  })

  it('omits Authorization header when session is null', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    await apiFetch('/api/foo', { method: 'POST' })
    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Authorization']).toBeUndefined()
  })

  it('omits Authorization header when access_token is falsy', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: '' } } })
    await apiFetch('/api/foo', { method: 'POST' })
    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Authorization']).toBeUndefined()
  })

  it('passes through the path and other options unmodified', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    await apiFetch('/api/analyze-recipe', { method: 'POST', body: '{"name":"test"}' })
    const [path, options] = mockFetch.mock.calls[0]
    expect(path).toBe('/api/analyze-recipe')
    expect(options.method).toBe('POST')
    expect(options.body).toBe('{"name":"test"}')
  })

  it('caller-supplied headers are merged (not dropped)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    await apiFetch('/api/foo', { method: 'POST', headers: { 'x-custom': 'yes' } })
    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['x-custom']).toBe('yes')
    expect(options.headers['content-type']).toBe('application/json')
    expect(options.headers['Authorization']).toBe('Bearer tok')
  })

  it('returns the raw Response from fetch', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })
    const fakeResponse = { ok: true, status: 200, json: vi.fn() }
    mockFetch.mockResolvedValue(fakeResponse)
    const result = await apiFetch('/api/foo', { method: 'POST' })
    expect(result).toBe(fakeResponse)
  })
})
