/**
 * Unit test for the per-row processor in
 * scripts/backfill-ingredients-classification.js. Drives the function with
 * a mocked Supabase client and a mocked classifier — no network calls,
 * no script main() invoked.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  normalizeVaultRowToIngredients,
  processRow,
} from '../../../scripts/backfill-ingredients-classification.js'

function makeSupabaseMock({ updateError = null } = {}) {
  const eq = vi.fn().mockResolvedValue({ data: null, error: updateError })
  const update = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ update })
  return { from, _spies: { from, update, eq } }
}

const silentLogger = { log: vi.fn(), error: vi.fn() }

describe('normalizeVaultRowToIngredients', () => {
  it('collects strings from the categorical fields and dedupes case-insensitively', () => {
    const row = {
      proteins: ['Beef', 'beef ', 'Cheese'],
      main_carb: 'Bread',
      vegetables: ['onion', 'Lettuce'],
      fruits: null,
      dairy_components: ['Cheese'],
    }
    expect(normalizeVaultRowToIngredients(row)).toEqual([
      'Beef', 'Cheese', 'Bread', 'onion', 'Lettuce',
    ])
  })

  it('returns [] when every field is empty / null', () => {
    expect(normalizeVaultRowToIngredients({})).toEqual([])
    expect(normalizeVaultRowToIngredients({
      proteins: [], main_carb: null, vegetables: null, fruits: [], dairy_components: [],
    })).toEqual([])
  })

  it('ignores non-string entries inside an array', () => {
    const row = { proteins: ['Beef', 42, null, '  '], main_carb: '' }
    expect(normalizeVaultRowToIngredients(row)).toEqual(['Beef'])
  })
})

describe('processRow', () => {
  it('classifies + persists the result on the happy path', async () => {
    const row = {
      id: 'r1',
      name: 'Cheeseburgers',
      cuisine_type: 'American',
      proteins: ['ground beef'],
      main_carb: 'Bread',
      vegetables: ['onion'],
      fruits: null,
      dairy_components: ['cheese'],
    }
    const classifications = [
      { name: 'ground beef', essentiality: 'essential', source: 'ai' },
      { name: 'bread',       essentiality: 'essential', source: 'ai' },
      { name: 'onion',       essentiality: 'omittable', source: 'ai' },
      { name: 'cheese',      essentiality: 'essential', source: 'ai' },
    ]
    const classifyImpl = vi.fn().mockResolvedValue({ classifications })
    const supabase = makeSupabaseMock()

    const result = await processRow({
      row, classifyImpl, anthropicClient: {}, supabase, logger: silentLogger,
    })

    expect(result).toEqual({ ok: true, count: 4 })
    expect(classifyImpl).toHaveBeenCalledWith(expect.objectContaining({
      ingredients: ['ground beef', 'Bread', 'onion', 'cheese'],
      recipeName: 'Cheeseburgers',
      cuisine: 'American',
    }))
    expect(supabase._spies.from).toHaveBeenCalledWith('vault')
    expect(supabase._spies.update).toHaveBeenCalledWith({ ingredients_classified: classifications })
    expect(supabase._spies.eq).toHaveBeenCalledWith('id', 'r1')
  })

  it('writes [] (and skips the classifier) when the row has no ingredient signal', async () => {
    const row = {
      id: 'r2', name: 'Mystery', cuisine_type: null,
      proteins: null, main_carb: null, vegetables: null, fruits: null, dairy_components: null,
    }
    const classifyImpl = vi.fn()
    const supabase = makeSupabaseMock()

    const result = await processRow({
      row, classifyImpl, anthropicClient: {}, supabase, logger: silentLogger,
    })

    expect(result).toEqual({ ok: true, count: 0 })
    expect(classifyImpl).not.toHaveBeenCalled()
    expect(supabase._spies.update).toHaveBeenCalledWith({ ingredients_classified: [] })
  })

  it('returns ok=false with reason "classify" when the classifier throws (no DB write)', async () => {
    const row = { id: 'r3', name: 'X', cuisine_type: null, proteins: ['salt'] }
    const err = Object.assign(new Error('upstream'), { status: 503 })
    const classifyImpl = vi.fn().mockRejectedValue(err)
    const supabase = makeSupabaseMock()

    const result = await processRow({
      row, classifyImpl, anthropicClient: {}, supabase, logger: silentLogger,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('classify')
    expect(result.status).toBe(503)
    expect(supabase._spies.update).not.toHaveBeenCalled()
  })

  it('returns ok=false with reason "update" when the supabase update errors', async () => {
    const row = { id: 'r4', name: 'X', cuisine_type: null, proteins: ['salt'] }
    const classifyImpl = vi.fn().mockResolvedValue({
      classifications: [{ name: 'salt', essentiality: 'essential', source: 'ai' }],
    })
    const supabase = makeSupabaseMock({
      updateError: { message: 'rls denied' },
    })

    const result = await processRow({
      row, classifyImpl, anthropicClient: {}, supabase, logger: silentLogger,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('update')
  })
})
