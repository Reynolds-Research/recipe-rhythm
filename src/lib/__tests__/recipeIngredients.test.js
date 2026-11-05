import { describe, it, expect, vi } from 'vitest'
import {
  chipsOf,
  fillMissingIngredients,
  fillRecipeIngredients,
  hasIngredientList,
  ingredientFields,
  loadMissingIngredients,
  readIngredients,
} from '../recipeIngredients'

// household.js is mocked globally (src/setupTests.js): household = `hh-<userId>`.
const USER = 'u1'
const HH = 'hh-u1'
const LIST = [{ name: 'penne', quantity: '1', unit: 'lb', notes: null }]
const SHOT = { data: 'abc', mediaType: 'image/jpeg' }

function components(over = {}) {
  return {
    ingredients_structured: LIST,
    ingredients_classified: [{ name: 'penne', essentiality: 'essential', source: 'ai' }],
    servings: 4, servings_inferred: true, ...over,
  }
}

/** A tiny supabase fake: records calls; vault select returns `rows`. */
function makeSupabase({ rows = [], updateError = null } = {}) {
  const sb = { calls: [] }
  sb.from = (table) => {
    const call = { table, op: null, payload: null, filters: [] }
    sb.calls.push(call)
    const chain = {
      select() { call.op = 'select'; return chain },
      update(p) { call.op = 'update'; call.payload = p; return chain },
      eq(c, v) { call.filters.push(['eq', c, v]); return chain },
      is(c, v) { call.filters.push(['is', c, v]); return chain },
      order() { return chain },
      then(res, rej) {
        const r = call.op === 'select' ? { data: rows, error: null } : { data: null, error: updateError }
        return Promise.resolve(r).then(res, rej)
      },
    }
    return chain
  }
  return sb
}

const PENNE = {
  id: 'r1', name: 'Penne alla Vodka', recipe_url: 'https://example.com/penne',
  main_carb: 'Pasta', vegetables: ['Tomato'], dairy_components: ['Cream'], proteins: [],
  ingredients_structured: null, ingredients_classified: null, ingredients_source: null,
}

describe('readIngredients', () => {
  it('with screenshots: sends them, and the list is marked "screenshot"', async () => {
    const analyze = vi.fn(async () => components())
    const r = await readIngredients({ name: 'Penne', images: [SHOT, SHOT], analyze })
    expect(analyze).toHaveBeenCalledWith({ name: 'Penne', url: '', images: [SHOT, SHOT] })
    expect(r).toMatchObject({ structured: LIST, servings: 4, source: 'screenshot' })
  })

  it('without screenshots: an estimate, pinned to her tags', async () => {
    const analyze = vi.fn(async () => components())
    const r = await readIngredients({ name: 'Penne', chips: chipsOf(PENNE), analyze })
    expect(analyze.mock.calls[0][0].images).toBeUndefined()
    expect(analyze.mock.calls[0][0].userChips).toMatchObject({ main_carb: 'Pasta', vegetables: ['Tomato'] })
    expect(r.source).toBe('estimated')
  })

  it("the API's fallback of 4 servings is not saved as a fact", async () => {
    const r = await readIngredients({ name: 'x', analyze: async () => components({ servings_inferred: false }) })
    expect(r.servings).toBeNull()
  })

  it('nothing usable (failed call, or no ingredients) → null', async () => {
    expect(await readIngredients({ name: 'x', analyze: async () => null })).toBeNull()
    expect(await readIngredients({ name: 'x', analyze: async () => components({ ingredients_structured: [] }) })).toBeNull()
  })

  it('refuses more than 3 screenshots', async () => {
    await expect(readIngredients({ name: 'x', images: [SHOT, SHOT, SHOT, SHOT], analyze: vi.fn() }))
      .rejects.toThrow('At most 3')
  })
})

describe('ingredientFields', () => {
  it('keeps her own "essential / can skip" choices when the list is re-read', () => {
    const mine = [{ name: 'penne', essentiality: 'omittable', source: 'user' }]
    const f = ingredientFields({ structured: LIST, classified: components().ingredients_classified, servings: 4, source: 'screenshot' }, mine)
    expect(f).toEqual({ ingredients_structured: LIST, ingredients_classified: mine, servings: 4, ingredients_source: 'screenshot' })
  })
})

describe('fillRecipeIngredients', () => {
  it('saves the list, servings and where it came from, for this household only', async () => {
    const sb = makeSupabase()
    const f = await fillRecipeIngredients(sb, USER, PENNE, { images: [SHOT], analyze: async () => components() })
    expect(f.ingredients_source).toBe('screenshot')
    const upd = sb.calls.find((c) => c.op === 'update')
    expect(upd.payload).toMatchObject({ ingredients_structured: LIST, servings: 4, ingredients_source: 'screenshot' })
    expect(upd.filters).toEqual([['eq', 'id', 'r1'], ['eq', 'household_id', HH]])
  })

  it('an estimate never overwrites a screenshot list', async () => {
    const sb = makeSupabase()
    const analyze = vi.fn()
    expect(await fillRecipeIngredients(sb, USER, { ...PENNE, ingredients_source: 'screenshot' }, { analyze })).toBeNull()
    expect(analyze).not.toHaveBeenCalled()
    expect(sb.calls).toEqual([])
  })

  it('new screenshots do replace a screenshot list', async () => {
    const sb = makeSupabase()
    const f = await fillRecipeIngredients(sb, USER, { ...PENNE, ingredients_source: 'screenshot' },
      { images: [SHOT], analyze: async () => components() })
    expect(f.ingredients_source).toBe('screenshot')
  })

  it('nothing read → nothing written', async () => {
    const sb = makeSupabase()
    expect(await fillRecipeIngredients(sb, USER, PENNE, { analyze: async () => null })).toBeNull()
    expect(sb.calls).toEqual([])
  })

  it('a failed save is thrown', async () => {
    const sb = makeSupabase({ updateError: { message: 'offline' } })
    await expect(fillRecipeIngredients(sb, USER, PENNE, { analyze: async () => components() }))
      .rejects.toMatchObject({ message: 'offline' })
  })
})

describe('filling every recipe with no list', () => {
  const FULL = { ...PENNE, id: 'r2', name: 'Tacos', ingredients_structured: LIST }
  const EMPTY = { ...PENNE, id: 'r3', name: 'Salad', ingredients_structured: [] }

  it('finds recipes with no list or an empty one, in this household, not deleted', async () => {
    const sb = makeSupabase({ rows: [PENNE, FULL, EMPTY] })
    expect((await loadMissingIngredients(sb, USER)).map((r) => r.name)).toEqual(['Penne alla Vodka', 'Salad'])
    expect(sb.calls[0].filters).toEqual([['eq', 'household_id', HH], ['is', 'deleted_at', null]])
    expect(hasIngredientList(FULL)).toBe(true)
  })

  it('estimates each one in turn, never touches a full one, and counts failures', async () => {
    const sb = makeSupabase({ rows: [PENNE, FULL, EMPTY] })
    const analyze = vi.fn(async ({ name }) => (name === 'Salad' ? null : components()))
    const progress = []
    const out = await fillMissingIngredients(sb, USER, { analyze, onProgress: (p) => progress.push(p.current) })
    expect(out).toEqual({ filled: ['Penne alla Vodka'], failed: ['Salad'] })
    expect(analyze).toHaveBeenCalledTimes(2)
    expect(progress).toEqual([1, 2])
    const upd = sb.calls.filter((c) => c.op === 'update')
    expect(upd).toHaveLength(1)
    expect(upd[0].payload.ingredients_source).toBe('estimated')
  })
})
