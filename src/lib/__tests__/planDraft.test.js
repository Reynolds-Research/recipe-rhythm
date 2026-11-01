import { describe, it, expect } from 'vitest'
import {
  fetchPlanDraft,
  savePlanDraft,
  clearPlanDraft,
  pickNewerDraft,
  isValidDraftPlan,
} from '../planDraft'

// ---------------------------------------------------------------------------
// Supabase fake — narrow shape, only the chains planDraft.js exercises:
//
//   .from('plan_drafts').select(cols).eq('user_id', id).maybeSingle()
//   .from('plan_drafts').upsert(row, opts)            (awaited directly)
//   .from('plan_drafts').delete().eq('user_id', id)   (awaited directly)
//
// Each chain resolves to whatever was preconfigured for its op key.
// ---------------------------------------------------------------------------
function makeSupabase(responses = {}) {
  const client = {
    calls: [],
    from(table) {
      const state = { table, op: null, payload: null, opts: null, filter: {} }
      client.calls.push(state)
      const result = () =>
        Promise.resolve(responses[`${table}.${state.op}`] ?? { data: null, error: null })
      const chain = {
        select() { state.op = 'select'; return chain },
        eq(col, val) { state.filter[col] = val; return chain },
        maybeSingle: result,
        upsert(payload, opts) {
          state.op = 'upsert'
          state.payload = payload
          state.opts = opts
          return result()
        },
        delete() { state.op = 'delete'; return chain },
        then(resolve, reject) { return result().then(resolve, reject) },
      }
      return chain
    },
  }
  return client
}

const USER = '00000000-0000-4000-8000-000000000001'
const PLAN = [
  { scheduled_date: '2026-11-02', name: 'Tacos', id: 'v1', is_wildcard: false },
  { scheduled_date: '2026-11-03', name: 'Ramen', id: 'v2', is_wildcard: false },
]

describe('isValidDraftPlan', () => {
  it('accepts an array of slots that all have a scheduled_date', () => {
    expect(isValidDraftPlan(PLAN)).toBe(true)
    expect(isValidDraftPlan([])).toBe(true)
  })

  it('rejects legacy or malformed shapes', () => {
    expect(isValidDraftPlan([{ day: 'Mon', name: 'Tacos' }])).toBe(false)
    expect(isValidDraftPlan(null)).toBe(false)
    expect(isValidDraftPlan({})).toBe(false)
  })
})

describe('fetchPlanDraft', () => {
  it('returns the draft with sorted dates when a row exists', async () => {
    const supabase = makeSupabase({
      'plan_drafts.select': {
        data: { plan: PLAN, selected_dates: ['2026-11-03', '2026-11-02'], updated_at: '2026-10-31T18:00:00Z' },
        error: null,
      },
    })

    const draft = await fetchPlanDraft(supabase, USER)

    expect(draft).toEqual({
      plan: PLAN,
      selectedDates: ['2026-11-02', '2026-11-03'],
      updatedAt: '2026-10-31T18:00:00Z',
    })
    expect(supabase.calls[0].filter).toEqual({ user_id: USER })
  })

  it('returns null when the user has no draft', async () => {
    const supabase = makeSupabase({ 'plan_drafts.select': { data: null, error: null } })
    expect(await fetchPlanDraft(supabase, USER)).toBeNull()
  })

  it('returns null instead of a malformed plan', async () => {
    const supabase = makeSupabase({
      'plan_drafts.select': {
        data: { plan: [{ day: 'Mon' }], selected_dates: [], updated_at: '2026-10-31T18:00:00Z' },
        error: null,
      },
    })
    expect(await fetchPlanDraft(supabase, USER)).toBeNull()
  })

  it('propagates database errors', async () => {
    const supabase = makeSupabase({
      'plan_drafts.select': { data: null, error: { code: '42501', message: 'permission denied' } },
    })
    await expect(fetchPlanDraft(supabase, USER)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('savePlanDraft', () => {
  it('upserts one row per user and returns the save time', async () => {
    const supabase = makeSupabase()
    const now = new Date('2026-10-31T18:30:00Z')

    const updatedAt = await savePlanDraft(
      supabase,
      USER,
      { plan: PLAN, selectedDates: ['2026-11-02', '2026-11-03'] },
      now,
    )

    expect(updatedAt).toBe('2026-10-31T18:30:00.000Z')
    const call = supabase.calls[0]
    expect(call.op).toBe('upsert')
    expect(call.payload).toEqual({
      user_id: USER,
      plan: PLAN,
      selected_dates: ['2026-11-02', '2026-11-03'],
      updated_at: '2026-10-31T18:30:00.000Z',
    })
    expect(call.opts).toEqual({ onConflict: 'user_id' })
  })

  it('throws when the save fails, so the UI can say "this device only"', async () => {
    const supabase = makeSupabase({
      'plan_drafts.upsert': { data: null, error: { code: '08006', message: 'network' } },
    })
    await expect(
      savePlanDraft(supabase, USER, { plan: PLAN, selectedDates: [] }),
    ).rejects.toMatchObject({ code: '08006' })
  })
})

describe('clearPlanDraft', () => {
  it('deletes only this user\'s row', async () => {
    const supabase = makeSupabase()
    await clearPlanDraft(supabase, USER)
    expect(supabase.calls[0]).toMatchObject({ op: 'delete', filter: { user_id: USER } })
  })
})

describe('pickNewerDraft', () => {
  const remote = { plan: PLAN, selectedDates: [], updatedAt: '2026-10-31T18:00:00Z' }

  it('keeps the local copy when the account has no draft', () => {
    expect(pickNewerDraft('2026-10-31T17:00:00Z', null)).toBe('local')
  })

  it('takes the account copy when it is newer than this device\'s last save', () => {
    expect(pickNewerDraft('2026-10-31T17:00:00Z', remote)).toBe('remote')
  })

  it('keeps the local copy when this device saved more recently', () => {
    expect(pickNewerDraft('2026-10-31T19:00:00Z', remote)).toBe('local')
  })

  it('takes the account copy when this device never recorded a save time', () => {
    expect(pickNewerDraft(null, remote)).toBe('remote')
  })
})
