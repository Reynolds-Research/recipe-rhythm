import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import SharedGroceryList from '../SharedGroceryList'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))
import { supabase } from '../../lib/supabase'

function renderWithToken(token) {
  return render(
    <MemoryRouter initialEntries={[`/share/grocery/${token}`]}>
      <Routes>
        <Route path="/share/grocery/:token" element={<SharedGroceryList />} />
      </Routes>
    </MemoryRouter>
  )
}

function listLookupChain(result) {
  return {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
}

function itemsLookupChain(result) {
  return {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    order:  vi.fn().mockResolvedValue(result),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('SharedGroceryList — public read-only view (PRD-003 P0.9)', () => {
  it('renders the section-grouped list when the token resolves', async () => {
    supabase.from
      .mockReturnValueOnce(listLookupChain({ data: { id: 'list-1' }, error: null }))
      .mockReturnValueOnce(itemsLookupChain({
        data: [
          { id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' },
          { id: 'i-2', name: 'Milk',    quantity: null, section: 'Other' },
        ],
        error: null,
      }))

    renderWithToken('valid-token')

    await waitFor(() => screen.getByText('Carrots'))
    expect(screen.getByText('Milk')).toBeInTheDocument()
    expect(screen.getByText('Produce')).toBeInTheDocument()
    expect(screen.getByText('Other')).toBeInTheDocument()
  })

  it('shows the "list closed" state when the token returns no rows', async () => {
    supabase.from.mockReturnValueOnce(
      listLookupChain({ data: null, error: null })
    )
    renderWithToken('revoked-token')

    await waitFor(() =>
      expect(screen.getByText(/no longer being shared/i)).toBeInTheDocument()
    )
  })

  it('shows the "list closed" state when the lookup errors', async () => {
    supabase.from.mockReturnValueOnce(
      listLookupChain({ data: null, error: { message: 'rls denied' } })
    )
    renderWithToken('bad-token')

    await waitFor(() =>
      expect(screen.getByText(/no longer being shared/i)).toBeInTheDocument()
    )
  })

  it('shows the empty state when the list resolves but has zero items', async () => {
    supabase.from
      .mockReturnValueOnce(listLookupChain({ data: { id: 'list-1' }, error: null }))
      .mockReturnValueOnce(itemsLookupChain({ data: [], error: null }))

    renderWithToken('empty-list-token')

    await waitFor(() =>
      expect(screen.getByText(/this list is empty/i)).toBeInTheDocument()
    )
  })

  it('tapping an item toggles its strikethrough and persists to localStorage', async () => {
    supabase.from
      .mockReturnValueOnce(listLookupChain({ data: { id: 'list-1' }, error: null }))
      .mockReturnValueOnce(itemsLookupChain({
        data: [{ id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' }],
        error: null,
      }))

    renderWithToken('check-token')

    const button = await screen.findByRole('button', { name: /Carrots/ })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    await userEvent.setup().click(button)
    expect(button).toHaveAttribute('aria-pressed', 'true')

    const stored = JSON.parse(
      localStorage.getItem('recipe-rhythm:share-checked:check-token') ?? '[]'
    )
    expect(stored).toEqual(['i-1'])
  })

  it('reads existing localStorage state on mount (checks survive a reload)', async () => {
    localStorage.setItem(
      'recipe-rhythm:share-checked:reload-token',
      JSON.stringify(['i-1'])
    )
    supabase.from
      .mockReturnValueOnce(listLookupChain({ data: { id: 'list-1' }, error: null }))
      .mockReturnValueOnce(itemsLookupChain({
        data: [{ id: 'i-1', name: 'Carrots', quantity: '2', section: 'Produce' }],
        error: null,
      }))

    renderWithToken('reload-token')

    const button = await screen.findByRole('button', { name: /Carrots/ })
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })
})
