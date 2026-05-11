/**
 * PRD-006 Bite δ tests for GroceryListBody:
 * structured-ingredient formatting + fallback chain + main_carb regression guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GroceryListBody from '../GroceryListBody'

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

vi.mock('../../../lib/mealPlanReader', () => ({
  fetchMostRecentPlan: vi.fn(),
}))

vi.mock('../../../lib/preferences', () => ({
  getPreferences: vi.fn(),
}))

import { supabase } from '../../../lib/supabase'
import { fetchMostRecentPlan } from '../../../lib/mealPlanReader'
import { getPreferences } from '../../../lib/preferences'

// ---- chain helpers (same patterns as GroceryList.test.jsx) ----

function listRowChain(result) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
}

function itemRowsChain(result) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
  }
}

function planItemsChain(result) {
  // Query shape: .select().eq(meal_plan_id).eq(is_shortlisted) — second eq is terminal.
  const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn() }
  chain.eq
    .mockReturnValueOnce(chain)         // first .eq() returns chain for chaining
    .mockResolvedValueOnce(result)      // second .eq() resolves the query
  return chain
}

function upsertCheckChain(result) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
}

function insertListChain(result) {
  return {
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue(result),
      }),
    }),
  }
}

function deleteChain(result = { error: null }) {
  return {
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue(result),
    }),
  }
}

function insertItemsChain(result = { error: null }) {
  return { insert: vi.fn().mockResolvedValue(result) }
}

// ---- shared setup ----

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn())
  getPreferences.mockResolvedValue({ adults: 2, children: 0 })
  fetchMostRecentPlan.mockResolvedValue({ plan: { id: 'plan-1' } })
})

/**
 * Set up supabase.from mock sequence for a full Generate flow.
 * Pass a vault object to control what the plan item's vault data looks like.
 */
function setupGenerateFlow(vault) {
  supabase.from
    // loadData → loadList: no existing list
    .mockReturnValueOnce(listRowChain({ data: null, error: null }))
    // handleGenerate: meal_plan_items join
    .mockReturnValueOnce(planItemsChain({
      data: [{ name: 'Dish', vault_id: 'v-1', vault }],
      error: null,
    }))
    // handleGenerate: upsert check — no existing list
    .mockReturnValueOnce(upsertCheckChain({ data: null, error: null }))
    // handleGenerate: insert new grocery_list
    .mockReturnValueOnce(insertListChain({ data: { id: 'list-new' }, error: null }))
    // handleGenerate: delete old items
    .mockReturnValueOnce(deleteChain())
    // handleGenerate: insert new items
    .mockReturnValueOnce(insertItemsChain())
    // loadList re-fetch: grocery_lists
    .mockReturnValueOnce(listRowChain({ data: { id: 'list-new', created_at: '2026-05-05' }, error: null }))
    // loadList re-fetch: grocery_list_items
    .mockReturnValueOnce(itemRowsChain({ data: [], error: null }))

  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ items: [{ name: 'x', quantity: '1', section: 'Pantry' }] }),
  })
}

// ---- PRD-003 P0.2: pantry_staples wiring tests ----

describe('PRD-003 P0.2 — pantry_staples flows through to fetch body', () => {
  const MINIMAL_VAULT = {
    name: 'Pasta',
    servings: 2,
    ingredients_structured: [{ name: 'pasta', quantity: '200', unit: 'g' }],
    ingredients_classified: null,
    proteins: [], main_carb: null, vegetables: [], dairy_components: [], fruits: [],
  }

  it('pantry_staples from prefs flow through as pantryStaples in the fetch body', async () => {
    getPreferences.mockResolvedValue({ adults: 2, children: 0, pantry_staples: ['olive oil', 'salt'] })
    setupGenerateFlow(MINIMAL_VAULT)

    render(<GroceryListBody userId="user-1" />)
    await waitFor(() => screen.getByRole('button', { name: 'Generate List' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Generate List' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body)
    expect(body.pantryStaples).toEqual(['olive oil', 'salt'])
  })

  it('empty pantry_staples flows through as [] in the fetch body', async () => {
    getPreferences.mockResolvedValue({ adults: 2, children: 0, pantry_staples: [] })
    setupGenerateFlow(MINIMAL_VAULT)

    render(<GroceryListBody userId="user-1" />)
    await waitFor(() => screen.getByRole('button', { name: 'Generate List' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Generate List' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body)
    expect(body.pantryStaples).toEqual([])
  })

  it('defensive fallback: pantryStaples is [] when prefs has no pantry_staples key', async () => {
    getPreferences.mockResolvedValue({ adults: 2, children: 0 })
    setupGenerateFlow(MINIMAL_VAULT)

    render(<GroceryListBody userId="user-1" />)
    await waitFor(() => screen.getByRole('button', { name: 'Generate List' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Generate List' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body)
    expect(body.pantryStaples).toEqual([])
  })
})

// ---- Bite δ tests ----

describe('Bite δ — structured-ingredient formatting', () => {
  it('recipe with ingredients_structured → POST body has formatted strings', async () => {
    setupGenerateFlow({
      name: 'Pasta Carbonara',
      servings: 4,
      ingredients_structured: [
        { name: 'olive oil', quantity: '2', unit: 'tbsp' },
        { name: 'kosher salt', quantity: null, unit: null, notes: 'to taste' },
      ],
      ingredients_classified: null,
      proteins: [], main_carb: null, vegetables: [], dairy_components: [], fruits: [],
    })

    render(<GroceryListBody userId="user-1" />)
    await waitFor(() => screen.getByRole('button', { name: 'Generate List' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Generate List' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body)
    expect(body.recipes[0].ingredients).toEqual(['olive oil: 2 tbsp', 'kosher salt: to taste'])
  })

  it('recipe with empty ingredients_structured → falls back to ingredients_classified names', async () => {
    setupGenerateFlow({
      name: 'Frittata',
      servings: 2,
      ingredients_structured: [],
      ingredients_classified: [{ name: 'eggs' }, { name: 'pancetta' }],
      proteins: [], main_carb: null, vegetables: [], dairy_components: [], fruits: [],
    })

    render(<GroceryListBody userId="user-1" />)
    await waitFor(() => screen.getByRole('button', { name: 'Generate List' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Generate List' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body)
    expect(body.recipes[0].ingredients).toEqual(['eggs', 'pancetta'])
  })

  it('recipe with neither structured nor classified → falls back to chip arrays', async () => {
    setupGenerateFlow({
      name: 'Rice Bowl',
      servings: 2,
      ingredients_structured: null,
      ingredients_classified: null,
      proteins: ['chicken'], main_carb: 'rice', vegetables: ['onion'],
      dairy_components: [], fruits: [],
    })

    render(<GroceryListBody userId="user-1" />)
    await waitFor(() => screen.getByRole('button', { name: 'Generate List' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Generate List' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body)
    expect(body.recipes[0].ingredients).toEqual(['chicken', 'rice', 'onion'])
  })

  it('main_carb as single string in chip fallback → one element, not characters', async () => {
    setupGenerateFlow({
      name: 'Simple Rice',
      servings: 2,
      ingredients_structured: null,
      ingredients_classified: null,
      proteins: [], main_carb: 'rice', vegetables: [],
      dairy_components: [], fruits: [],
    })

    render(<GroceryListBody userId="user-1" />)
    await waitFor(() => screen.getByRole('button', { name: 'Generate List' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Generate List' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1].body)
    // Must be ['rice'], NOT ['r', 'i', 'c', 'e']
    expect(body.recipes[0].ingredients).toEqual(['rice'])
  })

  it('recipe with no usable ingredient data is skipped with console.warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    fetchMostRecentPlan.mockResolvedValue({ plan: { id: 'plan-1' } })

    supabase.from
      // loadData → loadList: no existing list
      .mockReturnValueOnce(listRowChain({ data: null, error: null }))
      // handleGenerate: meal_plan_items join — vault with no ingredient data
      .mockReturnValueOnce(planItemsChain({
        data: [{
          name: 'Empty Dish', vault_id: 'v-1',
          vault: {
            name: 'Empty Dish',
            servings: 2,
            ingredients_structured: [],
            ingredients_classified: [],
            proteins: [], main_carb: null, vegetables: [],
            dairy_components: [], fruits: [],
          },
        }],
        error: null,
      }))

    render(<GroceryListBody userId="user-1" />)
    await waitFor(() => screen.getByRole('button', { name: 'Generate List' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Generate List' }))

    await waitFor(() =>
      expect(screen.getByText(/None of the meals/i)).toBeInTheDocument()
    )

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[GroceryList] no ingredient data for vault recipe:'),
      'Empty Dish',
    )
    expect(fetch).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })
})

// ---- AI-suggestion / no-vault-link warning ----

describe('AI-suggestion meals with no Cookbook entry', () => {
  const VALID_VAULT = {
    name: 'Pasta',
    servings: 2,
    ingredients_structured: [{ name: 'pasta', quantity: '200', unit: 'g' }],
    ingredients_classified: null,
    proteins: [], main_carb: null, vegetables: [], dairy_components: [], fruits: [],
  }

  it('shows an amber warning banner listing meals not in the Cookbook', async () => {
    supabase.from
      .mockReturnValueOnce(listRowChain({ data: null, error: null }))
      .mockReturnValueOnce(planItemsChain({
        data: [
          { name: 'AI Meal', vault_id: null, vault: null },
          { name: 'Pasta', vault_id: 'v-1', vault: VALID_VAULT },
        ],
        error: null,
      }))
      .mockReturnValueOnce(upsertCheckChain({ data: null, error: null }))
      .mockReturnValueOnce(insertListChain({ data: { id: 'list-new' }, error: null }))
      .mockReturnValueOnce(deleteChain())
      .mockReturnValueOnce(insertItemsChain())
      .mockReturnValueOnce(listRowChain({ data: { id: 'list-new', created_at: '2026-05-05' }, error: null }))
      .mockReturnValueOnce(itemRowsChain({ data: [], error: null }))

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ name: 'pasta', quantity: '200 g', section: 'Pantry' }] }),
    })

    render(<GroceryListBody userId="user-1" />)
    await waitFor(() => screen.getByRole('button', { name: 'Generate List' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Generate List' }))

    await waitFor(() =>
      expect(screen.getByText(/Not in your Cookbook/i)).toBeInTheDocument()
    )
    expect(screen.getByText(/AI Meal/)).toBeInTheDocument()
    // Vault-linked meal still contributes to the list call
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('shows targeted error (not generic message) when ALL meals are AI suggestions', async () => {
    supabase.from
      .mockReturnValueOnce(listRowChain({ data: null, error: null }))
      .mockReturnValueOnce(planItemsChain({
        data: [{ name: 'Chicken Tikka', vault_id: null, vault: null }],
        error: null,
      }))

    render(<GroceryListBody userId="user-1" />)
    await waitFor(() => screen.getByRole('button', { name: 'Generate List' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Generate List' }))

    await waitFor(() =>
      expect(screen.getByText(/None of the meals in this plan are in your Cookbook/i)).toBeInTheDocument()
    )
    expect(screen.getByText(/Chicken Tikka/)).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
})

// ---- PRD-003 P0.7 — ad-hoc add ----

describe('PRD-003 P0.7 — ad-hoc add', () => {
  function setupExistingList(items = []) {
    supabase.from
      .mockReturnValueOnce(listRowChain({
        data: { id: 'list-1', created_at: '2026-05-05' },
        error: null,
      }))
      .mockReturnValueOnce(itemRowsChain({ data: items, error: null }))
  }

  function adhocInsertChain(result = { error: null }) {
    return { insert: vi.fn().mockResolvedValue(result) }
  }

  it('renders the ad-hoc input only when items exist', async () => {
    setupExistingList([
      { id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' },
    ])
    render(<GroceryListBody userId="user-1" />)

    await waitFor(() => screen.getByText('Carrots'))
    expect(screen.getByPlaceholderText('Add an item…')).toBeInTheDocument()
  })

  it('does NOT render the ad-hoc input when there is no list yet', async () => {
    supabase.from.mockReturnValueOnce(listRowChain({ data: null, error: null }))
    render(<GroceryListBody userId="user-1" />)

    await waitFor(() => screen.getByRole('button', { name: 'Generate List' }))
    expect(screen.queryByPlaceholderText('Add an item…')).not.toBeInTheDocument()
  })

  it('submitting via Enter inserts a row with section=Other and is_adhoc=true', async () => {
    setupExistingList([
      { id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' },
    ])
    const insertChain = adhocInsertChain()
    supabase.from
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(listRowChain({
        data: { id: 'list-1', created_at: '2026-05-05' }, error: null,
      }))
      .mockReturnValueOnce(itemRowsChain({
        data: [
          { id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' },
          { id: 'i-2', name: 'Milk',    quantity: null, section: 'Other' },
        ],
        error: null,
      }))

    render(<GroceryListBody userId="user-1" />)
    const user = userEvent.setup()
    const input = await screen.findByPlaceholderText('Add an item…')

    await user.type(input, 'Milk')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(insertChain.insert).toHaveBeenCalledOnce())
    expect(insertChain.insert).toHaveBeenCalledWith({
      list_id:   'list-1',
      name:      'Milk',
      quantity:  null,
      section:   'Other',
      is_bought: false,
      is_adhoc:  true,
    })

    await waitFor(() => screen.getByText('Milk'))
  })

  it('submitting via the Add button does the same thing as Enter', async () => {
    setupExistingList([
      { id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' },
    ])
    const insertChain = adhocInsertChain()
    supabase.from
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(listRowChain({
        data: { id: 'list-1', created_at: '2026-05-05' }, error: null,
      }))
      .mockReturnValueOnce(itemRowsChain({ data: [], error: null }))

    render(<GroceryListBody userId="user-1" />)
    const user = userEvent.setup()
    const input = await screen.findByPlaceholderText('Add an item…')
    await user.type(input, 'Milk')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(insertChain.insert).toHaveBeenCalledOnce())
  })

  it('whitespace-only input is ignored (no insert, no error)', async () => {
    setupExistingList([
      { id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' },
    ])
    render(<GroceryListBody userId="user-1" />)
    const user = userEvent.setup()
    const input = await screen.findByPlaceholderText('Add an item…')
    await user.type(input, '   ')

    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()

    await user.keyboard('{Enter}')
    expect(supabase.from).toHaveBeenCalledTimes(2) // just the initial loadList chain
  })

  it('input is cleared after a successful add', async () => {
    setupExistingList([
      { id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' },
    ])
    supabase.from
      .mockReturnValueOnce(adhocInsertChain())
      .mockReturnValueOnce(listRowChain({
        data: { id: 'list-1', created_at: '2026-05-05' }, error: null,
      }))
      // Must return items so the form stays mounted and the input ref stays valid
      .mockReturnValueOnce(itemRowsChain({
        data: [
          { id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' },
          { id: 'i-2', name: 'Milk',    quantity: null, section: 'Other' },
        ],
        error: null,
      }))

    render(<GroceryListBody userId="user-1" />)
    const user = userEvent.setup()
    const input = await screen.findByPlaceholderText('Add an item…')
    await user.type(input, 'Milk')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('insert error surfaces a friendly message and leaves input intact', async () => {
    setupExistingList([
      { id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' },
    ])
    supabase.from.mockReturnValueOnce(
      adhocInsertChain({ error: { message: 'boom' } })
    )

    render(<GroceryListBody userId="user-1" />)
    const user = userEvent.setup()
    const input = await screen.findByPlaceholderText('Add an item…')
    await user.type(input, 'Milk')
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(screen.getByText(/Could not add item/i)).toBeInTheDocument()
    )
    expect(input).toHaveValue('Milk')
  })
})

// ---- PRD-003 P0.9 / P0.10 — share + revoke ----

describe('PRD-003 P0.9 / P0.10 — share + revoke', () => {
  function setupExistingListWithToken(token, items = []) {
    supabase.from
      .mockReturnValueOnce(listRowChain({
        data: { id: 'list-1', created_at: '2026-05-05', share_token: token },
        error: null,
      }))
      .mockReturnValueOnce(itemRowsChain({ data: items, error: null }))
  }

  function updateChain(result = { error: null }) {
    const eq = vi.fn().mockResolvedValue(result)
    const update = vi.fn().mockReturnValue({ eq })
    return { update, _eq: eq }
  }

  const ONE_ITEM = [{ id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' }]

  it('Share button shows "Share with…" when no token, opens sheet to a Generate CTA', async () => {
    setupExistingListWithToken(null, ONE_ITEM)
    render(<GroceryListBody userId="user-1" />)

    const shareBtn = await screen.findByRole('button', { name: /Share with/i })
    await userEvent.setup().click(shareBtn)

    expect(screen.getByRole('button', { name: /Generate share link/i })).toBeInTheDocument()
  })

  it('Share button shows "Share link active" when a token exists, opens sheet to Copy + Revoke', async () => {
    setupExistingListWithToken('abc123', ONE_ITEM)
    render(<GroceryListBody userId="user-1" />)

    const shareBtn = await screen.findByRole('button', { name: /Share link active/i })
    await userEvent.setup().click(shareBtn)

    expect(screen.getByRole('button', { name: /Copy link/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Revoke/i })).toBeInTheDocument()
  })

  it('Generate share link writes a UUID to share_token and updates state', async () => {
    setupExistingListWithToken(null, ONE_ITEM)
    const upd = updateChain()
    supabase.from.mockReturnValueOnce(upd)

    const stubbed = vi.spyOn(crypto, 'randomUUID').mockReturnValue('test-uuid-1234')

    render(<GroceryListBody userId="user-1" />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Share with/i }))
    await user.click(screen.getByRole('button', { name: /Generate share link/i }))

    await waitFor(() => expect(upd.update).toHaveBeenCalledWith({ share_token: 'test-uuid-1234' }))
    expect(screen.getByRole('button', { name: /Copy link/i })).toBeInTheDocument()

    stubbed.mockRestore()
  })

  it('Revoke nulls share_token and returns the sheet to the Generate state', async () => {
    setupExistingListWithToken('abc123', ONE_ITEM)
    const upd = updateChain()
    supabase.from.mockReturnValueOnce(upd)

    render(<GroceryListBody userId="user-1" />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Share link active/i }))
    await user.click(screen.getByRole('button', { name: /Revoke/i }))

    await waitFor(() => expect(upd.update).toHaveBeenCalledWith({ share_token: null }))
    expect(screen.getByRole('button', { name: /Generate share link/i })).toBeInTheDocument()
  })
})
