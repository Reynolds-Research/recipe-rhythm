import { describe, it, expect } from 'vitest'
import {
  getActivePeriodItems,
  deleteMealPlanItems,
} from '../mealPlanItems'

// ---------------------------------------------------------------------------
// Supabase fake — narrow shape, only the chains mealPlanItems.js exercises.
//
//   meal_plans (active-period lookup):
//     .select('id').eq('user_id', ...).lte('period_start', ...)
//       .gte('period_end', ...).is('finalized_at', null)
//       .order(...).limit(1).maybeSingle()
//
//   meal_plan_items (active-period items):
//     .select(joinedCols).eq('user_id', ...).eq('meal_plan_id', ...) → thenable
//
//   meal_plan_items (delete):
//     .delete({ count: 'exact' }).in('id', ids) → thenable
//
// Each .from() pushes a call record so tests can assert filter state.
// ---------------------------------------------------------------------------
function makeSupabase(responses = {}) {
  const client = {
    calls: [],
    from(table) {
      const state = {
        table,
        op: null,
        opOpts: null,
        selectCols: null,
        eqs: {},
        ltes: {},
        gtes: {},
        ises: {},
        inFilter: null,
        orderArgs: null,
        limitN: null,
      }
      client.calls.push(state)

      const chain = {
        select(cols) {
          if (!state.op) state.op = 'select'
          state.selectCols = cols
          return chain
        },
        delete(opts) {
          state.op = 'delete'
          state.opOpts = opts
          return chain
        },
        eq(col, val) {
          state.eqs[col] = val
          return chain
        },
        lte(col, val) {
          state.ltes[col] = val
          return chain
        },
        gte(col, val) {
          state.gtes[col] = val
          return chain
        },
        is(col, val) {
          state.ises[col] = val
          return chain
        },
        in(col, vals) {
          state.inFilter = { col, vals }
          const key = `${state.table}.${state.op}`
          const r = responses[key] ?? { data: null, error: null, count: null }
          return Promise.resolve(r)
        },
        order(col, opts) {
          state.orderArgs = [col, opts]
          return chain
        },
        limit(n) {
          state.limitN = n
          return chain
        },
        maybeSingle() {
          const key = `${state.table}.${state.op}.maybeSingle`
          const r = responses[key] ?? { data: null, error: null }
          return Promise.resolve(r)
        },
        then(onFulfilled, onRejected) {
          const key = `${state.table}.${state.op}`
          const r = responses[key] ?? { data: null, error: null, count: null }
          return Promise.resolve(r).then(onFulfilled, onRejected)
        },
      }
      return chain
    },
  }
  return client
}

const USER = '00000000-0000-4000-8000-000000000001'

// ---------------------------------------------------------------------------
// getActivePeriodItems
// ---------------------------------------------------------------------------

describe('getActivePeriodItems', () => {
  it('returns [] when there is no active period', async () => {
    const supabase = makeSupabase({
      'meal_plans.select.maybeSingle': { data: null, error: null },
    })

    const result = await getActivePeriodItems(USER, supabase)

    expect(result).toEqual([])
    // Items query should not have been issued.
    expect(supabase.calls).toHaveLength(1)
    expect(supabase.calls[0].table).toBe('meal_plans')
    expect(supabase.calls[0].eqs).toMatchObject({ user_id: USER })
    expect(supabase.calls[0].ises).toMatchObject({ finalized_at: null })
  })

  it('returns both scheduled and shortlisted items for the active period, with vault data flattened', async () => {
    const itemsResult = [
      {
        id: 'mpi-scheduled',
        scheduled_date: '2026-04-27',
        is_shortlisted: false,
        name: 'Chicken Tacos',
        vault_id: 'v1',
        vault: {
          cuisine_type: 'Mexican',
          prep_time_minutes: 30,
          proteins: ['Chicken'],
          vegetables: ['Tomato'],
          fruits: null,
          dairy_components: null,
          main_carb: 'Tortilla/Wrap',
          dietary_tags: null,
        },
      },
      {
        id: 'mpi-shortlisted',
        scheduled_date: null,
        is_shortlisted: true,
        name: 'Tofu Stir-fry',
        vault_id: 'v2',
        vault: {
          cuisine_type: 'Chinese',
          prep_time_minutes: 25,
          proteins: ['Tofu'],
          vegetables: ['Bell Peppers'],
          fruits: null,
          dairy_components: null,
          main_carb: 'Rice',
          dietary_tags: ['Vegetarian'],
        },
      },
    ]
    const supabase = makeSupabase({
      'meal_plans.select.maybeSingle': { data: { id: 'plan-1' }, error: null },
      'meal_plan_items.select': { data: itemsResult, error: null },
    })

    const result = await getActivePeriodItems(USER, supabase)

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      id: 'mpi-scheduled',
      scheduled_date: '2026-04-27',
      is_shortlisted: false,
      name: 'Chicken Tacos',
      cuisine_type: 'Mexican',
      prep_time_minutes: 30,
      proteins: ['Chicken'],
    })
    expect(result[1]).toMatchObject({
      id: 'mpi-shortlisted',
      scheduled_date: null,
      is_shortlisted: true,
      name: 'Tofu Stir-fry',
      cuisine_type: 'Chinese',
      prep_time_minutes: 25,
      proteins: ['Tofu'],
    })

    // Items query was scoped to the active plan + caller user.
    const itemsCall = supabase.calls.find(c => c.table === 'meal_plan_items')
    expect(itemsCall).toBeDefined()
    expect(itemsCall.eqs).toMatchObject({ user_id: USER, meal_plan_id: 'plan-1' })
  })

  it('handles the array-shaped vault join defensively', async () => {
    // Some PostgREST versions surface FK joins as a single-element array.
    const itemsResult = [
      {
        id: 'mpi-1',
        scheduled_date: '2026-04-27',
        is_shortlisted: false,
        name: 'Pizza',
        vault_id: 'v1',
        vault: [{
          cuisine_type: 'Italian',
          prep_time_minutes: 45,
          proteins: ['Cheese'],
        }],
      },
    ]
    const supabase = makeSupabase({
      'meal_plans.select.maybeSingle': { data: { id: 'plan-1' }, error: null },
      'meal_plan_items.select': { data: itemsResult, error: null },
    })

    const result = await getActivePeriodItems(USER, supabase)
    expect(result[0].cuisine_type).toBe('Italian')
    expect(result[0].prep_time_minutes).toBe(45)
  })

  it('passes wildcards / vault-less items through with null joined fields', async () => {
    const itemsResult = [
      {
        id: 'mpi-wildcard',
        scheduled_date: '2026-04-27',
        is_shortlisted: false,
        name: 'AI Suggestion',
        vault_id: null,
        vault: null,
      },
    ]
    const supabase = makeSupabase({
      'meal_plans.select.maybeSingle': { data: { id: 'plan-1' }, error: null },
      'meal_plan_items.select': { data: itemsResult, error: null },
    })

    const result = await getActivePeriodItems(USER, supabase)
    expect(result[0]).toMatchObject({
      id: 'mpi-wildcard',
      vault_id: null,
      cuisine_type: null,
      prep_time_minutes: null,
      proteins: null,
    })
  })

  it('propagates errors from the meal_plans lookup', async () => {
    const supabase = makeSupabase({
      'meal_plans.select.maybeSingle': {
        data: null,
        error: { code: '42501', message: 'permission denied' },
      },
    })

    await expect(getActivePeriodItems(USER, supabase)).rejects.toMatchObject({
      code: '42501',
    })
  })
})

// ---------------------------------------------------------------------------
// deleteMealPlanItems
// ---------------------------------------------------------------------------

describe('deleteMealPlanItems', () => {
  it('returns 0 without issuing a DB call when the id list is empty', async () => {
    const supabase = makeSupabase()

    const count = await deleteMealPlanItems([], supabase)

    expect(count).toBe(0)
    expect(supabase.calls).toHaveLength(0)
  })

  it('issues a DELETE on meal_plan_items.in("id", ids) and returns the count', async () => {
    const ids = ['mpi-1', 'mpi-2', 'mpi-3']
    const supabase = makeSupabase({
      'meal_plan_items.delete': { data: null, error: null, count: 3 },
    })

    const count = await deleteMealPlanItems(ids, supabase)

    expect(count).toBe(3)
    expect(supabase.calls).toHaveLength(1)
    const call = supabase.calls[0]
    expect(call.table).toBe('meal_plan_items')
    expect(call.op).toBe('delete')
    expect(call.opOpts).toEqual({ count: 'exact' })
    expect(call.inFilter).toEqual({ col: 'id', vals: ids })
  })

  it('falls back to 0 when Supabase omits the count field', async () => {
    const supabase = makeSupabase({
      'meal_plan_items.delete': { data: null, error: null, count: null },
    })

    const count = await deleteMealPlanItems(['mpi-1'], supabase)
    expect(count).toBe(0)
  })

  it('propagates Supabase errors', async () => {
    const supabase = makeSupabase({
      'meal_plan_items.delete': {
        data: null,
        error: { code: '42501', message: 'permission denied' },
        count: null,
      },
    })

    await expect(
      deleteMealPlanItems(['mpi-1'], supabase),
    ).rejects.toMatchObject({ code: '42501' })
  })
})
