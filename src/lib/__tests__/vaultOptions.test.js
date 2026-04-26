import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchVaultOptions,
  addVaultOption,
  removeVaultOption,
  migrateLocalStorageExtras,
  VAULT_OPTION_CATEGORIES,
} from '../vaultOptions'

// ---------------------------------------------------------------------------
// Supabase fake — narrow shape, only the chains vaultOptions exercises.
//
//   .from('vault_options').select(cols).eq(col, val)            → thenable
//   .from('vault_options').upsert(row, opts)                    → thenable
//   .from('vault_options').delete().match(criteria)             → thenable
//
// Each .from() call records to client.calls so tests can assert payload
// shape / chain ordering. Per-operation responses are configured via the
// `responses` arg (default: success, empty data).
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
        selectCols: null,
        filter: {},
        match: null,
      }
      client.calls.push(state)
      const chain = {
        select(cols) {
          state.op = 'select'
          state.selectCols = cols
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
        delete() {
          state.op = 'delete'
          return chain
        },
        match(criteria) {
          state.match = criteria
          return chain
        },
        then(onFulfilled, onRejected) {
          const key = `${state.table}.${state.op}`
          const r = responses[key] ?? { data: [], error: null }
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
// VAULT_OPTION_CATEGORIES — sanity check the canonical list
// ---------------------------------------------------------------------------

describe('VAULT_OPTION_CATEGORIES', () => {
  it('exports the nine canonical categories that match the migration CHECK', () => {
    expect(VAULT_OPTION_CATEGORIES).toEqual([
      'cuisine_type',
      'flavor_profile',
      'proteins',
      'cooking_method',
      'main_carb',
      'dietary_tags',
      'dairy_components',
      'vegetables',
      'fruits',
    ])
  })
})

// ---------------------------------------------------------------------------
// fetchVaultOptions
// ---------------------------------------------------------------------------

describe('fetchVaultOptions', () => {
  it('groups rows by category', async () => {
    const supabase = makeSupabase({
      'vault_options.select': {
        data: [
          { category: 'proteins', value: 'Octopus' },
          { category: 'proteins', value: 'Squid' },
          { category: 'cuisine_type', value: 'Filipino' },
        ],
        error: null,
      },
    })
    const grouped = await fetchVaultOptions(supabase, USER)
    expect(grouped).toEqual({
      proteins: ['Octopus', 'Squid'],
      cuisine_type: ['Filipino'],
    })
    expect(supabase.calls[0].table).toBe('vault_options')
    expect(supabase.calls[0].selectCols).toBe('category, value')
    expect(supabase.calls[0].filter).toEqual({ user_id: USER })
  })

  it('returns {} when the result set is empty', async () => {
    const supabase = makeSupabase({
      'vault_options.select': { data: [], error: null },
    })
    const grouped = await fetchVaultOptions(supabase, USER)
    expect(grouped).toEqual({})
  })

  it('returns {} (no throw) when Supabase reports an error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = makeSupabase({
      'vault_options.select': { data: null, error: { message: 'boom' } },
    })
    const grouped = await fetchVaultOptions(supabase, USER)
    expect(grouped).toEqual({})
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('returns {} immediately if userId is missing', async () => {
    const supabase = makeSupabase()
    const grouped = await fetchVaultOptions(supabase, null)
    expect(grouped).toEqual({})
    // Should short-circuit without any Supabase call.
    expect(supabase.calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// addVaultOption
// ---------------------------------------------------------------------------

describe('addVaultOption', () => {
  it('upserts (user_id, category, value) with the composite-PK onConflict key', async () => {
    const supabase = makeSupabase({
      'vault_options.upsert': { data: null, error: null },
    })
    const { error } = await addVaultOption(supabase, USER, 'cuisine_type', 'Filipino')
    expect(error).toBeNull()
    const call = supabase.calls[0]
    expect(call.table).toBe('vault_options')
    expect(call.op).toBe('upsert')
    expect(call.payload).toEqual({
      user_id: USER, category: 'cuisine_type', value: 'Filipino',
    })
    expect(call.upsertOpts).toEqual({ onConflict: 'user_id,category,value' })
  })

  it('trims whitespace on value before upserting', async () => {
    const supabase = makeSupabase({
      'vault_options.upsert': { data: null, error: null },
    })
    await addVaultOption(supabase, USER, 'proteins', '  Octopus  ')
    expect(supabase.calls[0].payload.value).toBe('Octopus')
  })

  it('rejects empty/whitespace-only values without hitting Supabase', async () => {
    const supabase = makeSupabase()
    expect((await addVaultOption(supabase, USER, 'proteins', '')).error).toBe('empty')
    expect((await addVaultOption(supabase, USER, 'proteins', '   ')).error).toBe('empty')
    expect((await addVaultOption(supabase, USER, 'proteins', null)).error).toBe('empty')
    expect(supabase.calls).toHaveLength(0)
  })

  it('rejects when userId is missing', async () => {
    const supabase = makeSupabase()
    const { error } = await addVaultOption(supabase, null, 'proteins', 'Octopus')
    expect(error).toBe('no-user')
    expect(supabase.calls).toHaveLength(0)
  })

  it('returns { error: <message> } when Supabase rejects the upsert', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = makeSupabase({
      'vault_options.upsert': { data: null, error: { message: 'rls violation' } },
    })
    const { error } = await addVaultOption(supabase, USER, 'proteins', 'Octopus')
    expect(error).toBe('rls violation')
    errSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// removeVaultOption
// ---------------------------------------------------------------------------

describe('removeVaultOption', () => {
  it('calls .match() with the (user_id, category, value) triple', async () => {
    const supabase = makeSupabase({
      'vault_options.delete': { data: null, error: null },
    })
    const { error } = await removeVaultOption(supabase, USER, 'proteins', 'Octopus')
    expect(error).toBeNull()
    const call = supabase.calls[0]
    expect(call.op).toBe('delete')
    expect(call.match).toEqual({ user_id: USER, category: 'proteins', value: 'Octopus' })
  })
})

// ---------------------------------------------------------------------------
// migrateLocalStorageExtras
// ---------------------------------------------------------------------------

describe('migrateLocalStorageExtras', () => {
  // Minimal localStorage stub that records gets/removes and serves what we set.
  function setupLocalStorage(initial = {}) {
    const store = { ...initial }
    const ls = {
      getItem: vi.fn((k) => (k in store ? store[k] : null)),
      setItem: vi.fn((k, v) => { store[k] = v }),
      removeItem: vi.fn((k) => { delete store[k] }),
      _store: store,
    }
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: ls,
    })
    return ls
  }

  beforeEach(() => {
    setupLocalStorage()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads every vault_extra_<key>, calls addVaultOption for each value, then clears the keys', async () => {
    const ls = setupLocalStorage({
      vault_extra_cuisine_type: JSON.stringify(['Filipino']),
      vault_extra_proteins: JSON.stringify(['Octopus', 'Squid']),
    })
    const supabase = makeSupabase({
      'vault_options.upsert': { data: null, error: null },
    })

    const result = await migrateLocalStorageExtras(supabase, USER)

    expect(result.migrated).toBe(3)
    // Three upserts on vault_options.
    const upserts = supabase.calls.filter(c => c.op === 'upsert')
    expect(upserts).toHaveLength(3)
    expect(upserts.map(c => [c.payload.category, c.payload.value])).toEqual([
      ['cuisine_type', 'Filipino'],
      ['proteins',     'Octopus'],
      ['proteins',     'Squid'],
    ])
    // Both keys are cleared after migration.
    expect(ls.removeItem).toHaveBeenCalledWith('vault_extra_cuisine_type')
    expect(ls.removeItem).toHaveBeenCalledWith('vault_extra_proteins')
  })

  // PRD-001 P0.7 dairy rename: legacy storageKey "dairy" maps to canonical
  // category "dairy_components". Keep this test name explicit so it doesn't
  // get accidentally deleted during a refactor.
  it('PRD-001 P0.7: maps vault_extra_dairy → category dairy_components (the rename)', async () => {
    setupLocalStorage({
      vault_extra_dairy: JSON.stringify(['Brie', 'Halloumi']),
    })
    const supabase = makeSupabase({
      'vault_options.upsert': { data: null, error: null },
    })

    await migrateLocalStorageExtras(supabase, USER)

    const upserts = supabase.calls.filter(c => c.op === 'upsert')
    expect(upserts).toHaveLength(2)
    expect(upserts.every(c => c.payload.category === 'dairy_components')).toBe(true)
    expect(upserts.map(c => c.payload.value)).toEqual(['Brie', 'Halloumi'])
  })

  it('is idempotent — second call does nothing because the keys are cleared', async () => {
    setupLocalStorage({
      vault_extra_cuisine_type: JSON.stringify(['Filipino']),
    })
    const supabase = makeSupabase({
      'vault_options.upsert': { data: null, error: null },
    })

    const first = await migrateLocalStorageExtras(supabase, USER)
    expect(first.migrated).toBe(1)

    const second = await migrateLocalStorageExtras(supabase, USER)
    expect(second.migrated).toBe(0)
    // Total upserts across both runs is still 1.
    expect(supabase.calls.filter(c => c.op === 'upsert')).toHaveLength(1)
  })

  it('tolerates malformed JSON — logs and continues to the next category', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ls = setupLocalStorage({
      vault_extra_proteins: '{this is not json',
      vault_extra_cuisine_type: JSON.stringify(['Filipino']),
    })
    const supabase = makeSupabase({
      'vault_options.upsert': { data: null, error: null },
    })

    const result = await migrateLocalStorageExtras(supabase, USER)

    // Only the well-formed key contributes a migrated value.
    expect(result.migrated).toBe(1)
    expect(warnSpy).toHaveBeenCalled()
    // Both keys are cleared even though one was malformed (so the warning
    // doesn't replay on every Vault mount).
    expect(ls.removeItem).toHaveBeenCalledWith('vault_extra_proteins')
    expect(ls.removeItem).toHaveBeenCalledWith('vault_extra_cuisine_type')
  })

  it('returns { migrated: 0 } when userId is missing', async () => {
    setupLocalStorage({
      vault_extra_proteins: JSON.stringify(['Octopus']),
    })
    const supabase = makeSupabase()
    const result = await migrateLocalStorageExtras(supabase, null)
    expect(result.migrated).toBe(0)
    expect(supabase.calls).toHaveLength(0)
  })
})
