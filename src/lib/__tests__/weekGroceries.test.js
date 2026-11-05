import { describe, it, expect, vi } from 'vitest'

// Household size comes from preferences; keep it fixed here.
vi.mock('../preferences', () => ({
  getPreferences: vi.fn(async () => ({ adults: 2, children: 1, pantry_staples: ['salt'] })),
}))

import {
  confirmWeek,
  keepListAsIs,
  loadConfirmation,
  loadGroceryItems,
  makeWeekGroceryList,
  WeekGroceryError,
} from '../weekGroceries'
import { recipesFromMeals, formatStructuredIngredient, groceryPrefs } from '../groceryRecipes'

// ---------------------------------------------------------------------------
// Supabase fake (same shape as plannedMeals.test.js): records every chain;
// each resolves to responses[`${table}.${op}`] — or, for a list, the next one.
// household.js is mocked globally (src/setupTests.js): household = `hh-<userId>`.
// ---------------------------------------------------------------------------
function makeSupabase(responses = {}) {
  const queues = Object.fromEntries(
    Object.entries(responses).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]),
  )
  const client = {
    calls: [],
    from(table) {
      const call = { table, op: null, columns: null, payload: null, filters: [], order: [], end: null }
      client.calls.push(call)
      const result = () => {
        const q = queues[`${table}.${call.op}`]
        const r = Array.isArray(q) ? q.shift() : q
        return Promise.resolve(r ?? { data: null, error: null })
      }
      const chain = {
        select(cols) { if (!call.op) call.op = 'select'; call.columns = cols; return chain },
        insert(row) { call.op = 'insert'; call.payload = row; return chain },
        update(patch) { call.op = 'update'; call.payload = patch; return chain },
        delete() { call.op = 'delete'; return chain },
        eq(c, v) { call.filters.push(['eq', c, v]); return chain },
        gte(c, v) { call.filters.push(['gte', c, v]); return chain },
        lte(c, v) { call.filters.push(['lte', c, v]); return chain },
        order(c) { call.order.push(c); return chain },
        single() { call.end = 'single'; return result() },
        maybeSingle() { call.end = 'maybeSingle'; return result() },
        then(resolve, reject) { return result().then(resolve, reject) },
      }
      return chain
    },
  }
  return client
}

const USER = 'u1'
const HH = 'hh-u1'
const ok = (data) => ({ data, error: null })
const fail = (message, code) => ({ data: null, error: { message, code } })
const ops = (sb) => sb.calls.map((c) => `${c.table}.${c.op}`)

const confirmation = (over = {}) => ({
  id: 'c1', household_id: HH, starts_on: '2026-11-08', ends_on: '2026-11-14', user_id: USER,
  confirmed_at: '2026-11-08T20:00:00+00:00', changed_at: null, grocery_list_id: null, ...over,
})

const TACOS = {
  name: 'Tacos', vault_id: 'v1',
  vault: { name: 'Tacos', servings: 4, ingredients_structured: [{ name: 'tortillas', quantity: '8', unit: null }] },
}
const ONE_OFF = { name: 'Pizza out', vault_id: null, vault: null }

function api(items = [{ name: 'Tortillas', quantity: '8', section: 'Bakery' }], status = 200) {
  return vi.fn(async () => ({ ok: status < 400, status, json: async () => ({ items }) }))
}

// ---------------------------------------------------------------------------
describe('groceryRecipes (moved from GroceryListBody)', () => {
  it('formats structured ingredients with quantity, unit and notes', () => {
    expect(formatStructuredIngredient({ name: 'olive oil', quantity: '2', unit: 'tbsp' })).toBe('olive oil: 2 tbsp')
    expect(formatStructuredIngredient({ name: 'garlic', quantity: '3', notes: 'minced' })).toBe('garlic: 3, minced')
    expect(formatStructuredIngredient({ name: '  ' })).toBeNull()
  })

  it('prefers structured → classified → chips, and names what it skips', () => {
    const r = recipesFromMeals([
      TACOS,
      { name: 'Curry', vault_id: 'v2', vault: { name: 'Curry', servings: null, ingredients_classified: [{ name: 'coconut milk' }] } },
      { name: 'Salad', vault_id: 'v3', vault: { name: 'Salad', proteins: ['Chicken'], main_carb: '', vegetables: ['Lettuce'] } },
      { name: 'Mystery', vault_id: 'v4', vault: { name: 'Mystery' } },
      ONE_OFF,
    ])
    expect(r.recipes).toEqual([
      { name: 'Tacos', ingredients: ['tortillas: 8'], servings: 4 },
      { name: 'Curry', ingredients: ['coconut milk'], servings: null },
      { name: 'Salad', ingredients: ['Chicken', 'Lettuce'], servings: null },
    ])
    expect(r.notInCookbook).toEqual(['Pizza out'])
    expect(r.noIngredients).toEqual(['Mystery'])
    // Curry (names only) and Salad (tags only) were used without a saved list: a guess.
    expect(r.noList).toEqual(['Curry', 'Salad'])
  })

  it('household size is adults + children, never below 1', () => {
    expect(groceryPrefs(null)).toEqual({ householdSize: 2, pantryStaples: [] })
    expect(groceryPrefs({ adults: 0, children: 0 }).householdSize).toBe(1)
  })
})

// ---------------------------------------------------------------------------
describe('loadConfirmation / confirmWeek', () => {
  it('looks up exactly the Sun–Sat range for the household', async () => {
    const sb = makeSupabase({ 'week_confirmations.select': ok(confirmation()) })
    expect(await loadConfirmation(sb, USER, '2026-11-08')).toEqual(confirmation())
    expect(sb.calls[0].filters).toEqual([
      ['eq', 'household_id', HH], ['eq', 'starts_on', '2026-11-08'], ['eq', 'ends_on', '2026-11-14'],
    ])
  })

  it('returns null for an unconfirmed week', async () => {
    const sb = makeSupabase({ 'week_confirmations.select': ok(null) })
    expect(await loadConfirmation(sb, USER, '2026-11-08')).toBeNull()
  })

  it('refuses a date that is not a Sunday', async () => {
    await expect(loadConfirmation(makeSupabase(), USER, '2026-11-09')).rejects.toThrow('not a Sunday')
  })

  it('confirming writes one stamp for the week', async () => {
    const sb = makeSupabase({ 'week_confirmations.insert': ok(confirmation()) })
    expect(await confirmWeek(sb, USER, '2026-11-08')).toEqual(confirmation())
    expect(sb.calls[0].payload).toEqual({
      household_id: HH, starts_on: '2026-11-08', ends_on: '2026-11-14', user_id: USER,
    })
  })

  it('already confirmed (e.g. by her partner): returns that one, no error', async () => {
    const sb = makeSupabase({
      'week_confirmations.insert': fail('duplicate key', '23505'),
      'week_confirmations.select': ok(confirmation({ user_id: 'u2' })),
    })
    expect((await confirmWeek(sb, USER, '2026-11-08')).user_id).toBe('u2')
  })

  it('any other failure is thrown', async () => {
    const sb = makeSupabase({ 'week_confirmations.insert': fail('offline') })
    await expect(confirmWeek(sb, USER, '2026-11-08')).rejects.toMatchObject({ message: 'offline' })
  })
})

// ---------------------------------------------------------------------------
describe('makeWeekGroceryList', () => {
  it("builds the list from exactly that week's meals", async () => {
    const sb = makeSupabase({
      'planned_meals.select': ok([TACOS, ONE_OFF]),
      'grocery_lists.insert': ok({ id: 'L2' }),
      'week_confirmations.update': ok([{ id: 'c1' }]),
    })
    const fetchApi = api()
    const out = await makeWeekGroceryList(sb, USER, confirmation(), { fetchApi })

    const read = sb.calls[0]
    expect(read.table).toBe('planned_meals')
    expect(read.filters).toEqual([
      ['eq', 'household_id', HH], ['gte', 'planned_on', '2026-11-08'], ['lte', 'planned_on', '2026-11-14'],
    ])
    expect(read.columns).toMatch(/vault\(.*ingredients_structured/)

    expect(fetchApi).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchApi.mock.calls[0][1].body)
    expect(body).toEqual({
      recipes: [{ name: 'Tacos', ingredients: ['tortillas: 8'], servings: 4 }],
      pantryStaples: ['salt'],
      householdSize: 3,
    })
    expect(out).toEqual({ listId: 'L2', notInCookbook: ['Pizza out'], noIngredients: [], noList: [] })

    const items = sb.calls.find((c) => c.table === 'grocery_list_items' && c.op === 'insert')
    expect(items.payload).toEqual([{
      list_id: 'L2', name: 'Tortillas', quantity: '8', section: 'Bakery', is_bought: false, is_adhoc: false,
    }])
    const link = sb.calls.find((c) => c.table === 'week_confirmations' && c.op === 'update')
    expect(link.payload).toEqual({ grocery_list_id: 'L2' })
    expect(link.filters).toEqual([['eq', 'id', 'c1']])
  })

  it('remaking: new list linked first, then the stamp cleared (guarded), then the old list deleted', async () => {
    const seen = '2026-11-09T18:00:00.123456+00:00'
    const sb = makeSupabase({
      'planned_meals.select': ok([TACOS]),
      'grocery_lists.insert': ok({ id: 'L2' }),
      'week_confirmations.update': [ok([{ id: 'c1' }]), ok([{ id: 'c1' }])],
    })
    await makeWeekGroceryList(sb, USER, confirmation({ grocery_list_id: 'L1', changed_at: seen }), { fetchApi: api() })

    expect(ops(sb)).toEqual([
      'planned_meals.select', 'grocery_lists.insert', 'grocery_list_items.insert',
      'week_confirmations.update', 'week_confirmations.update', 'grocery_lists.delete',
    ])
    const clear = sb.calls[4]
    expect(clear.payload).toEqual({ changed_at: null })
    expect(clear.filters).toEqual([['eq', 'id', 'c1'], ['eq', 'changed_at', seen]])
    expect(sb.calls[5].filters).toEqual([['eq', 'id', 'L1']])
  })

  it('no cookbook recipes with ingredients: says so, calls no AI, writes nothing', async () => {
    const sb = makeSupabase({ 'planned_meals.select': ok([ONE_OFF]) })
    const fetchApi = api()
    const err = await makeWeekGroceryList(sb, USER, confirmation(), { fetchApi }).catch((e) => e)
    expect(err).toBeInstanceOf(WeekGroceryError)
    expect(err.code).toBe('no_recipes')
    expect(err.notInCookbook).toEqual(['Pizza out'])
    expect(fetchApi).not.toHaveBeenCalled()
    expect(ops(sb)).toEqual(['planned_meals.select'])
  })

  it('AI call fails: nothing written, the old list untouched', async () => {
    const sb = makeSupabase({ 'planned_meals.select': ok([TACOS]) })
    const err = await makeWeekGroceryList(sb, USER, confirmation({ grocery_list_id: 'L1' }), { fetchApi: api([], 502) })
      .catch((e) => e)
    expect(err.code).toBe('api')
    expect(ops(sb)).toEqual(['planned_meals.select'])
  })

  it('items fail to save: the half-made list is thrown away, the old one kept, the stamp left alone', async () => {
    const sb = makeSupabase({
      'planned_meals.select': ok([TACOS]),
      'grocery_lists.insert': ok({ id: 'L2' }),
      'grocery_list_items.insert': fail('offline'),
    })
    await expect(
      makeWeekGroceryList(sb, USER, confirmation({ grocery_list_id: 'L1', changed_at: 'x' }), { fetchApi: api() }),
    ).rejects.toMatchObject({ message: 'offline' })
    const deletes = sb.calls.filter((c) => c.op === 'delete')
    expect(deletes.map((c) => c.filters)).toEqual([[['eq', 'id', 'L2']]])
    expect(sb.calls.some((c) => c.table === 'week_confirmations')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('makeWeekGroceryList: after the list is linked', () => {
  it('the confirmation is gone (0 rows linked): the new list is thrown away, the old one kept', async () => {
    const sb = makeSupabase({
      'planned_meals.select': ok([TACOS]),
      'grocery_lists.insert': ok({ id: 'L2' }),
      'week_confirmations.update': ok([]),
    })
    await expect(makeWeekGroceryList(sb, USER, confirmation({ grocery_list_id: 'L1' }), { fetchApi: api() }))
      .rejects.toThrow('the confirmation is gone')
    expect(sb.calls.filter((c) => c.op === 'delete').map((c) => c.filters)).toEqual([[['eq', 'id', 'L2']]])
  })

  it('clearing the stamp fails: the list still counts as made and the old one is still deleted', async () => {
    const sb = makeSupabase({
      'planned_meals.select': ok([TACOS]),
      'grocery_lists.insert': ok({ id: 'L2' }),
      'week_confirmations.update': [ok([{ id: 'c1' }]), fail('offline')],
    })
    const out = await makeWeekGroceryList(sb, USER, confirmation({ grocery_list_id: 'L1', changed_at: 'x' }), { fetchApi: api() })
    expect(out.listId).toBe('L2')
    expect(sb.calls.filter((c) => c.op === 'delete').map((c) => c.filters)).toEqual([[['eq', 'id', 'L1']]])
  })
})

describe('changed since confirmed', () => {
  it('"Keep as is" clears the stamp only if it is still the one we saw', async () => {
    const seen = '2026-11-09T18:00:00+00:00'
    const sb = makeSupabase({ 'week_confirmations.update': ok([{ id: 'c1' }]) })
    expect(await keepListAsIs(sb, confirmation({ changed_at: seen }))).toBe(true)
    expect(sb.calls[0].payload).toEqual({ changed_at: null })
    expect(sb.calls[0].filters).toEqual([['eq', 'id', 'c1'], ['eq', 'changed_at', seen]])
  })

  it('an edit since we looked (newer stamp) is not cleared', async () => {
    const sb = makeSupabase({ 'week_confirmations.update': ok([]) })
    expect(await keepListAsIs(sb, confirmation({ changed_at: 'old' }))).toBe(false)
  })

  it('nothing to clear: no write', async () => {
    const sb = makeSupabase()
    expect(await keepListAsIs(sb, confirmation())).toBe(true)
    expect(sb.calls).toEqual([])
  })
})

describe('loadGroceryItems', () => {
  it("reads a list's items oldest first", async () => {
    const sb = makeSupabase({ 'grocery_list_items.select': ok([{ id: 'i1', name: 'Limes' }]) })
    expect(await loadGroceryItems(sb, 'L1')).toEqual([{ id: 'i1', name: 'Limes' }])
    expect(sb.calls[0].filters).toEqual([['eq', 'list_id', 'L1']])
    expect(sb.calls[0].order).toEqual(['created_at'])
  })
})
