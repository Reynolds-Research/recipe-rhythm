import { describe, it, expect } from 'vitest'
import { fetchScheduledItemsInRange } from '../mealPlanReader'

/**
 * Handwritten Supabase client fake for the range query.
 *
 * Call shape: .from('meal_plan_items').select().eq().gte().lte().order().order()
 * and terminates via the thenable at the end of the chain.
 */
function makeRangeSupabase({ data = [], error = null } = {}) {
  const calls = { meal_plan_items: null }
  return {
    calls,
    from(table) {
      const state = { select: null, eqs: [], gte: null, lte: null, orders: [] }
      calls[table] = state
      const chain = {
        select(cols) { state.select = cols; return chain },
        eq(col, val) { state.eqs.push([col, val]); return chain },
        gte(col, val) { state.gte = [col, val]; return chain },
        lte(col, val) { state.lte = [col, val]; return chain },
        order(col, opts) { state.orders.push([col, opts]); return chain },
        then(onFulfilled, onRejected) {
          return Promise.resolve({ data, error }).then(onFulfilled, onRejected)
        },
      }
      return chain
    },
  }
}

describe('fetchScheduledItemsInRange', () => {
  it('flattens joined meal_plans rows into the documented shape', async () => {
    const data = [
      {
        id: 'mpi-1',
        scheduled_date: '2026-04-12',
        name: 'Pancakes',
        cooked: true,
        meal_plan_id: 'plan-A',
        meal_plans: {
          period_start: '2026-04-12',
          period_end: '2026-04-18',
          finalized_at: '2026-04-19T00:00:00Z',
        },
      },
      {
        id: 'mpi-2',
        scheduled_date: '2026-04-14',
        name: 'Tacos',
        cooked: false,
        meal_plan_id: 'plan-A',
        meal_plans: {
          period_start: '2026-04-12',
          period_end: '2026-04-18',
          finalized_at: '2026-04-19T00:00:00Z',
        },
      },
    ]
    const supabase = makeRangeSupabase({ data })
    const rows = await fetchScheduledItemsInRange(
      supabase,
      'user-1',
      '2026-04-01',
      '2026-04-30',
    )

    expect(supabase.calls.meal_plan_items).toBeTruthy()
    expect(supabase.calls.meal_plan_items.eqs).toContainEqual(['user_id', 'user-1'])
    expect(supabase.calls.meal_plan_items.gte).toEqual(['scheduled_date', '2026-04-01'])
    expect(supabase.calls.meal_plan_items.lte).toEqual(['scheduled_date', '2026-04-30'])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      item_id: 'mpi-1',
      scheduled_date: '2026-04-12',
      name: 'Pancakes',
      cooked: true,
      meal_plan_id: 'plan-A',
      period_start: '2026-04-12',
      period_end: '2026-04-18',
      finalized_at: '2026-04-19T00:00:00Z',
    })
    expect(rows[1]).toMatchObject({
      item_id: 'mpi-2',
      name: 'Tacos',
      cooked: false,
      finalized_at: '2026-04-19T00:00:00Z',
    })
  })

  it('handles embedded meal_plans returned as a single-element array', async () => {
    // Some PostgREST versions return the joined row as [obj] rather than obj.
    const data = [
      {
        id: 'mpi-3',
        scheduled_date: '2026-04-20',
        name: 'Ramen',
        cooked: false,
        meal_plan_id: 'plan-B',
        meal_plans: [
          {
            period_start: '2026-04-19',
            period_end: '2026-04-25',
            finalized_at: null,
          },
        ],
      },
    ]
    const supabase = makeRangeSupabase({ data })
    const rows = await fetchScheduledItemsInRange(
      supabase,
      'user-1',
      '2026-04-01',
      '2026-04-30',
    )
    expect(rows[0].period_start).toBe('2026-04-19')
    expect(rows[0].period_end).toBe('2026-04-25')
    expect(rows[0].finalized_at).toBeNull()
  })

  it('returns [] for an empty range', async () => {
    const supabase = makeRangeSupabase({ data: [] })
    const rows = await fetchScheduledItemsInRange(
      supabase,
      'user-1',
      '2026-01-01',
      '2026-01-31',
    )
    expect(rows).toEqual([])
  })

  it('returns [] when data is null (no rows)', async () => {
    const supabase = makeRangeSupabase({ data: null })
    const rows = await fetchScheduledItemsInRange(
      supabase,
      'user-1',
      '2026-01-01',
      '2026-01-31',
    )
    expect(rows).toEqual([])
  })

  it('throws when the query errors', async () => {
    const supabase = makeRangeSupabase({
      data: null,
      error: { message: 'permission denied', code: '42501' },
    })
    await expect(
      fetchScheduledItemsInRange(supabase, 'user-1', '2026-04-01', '2026-04-30'),
    ).rejects.toMatchObject({ message: 'permission denied' })
  })

  it('coerces nullish cooked values to false', async () => {
    const data = [
      {
        id: 'mpi-nocook',
        scheduled_date: '2026-04-12',
        name: 'Mystery Meal',
        cooked: null,
        meal_plan_id: 'plan-X',
        meal_plans: {
          period_start: '2026-04-12',
          period_end: '2026-04-18',
          finalized_at: null,
        },
      },
    ]
    const supabase = makeRangeSupabase({ data })
    const rows = await fetchScheduledItemsInRange(
      supabase,
      'user-1',
      '2026-04-01',
      '2026-04-30',
    )
    expect(rows[0].cooked).toBe(false)
  })
})
