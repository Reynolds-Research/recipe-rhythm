import { describe, it, expect } from 'vitest'
import {
  addShortlistItem,
  scheduleShortlistItem,
  moveItemToShortlist,
  deleteMealPlanItem,
} from '../mealPlanWriter'

// PRD-002 P0.6 — meal_plan_items shortlist helpers.
//
// These exercise the wire-level write shape for each of the four shortlist
// operations. The biconditional CHECK constraint
// `meal_plan_items_scheduled_xor_shortlisted` is enforced server-side by
// Postgres; here we use a handwritten supabase fake to (a) confirm the
// helpers produce the right shape on the wire and (b) simulate a CHECK
// violation response and confirm the helper propagates it as a typed error.

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
        select(cols) {
          state.selectCols = cols
          return chain
        },
        single() {
          const key = `${state.table}.${state.op}.single`
          const r = responses[key] ?? { data: { id: 'item-new' }, error: null }
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

const VAULT_UUID = '11111111-1111-4111-8111-111111111111'

describe('addShortlistItem', () => {
  it('inserts a row with scheduled_date=null and is_shortlisted=true', async () => {
    const supabase = makeSupabase({
      'meal_plan_items.insert.single': {
        data: { id: 'item-1' },
        error: null,
      },
    })

    const result = await addShortlistItem(supabase, 'user-1', 'plan-1', {
      name: 'Chicken Tagine',
      id: VAULT_UUID,
      is_wildcard: false,
      source_url: null,
    })

    expect(result).toEqual({ id: 'item-1' })
    expect(supabase.calls).toHaveLength(1)
    const [call] = supabase.calls
    expect(call.table).toBe('meal_plan_items')
    expect(call.op).toBe('insert')
    expect(call.payload).toEqual({
      user_id: 'user-1',
      meal_plan_id: 'plan-1',
      scheduled_date: null,
      is_shortlisted: true,
      position: 0,
      vault_id: VAULT_UUID,
      name: 'Chicken Tagine',
      is_wildcard: false,
      source_url: null,
    })
  })

  it('strips synthetic (non-UUID) ids from vault_id but preserves the name', async () => {
    const supabase = makeSupabase()
    await addShortlistItem(supabase, 'user-1', 'plan-1', {
      name: 'AI Wildcard',
      id: 'ai-suggestion-3',
      is_wildcard: true,
    })
    const [call] = supabase.calls
    expect(call.payload.vault_id).toBeNull()
    expect(call.payload.name).toBe('AI Wildcard')
    expect(call.payload.is_shortlisted).toBe(true)
    expect(call.payload.scheduled_date).toBeNull()
  })

  it('wraps the CHECK violation response from Postgres as code=shortlist_insert_failed', async () => {
    // Simulate the server rejecting an invalid shape (e.g. an attempted
    // insert with both scheduled_date AND is_shortlisted=true). The helper
    // never produces this shape itself — but if a future caller tried, the
    // DB would reject with 23514, and we forward that as a typed error.
    const pgError = {
      code: '23514',
      message:
        'new row for relation "meal_plan_items" violates check constraint "meal_plan_items_scheduled_xor_shortlisted"',
    }
    const supabase = makeSupabase({
      'meal_plan_items.insert.single': { data: null, error: pgError },
    })
    let thrown
    try {
      await addShortlistItem(supabase, 'user-1', 'plan-1', { name: 'X' })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeDefined()
    expect(thrown.code).toBe('shortlist_insert_failed')
    expect(thrown.cause).toBe(pgError)
  })
})

describe('scheduleShortlistItem', () => {
  it('UPDATEs scheduled_date and clears is_shortlisted in a single statement', async () => {
    const supabase = makeSupabase({
      'meal_plan_items.update': { data: null, error: null },
    })

    await scheduleShortlistItem(supabase, 'item-1', '2026-04-22')

    expect(supabase.calls).toHaveLength(1)
    const [call] = supabase.calls
    expect(call.table).toBe('meal_plan_items')
    expect(call.op).toBe('update')
    expect(call.payload).toEqual({
      scheduled_date: '2026-04-22',
      is_shortlisted: false,
    })
    expect(call.filter).toEqual({ id: 'item-1' })
  })

  it('wraps DB errors as code=schedule_failed', async () => {
    const supabase = makeSupabase({
      'meal_plan_items.update': {
        data: null,
        error: { code: '42501', message: 'permission denied' },
      },
    })
    await expect(
      scheduleShortlistItem(supabase, 'item-1', '2026-04-22'),
    ).rejects.toMatchObject({ code: 'schedule_failed' })
  })
})

describe('moveItemToShortlist', () => {
  it('UPDATEs scheduled_date=null and is_shortlisted=true', async () => {
    const supabase = makeSupabase({
      'meal_plan_items.update': { data: null, error: null },
    })

    await moveItemToShortlist(supabase, 'item-1')

    const [call] = supabase.calls
    expect(call.op).toBe('update')
    expect(call.payload).toEqual({
      scheduled_date: null,
      is_shortlisted: true,
    })
    expect(call.filter).toEqual({ id: 'item-1' })
  })

  it('wraps DB errors as code=shortlist_move_failed', async () => {
    const supabase = makeSupabase({
      'meal_plan_items.update': {
        data: null,
        error: { code: '23514', message: 'check violation' },
      },
    })
    await expect(moveItemToShortlist(supabase, 'item-1')).rejects.toMatchObject(
      { code: 'shortlist_move_failed' },
    )
  })
})

describe('deleteMealPlanItem', () => {
  it('DELETEs by id', async () => {
    const supabase = makeSupabase({
      'meal_plan_items.delete': { data: null, error: null },
    })

    await deleteMealPlanItem(supabase, 'item-1')

    const [call] = supabase.calls
    expect(call.op).toBe('delete')
    expect(call.filter).toEqual({ id: 'item-1' })
  })

  it('wraps DB errors as code=item_delete_failed', async () => {
    const supabase = makeSupabase({
      'meal_plan_items.delete': {
        data: null,
        error: { code: '42501', message: 'permission denied' },
      },
    })
    await expect(deleteMealPlanItem(supabase, 'item-1')).rejects.toMatchObject({
      code: 'item_delete_failed',
    })
  })
})
