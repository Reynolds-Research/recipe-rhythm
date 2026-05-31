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

  it('prefers the new schema: items carry scheduled_date directly', async () => {
    const itemsResult = [
      { id: 'mpi-1', scheduled_date: '2026-04-12', position: 0, vault_id: 'v1', name: 'Pancakes', is_wildcard: false, source_url: null, cooked: false, cooked_at: null },
      { id: 'mpi-2', scheduled_date: '2026-04-13', position: 0, vault_id: 'v2', name: 'Tacos',    is_wildcard: false, source_url: null, cooked: false, cooked_at: null },
      { id: 'mpi-3', scheduled_date: '2026-04-14', position: 0, vault_id: 'v3', name: 'Ramen',    is_wildcard: false, source_url: null, cooked: false, cooked_at: null },
      { id: 'mpi-4', scheduled_date: '2026-04-15', position: 0, vault_id: null, name: 'Curry',    is_wildcard: true,  source_url: 'https://example.com/curry', cooked: false, cooked_at: null },
      { id: 'mpi-5', scheduled_date: '2026-04-16', position: 0, vault_id: 'v5', name: 'Pizza',    is_wildcard: false, source_url: null, cooked: false, cooked_at: null },
    ]
    const supabase = makeSupabase({ planResult: PLAN_ROW, itemsResult })
    const { plan } = await fetchMostRecentPlan(supabase, 'user-1')

    expect(plan.source).toBe('new')
    expect(plan.id).toBe('plan-1')
    expect(plan.period_start).toBe('2026-04-12')
    expect(plan.items).toHaveLength(5)
    expect(plan.items.map(i => i.scheduled_date)).toEqual([
      '2026-04-12', '2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16',
    ])
    expect(plan.items.map(i => i.name)).toEqual(['Pancakes', 'Tacos', 'Ramen', 'Curry', 'Pizza'])
    expect(plan.items.map(i => i.id)).toEqual(['v1', 'v2', 'v3', null, 'v5'])
    expect(plan.items[3]).toMatchObject({
      is_wildcard: true,
      source_url: 'https://example.com/curry',
    })
    // No legacy `day` weekday field on items.
    expect(plan.items[0]).not.toHaveProperty('day')
    expect(plan.scheduledDates).toEqual([
      '2026-04-12', '2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16',
    ])
  })

  it('legacy fallback: derives scheduled_date from weekday + served_at', async () => {
    // PLAN_ROW.served_at = '2026-04-12T10:00:00Z' which is a Sunday in local time.
    // Sun→Sun = 2026-04-12; Mon→Mon = 2026-04-13; Tue→Tue = 2026-04-14.
    const legacyPlan = {
      ...PLAN_ROW,
      items: [
        { day: 'Sun', name: 'Old Roast',    vault_id: 'v-old-1', is_wildcard: false, source_url: null },
        { day: 'Mon', name: 'Old Tacos',    vault_id: 'v-old-2', is_wildcard: false, source_url: null },
        { day: 'Tue', name: 'Old Wildcard', vault_id: null,      is_wildcard: true,  source_url: 'https://example.com/wild' },
      ],
    }
    const supabase = makeSupabase({ planResult: legacyPlan, itemsResult: [] })
    const { plan } = await fetchMostRecentPlan(supabase, 'user-1')

    expect(plan.source).toBe('legacy')
    expect(plan.items).toHaveLength(3)
    // scheduled_date is derived for each legacy weekday.
    expect(plan.items.map(i => i.scheduled_date)).toEqual([
      '2026-04-12', '2026-04-13', '2026-04-14',
    ])
    expect(plan.items[0]).toMatchObject({
      scheduled_date: '2026-04-12',
      name: 'Old Roast',
      id: 'v-old-1',
      item_id: null,
      cooked: false,
    })
    expect(plan.items[2]).toMatchObject({
      scheduled_date: '2026-04-14',
      is_wildcard: true,
      source_url: 'https://example.com/wild',
    })
    expect(plan.scheduledDates).toEqual(['2026-04-12', '2026-04-13', '2026-04-14'])
  })

  it('legacy fallback: drops items with malformed weekday rather than emit invalid dates', async () => {
    const legacyPlan = {
      ...PLAN_ROW,
      items: [
        { day: 'Sun', name: 'Valid',   vault_id: 'v1', is_wildcard: false, source_url: null },
        { day: 'Xyz', name: 'Bad',     vault_id: 'v2', is_wildcard: false, source_url: null },
        { day: null,  name: 'AlsoBad', vault_id: 'v3', is_wildcard: false, source_url: null },
      ],
    }
    const supabase = makeSupabase({ planResult: legacyPlan, itemsResult: [] })
    const { plan } = await fetchMostRecentPlan(supabase, 'user-1')

    expect(plan.items).toHaveLength(1)
    expect(plan.items[0].name).toBe('Valid')
  })

  it('legacy fallback: drops everything when served_at is missing', async () => {
    const legacyPlan = {
      ...PLAN_ROW,
      served_at: null,
      items: [
        { day: 'Sun', name: 'Old Roast', vault_id: 'v-old-1', is_wildcard: false, source_url: null },
      ],
    }
    const supabase = makeSupabase({ planResult: legacyPlan, itemsResult: [] })
    const { plan } = await fetchMostRecentPlan(supabase, 'user-1')
    expect(plan.source).toBe('legacy')
    expect(plan.items).toEqual([])
    expect(plan.scheduledDates).toEqual([])
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
        scheduled_date: '2026-04-12',
        name: 'New Pancakes',
        id: 'new-1',
        is_wildcard: false,
        source_url: null,
        item_id: 'mpi-1',
        cooked: false,
        cooked_at: null,
        // PRD-002 P0.6: every mapped row carries the shortlist flag.
        is_shortlisted: false,
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

  it('returns empty items + empty scheduledDates when neither source has any rows', async () => {
    const emptyPlan = { ...PLAN_ROW, items: [] }
    const supabase = makeSupabase({ planResult: emptyPlan, itemsResult: [] })
    const { plan } = await fetchMostRecentPlan(supabase, 'user-1')

    expect(plan).toMatchObject({
      id: 'plan-1',
      items: [],
      scheduledDates: [],
      source: 'new',
    })
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

  // ADR-001 Phase 5 split: what was "finalized regardless of dates" now
  // bifurcates. Finalized + today ≤ period_end → 'finalized' (locked but the
  // window isn't over). Finalized + today > period_end → 'gap' (the past-end
  // state routed to the new gap-day view).
  it('returns finalized when finalized_at is set AND today ≤ period_end', () => {
    const plan = {
      period_start: '2026-04-15',
      period_end: PLUS_FOUR,
      finalized_at: MINUS_28,
    }
    expect(classifyPlanState(plan, NOW)).toBe('finalized')
  })

  it('returns gap when finalized_at is set AND today > period_end', () => {
    // Replaces the previous "finalized regardless of dates" mapping for the
    // past-end case. Same input shape as the old test; different output.
    const plan = {
      period_start: '2026-03-15',
      period_end: MINUS_30,
      finalized_at: MINUS_28,
    }
    expect(classifyPlanState(plan, NOW)).toBe('gap')
  })

  it('keeps same-day boundary as finalized, not gap', () => {
    const plan = {
      period_start: '2026-04-15',
      period_end: TODAY,
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

  // Regression: the `current_leftovers` view predates the shortlist feature
  // (PRD-002 P0.6) and historically leaked shortlisted rows — which have
  // `scheduled_date = NULL` — into the result set. Downstream formatters
  // (LeftoverPicker.formatShortDate) crashed on null, surfacing the global
  // ErrorBoundary right after the user confirmed dates for a new period.
  // The companion migration 20260530000002 fixes the view at the DB layer;
  // this filter is defense-in-depth at the data-access layer so a stale view
  // or future regression can never surface a null-date leftover to the UI.
  it('filters out rows with null scheduled_date (shortlist leak guard)', async () => {
    const data = [
      {
        id: 'item-real',
        name: 'Roast',
        vault_id: 'v1',
        is_wildcard: false,
        source_url: null,
        scheduled_date: '2026-04-12',
        source_period_start: '2026-04-12',
        source_period_end: '2026-04-18',
      },
      {
        // Shortlisted leftover that leaked from the view — would crash
        // LeftoverPicker before this filter.
        id: 'item-shortlist',
        name: 'Cheese Tuna Orzo',
        vault_id: 'v2',
        is_wildcard: false,
        source_url: null,
        scheduled_date: null,
        source_period_start: '2026-04-12',
        source_period_end: '2026-04-18',
      },
    ]
    const supabase = makeLeftoversSupabase({ data })
    const result = await fetchCurrentLeftovers(supabase, 'user-1')

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('item-real')
    expect(result.every((r) => !!r.scheduled_date)).toBe(true)
  })
})
