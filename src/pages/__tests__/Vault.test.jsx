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
    const mockSelect = vi.fn().mockResolvedValue({ data: [], error: null })
    supabase.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ order: mockSelect }) })
    }))

    render(<Vault userId="test-user" />)
    expect(screen.getByText('Loading vault…')).toBeInTheDocument()
  })

  it('renders recipes once loaded', async () => {
    const mockData = [
      { id: '1', name: 'Test Recipe 1', cuisine_type: 'American', created_at: new Date().toISOString() }
    ]
    const mockSelect = vi.fn().mockResolvedValue({ data: mockData, error: null })
    supabase.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ order: mockSelect }) })
    }))

    render(<Vault userId="test-user" />)

    await waitFor(() => {
      expect(screen.queryByText('Loading vault…')).not.toBeInTheDocument()
    })

    expect(screen.getByText('Test Recipe 1')).toBeInTheDocument()
  })
})

// PRD-001 P1.1 — Family rating
//
// Helper that builds a `from()` mock supporting BOTH the initial fetch chain
// (`select(...).eq(...).order(...)`) and the rating-update chain
// (`update(...).eq(...).eq(...)`). Tests pass `recipes` for the initial state
// and `onUpdate` to capture the payload sent to Supabase on rating changes.
function buildVaultFromMock({ recipes = [], onUpdate = () => {} } = {}) {
  return () => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => Promise.resolve({ data: recipes, error: null })),
        ilike: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      })),
    })),
    update: vi.fn((payload) => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => {
          onUpdate(payload)
          return Promise.resolve({ error: null })
        }),
      })),
    })),
    insert: vi.fn(() => Promise.resolve({ error: null })),
    delete: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
    })),
  })
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
            order: () => Promise.resolve({ data: [], error: null }),
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
    supabase.from.mockImplementation(
      buildVaultFromMock({ recipes, onUpdate: (p) => { capturedPayload = p } })
    )

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
    supabase.from.mockImplementation(
      buildVaultFromMock({ recipes, onUpdate: (p) => { capturedPayload = p } })
    )

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
    supabase.from.mockImplementation(buildVaultFromMock({ recipes }))

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
