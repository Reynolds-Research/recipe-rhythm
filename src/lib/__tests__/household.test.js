import { describe, it, expect, vi, beforeEach } from 'vitest'

// setupTests.js mocks ../household for every other test; here we want the real one.
const { getHouseholdId, clearHouseholdCache, NoHouseholdError } =
  await vi.importActual('../household')

// Minimal fake of the one chain getHouseholdId uses:
//   .from('household_members').select('household_id').eq('user_id', id).maybeSingle()
function makeSupabase(responses) {
  const calls = []
  let i = 0
  return {
    calls,
    from(table) {
      const call = { table, filter: {} }
      calls.push(call)
      const chain = {
        select(cols) { call.select = cols; return chain },
        eq(col, val) { call.filter[col] = val; return chain },
        maybeSingle() {
          const r = responses[Math.min(i++, responses.length - 1)]
          return Promise.resolve(r)
        },
      }
      return chain
    },
  }
}

describe('getHouseholdId', () => {
  beforeEach(() => clearHouseholdCache())

  it('looks up the household for the account', async () => {
    const supabase = makeSupabase([{ data: { household_id: 'hh-1' }, error: null }])
    await expect(getHouseholdId(supabase, 'user-1')).resolves.toBe('hh-1')
    expect(supabase.calls).toEqual([
      { table: 'household_members', select: 'household_id', filter: { user_id: 'user-1' } },
    ])
  })

  it('asks the database only once per account', async () => {
    const supabase = makeSupabase([{ data: { household_id: 'hh-1' }, error: null }])
    const [a, b] = await Promise.all([getHouseholdId(supabase, 'user-1'), getHouseholdId(supabase, 'user-1')])
    await getHouseholdId(supabase, 'user-1')
    expect([a, b]).toEqual(['hh-1', 'hh-1'])
    expect(supabase.calls).toHaveLength(1)
  })

  it('keeps accounts apart', async () => {
    const supabase = makeSupabase([
      { data: { household_id: 'hh-1' }, error: null },
      { data: { household_id: 'hh-2' }, error: null },
    ])
    await expect(getHouseholdId(supabase, 'user-1')).resolves.toBe('hh-1')
    await expect(getHouseholdId(supabase, 'user-2')).resolves.toBe('hh-2')
  })

  it('rejects with NoHouseholdError when the account has no household', async () => {
    const supabase = makeSupabase([{ data: null, error: null }])
    await expect(getHouseholdId(supabase, 'user-1')).rejects.toBeInstanceOf(NoHouseholdError)
  })

  it('does not remember a failure: the next call tries again', async () => {
    const supabase = makeSupabase([
      { data: null, error: { message: 'network down' } },
      { data: { household_id: 'hh-1' }, error: null },
    ])
    await expect(getHouseholdId(supabase, 'user-1')).rejects.toEqual({ message: 'network down' })
    await expect(getHouseholdId(supabase, 'user-1')).resolves.toBe('hh-1')
    expect(supabase.calls).toHaveLength(2)
  })

  it('clearHouseholdCache makes the next call look up again', async () => {
    const supabase = makeSupabase([
      { data: { household_id: 'hh-1' }, error: null },
      { data: { household_id: 'hh-shared' }, error: null },
    ])
    await getHouseholdId(supabase, 'user-1')
    clearHouseholdCache()
    await expect(getHouseholdId(supabase, 'user-1')).resolves.toBe('hh-shared')
  })

  it('rejects without a userId', async () => {
    await expect(getHouseholdId(makeSupabase([]), undefined)).rejects.toThrow(/userId is required/)
  })
})
