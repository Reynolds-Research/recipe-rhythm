import { describe, it, expect } from 'vitest'
import { listUserPeriods } from '../mealPlanReader'

// listUserPeriods uses .from('meal_plans').select().eq().not().not() and
// terminates via the chain's then(). This fake records the filters that were
// applied so we can verify the NULL-bound exclusion is in place.
function makeSupabase({ data = [], error = null } = {}) {
  const calls = { meal_plans: null }
  return {
    calls,
    from(table) {
      const state = { select: null, eqs: [], nots: [] }
      calls[table] = state
      const chain = {
        select(cols) { state.select = cols; return chain },
        eq(col, val) { state.eqs.push([col, val]); return chain },
        not(col, op, val) { state.nots.push([col, op, val]); return chain },
        then(onFulfilled, onRejected) {
          return Promise.resolve({ data, error }).then(onFulfilled, onRejected)
        },
      }
      return chain
    },
  }
}

describe('listUserPeriods', () => {
  it('returns the user\'s period bounds', async () => {
    const supabase = makeSupabase({
      data: [
        { period_start: '2026-04-12', period_end: '2026-04-18' },
        { period_start: '2026-04-26', period_end: '2026-05-02' },
      ],
    })

    const result = await listUserPeriods(supabase, 'user-1')

    expect(result).toEqual([
      { period_start: '2026-04-12', period_end: '2026-04-18' },
      { period_start: '2026-04-26', period_end: '2026-05-02' },
    ])
  })

  it('filters by user_id and excludes NULL-bound rows at the query level', async () => {
    const supabase = makeSupabase({ data: [] })
    await listUserPeriods(supabase, 'user-1')

    const state = supabase.calls.meal_plans
    expect(state.select).toBe('period_start, period_end')
    expect(state.eqs).toContainEqual(['user_id', 'user-1'])
    // Both NULL-bound exclusions must be in place — the writer enforces them
    // for the EXCLUDE constraint to apply.
    expect(state.nots).toContainEqual(['period_start', 'is', null])
    expect(state.nots).toContainEqual(['period_end', 'is', null])
  })

  it('returns [] when the user has no periods', async () => {
    const supabase = makeSupabase({ data: [] })
    const result = await listUserPeriods(supabase, 'user-1')
    expect(result).toEqual([])
  })

  it('returns [] when data is null', async () => {
    const supabase = makeSupabase({ data: null })
    const result = await listUserPeriods(supabase, 'user-1')
    expect(result).toEqual([])
  })

  it('throws when the query errors', async () => {
    const supabase = makeSupabase({
      data: null,
      error: { message: 'permission denied', code: '42501' },
    })
    await expect(listUserPeriods(supabase, 'user-1')).rejects.toMatchObject({
      message: 'permission denied',
    })
  })
})
