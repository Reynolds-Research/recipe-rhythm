import { describe, it, expect } from 'vitest'
import {
  getPreferences,
  upsertPreferences,
  InvalidPreferenceError,
} from '../preferences'

// ---------------------------------------------------------------------------
// Supabase fake — narrow shape, only the chains preferences.js exercises.
//
//   .from('household_preferences').select('*').eq('user_id', id).single()
//   .from('household_preferences').upsert(row, opts).select().single()
//
// Each chain resolves to whatever was preconfigured for its `op` key.
// ---------------------------------------------------------------------------
function makeSupabase(responses = {}) {
  const client = {
    calls: [],
    from(table) {
      const state = {
        table,
        op: null,
        payload: null,
        upsertOpts: null,
        filter: {},
      }
      client.calls.push(state)
      const chain = {
        select() {
          if (!state.op) state.op = 'select'
          return chain
        },
        eq(col, val) {
          state.filter[col] = val
          return chain
        },
        upsert(payload, opts) {
          state.op = 'upsert'
          state.payload = payload
          state.upsertOpts = opts
          return chain
        },
        single() {
          const key = `${state.table}.${state.op}`
          const r = responses[key] ?? { data: null, error: null }
          return Promise.resolve(r)
        },
      }
      return chain
    },
  }
  return client
}

const USER = '00000000-0000-4000-8000-000000000001'

const SAMPLE_ROW = {
  user_id: USER,
  dietary_restrictions: ['vegetarian'],
  excluded_ingredients: ['cilantro'],
  excluded_cuisines: ['Indian'],
  max_prep_time_minutes: 45,
  adults: 2,
  children: 0,
  created_at: '2026-04-27T10:00:00Z',
  updated_at: '2026-04-27T10:00:00Z',
}

// ---------------------------------------------------------------------------
// getPreferences
// ---------------------------------------------------------------------------

describe('getPreferences', () => {
  it('returns the row as-is when one exists', async () => {
    const supabase = makeSupabase({
      'household_preferences.select': { data: SAMPLE_ROW, error: null },
    })

    const prefs = await getPreferences(USER, supabase)

    expect(prefs).toEqual(SAMPLE_ROW)
    const call = supabase.calls[0]
    expect(call.table).toBe('household_preferences')
    expect(call.filter).toEqual({ user_id: USER })
  })

  it('returns the defaults object when no row exists (PGRST116)', async () => {
    const supabase = makeSupabase({
      'household_preferences.select': {
        data: null,
        error: { code: 'PGRST116', message: 'no rows' },
      },
    })

    const prefs = await getPreferences(USER, supabase)

    expect(prefs).toEqual({
      user_id: USER,
      dietary_restrictions: [],
      excluded_ingredients: [],
      excluded_cuisines: [],
      max_prep_time_minutes: null,
      adults: 2,
      children: 0,
      pantry_staples: [],
    })
  })

  it('defaults() includes pantry_staples: []', async () => {
    const supabase = makeSupabase({
      'household_preferences.select': {
        data: null,
        error: { code: 'PGRST116', message: 'no rows' },
      },
    })

    const prefs = await getPreferences(USER, supabase)

    expect(prefs).toHaveProperty('pantry_staples', [])
  })

  it('propagates non-PGRST116 errors', async () => {
    const supabase = makeSupabase({
      'household_preferences.select': {
        data: null,
        error: { code: '42501', message: 'permission denied' },
      },
    })

    await expect(getPreferences(USER, supabase)).rejects.toMatchObject({
      code: '42501',
      message: 'permission denied',
    })
  })

  it('returns NULL max_prep_time as null without applying any default', async () => {
    // Read path is dumb storage — fallback to DEFAULT_MAX_PREP_TIME_MINUTES
    // is the recommender's job (P0.5), not this helper's.
    const row = { ...SAMPLE_ROW, max_prep_time_minutes: null }
    const supabase = makeSupabase({
      'household_preferences.select': { data: row, error: null },
    })

    const prefs = await getPreferences(USER, supabase)
    expect(prefs.max_prep_time_minutes).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// upsertPreferences
// ---------------------------------------------------------------------------

describe('upsertPreferences', () => {
  it('upserts a valid patch with user_id merged in and returns the row', async () => {
    const expectedRow = { ...SAMPLE_ROW, max_prep_time_minutes: 30 }
    const supabase = makeSupabase({
      'household_preferences.upsert': { data: expectedRow, error: null },
    })

    const result = await upsertPreferences(
      USER,
      {
        dietary_restrictions: ['vegetarian'],
        excluded_cuisines: ['Indian'],
        max_prep_time_minutes: 30,
      },
      supabase,
    )

    expect(result).toEqual(expectedRow)
    const call = supabase.calls[0]
    expect(call.table).toBe('household_preferences')
    expect(call.op).toBe('upsert')
    expect(call.payload).toMatchObject({
      user_id: USER,
      dietary_restrictions: ['vegetarian'],
      excluded_cuisines: ['Indian'],
      max_prep_time_minutes: 30,
    })
    expect(call.upsertOpts).toEqual({ onConflict: 'user_id' })
  })

  it('throws InvalidPreferenceError for an unknown dietary_restriction id (no DB call)', async () => {
    const supabase = makeSupabase()

    await expect(
      upsertPreferences(USER, { dietary_restrictions: ['pescetarian'] }, supabase),
    ).rejects.toBeInstanceOf(InvalidPreferenceError)

    // Re-run to inspect the thrown error's payload.
    let caught
    try {
      await upsertPreferences(USER, { dietary_restrictions: ['pescetarian'] }, supabase)
    } catch (err) {
      caught = err
    }
    expect(caught.field).toBe('dietary_restriction')
    expect(caught.invalidValue).toBe('pescetarian')
    expect(caught.message).toContain('pescetarian')

    // Validation runs before any Supabase call.
    expect(supabase.calls).toHaveLength(0)
  })

  it('throws InvalidPreferenceError for an unknown excluded_cuisine (no DB call)', async () => {
    const supabase = makeSupabase()

    let caught
    try {
      await upsertPreferences(USER, { excluded_cuisines: ['Klingon'] }, supabase)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(InvalidPreferenceError)
    expect(caught.field).toBe('excluded_cuisine')
    expect(caught.invalidValue).toBe('Klingon')
    expect(caught.message).toContain('Klingon')
    expect(supabase.calls).toHaveLength(0)
  })

  it('normalizes excluded_ingredients (trim + lowercase + dedupe)', async () => {
    const supabase = makeSupabase({
      'household_preferences.upsert': { data: SAMPLE_ROW, error: null },
    })

    await upsertPreferences(
      USER,
      { excluded_ingredients: [' Cilantro ', 'cilantro', 'OLIVES', '  olives'] },
      supabase,
    )

    expect(supabase.calls[0].payload.excluded_ingredients).toEqual([
      'cilantro',
      'olives',
    ])
  })

  it('normalizes pantry_staples (trim + lowercase + dedupe)', async () => {
    const supabase = makeSupabase({
      'household_preferences.upsert': { data: SAMPLE_ROW, error: null },
    })

    await upsertPreferences(
      USER,
      { pantry_staples: ['  Olive Oil  ', 'olive oil', 'SALT', ''] },
      supabase,
    )

    expect(supabase.calls[0].payload.pantry_staples).toEqual(['olive oil', 'salt'])
  })

  it('does not touch pantry_staples when the patch omits it', async () => {
    const supabase = makeSupabase({
      'household_preferences.upsert': { data: { ...SAMPLE_ROW, adults: 3 }, error: null },
    })

    await upsertPreferences(USER, { adults: 3 }, supabase)

    expect(supabase.calls[0].payload).not.toHaveProperty('pantry_staples')
  })

  it('propagates Supabase errors from the upsert', async () => {
    const supabase = makeSupabase({
      'household_preferences.upsert': {
        data: null,
        error: { code: '23514', message: 'check_violation' },
      },
    })

    await expect(
      upsertPreferences(USER, { max_prep_time_minutes: 30 }, supabase),
    ).rejects.toMatchObject({
      code: '23514',
      message: 'check_violation',
    })
  })

  it('accepts valid adults value and upserts it', async () => {
    const supabase = makeSupabase({
      'household_preferences.upsert': { data: { ...SAMPLE_ROW, adults: 3 }, error: null },
    })
    const result = await upsertPreferences(USER, { adults: 3 }, supabase)
    expect(result.adults).toBe(3)
    expect(supabase.calls[0].payload.adults).toBe(3)
  })

  it('throws InvalidPreferenceError for adults < 1 (0, negative)', async () => {
    const supabase = makeSupabase()
    for (const bad of [0, -1, -10]) {
      await expect(
        upsertPreferences(USER, { adults: bad }, supabase),
      ).rejects.toBeInstanceOf(InvalidPreferenceError)
    }
    expect(supabase.calls).toHaveLength(0)
  })

  it('throws InvalidPreferenceError for non-integer adults', async () => {
    const supabase = makeSupabase()
    await expect(
      upsertPreferences(USER, { adults: 1.5 }, supabase),
    ).rejects.toBeInstanceOf(InvalidPreferenceError)
    expect(supabase.calls).toHaveLength(0)
  })

  it('accepts valid children value (including 0) and upserts it', async () => {
    const supabase = makeSupabase({
      'household_preferences.upsert': { data: { ...SAMPLE_ROW, children: 2 }, error: null },
    })
    const result = await upsertPreferences(USER, { children: 2 }, supabase)
    expect(result.children).toBe(2)
    expect(supabase.calls[0].payload.children).toBe(2)
  })

  it('throws InvalidPreferenceError for children < 0', async () => {
    const supabase = makeSupabase()
    await expect(
      upsertPreferences(USER, { children: -1 }, supabase),
    ).rejects.toBeInstanceOf(InvalidPreferenceError)
    expect(supabase.calls).toHaveLength(0)
  })
})
