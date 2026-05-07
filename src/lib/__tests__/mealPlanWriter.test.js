import { describe, it, expect } from 'vitest'
import {
  createServedPlan,
  setItemCooked,
  finalizePlan,
  checkPeriodOverlap,
  startNewPeriod,
  resetCurrentPlan,
} from '../mealPlanWriter'

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
        isFilter: {},
      }
      client.calls.push(state)

      const chain = {
        insert(payload) {
          state.op = 'insert'
          state.payload = payload
          return chain
        },
        update(payload) {
          state.op = 'update'
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
        is(col, val) {
          state.isFilter[col] = val
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
        maybeSingle() {
          const key = `${state.table}.${state.op}.maybeSingle`
          const r = responses[key] ?? { data: null, error: null }
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

const FIVE_ITEMS = [
  { scheduled_date: '2026-04-19', name: 'Roast', id: UUID_A, is_wildcard: false, source_url: null },
  { scheduled_date: '2026-04-20', name: 'Tacos', id: UUID_B, is_wildcard: false, source_url: null },
  { scheduled_date: '2026-04-21', name: 'Ramen', id: UUID_C, is_wildcard: false, source_url: null },
  { scheduled_date: '2026-04-22', name: 'Curry', id: UUID_D, is_wildcard: false, source_url: null },
  { scheduled_date: '2026-04-23', name: 'Pizza', id: UUID_E, is_wildcard: false, source_url: null },
]

describe('createServedPlan', () => {
  it('derives period_start/period_end from min/max scheduled_date and inserts both writes', async () => {
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

    const result = await createServedPlan(supabase, 'user-1', FIVE_ITEMS)

    expect(supabase.calls).toHaveLength(2)
    const [plansCall, itemsCall] = supabase.calls

    expect(plansCall.table).toBe('meal_plans')
    expect(plansCall.op).toBe('insert')
    expect(plansCall.payload).toEqual({
      user_id: 'user-1',
      period_start: '2026-04-19',
      period_end: '2026-04-23',
      served_feedback: null,
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

    expect(result).toEqual({
      id: 'plan-new',
      served_at: '2026-04-19T12:00:00Z',
      period_start: '2026-04-19',
      period_end: '2026-04-23',
    })
  })

  it('handles a non-contiguous date list (gaps in the middle)', async () => {
    const supabase = makeSupabase({
      'meal_plans.insert.single': {
        data: {
          id: 'plan-gap',
          served_at: '2026-04-19T12:00:00Z',
          period_start: '2026-04-19',
          period_end: '2026-04-25',
        },
        error: null,
      },
    })

    const items = [
      { scheduled_date: '2026-04-19', name: 'A', id: UUID_A, is_wildcard: false, source_url: null },
      { scheduled_date: '2026-04-22', name: 'B', id: UUID_B, is_wildcard: false, source_url: null },
      { scheduled_date: '2026-04-25', name: 'C', id: UUID_C, is_wildcard: false, source_url: null },
    ]

    await createServedPlan(supabase, 'user-1', items)

    const [plansCall, itemsCall] = supabase.calls
    expect(plansCall.payload).toEqual({
      user_id: 'user-1',
      period_start: '2026-04-19',
      period_end: '2026-04-25',
      served_feedback: null,
    })
    expect(itemsCall.payload).toHaveLength(3)
  })

  it('throws when items is empty (UI guard)', async () => {
    const supabase = makeSupabase()
    await expect(createServedPlan(supabase, 'user-1', [])).rejects.toThrow(
      /non-empty/i,
    )
    expect(supabase.calls).toHaveLength(0)
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
      await createServedPlan(supabase, 'user-1', FIVE_ITEMS)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeDefined()
    expect(thrown.code).toBe('period_overlap')
    expect(thrown.cause).toBe(pgError)
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
      createServedPlan(supabase, 'user-1', FIVE_ITEMS),
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
      createServedPlan(supabase, 'user-1', FIVE_ITEMS),
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
      await createServedPlan(supabase, 'user-1', FIVE_ITEMS)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeDefined()
    expect(thrown.code).toBe('items_insert_failed')

    expect(supabase.calls).toHaveLength(3)
    const [, , deleteCall] = supabase.calls
    expect(deleteCall.table).toBe('meal_plans')
    expect(deleteCall.op).toBe('delete')
    expect(deleteCall.filter).toEqual({ id: 'plan-orphan' })
  })

  it('maps a wildcard item with null id to vault_id=null / is_wildcard=true', async () => {
    const supabase = makeSupabase()
    const items = [
      {
        scheduled_date: '2026-04-19',
        name: 'Mystery Soup',
        id: null,
        is_wildcard: true,
        source_url: 'https://example.com/soup',
      },
    ]

    await createServedPlan(supabase, 'user-1', items)

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
    const items = [
      {
        scheduled_date: '2026-04-19',
        name: 'AI Curry',
        id: 'ai-suggestion-0',
        is_wildcard: true,
        source_url: null,
      },
    ]

    await createServedPlan(supabase, 'user-1', items)

    const itemsCall = supabase.calls.find((c) => c.table === 'meal_plan_items')
    expect(itemsCall.payload[0].vault_id).toBeNull()
    expect(itemsCall.payload[0].is_wildcard).toBe(true)
  })

  it('passes served_feedback="positive" when opts.feedback is "positive"', async () => {
    const supabase = makeSupabase()
    const items = [
      { scheduled_date: '2026-04-19', name: 'Roast', id: UUID_A, is_wildcard: false, source_url: null },
    ]

    await createServedPlan(supabase, 'user-1', items, { feedback: 'positive' })

    const plansCall = supabase.calls.find((c) => c.table === 'meal_plans')
    expect(plansCall.payload.served_feedback).toBe('positive')
  })

  it('passes served_feedback="negative" when opts.feedback is "negative"', async () => {
    const supabase = makeSupabase()
    const items = [
      { scheduled_date: '2026-04-19', name: 'Roast', id: UUID_A, is_wildcard: false, source_url: null },
    ]

    await createServedPlan(supabase, 'user-1', items, { feedback: 'negative' })

    const plansCall = supabase.calls.find((c) => c.table === 'meal_plans')
    expect(plansCall.payload.served_feedback).toBe('negative')
  })

  it('defaults served_feedback to null when opts is omitted', async () => {
    const supabase = makeSupabase()
    const items = [
      { scheduled_date: '2026-04-19', name: 'Roast', id: UUID_A, is_wildcard: false, source_url: null },
    ]

    await createServedPlan(supabase, 'user-1', items)

    const plansCall = supabase.calls.find((c) => c.table === 'meal_plans')
    expect(plansCall.payload.served_feedback).toBeNull()
  })

  it('defaults served_feedback to null when opts.feedback is undefined', async () => {
    const supabase = makeSupabase()
    const items = [
      { scheduled_date: '2026-04-19', name: 'Roast', id: UUID_A, is_wildcard: false, source_url: null },
    ]

    await createServedPlan(supabase, 'user-1', items, {})

    const plansCall = supabase.calls.find((c) => c.table === 'meal_plans')
    expect(plansCall.payload.served_feedback).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// setItemCooked
// ---------------------------------------------------------------------------

describe('setItemCooked', () => {
  const ITEM_ID = 'mpi-abc'

  it('writes cooked=true with a non-null cooked_at when flipping on', async () => {
    const supabase = makeSupabase({
      'meal_plan_items.update': { data: null, error: null },
    })

    await setItemCooked(supabase, ITEM_ID, true)

    expect(supabase.calls).toHaveLength(1)
    const call = supabase.calls[0]
    expect(call.table).toBe('meal_plan_items')
    expect(call.op).toBe('update')
    expect(call.filter).toEqual({ id: ITEM_ID })
    expect(call.payload.cooked).toBe(true)
    expect(typeof call.payload.cooked_at).toBe('string')
    // Sanity-check the ISO shape rather than the exact instant.
    expect(call.payload.cooked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('writes cooked=false with cooked_at=null when flipping off', async () => {
    const supabase = makeSupabase({
      'meal_plan_items.update': { data: null, error: null },
    })

    await setItemCooked(supabase, ITEM_ID, false)

    const call = supabase.calls[0]
    expect(call.payload).toEqual({ cooked: false, cooked_at: null })
  })

  it('throws code=toggle_failed and attaches the original error on DB failure', async () => {
    const dbError = { code: '42501', message: 'permission denied' }
    const supabase = makeSupabase({
      'meal_plan_items.update': { data: null, error: dbError },
    })

    let thrown
    try {
      await setItemCooked(supabase, ITEM_ID, true)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeDefined()
    expect(thrown.code).toBe('toggle_failed')
    expect(thrown.cause).toBe(dbError)
  })
})

// ---------------------------------------------------------------------------
// resetCurrentPlan
// ---------------------------------------------------------------------------

describe('resetCurrentPlan', () => {
  const PLAN_ID = 'plan-reset'

  it('issues a delete on meal_plans filtered by id and finalized_at IS NULL', async () => {
    const supabase = makeSupabase({
      'meal_plans.delete': { data: [{ id: PLAN_ID }], error: null },
    })

    const result = await resetCurrentPlan(supabase, PLAN_ID)

    expect(result).toEqual({ deleted: true })
    expect(supabase.calls).toHaveLength(1)
    const call = supabase.calls[0]
    expect(call.table).toBe('meal_plans')
    expect(call.op).toBe('delete')
    expect(call.filter).toEqual({ id: PLAN_ID })
    expect(call.isFilter).toEqual({ finalized_at: null })
    expect(call.selectCols).toBe('id')
  })

  it('returns deleted:false when the plan is already finalized (no row matches)', async () => {
    // The .is('finalized_at', null) filter excludes finalized rows; the SDK
    // returns an empty array, which we treat as a soft refusal rather than
    // an error.
    const supabase = makeSupabase({
      'meal_plans.delete': { data: [], error: null },
    })

    const result = await resetCurrentPlan(supabase, PLAN_ID)

    expect(result).toEqual({ deleted: false })
  })

  it('throws code=reset_failed and attaches the original error on DB failure', async () => {
    const dbError = { code: '42501', message: 'permission denied' }
    const supabase = makeSupabase({
      'meal_plans.delete': { data: null, error: dbError },
    })

    let thrown
    try {
      await resetCurrentPlan(supabase, PLAN_ID)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeDefined()
    expect(thrown.code).toBe('reset_failed')
    expect(thrown.cause).toBe(dbError)
  })
})

// ---------------------------------------------------------------------------
// finalizePlan
// ---------------------------------------------------------------------------

describe('finalizePlan', () => {
  const PLAN_ID = 'plan-xyz'

  it('writes finalized_at and returns the timestamp from the update', async () => {
    const supabase = makeSupabase({
      'meal_plans.update.maybeSingle': {
        data: { finalized_at: '2026-04-23T18:00:00Z' },
        error: null,
      },
    })

    const result = await finalizePlan(supabase, PLAN_ID)

    expect(result).toEqual({ finalized_at: '2026-04-23T18:00:00Z' })
    expect(supabase.calls).toHaveLength(1)
    const call = supabase.calls[0]
    expect(call.table).toBe('meal_plans')
    expect(call.op).toBe('update')
    expect(call.filter).toEqual({ id: PLAN_ID })
    // Idempotency guard: the update only matches rows that haven't been finalized.
    expect(call.isFilter).toEqual({ finalized_at: null })
    expect(typeof call.payload.finalized_at).toBe('string')
    expect(call.payload.finalized_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('is idempotent: re-finalize reads back the existing timestamp without overwriting', async () => {
    // The .is('finalized_at', null) filter means an already-finalized row
    // doesn't match the UPDATE — the SDK returns `data: null`. finalizePlan
    // then issues a follow-up SELECT to recover the existing timestamp.
    const ORIGINAL_TS = '2026-04-23T18:00:00Z'
    const supabase = makeSupabase({
      'meal_plans.update.maybeSingle': { data: null, error: null },
      'meal_plans.null.maybeSingle': {
        data: { finalized_at: ORIGINAL_TS },
        error: null,
      },
    })

    const result = await finalizePlan(supabase, PLAN_ID)

    expect(result).toEqual({ finalized_at: ORIGINAL_TS })

    expect(supabase.calls).toHaveLength(2)
    const [updateCall, readCall] = supabase.calls
    expect(updateCall.op).toBe('update')
    expect(updateCall.isFilter).toEqual({ finalized_at: null })
    // The follow-up read: pure select + eq + maybeSingle (no insert/update/delete op set).
    expect(readCall.op).toBeNull()
    expect(readCall.selectCols).toBe('finalized_at')
    expect(readCall.filter).toEqual({ id: PLAN_ID })
  })

  it('throws code=finalize_failed and attaches the original error on DB failure', async () => {
    const dbError = { code: '42501', message: 'permission denied' }
    const supabase = makeSupabase({
      'meal_plans.update.maybeSingle': { data: null, error: dbError },
    })

    let thrown
    try {
      await finalizePlan(supabase, PLAN_ID)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeDefined()
    expect(thrown.code).toBe('finalize_failed')
    expect(thrown.cause).toBe(dbError)
  })
})

// ---------------------------------------------------------------------------
// checkPeriodOverlap (ADR-001 Phase 5)
// ---------------------------------------------------------------------------

function makeOverlapSupabase({ data = [], error = null } = {}) {
  return {
    from() {
      const state = { eqs: [], nots: [] }
      const chain = {
        select() { return chain },
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

describe('checkPeriodOverlap', () => {
  it('returns { overlaps: false } when no existing periods overlap', async () => {
    const supabase = makeOverlapSupabase({
      data: [
        { period_start: '2026-03-01', period_end: '2026-03-07' },
        { period_start: '2026-03-15', period_end: '2026-03-21' },
      ],
    })
    const result = await checkPeriodOverlap(
      supabase,
      'user-1',
      '2026-04-01',
      '2026-04-07',
    )
    expect(result).toEqual({ overlaps: false })
  })

  it('flags a simple overlap with the conflicting period', async () => {
    const supabase = makeOverlapSupabase({
      data: [{ period_start: '2026-04-05', period_end: '2026-04-10' }],
    })
    const result = await checkPeriodOverlap(
      supabase,
      'user-1',
      '2026-04-08',
      '2026-04-15',
    )
    expect(result).toEqual({
      overlaps: true,
      conflictingPeriod: { period_start: '2026-04-05', period_end: '2026-04-10' },
    })
  })

  it('flags when the new range fully contains an existing period', async () => {
    const supabase = makeOverlapSupabase({
      data: [{ period_start: '2026-04-10', period_end: '2026-04-12' }],
    })
    const result = await checkPeriodOverlap(
      supabase,
      'user-1',
      '2026-04-01',
      '2026-04-30',
    )
    expect(result.overlaps).toBe(true)
    expect(result.conflictingPeriod).toEqual({
      period_start: '2026-04-10',
      period_end: '2026-04-12',
    })
  })

  it('flags when the new range is fully contained inside an existing period', async () => {
    const supabase = makeOverlapSupabase({
      data: [{ period_start: '2026-04-01', period_end: '2026-04-30' }],
    })
    const result = await checkPeriodOverlap(
      supabase,
      'user-1',
      '2026-04-10',
      '2026-04-12',
    )
    expect(result.overlaps).toBe(true)
  })

  it('treats adjacent ranges (end == start next day) as non-overlapping', async () => {
    const supabase = makeOverlapSupabase({
      data: [{ period_start: '2026-04-01', period_end: '2026-04-07' }],
    })
    const result = await checkPeriodOverlap(
      supabase,
      'user-1',
      '2026-04-08',
      '2026-04-14',
    )
    expect(result.overlaps).toBe(false)
  })

  it('handles empty rows (no existing periods) as non-overlapping', async () => {
    const supabase = makeOverlapSupabase({ data: [] })
    const result = await checkPeriodOverlap(
      supabase,
      'user-1',
      '2026-04-01',
      '2026-04-07',
    )
    expect(result.overlaps).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// startNewPeriod (ADR-001 Phase 5)
// ---------------------------------------------------------------------------

/**
 * Tracks the full query sequence. Each `from(...)` entry records what
 * op + payload + filters were applied and what response is returned. For
 * startNewPeriod the sequence is:
 *   1. meal_plans.insert.select.single  → new plan row
 *   2. meal_plan_items.update.eq.eq     → one per leftover to move
 *   3. (on failure) meal_plans.delete.eq → cleanup
 */
function makeRolloverSupabase(responses = {}) {
  const client = {
    calls: [],
    from(table) {
      const state = {
        table,
        op: null,
        payload: null,
        filters: {},
      }
      client.calls.push(state)
      const chain = {
        insert(payload) { state.op = 'insert'; state.payload = payload; return chain },
        update(payload) { state.op = 'update'; state.payload = payload; return chain },
        delete() { state.op = 'delete'; return chain },
        select() { return chain },
        eq(col, val) { state.filters[col] = val; return chain },
        not() { return chain },
        single() {
          const key = `${table}.insert.single`
          const r = responses[key] ?? {
            data: {
              id: 'plan-new',
              period_start: state.payload?.period_start ?? null,
              period_end: state.payload?.period_end ?? null,
            },
            error: null,
          }
          return Promise.resolve(r)
        },
        then(onFulfilled, onRejected) {
          const key = `${table}.${state.op}`
          const r = responses[key] ?? { data: null, error: null }
          return Promise.resolve(r).then(onFulfilled, onRejected)
        },
      }
      return chain
    },
  }
  return client
}

describe('startNewPeriod', () => {
  it('happy path with 0 leftovers inserts plan, issues no updates', async () => {
    const supabase = makeRolloverSupabase({
      'meal_plans.insert.single': {
        data: { id: 'plan-new', period_start: '2026-05-01', period_end: '2026-05-05' },
        error: null,
      },
    })

    const result = await startNewPeriod(
      supabase,
      'user-1',
      '2026-05-01',
      '2026-05-05',
      [],
    )

    expect(result).toEqual({
      id: 'plan-new',
      period_start: '2026-05-01',
      period_end: '2026-05-05',
      rolled_forward: 0,
      overflow: 0,
    })
    // Exactly one call: the plan insert.
    expect(supabase.calls).toHaveLength(1)
    expect(supabase.calls[0]).toMatchObject({
      table: 'meal_plans',
      op: 'insert',
      payload: {
        user_id: 'user-1',
        period_start: '2026-05-01',
        period_end: '2026-05-05',
      },
    })
  })

  it('rolls 3 leftovers into days 1–3 of a 5-day period', async () => {
    const supabase = makeRolloverSupabase({
      'meal_plans.insert.single': {
        data: { id: 'plan-new', period_start: '2026-05-01', period_end: '2026-05-05' },
        error: null,
      },
      'meal_plan_items.update': { data: null, error: null },
    })

    const result = await startNewPeriod(
      supabase,
      'user-1',
      '2026-05-01',
      '2026-05-05',
      ['L1', 'L2', 'L3'],
    )

    expect(result).toEqual({
      id: 'plan-new',
      period_start: '2026-05-01',
      period_end: '2026-05-05',
      rolled_forward: 3,
      overflow: 0,
    })

    const updates = supabase.calls.filter((c) => c.op === 'update')
    expect(updates).toHaveLength(3)
    expect(updates.map((u) => u.payload)).toEqual([
      { meal_plan_id: 'plan-new', scheduled_date: '2026-05-01' },
      { meal_plan_id: 'plan-new', scheduled_date: '2026-05-02' },
      { meal_plan_id: 'plan-new', scheduled_date: '2026-05-03' },
    ])
    expect(updates.map((u) => u.filters.id)).toEqual(['L1', 'L2', 'L3'])
    // Each update also scopes by user_id as belt-and-braces with RLS.
    expect(updates.every((u) => u.filters.user_id === 'user-1')).toBe(true)
  })

  it('drops overflow when 5 leftovers are given for a 3-day period', async () => {
    const supabase = makeRolloverSupabase({
      'meal_plans.insert.single': {
        data: { id: 'plan-new', period_start: '2026-05-01', period_end: '2026-05-03' },
        error: null,
      },
      'meal_plan_items.update': { data: null, error: null },
    })

    const result = await startNewPeriod(
      supabase,
      'user-1',
      '2026-05-01',
      '2026-05-03',
      ['L1', 'L2', 'L3', 'L4', 'L5'],
    )

    expect(result).toEqual({
      id: 'plan-new',
      period_start: '2026-05-01',
      period_end: '2026-05-03',
      rolled_forward: 3,
      overflow: 2,
    })

    const updates = supabase.calls.filter((c) => c.op === 'update')
    expect(updates).toHaveLength(3)
    expect(updates.map((u) => u.filters.id)).toEqual(['L1', 'L2', 'L3'])
  })

  it('maps EXCLUDE constraint violation to code=period_overlap and attempts no updates', async () => {
    const supabase = makeRolloverSupabase({
      'meal_plans.insert.single': {
        data: null,
        error: {
          code: '23P01',
          message:
            'conflicting key value violates exclusion constraint "meal_plans_no_period_overlap"',
        },
      },
    })

    let thrown
    try {
      await startNewPeriod(
        supabase,
        'user-1',
        '2026-05-01',
        '2026-05-05',
        ['L1'],
      )
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeDefined()
    expect(thrown.code).toBe('period_overlap')
    // No update attempts should have been made after the insert failure.
    expect(supabase.calls.filter((c) => c.op === 'update')).toHaveLength(0)
  })

  it('wraps other plan-insert failures with code=plan_insert_failed', async () => {
    const supabase = makeRolloverSupabase({
      'meal_plans.insert.single': {
        data: null,
        error: { code: '42501', message: 'permission denied' },
      },
    })

    await expect(
      startNewPeriod(supabase, 'user-1', '2026-05-01', '2026-05-05', []),
    ).rejects.toMatchObject({ code: 'plan_insert_failed' })
  })

  it('deletes the new plan row if a leftover update fails', async () => {
    const supabase = makeRolloverSupabase({
      'meal_plans.insert.single': {
        data: { id: 'plan-orphan', period_start: '2026-05-01', period_end: '2026-05-05' },
        error: null,
      },
      'meal_plan_items.update': {
        data: null,
        error: { code: '23503', message: 'foreign key violation' },
      },
      'meal_plans.delete': { data: null, error: null },
    })

    let thrown
    try {
      await startNewPeriod(
        supabase,
        'user-1',
        '2026-05-01',
        '2026-05-05',
        ['L1', 'L2'],
      )
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeDefined()
    expect(thrown.code).toBe('rollforward_failed')

    // The compensating delete targets the orphan plan row.
    const deleteCall = supabase.calls.find(
      (c) => c.table === 'meal_plans' && c.op === 'delete',
    )
    expect(deleteCall).toBeDefined()
    expect(deleteCall.filters).toEqual({ id: 'plan-orphan' })
  })
})
