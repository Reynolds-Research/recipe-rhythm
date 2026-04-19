import { describe, it, expect } from 'vitest'
import { fetchMostRecentPlan, classifyPlanState } from '../mealPlanReader'

/**
 * Handwritten Supabase client fake.
 *
 * Two query shapes are used by mealPlanReader:
 *   meal_plans:       .select().eq().order().limit().maybeSingle()  → Promise
 *   meal_plan_items:  .select().eq().order().order()                → thenable
 *
 * This factory routes `from(table)` to a per-table chain that records the
 * args and terminates with the data/error the test supplied.
 */
function makeSupabase({
  planResult = null,
  planError = null,
  itemsResult = [],
  itemsError = null,
} = {}) {
  const calls = { meal_plans: null, meal_plan_items: null }
  return {
    calls,
    from(table) {
      const state = { select: null, eqs: [], orders: [], limit: null }
      calls[table] = state
      const chain = {
        select(cols) { state.select = cols; return chain },
        eq(col, val) { state.eqs.push([col, val]); return chain },
        order(col, opts) { state.orders.push([col, opts]); return chain },
        limit(n) { state.limit = n; return chain },
        maybeSingle() {
          return Promise.resolve({
            data: planResult,
            error: planError,
          })
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve({
            data: itemsResult,
            error: itemsError,
          }).then(onFulfilled, onRejected)
        },
      }
      return chain
    },
  }
}

const PLAN_ROW = {
  id: 'plan-1',
  served_at: '2026-04-12T10:00:00Z',
  period_start: '2026-04-12',
  period_end: '2026-04-18',
  finalized_at: null,
  days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'],
  items: null,
  week_label: 'Apr 12 – 18, 2026',
}

describe('fetchMostRecentPlan', () => {
  it('returns { plan: null } when the user has no plans', async () => {
    const supabase = makeSupabase({ planResult: null })
    const result = await fetchMostRecentPlan(supabase, 'user-1')
    expect(result).toEqual({ plan: null })
    // Items query should not have been issued.
    expect(supabase.calls.meal_plan_items).toBeNull()
  })

  it('prefers the new schema: maps meal_plan_items to the UI shape', async () => {
    const itemsResult = [
      { scheduled_date: '2026-04-12', position: 0, vault_id: 'v1', name: 'Pancakes', is_wildcard: false, source_url: null },
      { scheduled_date: '2026-04-13', position: 0, vault_id: 'v2', name: 'Tacos',    is_wildcard: false, source_url: null },
      { scheduled_date: '2026-04-14', position: 0, vault_id: 'v3', name: 'Ramen',    is_wildcard: false, source_url: null },
      { scheduled_date: '2026-04-15', position: 0, vault_id: null, name: 'Curry',    is_wildcard: true,  source_url: 'https://example.com/curry' },
      { scheduled_date: '2026-04-16', position: 0, vault_id: 'v5', name: 'Pizza',    is_wildcard: false, source_url: null },
    ]
    const supabase = makeSupabase({ planResult: PLAN_ROW, itemsResult })
    const { plan } = await fetchMostRecentPlan(supabase, 'user-1')

    expect(plan.source).toBe('new')
    expect(plan.id).toBe('plan-1')
    expect(plan.period_start).toBe('2026-04-12')
    expect(plan.items).toHaveLength(5)
    expect(plan.items.map(i => i.day)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu'])
    expect(plan.items.map(i => i.name)).toEqual(['Pancakes', 'Tacos', 'Ramen', 'Curry', 'Pizza'])
    expect(plan.items.map(i => i.id)).toEqual(['v1', 'v2', 'v3', null, 'v5'])
    expect(plan.items[3]).toMatchObject({
      is_wildcard: true,
      source_url: 'https://example.com/curry',
    })
    expect(plan.days).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu'])
  })

  it('falls back to legacy jsonb when meal_plan_items is empty', async () => {
    const legacyPlan = {
      ...PLAN_ROW,
      items: [
        { day: 'Sun', name: 'Old Roast',   vault_id: 'v-old-1', is_wildcard: false, source_url: null },
        { day: 'Mon', name: 'Old Tacos',   vault_id: 'v-old-2', is_wildcard: false, source_url: null },
        { day: 'Tue', name: 'Old Wildcard', vault_id: null,      is_wildcard: true,  source_url: 'https://example.com/wild' },
      ],
    }
    const supabase = makeSupabase({ planResult: legacyPlan, itemsResult: [] })
    const { plan } = await fetchMostRecentPlan(supabase, 'user-1')

    expect(plan.source).toBe('legacy')
    expect(plan.items).toHaveLength(3)
    expect(plan.items[0]).toEqual({
      day: 'Sun', name: 'Old Roast', id: 'v-old-1', is_wildcard: false, source_url: null,
      item_id: null, scheduled_date: null, cooked: false, cooked_at: null,
    })
    expect(plan.items[2]).toEqual({
      day: 'Tue', name: 'Old Wildcard', id: null, is_wildcard: true, source_url: 'https://example.com/wild',
      item_id: null, scheduled_date: null, cooked: false, cooked_at: null,
    })
    // Uses the plan's stored days array when present.
    expect(plan.days).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu'])
  })

  it('prefers new schema over legacy when both are present', async () => {
    const dualPlan = {
      ...PLAN_ROW,
      items: [
        { day: 'Sun', name: 'Legacy Roast', vault_id: 'legacy-1', is_wildcard: false, source_url: null },
      ],
    }
    const itemsResult = [
      { id: 'mpi-1', scheduled_date: '2026-04-12', position: 0, vault_id: 'new-1', name: 'New Pancakes', is_wildcard: false, source_url: null, cooked: false, cooked_at: null },
    ]
    const supabase = makeSupabase({ planResult: dualPlan, itemsResult })
    const { plan } = await fetchMostRecentPlan(supabase, 'user-1')

    expect(plan.source).toBe('new')
    expect(plan.items).toEqual([
      {
        day: 'Sun', name: 'New Pancakes', id: 'new-1', is_wildcard: false, source_url: null,
        item_id: 'mpi-1', scheduled_date: '2026-04-12', cooked: false, cooked_at: null,
      },
    ])
  })

  it('surfaces item_id, cooked, and scheduled_date for new-schema items', async () => {
    const itemsResult = [
      { id: 'mpi-A', scheduled_date: '2026-04-12', position: 0, vault_id: 'v1', name: 'Pancakes', is_wildcard: false, source_url: null, cooked: true,  cooked_at: '2026-04-12T18:00:00Z' },
      { id: 'mpi-B', scheduled_date: '2026-04-13', position: 0, vault_id: 'v2', name: 'Tacos',    is_wildcard: false, source_url: null, cooked: false, cooked_at: null },
    ]
    const supabase = makeSupabase({ planResult: PLAN_ROW, itemsResult })
    const { plan } = await fetchMostRecentPlan(supabase, 'user-1')

    expect(plan.items[0]).toMatchObject({
      item_id: 'mpi-A', scheduled_date: '2026-04-12', cooked: true,  cooked_at: '2026-04-12T18:00:00Z',
    })
    expect(plan.items[1]).toMatchObject({
      item_id: 'mpi-B', scheduled_date: '2026-04-13', cooked: false, cooked_at: null,
    })
  })

  it('returns empty items when neither source has any rows', async () => {
    const emptyPlan = { ...PLAN_ROW, items: [] }
    const supabase = makeSupabase({ planResult: emptyPlan, itemsResult: [] })
    const { plan } = await fetchMostRecentPlan(supabase, 'user-1')

    expect(plan).toMatchObject({
      id: 'plan-1',
      items: [],
      days: [],
      source: 'new',
    })
  })

  it('derives weekdays in UTC so scheduled_date does not drift by timezone', async () => {
    // 2026-04-20 is a Monday in UTC. Even on a machine set to UTC-12 the
    // legacy `new Date('2026-04-20')` would parse to Sunday local time,
    // so this asserts the UTC parsing path is used.
    const itemsResult = [
      { scheduled_date: '2026-04-20', position: 0, vault_id: 'v1', name: 'Mon Meal', is_wildcard: false, source_url: null },
    ]
    const supabase = makeSupabase({ planResult: PLAN_ROW, itemsResult })
    const { plan } = await fetchMostRecentPlan(supabase, 'user-1')

    expect(plan.items[0].day).toBe('Mon')
    expect(plan.days).toEqual(['Mon'])
  })

  it('throws when the meal_plans fetch returns an error', async () => {
    const supabase = makeSupabase({
      planError: { message: 'connection reset', code: '500' },
    })
    await expect(fetchMostRecentPlan(supabase, 'user-1')).rejects.toMatchObject({
      message: 'connection reset',
    })
  })
})

// ---------------------------------------------------------------------------
// classifyPlanState
// ---------------------------------------------------------------------------

describe('classifyPlanState', () => {
  // Anchor "today" to a fixed local-calendar date so we can build YYYY-MM-DD
  // strings for period_start / period_end without timezone math in the test.
  const NOW = new Date(2026, 3, 19) // April 19, 2026 (a Sunday)
  const TODAY     = '2026-04-19'
  const TOMORROW  = '2026-04-20'
  const YESTERDAY = '2026-04-18'
  const PLUS_FOUR = '2026-04-23'
  const MINUS_30  = '2026-03-20'
  const MINUS_28  = '2026-03-22T10:00:00Z'

  it('returns no_plan when plan is null', () => {
    expect(classifyPlanState(null, NOW)).toBe('no_plan')
  })

  it('returns active when today falls inside [period_start, period_end]', () => {
    const plan = {
      period_start: TODAY,
      period_end: PLUS_FOUR,
      finalized_at: null,
    }
    expect(classifyPlanState(plan, NOW)).toBe('active')
  })

  it('returns ended_unfinalized when period_end is in the past and not finalized', () => {
    const plan = {
      period_start: '2026-04-12',
      period_end: YESTERDAY,
      finalized_at: null,
    }
    expect(classifyPlanState(plan, NOW)).toBe('ended_unfinalized')
  })

  it('returns finalized when finalized_at is set, regardless of dates', () => {
    const plan = {
      period_start: '2026-03-15',
      period_end: MINUS_30,
      finalized_at: MINUS_28,
    }
    expect(classifyPlanState(plan, NOW)).toBe('finalized')
  })

  it('treats period_end = today as still active (inclusive boundary)', () => {
    const plan = {
      period_start: '2026-04-15',
      period_end: TODAY,
      finalized_at: null,
    }
    expect(classifyPlanState(plan, NOW)).toBe('active')
  })

  it('treats a future-dated period (period_start > today) as active', () => {
    const plan = {
      period_start: TOMORROW,
      period_end: '2026-04-24',
      finalized_at: null,
    }
    expect(classifyPlanState(plan, NOW)).toBe('active')
  })

  it('treats a plan with null period_end as active (legacy safety)', () => {
    const plan = {
      period_start: null,
      period_end: null,
      finalized_at: null,
    }
    expect(classifyPlanState(plan, NOW)).toBe('active')
  })
})
