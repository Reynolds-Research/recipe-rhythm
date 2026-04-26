import { describe, it, expect, vi, beforeEach } from 'vitest'
import { matchVaultByName } from '../vaultMatch'

// Helper: build a minimal supabase mock where:
//   - .from('vault').select().eq().ilike().limit() resolves to `exactRows`
//   - .rpc('vault_fuzzy_match', ...) resolves to `fuzzyRows`
// Both `exactRows` and `fuzzyRows` are { data, error } objects so each test
// can simulate "no match" or "error" independently.
function makeSupabase({ exact = { data: [], error: null }, fuzzy = { data: [], error: null }, rpcSpy } = {}) {
  const ilike  = vi.fn().mockReturnThis()
  const eq     = vi.fn().mockReturnThis()
  const select = vi.fn().mockReturnThis()
  const limit  = vi.fn().mockResolvedValue(exact)
  const fromChain = { select, eq, ilike, limit }
  const from = vi.fn(() => fromChain)
  const rpc  = rpcSpy ?? vi.fn().mockResolvedValue(fuzzy)
  return { client: { from, rpc }, fromChain, from, rpc }
}

describe('matchVaultByName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns confidence "exact" with a single result for a case-insensitive exact match', async () => {
    const exactRow = { id: 'v1', name: 'Carnitas Tacos', image_url: null }
    const { client, from, fromChain } = makeSupabase({
      exact: { data: [exactRow], error: null },
    })

    const result = await matchVaultByName(client, 'user-1', 'carnitas tacos')

    expect(result.confidence).toBe('exact')
    expect(result.matches).toEqual([exactRow])
    expect(from).toHaveBeenCalledWith('vault')
    expect(fromChain.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(fromChain.ilike).toHaveBeenCalledWith('name', 'carnitas tacos')
  })

  it('returns confidence "fuzzy" with multiple results when pg_trgm finds candidates', async () => {
    // "Tacos" alone exact-matches nothing; trigram returns both vault rows
    // ordered by similarity DESC (the RPC enforces this on the server).
    const fuzzyRows = [
      { id: 'v1', name: 'Carnitas Tacos', image_url: null, similarity: 0.82 },
      { id: 'v2', name: 'Chicken Tacos',  image_url: null, similarity: 0.78 },
    ]
    const { client, rpc } = makeSupabase({
      exact: { data: [], error: null },
      fuzzy: { data: fuzzyRows, error: null },
    })

    const result = await matchVaultByName(client, 'user-1', 'Tacos')

    expect(result.confidence).toBe('fuzzy')
    expect(result.matches).toEqual([
      { id: 'v1', name: 'Carnitas Tacos', image_url: null },
      { id: 'v2', name: 'Chicken Tacos',  image_url: null },
    ])
    // Order is preserved (highest similarity first)
    expect(result.matches[0].id).toBe('v1')
    expect(rpc).toHaveBeenCalledWith('vault_fuzzy_match', {
      p_user_id:   'user-1',
      p_query:     'Tacos',
      p_threshold: 0.6,
    })
  })

  it('returns confidence "none" with empty matches when nothing exact or fuzzy matches', async () => {
    const { client } = makeSupabase({
      exact: { data: [], error: null },
      fuzzy: { data: [], error: null },
    })

    const result = await matchVaultByName(client, 'user-1', 'something nobody has cooked')

    expect(result.confidence).toBe('none')
    expect(result.matches).toEqual([])
  })

  it('returns confidence "none" when name is empty after trim', async () => {
    const { client, from, rpc } = makeSupabase()

    const result = await matchVaultByName(client, 'user-1', '   ')

    expect(result.confidence).toBe('none')
    expect(result.matches).toEqual([])
    // Should short-circuit without any DB calls
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('respects the user_id filter (RPC returns nothing when called with a different user)', async () => {
    // Simulate a user who has no matching vault rows at all: exact → [],
    // RPC scoped to that user → [] (RLS + the explicit user_id filter both
    // make this hold; the test mocks the resulting empty payload).
    const rpc = vi.fn().mockImplementation((_fn, args) => {
      // Only the right user gets data back; everyone else gets nothing.
      if (args.p_user_id === 'owner-of-tacos') {
        return Promise.resolve({
          data: [{ id: 'v1', name: 'Carnitas Tacos', image_url: null, similarity: 0.9 }],
          error: null,
        })
      }
      return Promise.resolve({ data: [], error: null })
    })
    const { client } = makeSupabase({
      exact: { data: [], error: null },
      rpcSpy: rpc,
    })

    const otherUser = await matchVaultByName(client, 'some-other-user', 'tacos')
    expect(otherUser.confidence).toBe('none')
    expect(otherUser.matches).toEqual([])

    const owner = await matchVaultByName(client, 'owner-of-tacos', 'tacos')
    expect(owner.confidence).toBe('fuzzy')
    expect(owner.matches).toHaveLength(1)
  })

  it('allows the fuzzy threshold to be overridden via opts.fuzzyThreshold', async () => {
    const { client, rpc } = makeSupabase({
      exact: { data: [], error: null },
      fuzzy: { data: [], error: null },
    })

    await matchVaultByName(client, 'user-1', 'tacos', { fuzzyThreshold: 0.4 })

    expect(rpc).toHaveBeenCalledWith('vault_fuzzy_match', {
      p_user_id:   'user-1',
      p_query:     'tacos',
      p_threshold: 0.4,
    })
  })
})
