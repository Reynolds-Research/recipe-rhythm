import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Settings: "Recipes with no ingredient list" → fill them in with estimates.
// Replaced the old "re-extract every recipe" button, which also rewrote
// recipes that were fine. The lib is tested in recipeIngredients.test.js.
vi.mock('../../../lib/preferences', () => ({ getPreferences: vi.fn(), upsertPreferences: vi.fn() }))
vi.mock('../../../lib/mealPlanItems', () => ({ getActivePeriodItems: vi.fn(), deleteMealPlanItems: vi.fn() }))
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../../hooks/useHaptics', () => ({ useHaptics: () => ({ trigger: vi.fn() }) }))
vi.mock('../../../lib/recipeIngredients', () => ({
  loadMissingIngredients: vi.fn(),
  fillMissingIngredients: vi.fn(),
}))

import Preferences from '../index'
import { getPreferences } from '../../../lib/preferences'
import { fillMissingIngredients, loadMissingIngredients } from '../../../lib/recipeIngredients'

const PREFS = {
  dietary_restrictions: [], excluded_ingredients: [], excluded_cuisines: [],
  max_prep_time_minutes: null, adults: 2, children: 1, pantry_staples: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  getPreferences.mockResolvedValue(PREFS)
})

describe('Settings: recipes with no ingredient list', () => {
  it('names them and fills them in on one tap, then shows what is left', async () => {
    loadMissingIngredients
      .mockResolvedValueOnce([{ name: 'Penne alla Vodka' }, { name: 'Corn and Bean Salad' }])
      .mockResolvedValueOnce([])
    fillMissingIngredients.mockImplementation(async (_sb, _u, { onProgress }) => {
      onProgress({ current: 1, total: 2 })
      return { filled: ['Penne alla Vodka', 'Corn and Bean Salad'], failed: [] }
    })
    render(<Preferences userId="u1" />)
    expect(await screen.findByText(/The grocery list can’t include these: Penne alla Vodka, Corn and Bean Salad\./))
      .toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Fill in 2 recipes/ }))
    expect(fillMissingIngredients).toHaveBeenCalledWith({}, 'u1', expect.any(Object))
    expect(await screen.findByRole('status')).toHaveTextContent('✓ Filled in 2 recipes.')
    expect(screen.queryByRole('button', { name: /Fill in/ })).not.toBeInTheDocument()
  })

  it('some fail: says so, and the button stays for the ones left', async () => {
    loadMissingIngredients
      .mockResolvedValueOnce([{ name: 'A' }, { name: 'B' }])
      .mockResolvedValueOnce([{ name: 'B' }])
    fillMissingIngredients.mockResolvedValue({ filled: ['A'], failed: ['B'] })
    render(<Preferences userId="u1" />)
    await userEvent.click(await screen.findByRole('button', { name: /Fill in 2 recipes/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('✓ Filled in 1 recipe. Some couldn’t be filled; try again later.')
    expect(screen.getByRole('button', { name: 'Fill in 1 recipe' })).toBeInTheDocument()
  })

  it('every recipe has a list: the section is hidden, and the old re-extract-all button is gone', async () => {
    loadMissingIngredients.mockResolvedValue([])
    render(<Preferences userId="u1" />)
    await waitFor(() => expect(loadMissingIngredients).toHaveBeenCalled())
    await screen.findByRole('heading', { name: /dietary restrictions/i })
    expect(screen.queryByText('Recipes with no ingredient list')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Re-extract/ })).not.toBeInTheDocument()
  })
})
