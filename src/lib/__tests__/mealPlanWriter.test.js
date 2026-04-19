import { describe, it, expect } from 'vitest'
import { derivePlanDates, createServedPlan } from '../mealPlanWriter'

// ---------------------------------------------------------------------------
// derivePlanDates
// ---------------------------------------------------------------------------

describe('derivePlanDates', () => {
  it('maps a Sun–Thu plan to real dates when today is Saturday', () => {
    // new Date(year, monthIndex, day) is LOCAL-time; 2026-04-18 is a Saturday.
    const now = new Date(2026, 3, 18)
    const result = derivePlanDates(
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'],
      now,
    )

    expect(result.period_start).toBe('2026-04-19')
    expect(result.period_end).toBe('2026-04-23')
    expect(result.dateByDay).toEqual({
      Sun: '2026-04-19',
      Mon: '2026-04-20',
      Tue: '2026-04-21',
      Wed: '2026-04-22',
      Thu: '2026-04-23',
    })
  })

  it('skips to next week when today matches planDays[0]', () => {
    // 2026-04-19 is a Sunday — the strictly-after rule must pick the NEXT Sun.
    const now = new Date(2026, 3, 19)
    const result = derivePlanDates(
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'],
      now,
    )

    expect(result.period_start).toBe('2026-04-26')
    expect(result.period_end).toBe('2026-04-30')
    expect(result.dateByDay.Sun).toBe('2026-04-26')
  })

  it('handles a plan that starts mid-week (Mon–Fri)', () => {
    // 2026-04-18 is Saturday; next Monday is 2026-04-20.
    const now = new Date(2026, 3, 18)
    const result = derivePlanDates(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], now)

    expect(result.period_start).toBe('2026-04-20')
    expect(result.period_end).toBe('2026-04-24')
    expect(result.dateByDay).toEqual({
      Mon: '2026-04-20',
      Tue: '2026-04-21',
      Wed: '2026-04-22',
      Thu: '2026-04-23',
      Fri: '2026-04-24',
    })
  })

  it('is timezone-stable: formatted output does not depend on UTC conversion', () => {
    // Construct `now` with local-time components. If the implementation
    // accidentally called toISOString() on firstDate, the date would flip
    // in time zones east of UTC+12 (e.g. Kiribati UTC+14) where local
    // midnight is 10am the PREVIOUS day in UTC. Here we assert that the
    // output is derived purely from getFullYear/Month/Date of a date
    // constructed from local components — a property we can verify without
    // forking the process TZ.
    const now = new Date(2026, 3, 18, 23, 59, 59) // late-evening Sat local
    const result = derivePlanDates(
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'],
      now,
    )

    // If the implementation used toISOString() on a local-midnight Date in a
    // positive-offset timezone, period_start would come out as '2026-04-18'
    // instead of '2026-04-19'. The assertion below will fail in that case.
    expect(result.period_start).toBe('2026-04-19')
    expect(result.period_end).toBe('2026-04-23')
    // Spot-check: a 'YYYY-MM-DD' shape, no 'T' separator from ISO.
    for (const d of Object.values(result.dateByDay)) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('throws on an empty planDays array', () => {
    expect(() => derivePlanDates([], new Date(2026, 3, 18))).toThrow(
      /non-empty/i,
    )
  })

  it('throws on an unknown weekday abbreviation', () => {
    expect(() =>
      derivePlanDates(['Sun', 'Xyz'], new Date(2026, 3, 18)),
    ).toThrow(/invalid weekday/i)
  })
})

// ---------------------------------------------------------------------------
// createServedPlan
// ---------------------------------------------------------------------------

/**
 * Handwritten Supabase client fake.
 *
 * Three query shapes are exercised by mealPlanWriter:
 *   meal_plans insert:      .from('meal_plans').insert(obj).select(...).single() → Promise
 *   meal_plan_items insert: .from('meal_plan_items').insert(rows)                → thenable
 *   meal_plans delete:      .from('meal_plans').delete().eq('id', ...)            → thenable
 *
 * Each `from(table)` pushes a call record onto `client.calls` so tests can
 * assert ordering and payload shape. Per-operation responses are programmed
 * via the `responses` argument; omitted ones default to success.
 */
function makeSupabase(responses = {}) {
  const client = {
    calls: [],
    from(table) {
      const state = {
        table,
        op: null,
        payload: null,
        selectCols: null,
        filter: {},
      }
      client.calls.push(state)

      const chain = {
        insert(payload) {
          state.op = 'insert'
          state.payload = payload
          return chain
        },
        delete() {
          state.op = 'delete'
          return chain
        },
        eq(col, val) {
          state.filter[col] = val
          return chain
        },
        select(cols) {
          state.selectCols = cols
          return chain
        },
        single() {
          const key = `${state.table}.${state.op}.single`
          const r =
            responses[key] ??
            // sensible default for meal_plans.insert.single
            {
              data: {
                id: 'plan-new',
                served_at: '2026-04-19T12:00:00Z',
                period_start: state.payload?.period_start ?? null,
                period_end: state.payload?.period_end ?? null,
              },
              error: null,
            }
          return Promise.resolve(r)
        },
        then(onFulfilled, onRejected) {
          const key = `${state.table}.${state.op}`
          const r = responses[key] ?? { data: null, error: null }
          return Promise.resolve(r).then(onFulfilled, onRejected)
        },
      }
      return chain
    },
  }
  return client
}

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'
const UUID_C = '33333333-3333-4333-8333-333333333333'
const UUID_D = '44444444-4444-4444-8444-444444444444'
const UUID_E = '55555555-5555-4555-8555-555555555555'

const FIVE_DAY_PLAN = [
  { day: 'Sun', name: 'Roast',    id: UUID_A, is_wildcard: false, source_url: null },
  { day: 'Mon', name: 'Tacos',    id: UUID_B, is_wildcard: false, source_url: null },
  { day: 'Tue', name: 'Ramen',    id: UUID_C, is_wildcard: false, source_url: null },
  { day: 'Wed', name: 'Curry',    id: UUID_D, is_wildcard: false, source_url: null },
  { day: 'Thu', name: 'Pizza',    id: UUID_E, is_wildcard: false, source_url: null },
]

const PLAN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu']

describe('createServedPlan', () => {
  it('inserts meal_plans with only the new-schema fields, then meal_plan_items', async () => {
    const supabase = makeSupabase({
      'meal_plans.insert.single': {
        data: {
          id: 'plan-new',
          served_at: '2026-04-19T12:00:00Z',
          period_start: '2026-04-19',
          period_end: '2026-04-23',
        },
        error: null,
      },
    })

    const result = await createServedPlan(
      supabase,
      'user-1',
      FIVE_DAY_PLAN,
      PLAN_DAYS,
      new Date(2026, 3, 18), // Sat
    )

    // Exactly two writes, in order: meal_plans then meal_plan_items.
    expect(supabase.calls).toHaveLength(2)
    const [plansCall, itemsCall] = supabase.calls

    expect(plansCall.table).toBe('meal_plans')
    expect(plansCall.op).toBe('insert')
    expect(plansCall.payload).toEqual({
      user_id: 'user-1',
      period_start: '2026-04-19',
      period_end: '2026-04-23',
    })
    // Guard against accidental writes to deprecated columns.
    expect(plansCall.payload).not.toHaveProperty('week_label')
    expect(plansCall.payload).not.toHaveProperty('days')
    expect(plansCall.payload).not.toHaveProperty('items')

    expect(itemsCall.table).toBe('meal_plan_items')
    expect(itemsCall.op).toBe('insert')
    expect(Array.isArray(itemsCall.payload)).toBe(true)
    expect(itemsCall.payload).toHaveLength(5)

    expect(itemsCall.payload[0]).toEqual({
      user_id: 'user-1',
      meal_plan_id: 'plan-new',
      scheduled_date: '2026-04-19',
      position: 0,
      vault_id: UUID_A,
      name: 'Roast',
      is_wildcard: false,
      source_url: null,
    })
    expect(itemsCall.payload.map((r) => r.scheduled_date)).toEqual([
      '2026-04-19',
      '2026-04-20',
      '2026-04-21',
      '2026-04-22',
      '2026-04-23',
    ])
    expect(itemsCall.payload.map((r) => r.name)).toEqual([
      'Roast',
      'Tacos',
      'Ramen',
      'Curry',
      'Pizza',
    ])
    expect(itemsCall.payload.map((r) => r.vault_id)).toEqual([
      UUID_A,
      UUID_B,
      UUID_C,
      UUID_D,
      UUID_E,
    ])

    expect(result).toEqual({
      id: 'plan-new',
      served_at: '2026-04-19T12:00:00Z',
      period_start: '2026-04-19',
      period_end: '2026-04-23',
    })
  })

  it('wraps the EXCLUDE constraint violation with code=period_overlap', async () => {
    const pgError = {
      code: '23P01',
      message:
        'conflicting key value violates exclusion constraint "meal_plans_no_period_overlap"',
    }
    const supabase = makeSupabase({
      'meal_plans.insert.single': { data: null, error: pgError },
    })

    let thrown
    try {
      await createServedPlan(
        supabase,
        'user-1',
        FIVE_DAY_PLAN,
        PLAN_DAYS,
        new Date(2026, 3, 18),
      )
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeDefined()
    expect(thrown.code).toBe('period_overlap')
    expect(thrown.cause).toBe(pgError)
    // We should NOT have attempted the items insert after the overlap failure.
    expect(supabase.calls).toHaveLength(1)
    expect(supabase.calls[0].table).toBe('meal_plans')
  })

  it('also detects overlap by constraint name when code is missing', async () => {
    const pgError = {
      message:
        'duplicate key value violates exclusion constraint "meal_plans_no_period_overlap"',
      constraint: 'meal_plans_no_period_overlap',
    }
    const supabase = makeSupabase({
      'meal_plans.insert.single': { data: null, error: pgError },
    })

    await expect(
      createServedPlan(
        supabase,
        'user-1',
        FIVE_DAY_PLAN,
        PLAN_DAYS,
        new Date(2026, 3, 18),
      ),
    ).rejects.toMatchObject({ code: 'period_overlap' })
  })

  it('wraps a generic plan-insert failure with code=plan_insert_failed', async () => {
    const supabase = makeSupabase({
      'meal_plans.insert.single': {
        data: null,
        error: { code: '42501', message: 'permission denied' },
      },
    })

    await expect(
      createServedPlan(
        supabase,
        'user-1',
        FIVE_DAY_PLAN,
        PLAN_DAYS,
        new Date(2026, 3, 18),
      ),
    ).rejects.toMatchObject({ code: 'plan_insert_failed' })
  })

  it('deletes the orphan meal_plans row when meal_plan_items insert fails', async () => {
    const supabase = makeSupabase({
      'meal_plans.insert.single': {
        data: {
          id: 'plan-orphan',
          served_at: '2026-04-19T12:00:00Z',
          period_start: '2026-04-19',
          period_end: '2026-04-23',
        },
        error: null,
      },
      'meal_plan_items.insert': {
        data: null,
        error: { code: '23503', message: 'foreign key violation' },
      },
      'meal_plans.delete': { data: null, error: null },
    })

    let thrown
    try {
      await createServedPlan(
        supabase,
        'user-1',
        FIVE_DAY_PLAN,
        PLAN_DAYS,
        new Date(2026, 3, 18),
      )
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeDefined()
    expect(thrown.code).toBe('items_insert_failed')

    // Three calls in order: insert meal_plans, insert meal_plan_items, delete meal_plans.
    expect(supabase.calls).toHaveLength(3)
    const [, , deleteCall] = supabase.calls
    expect(deleteCall.table).toBe('meal_plans')
    expect(deleteCall.op).toBe('delete')
    expect(deleteCall.filter).toEqual({ id: 'plan-orphan' })
  })

  it('maps a wildcard slot with null id to vault_id=null / is_wildcard=true', async () => {
    const supabase = makeSupabase()
    const planWithWildcard = [
      {
        day: 'Sun',
        name: 'Mystery Soup',
        id: null,
        is_wildcard: true,
        source_url: 'https://example.com/soup',
      },
    ]

    await createServedPlan(
      supabase,
      'user-1',
      planWithWildcard,
      ['Sun'],
      new Date(2026, 3, 18),
    )

    const itemsCall = supabase.calls.find((c) => c.table === 'meal_plan_items')
    expect(itemsCall).toBeDefined()
    expect(itemsCall.payload).toHaveLength(1)
    expect(itemsCall.payload[0]).toMatchObject({
      vault_id: null,
      is_wildcard: true,
      name: 'Mystery Soup',
      source_url: 'https://example.com/soup',
    })
  })

  it('nulls out non-UUID ids (e.g. synthetic AI-suggestion ids)', async () => {
    const supabase = makeSupabase()
    const plan = [
      {
        day: 'Sun',
        name: 'AI Curry',
        id: 'ai-suggestion-0',
        is_wildcard: true,
        source_url: null,
      },
    ]

    await createServedPlan(
      supabase,
      'user-1',
      plan,
      ['Sun'],
      new Date(2026, 3, 18),
    )

    const itemsCall = supabase.calls.find((c) => c.table === 'meal_plan_items')
    expect(itemsCall.payload[0].vault_id).toBeNull()
    expect(itemsCall.payload[0].is_wildcard).toBe(true)
  })
})
