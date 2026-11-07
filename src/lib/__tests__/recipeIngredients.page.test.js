import { describe, it, expect, vi } from 'vitest'
import {
  estimateFields,
  fillRecipeIngredients,
  loadLinkedGuesses,
  readIngredients,
  readLinkedRecipes,
} from '../recipeIngredients'

// Reading the real recipe from its link (2026-11-06). The skillet's list was a
// guess (chili powder 1 tsp) though its page says 1 tablespoon; links were
// saved but never opened. household.js is mocked globally: household = `hh-<userId>`.
const USER = 'u1'
const HH = 'hh-u1'
const PAGE_LIST = [{ name: 'chili powder', quantity: '1', unit: 'tablespoon', notes: null }]
const SHOT = { data: 'abc', mediaType: 'image/jpeg' }

const read = (over = {}) => ({
  ingredients_structured: PAGE_LIST, ingredients_classified: null, servings: 4, servings_inferred: true,
  page: { read: true, kind: 'text' }, ...over,
})
const refused = (reason = 'blocked') => read({ page: { read: false, reason } })

function makeSupabase({ rows = [], updatedRows = null } = {}) {
  const sb = { calls: [] }
  sb.from = (table) => {
    const call = { table, op: null, payload: null, filters: [] }
    sb.calls.push(call)
    const chain = {
      select() { if (!call.op) call.op = 'select'; return chain },
      update(p) { call.op = 'update'; call.payload = p; return chain },
      or(f) { call.filters.push(['or', f]); return chain },
      eq(c, v) { call.filters.push(['eq', c, v]); return chain },
      is(c, v) { call.filters.push(['is', c, v]); return chain },
      not(c, o, v) { call.filters.push(['not', c, o, v]); return chain },
      order() { return chain },
      then(res, rej) {
        const r = call.op === 'select' ? { data: rows, error: null } : { data: updatedRows ?? [{ id: 'r' }], error: null }
        return Promise.resolve(r).then(res, rej)
      },
    }
    return chain
  }
  return sb
}

const SKILLET = {
  id: 's1', name: 'One Pan Turkey Sweet Potato Skillet',
  recipe_url: 'https://broccyourbody.com/one-pan-turkey-sweet-potato-skillet/',
  ingredients_structured: [{ name: 'chili powder', quantity: '1', unit: 'tsp' }], ingredients_source: 'estimated',
}
const updateOf = (sb) => sb.calls.find((c) => c.op === 'update')

describe('readIngredients with a link', () => {
  it('asks the server to read the page, and a page list is the real recipe', async () => {
    const analyze = vi.fn(async () => read())
    const r = await readIngredients({ name: 'Skillet', url: SKILLET.recipe_url, readPage: true, analyze })
    expect(analyze).toHaveBeenCalledWith({ name: 'Skillet', url: SKILLET.recipe_url, readPage: true })
    expect(r.source).toBe('page')
    expect(r.page).toEqual({ read: true, kind: 'text' })
  })

  it('a page that refused leaves an estimate, marked as one', async () => {
    const r = await readIngredients({ name: 'X', url: 'https://x.test/r', readPage: true, analyze: async () => refused() })
    expect(r.source).toBe('estimated')
    expect(r.page).toEqual({ read: false, reason: 'blocked' })
  })

  it('screenshots win: no page read is asked for', async () => {
    const analyze = vi.fn(async () => read({ page: undefined }))
    const r = await readIngredients({ name: 'X', url: 'https://x.test/r', images: [SHOT], readPage: true, analyze })
    expect(analyze.mock.calls[0][0].readPage).toBeUndefined()
    expect(r.source).toBe('screenshot')
  })

  it("the Cookbook form's suggestion keeps the page's label", () => {
    expect(estimateFields(read()).ingredients_source).toBe('page')
    expect(estimateFields(refused()).ingredients_source).toBe('estimated')
  })
})

describe('fillRecipeIngredients with a link', () => {
  it('replaces a guess with the page list; guarded so screenshots added meanwhile still win', async () => {
    const sb = makeSupabase()
    const pages = []
    const f = await fillRecipeIngredients(sb, USER, SKILLET, { analyze: async () => read(), onPage: (p) => pages.push(p) })
    expect(f).toMatchObject({ ingredients_structured: PAGE_LIST, ingredients_source: 'page' })
    expect(pages).toEqual([{ read: true, kind: 'text' }])
    expect(updateOf(sb).filters).toEqual([
      ['eq', 'id', 's1'], ['eq', 'household_id', HH],
      ['or', 'ingredients_source.is.null,ingredients_source.eq.estimated,ingredients_source.eq.page'],
    ])
  })

  it('a page list is never replaced by an estimate (or re-read) unless the link changed', async () => {
    const sb = makeSupabase()
    const analyze = vi.fn(async () => read())
    expect(await fillRecipeIngredients(sb, USER, { ...SKILLET, ingredients_source: 'page' }, { analyze })).toBeNull()
    expect(analyze).not.toHaveBeenCalled()
    const f = await fillRecipeIngredients(sb, USER, { ...SKILLET, ingredients_source: 'page' }, { analyze, newLink: true })
    expect(f.ingredients_source).toBe('page')
  })

  it("pageOnly: a refused page writes nothing (one guess isn't swapped for another)", async () => {
    const sb = makeSupabase()
    const pages = []
    const f = await fillRecipeIngredients(sb, USER, SKILLET, {
      analyze: async () => refused('no_recipe'), pageOnly: true, onPage: (p) => pages.push(p),
    })
    expect(f).toBeNull()
    expect(pages).toEqual([{ read: false, reason: 'no_recipe' }])
    expect(updateOf(sb)).toBeUndefined()
  })

  it('without pageOnly, a refused page still fills a recipe that has no list (as an estimate)', async () => {
    const sb = makeSupabase()
    const f = await fillRecipeIngredients(sb, USER, { ...SKILLET, ingredients_source: null, ingredients_structured: null },
      { analyze: async () => refused() })
    expect(f.ingredients_source).toBe('estimated')
    expect(updateOf(sb).filters).toContainEqual(['or', 'ingredients_source.is.null,ingredients_source.eq.estimated'])
  })

  it('her screenshots are never replaced by the page', async () => {
    const sb = makeSupabase()
    const analyze = vi.fn()
    expect(await fillRecipeIngredients(sb, USER, { ...SKILLET, ingredients_source: 'screenshot' }, { analyze, newLink: true })).toBeNull()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('no link: nothing to read', async () => {
    const analyze = vi.fn()
    expect(await fillRecipeIngredients(makeSupabase(), USER, { ...SKILLET, recipe_url: '' }, { analyze, pageOnly: true })).toBeNull()
    expect(analyze).not.toHaveBeenCalled()
  })
})

describe('Settings: read every linked recipe', () => {
  const rows = [
    SKILLET,
    { id: 'a1', name: 'Cheese Tuna Orzo', recipe_url: 'https://www.ambitiouskitchen.com/cheesy-tuna-orzo-skillet/', ingredients_source: null },
    { id: 'p1', name: 'Penne alla Vodka', recipe_url: 'https://www.saltandlavender.com/penne-alla-vodka-recipe/', ingredients_source: 'screenshot' },
    { id: 'c1', name: 'Chicken Piccata', recipe_url: 'https://www.saltandlavender.com/chicken-piccata/', ingredients_source: 'page' },
    { id: 'n1', name: 'Pizza night', recipe_url: '  ', ingredients_source: null },
  ]

  it('lists only linked recipes whose amounts are still a guess', async () => {
    const sb = makeSupabase({ rows })
    expect((await loadLinkedGuesses(sb, USER)).map((r) => r.name)).toEqual(['One Pan Turkey Sweet Potato Skillet', 'Cheese Tuna Orzo'])
    expect(sb.calls[0].filters).toContainEqual(['not', 'recipe_url', 'is', null])
  })

  it('reads each page; sites that refuse are named for screenshots; nothing else is written', async () => {
    const sb = makeSupabase({ rows })
    const analyze = vi.fn(async ({ url }) => (url.includes('ambitiouskitchen') ? refused('blocked') : read()))
    const progress = []
    const out = await readLinkedRecipes(sb, USER, { analyze, onProgress: (p) => progress.push(p.current) })
    expect(out).toEqual({
      read: ['One Pan Turkey Sweet Potato Skillet'],
      needScreenshots: [{ name: 'Cheese Tuna Orzo', reason: 'blocked' }],
      failed: [],
    })
    expect(progress).toEqual([1, 2])
    expect(sb.calls.filter((c) => c.op === 'update')).toHaveLength(1)
  })

  it('a call that throws is counted as failed, and the rest carry on', async () => {
    const sb = makeSupabase({ rows })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let n = 0
    const out = await readLinkedRecipes(sb, USER, { analyze: async () => { if (n++ === 0) throw new Error('offline'); return read() } })
    expect(out.failed).toEqual(['One Pan Turkey Sweet Potato Skillet'])
    expect(out.read).toEqual(['Cheese Tuna Orzo'])
  })
})
