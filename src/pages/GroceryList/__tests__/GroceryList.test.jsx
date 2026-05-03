import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GroceryList from '../index'

// --- Module mocks ---

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

vi.mock('../../../lib/mealPlanReader', () => ({
  fetchMostRecentPlan: vi.fn(),
}))

import { supabase } from '../../../lib/supabase'
import { fetchMostRecentPlan } from '../../../lib/mealPlanReader'

// Helpers — each returns a minimal chain for a specific query pattern.

// .select().eq().eq().maybeSingle()  →  resolves to `result`
function listRowChain(result) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
}

// .select().eq().order()  →  resolves to `result`
function itemRowsChain(result) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue(result),
  }
}

// .select().eq().eq().not()  →  resolves to `result`   (meal_plan_items join)
function planItemsChain(result) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockResolvedValue(result),
  }
}

// .select('id').eq().eq().maybeSingle()  →  resolves to `result`  (upsert check)
function upsertCheckChain(result) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
}

// .insert({}).select('id').single()  →  resolves to `result`
function insertListChain(result) {
  return {
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue(result),
      }),
    }),
  }
}

// .delete().eq()  →  resolves to `result`
function deleteChain(result = { error: null }) {
  return {
    delete: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue(result),
    }),
  }
}

// .insert([])  →  resolves to `result`
function insertItemsChain(result = { error: null }) {
  return { insert: vi.fn().mockResolvedValue(result) }
}

describe('GroceryList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  // 1. No active plan
  it('renders no-active-plan empty state when fetchMostRecentPlan returns null', async () => {
    fetchMostRecentPlan.mockResolvedValue({ plan: null })

    render(<GroceryList userId="user-1" />)

    await waitFor(() =>
      expect(screen.getByText('No active planning period.')).toBeInTheDocument()
    )
    expect(screen.getByText(/Start one in Brainstorm/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generate/i })).not.toBeInTheDocument()
  })

  // 2. Active plan, no list yet
  it('renders no-list empty state with Generate button when plan exists but no list', async () => {
    fetchMostRecentPlan.mockResolvedValue({ plan: { id: 'plan-1' } })

    supabase.from.mockReturnValueOnce(
      listRowChain({ data: null, error: null })
    )

    render(<GroceryList userId="user-1" />)

    await waitFor(() =>
      expect(screen.getByText('No grocery list yet for this plan.')).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: 'Generate List' })).toBeInTheDocument()
  })

  // 3. Items grouped by section in GROCERY_SECTIONS order
  it('renders items grouped by section in canonical order', async () => {
    fetchMostRecentPlan.mockResolvedValue({ plan: { id: 'plan-1' } })

    const mockItems = [
      { id: 'i1', name: 'Chicken breast', quantity: '2 lbs',  section: 'Meat & Seafood' },
      { id: 'i2', name: 'Garlic',         quantity: '1 head', section: 'Produce' },
      { id: 'i3', name: 'Cheddar',        quantity: null,     section: 'Dairy' },
    ]

    supabase.from
      .mockReturnValueOnce(listRowChain({ data: { id: 'list-1', created_at: '2026-05-03' }, error: null }))
      .mockReturnValueOnce(itemRowsChain({ data: mockItems, error: null }))

    render(<GroceryList userId="user-1" />)

    await waitFor(() => expect(screen.getByText('Chicken breast')).toBeInTheDocument())

    expect(screen.getByText('Garlic')).toBeInTheDocument()
    expect(screen.getByText('Cheddar')).toBeInTheDocument()
    expect(screen.getByText('2 lbs')).toBeInTheDocument()
    expect(screen.getByText('1 head')).toBeInTheDocument()

    // Section headings present
    expect(screen.getByText('Produce')).toBeInTheDocument()
    expect(screen.getByText('Meat & Seafood')).toBeInTheDocument()
    expect(screen.getByText('Dairy')).toBeInTheDocument()

    // Canonical order: sections rendered in GROCERY_SECTIONS order, so
    // Produce (index 0) appears before Meat & Seafood (index 1) in the DOM.
    const sections = document.querySelectorAll('section')
    const sectionNames = Array.from(sections).map(s => s.querySelector('p')?.textContent)
    const produceIdx = sectionNames.indexOf('Produce')
    const meatIdx    = sectionNames.indexOf('Meat & Seafood')
    expect(produceIdx).toBeGreaterThanOrEqual(0)
    expect(meatIdx).toBeGreaterThanOrEqual(0)
    expect(produceIdx).toBeLessThan(meatIdx)

    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()
  })

  // 4. Sections with zero items do NOT render their headers
  it('does not render headers for sections with no items', async () => {
    fetchMostRecentPlan.mockResolvedValue({ plan: { id: 'plan-1' } })

    supabase.from
      .mockReturnValueOnce(listRowChain({ data: { id: 'list-1', created_at: '2026-05-03' }, error: null }))
      .mockReturnValueOnce(itemRowsChain({
        data: [{ id: 'i1', name: 'Eggs', quantity: '1 dozen', section: 'Dairy' }],
        error: null,
      }))

    render(<GroceryList userId="user-1" />)

    await waitFor(() => expect(screen.getByText('Eggs')).toBeInTheDocument())

    expect(screen.getByText('Dairy')).toBeInTheDocument()
    // All other section headers must be absent
    for (const s of ['Produce', 'Meat & Seafood', 'Pantry', 'Frozen', 'Bakery', 'Beverages', 'Other']) {
      expect(screen.queryByText(s)).not.toBeInTheDocument()
    }
  })

  // 5. Clicking Generate calls the API and persists the response
  it('clicking Generate calls the API and inserts returned items', async () => {
    fetchMostRecentPlan.mockResolvedValue({ plan: { id: 'plan-1' } })

    const mockPlanItems = [
      {
        name: 'Pasta',
        vault_id: 'v-1',
        vault: {
          name: 'Pasta Carbonara',
          ingredients_classified: [
            { name: 'spaghetti', essentiality: 'essential' },
            { name: 'eggs',      essentiality: 'essential' },
          ],
        },
      },
    ]

    const insertListMock = insertListChain({ data: { id: 'list-new' }, error: null })

    supabase.from
      // loadData → loadList: no existing list
      .mockReturnValueOnce(listRowChain({ data: null, error: null }))
      // handleGenerate: meal_plan_items join
      .mockReturnValueOnce(planItemsChain({ data: mockPlanItems, error: null }))
      // handleGenerate: upsert check — no existing list
      .mockReturnValueOnce(upsertCheckChain({ data: null, error: null }))
      // handleGenerate: insert new grocery_list
      .mockReturnValueOnce(insertListMock)
      // handleGenerate: delete old grocery_list_items
      .mockReturnValueOnce(deleteChain())
      // handleGenerate: insert new grocery_list_items
      .mockReturnValueOnce(insertItemsChain())
      // loadList (re-fetch): grocery_lists
      .mockReturnValueOnce(listRowChain({ data: { id: 'list-new', created_at: '2026-05-03' }, error: null }))
      // loadList (re-fetch): grocery_list_items
      .mockReturnValueOnce(itemRowsChain({
        data: [{ id: 'r1', name: 'spaghetti', quantity: '400g', section: 'Pantry' }],
        error: null,
      }))

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ name: 'spaghetti', quantity: '400g', section: 'Pantry' }],
      }),
    })

    render(<GroceryList userId="user-1" />)

    // Wait for the empty state
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Generate List' })).toBeInTheDocument()
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'Generate List' }))

    // API was called with the right payload
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const [url, opts] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/grocery-list')
    const body = JSON.parse(opts.body)
    expect(body.recipes[0].name).toBe('Pasta Carbonara')
    expect(body.recipes[0].ingredients).toContain('spaghetti')
    expect(body.pantryStaples).toEqual([])

    // Supabase insert was called for the new list row
    await waitFor(() => expect(insertListMock.insert).toHaveBeenCalled())

    // After generate, items appear in the DOM
    await waitFor(() => expect(screen.getByText('spaghetti')).toBeInTheDocument())
  })
})
