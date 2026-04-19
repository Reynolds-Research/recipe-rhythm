import { describe, it, expect } from 'vitest'
import {
  fetchMostRecentPlan,
  fetchCurrentLeftovers,
  classifyPlanState,
} from '../mealPlanReader'

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
    })
    expect(plan.items[2]).toEqual({
      day: 'Tue', name: 'Old Wildcard', id: null, is_wildcard: true, source_url: 'https://example.com/wild',
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
      { scheduled_date: '2026-04-12', position: 0, vault_id: 'new-1', name: 'New Pancakes', is_wildcard: false, source_url: null },
    ]
    const supabase = makeSupabase({ planResult: dualPlan, itemsResult })
    const { plan } = await fetchMostRecentPlan(supabase, 'user-1')

    expect(plan.source).toBe('new')
    expect(plan.items).toEqual([
      { day: 'Sun', name: 'New Pancakes', id: 'new-1', is_wildcard: false, source_url: null },
    ])
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
// classifyPlanState (ADR-001 Phase 5)
// ---------------------------------------------------------------------------

describe('classifyPlanState', () => {
  const TODAY = new Date(2026, 3, 19) // local-time Apr 19 2026

  it('returns "none" for null/undefined plan', () => {
    expect(classifyPlanState(null, TODAY)).toBe('none')
    expect(classifyPlanState(undefined, TODAY)).toBe('none')
  })

  it('returns "active" when the plan has no finalized_at', () => {
    const plan = { finalized_at: null, period_end: '2026-04-23' }
    expect(classifyPlanState(plan, TODAY)).toBe('active')
  })

  it('returns "gap" when finalized_at is set AND today > period_end', () => {
    // This replaces the previous "finalized" mapping for past-end periods.
    const plan = {
      finalized_at: '2026-04-18T00:00:00Z',
      period_end: '2026-04-18',
    }
    expect(classifyPlanState(plan, TODAY)).toBe('gap')
  })

  it('returns "finalized" when finalized_at is set AND today ≤ period_end', () => {
    const plan = {
      finalized_at: '2026-04-19T00:00:00Z',
      period_end: '2026-04-25',
    }
    expect(classifyPlanState(plan, TODAY)).toBe('finalized')
  })

  it('handles same-day boundary as finalized (not gap)', () => {
    const plan = {
      finalized_at: '2026-04-19T00:00:00Z',
      period_end: '2026-04-19',
    }
    expect(classifyPlanState(plan, TODAY)).toBe('finalized')
  })
})

// ---------------------------------------------------------------------------
// fetchCurrentLeftovers (ADR-001 Phase 5)
// ---------------------------------------------------------------------------

// A lighter shape — fetchCurrentLeftovers uses `.from(...).select().eq().order()`
// and terminates via the thenable. We mirror the pattern from makeSupabase above
// without the meal_plan_items branch.
function makeLeftoversSupabase({ data = [], error = null } = {}) {
  const calls = { current_leftovers: null }
  return {
    calls,
    from(table) {
      const state = { select: null, eqs: [], orders: [] }
      calls[table] = state
      const chain = {
        select(cols) { state.select = cols; return chain },
        eq(col, val) { state.eqs.push([col, val]); return chain },
        order(col, opts) { state.orders.push([col, opts]); return chain },
        then(onFulfilled, onRejected) {
          return Promise.resolve({ data, error }).then(onFulfilled, onRejected)
        },
      }
      return chain
    },
  }
}

describe('fetchCurrentLeftovers', () => {
  it('maps rows from the current_leftovers view to the UI shape', async () => {
    const data = [
      {
        id: 'item-1',
        name: 'Roast',
        vault_id: 'v1',
        is_wildcard: false,
        source_url: null,
        scheduled_date: '2026-04-12',
        source_period_start: '2026-04-12',
        source_period_end: '2026-04-18',
      },
      {
        id: 'item-2',
        name: 'Curry',
        vault_id: null,
        is_wildcard: true,
        source_url: 'https://example.com/curry',
        scheduled_date: '2026-04-14',
        source_period_start: '2026-04-12',
        source_period_end: '2026-04-18',
      },
    ]
    const supabase = makeLeftoversSupabase({ data })
    const result = await fetchCurrentLeftovers(supabase, 'user-1')

    expect(supabase.calls.current_leftovers).toBeTruthy()
    expect(supabase.calls.current_leftovers.eqs).toContainEqual(['user_id', 'user-1'])
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      id: 'item-1',
      name: 'Roast',
      vault_id: 'v1',
      is_wildcard: false,
      source_url: null,
      scheduled_date: '2026-04-12',
      source_period_start: '2026-04-12',
      source_period_end: '2026-04-18',
    })
    expect(result[1].is_wildcard).toBe(true)
    expect(result[1].source_url).toBe('https://example.com/curry')
  })

  it('returns [] when there are no leftovers', async () => {
    const supabase = makeLeftoversSupabase({ data: [] })
    const result = await fetchCurrentLeftovers(supabase, 'user-1')
    expect(result).toEqual([])
  })

  it('throws when the view query errors', async () => {
    const supabase = makeLeftoversSupabase({
      data: null,
      error: { message: 'permission denied', code: '42501' },
    })
    await expect(fetchCurrentLeftovers(supabase, 'user-1')).rejects.toMatchObject({
      message: 'permission denied',
    })
  })
})
