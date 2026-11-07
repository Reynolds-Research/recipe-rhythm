import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useVault } from '../useVault'
import { supabase } from '../../../lib/supabase'

// Remove is a soft delete (sets deleted_at); Undo clears it again, scoped to
// her household. These pin the two writes the Cookbook's Remove / Undo use.

vi.mock('../../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))
vi.mock('../../../lib/household', () => ({ getHouseholdId: vi.fn(async () => 'hh-1') }))

// A chainable stand-in for supabase-js: every method returns the chain, and
// awaiting it gives `result`. Records each update() payload and eq() filter.
function chain(calls, result) {
  const c = {
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
  for (const m of ['select', 'is', 'not', 'order', 'limit', 'ilike', 'in', 'or', 'maybeSingle', 'single']) {
    c[m] = () => c
  }
  c.eq = (col, val) => { calls.eq.push([col, val]); return c }
  c.update = (payload) => { calls.update.push(payload); return c }
  return c
}

let calls
let writeResult
beforeEach(() => {
  calls = { update: [], eq: [] }
  writeResult = { data: null, error: null }
  supabase.from.mockImplementation(() => {
    // Reads (the page's fetch) get an empty list; writes get writeResult.
    const c = chain(calls, { data: [], error: null })
    const update = c.update
    c.update = (payload) => { update(payload); return chain(calls, writeResult) }
    return c
  })
})

async function loaded() {
  const hook = renderHook(() => useVault('user-1'))
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  return hook
}

describe('useVault — Remove and Undo', () => {
  it('deleteRecipe sets deleted_at on that recipe in her household', async () => {
    const { result } = await loaded()
    let out
    await act(async () => { out = await result.current.deleteRecipe('r1') })
    expect(out).toEqual({ ok: true })
    expect(calls.update.at(-1)).toEqual({ deleted_at: expect.any(String) })
    expect(calls.eq).toEqual(expect.arrayContaining([['id', 'r1'], ['household_id', 'hh-1']]))
  })

  it('restoreRecipe clears deleted_at on that recipe in her household', async () => {
    const { result } = await loaded()
    let out
    await act(async () => { out = await result.current.restoreRecipe('r1') })
    expect(out).toEqual({ ok: true })
    expect(calls.update.at(-1)).toEqual({ deleted_at: null })
    expect(calls.eq).toEqual(expect.arrayContaining([['id', 'r1'], ['household_id', 'hh-1']]))
  })

  it('both report a failed write instead of pretending it worked', async () => {
    const { result } = await loaded()
    writeResult = { data: null, error: { message: 'denied' } }
    let del, res
    await act(async () => {
      del = await result.current.deleteRecipe('r1')
      res = await result.current.restoreRecipe('r1')
    })
    expect(del.ok).toBe(false)
    expect(res.ok).toBe(false)
  })
})
