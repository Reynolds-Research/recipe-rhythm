import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Vault from '../Vault'
import { supabase } from '../../lib/supabase'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ error: null }),
      delete: vi.fn().mockReturnThis(),
      then: vi.fn(),
    })),
  }
}))

describe('Vault Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state initially', () => {
    // PRD-001 P0.5: fetchRecipes chain is now .eq().is().order(). Mock
    // mirrors that shape.
    const mockOrder = vi.fn().mockResolvedValue({ data: [], error: null })
    supabase.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ is: () => ({ order: mockOrder }) }) }),
    }))

    render(<Vault userId="test-user" />)
    expect(screen.getByText('Loading vault…')).toBeInTheDocument()
  })

  it('renders recipes once loaded', async () => {
    const mockData = [
      { id: '1', name: 'Test Recipe 1', cuisine_type: 'American', created_at: new Date().toISOString() }
    ]
    const mockOrder = vi.fn().mockResolvedValue({ data: mockData, error: null })
    supabase.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ is: () => ({ order: mockOrder }) }) }),
    }))

    render(<Vault userId="test-user" />)

    await waitFor(() => {
      expect(screen.queryByText('Loading vault…')).not.toBeInTheDocument()
    })

    expect(screen.getByText('Test Recipe 1')).toBeInTheDocument()
  })
})

// Helper that builds a `from()` mock supporting:
//   - the fetchRecipes chain: .select().eq().is().order() — PRD-001 P0.5
//     added the .is('deleted_at', null) link
//   - the handleAdd duplicate-check chain: .select('id').eq().is().ilike().limit()
//   - the rating-update chain: .update().eq().eq()           — PRD-001 P1.1
//   - the soft-delete chain:  .update().eq().eq()            — PRD-001 P0.5
//   - the legacy (pre-P0.5) hard-delete chain: .delete().eq().eq()
//     (kept reachable so a test can assert it's NOT called)
//
// Returns the `from` impl plus spies so tests can assert specific calls.
//   - isSpy:      records every .is() call across all chains for filter-asserts
//   - updateSpy:  the .update(payload) entry-point spy
//   - deleteSpy:  the .delete() entry-point spy (must remain uncalled post-P0.5)
function buildVaultFromMock({ recipes = [], duplicateRows = [], onUpdate = () => {}, onDelete = () => {} } = {}) {
  const orderResolved     = Promise.resolve({ data: recipes, error: null })
  const limitResolved     = Promise.resolve({ data: duplicateRows, error: null })

  // .is() returns a chain object that exposes both .order (fetchRecipes path)
  // and .ilike(...).limit(...) (handleAdd duplicate-check path).
  const isSpy = vi.fn(() => ({
    order: vi.fn(() => orderResolved),
    ilike: vi.fn(() => ({ limit: vi.fn(() => limitResolved) })),
  }))

  const updateSpy = vi.fn((payload) => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => {
        onUpdate(payload)
        return Promise.resolve({ error: null })
      }),
    })),
  }))

  const deleteSpy = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => {
        onDelete()
        return Promise.resolve({ error: null })
      }),
    })),
  }))

  const fromImpl = () => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ is: isSpy })),
    })),
    update: updateSpy,
    insert: vi.fn(() => Promise.resolve({ error: null })),
    delete: deleteSpy,
  })

  return { fromImpl, isSpy, updateSpy, deleteSpy }
}

describe('Vault — PRD-001 P1.1 family rating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('SELECTs family_rating from the vault table', async () => {
    // Capture the column-list string the component passes to .select().
    let capturedSelect = null
    supabase.from.mockImplementation(() => ({
      select: (cols) => {
        capturedSelect = cols
        return {
          eq: () => ({
            // PRD-001 P0.5 added .is('deleted_at', null) to the chain.
            is: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }
      },
    }))

    render(<Vault userId="test-user" />)

    await waitFor(() => {
      expect(capturedSelect).not.toBeNull()
    })
    expect(capturedSelect).toMatch(/family_rating/)
  })

  it('writes the new rating when an unfilled star is tapped', async () => {
    let capturedPayload = null
    const recipes = [{
      id: 'recipe-1',
      name: 'Tacos',
      cuisine_type: 'Mexican',
      family_rating: null,
      created_at: new Date().toISOString(),
    }]
    const { fromImpl } = buildVaultFromMock({
      recipes,
      onUpdate: (p) => { capturedPayload = p },
    })
    supabase.from.mockImplementation(fromImpl)

    const user = userEvent.setup()
    render(<Vault userId="test-user" />)

    // Wait for the recipe to render so the stars exist on the collapsed row.
    await waitFor(() => expect(screen.getByText('Tacos')).toBeInTheDocument())

    // Tap the 4-star button on the collapsed row.
    const fourStarButtons = screen.getAllByRole('radio', { name: /^4 stars$/i })
    expect(fourStarButtons.length).toBeGreaterThan(0)
    await user.click(fourStarButtons[0])

    await waitFor(() => {
      expect(capturedPayload).toEqual({ family_rating: 4 })
    })
  })

  it('clears the rating to NULL when the currently-selected star is tapped again', async () => {
    let capturedPayload = null
    const recipes = [{
      id: 'recipe-2',
      name: 'Pho',
      cuisine_type: 'Vietnamese',
      family_rating: 3,
      created_at: new Date().toISOString(),
    }]
    const { fromImpl } = buildVaultFromMock({
      recipes,
      onUpdate: (p) => { capturedPayload = p },
    })
    supabase.from.mockImplementation(fromImpl)

    const user = userEvent.setup()
    render(<Vault userId="test-user" />)

    await waitFor(() => expect(screen.getByText('Pho')).toBeInTheDocument())

    // Tap the 3-star button (the currently-rated star) — should clear to NULL.
    const threeStarButtons = screen.getAllByRole('radio', { name: /^3 stars$/i })
    await user.click(threeStarButtons[0])

    await waitFor(() => {
      expect(capturedPayload).toEqual({ family_rating: null })
    })
  })

  it('does not collapse the recipe card when a star is tapped', async () => {
    // The collapsed card has an onClick that toggles expand/collapse. The
    // StarRating must stop propagation so a star-tap doesn't accidentally
    // open the editor. We verify by checking that ComponentRow content
    // (which only appears when the card is expanded) is NOT in the DOM
    // after a star tap.
    const recipes = [{
      id: 'recipe-3',
      name: 'Ramen',
      family_rating: null,
      proteins: ['Pork'],
      created_at: new Date().toISOString(),
    }]
    const { fromImpl } = buildVaultFromMock({ recipes })
    supabase.from.mockImplementation(fromImpl)

    const user = userEvent.setup()
    render(<Vault userId="test-user" />)
    await waitFor(() => expect(screen.getByText('Ramen')).toBeInTheDocument())

    // Initially, no expanded "Carb"/"Method" detail row labels are visible.
    expect(screen.queryByText('Carb')).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('radio', { name: /^2 stars$/i })[0])

    // After tapping a star, the card should still be collapsed (no detail
    // labels). The card's onClick handler must not have fired.
    expect(screen.queryByText('Carb')).not.toBeInTheDocument()
  })
})

describe('Vault — PRD-001 P0.5 soft-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetchRecipes filters .is(deleted_at, null) so deleted recipes are hidden', async () => {
    const recipes = [{
      id: 'recipe-active',
      name: 'Carbonara',
      family_rating: null,
      created_at: new Date().toISOString(),
    }]
    const { fromImpl, isSpy } = buildVaultFromMock({ recipes })
    supabase.from.mockImplementation(fromImpl)

    render(<Vault userId="test-user" />)

    await waitFor(() => expect(screen.getByText('Carbonara')).toBeInTheDocument())

    // The fetchRecipes chain went through .is('deleted_at', null).
    expect(isSpy).toHaveBeenCalledWith('deleted_at', null)
  })

  it('handleDelete writes UPDATE deleted_at = <ISO timestamp> and never issues a DELETE', async () => {
    let capturedPayload = null
    const recipes = [{
      id: 'recipe-victim',
      name: 'Old Soup',
      family_rating: null,
      created_at: new Date().toISOString(),
    }]
    const { fromImpl, updateSpy, deleteSpy } = buildVaultFromMock({
      recipes,
      onUpdate: (p) => { capturedPayload = p },
    })
    supabase.from.mockImplementation(fromImpl)

    const user = userEvent.setup()
    render(<Vault userId="test-user" />)
    await waitFor(() => expect(screen.getByText('Old Soup')).toBeInTheDocument())

    // The "Remove" button is in the expanded card. Click the recipe row to
    // expand. We click the recipe NAME (not the star buttons, which stop
    // propagation).
    await user.click(screen.getByText('Old Soup'))

    const removeButton = await screen.findByRole('button', { name: /Remove/i })
    await user.click(removeButton)

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalled()
      expect(capturedPayload).toMatchObject({ deleted_at: expect.any(String) })
    })

    // The legacy hard-delete chain must not have been entered.
    expect(deleteSpy).not.toHaveBeenCalled()

    // The deleted_at value should parse as a real Date.
    expect(Number.isFinite(new Date(capturedPayload.deleted_at).getTime())).toBe(true)
  })

  it('handleAdd duplicate-check filters .is(deleted_at, null) so a soft-deleted name is re-addable', async () => {
    // We simulate the duplicate-check returning EMPTY (because the only
    // existing "Tacos" is soft-deleted and the .is filter excludes it).
    // Verifying that the chain went through .is('deleted_at', null) is
    // enough — the rest of the add path is covered by other tests.
    const { fromImpl, isSpy } = buildVaultFromMock({
      recipes: [],
      duplicateRows: [],   // duplicate-check returns no active matches
    })
    supabase.from.mockImplementation(fromImpl)

    const user = userEvent.setup()
    render(<Vault userId="test-user" />)

    // Wait for the initial fetchRecipes call to resolve so we can isolate
    // any subsequent .is() calls to the handleAdd duplicate-check path.
    await waitFor(() => expect(isSpy).toHaveBeenCalledWith('deleted_at', null))
    isSpy.mockClear()

    // Open the add form and submit a name. The handler runs the duplicate
    // check via .from('vault').select('id').eq().is().ilike().limit().
    const openAddBtn = screen.getByRole('button', { name: /Add a new recipe/i })
    await user.click(openAddBtn)

    const nameInput = screen.getByPlaceholderText(/recipe name/i)
    await user.type(nameInput, 'Tacos')

    const saveButton = screen.getByRole('button', { name: /Save to vault/i })
    await user.click(saveButton)

    // The duplicate-check chain went through .is('deleted_at', null).
    await waitFor(() => {
      expect(isSpy).toHaveBeenCalledWith('deleted_at', null)
    })
  })
})
