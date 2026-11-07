import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Settings: "Read N recipes from their links" (2026-11-06). Her recipes had
// links saved but guessed amounts; this reads every page once.
vi.mock('../../../lib/preferences', () => ({ getPreferences: vi.fn(), upsertPreferences: vi.fn() }))
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../../hooks/useHaptics', () => ({ useHaptics: () => ({ trigger: vi.fn() }) }))
vi.mock('../../../lib/recipeIngredients', () => ({
  loadMissingIngredients: vi.fn(async () => []),
  fillMissingIngredients: vi.fn(),
  loadLinkedGuesses: vi.fn(),
  readLinkedRecipes: vi.fn(),
}))

import Preferences from '../index'
import { getPreferences } from '../../../lib/preferences'
import { loadLinkedGuesses, readLinkedRecipes } from '../../../lib/recipeIngredients'

const PREFS = {
  dietary_restrictions: [], excluded_ingredients: [], excluded_cuisines: [],
  max_prep_time_minutes: null, adults: 2, children: 1, pantry_staples: [],
}
const LINKED = [{ name: 'One Pan Turkey Sweet Potato Skillet' }, { name: 'Cheese Tuna Orzo' }]

beforeEach(() => {
  vi.clearAllMocks()
  getPreferences.mockResolvedValue(PREFS)
})

describe('Settings: read recipes from their links', () => {
  it('names the linked recipes with guessed amounts and reads them in one tap', async () => {
    loadLinkedGuesses.mockResolvedValueOnce(LINKED).mockResolvedValueOnce([{ name: 'Cheese Tuna Orzo' }])
    readLinkedRecipes.mockImplementation(async (_sb, _u, { onProgress }) => {
      onProgress({ current: 1, total: 2 })
      return { read: ['One Pan Turkey Sweet Potato Skillet'], needScreenshots: [{ name: 'Cheese Tuna Orzo', reason: 'blocked' }], failed: [] }
    })
    render(<Preferences userId="u1" />)
    const section = await screen.findByRole('region', { name: 'Recipes to read from their links' })
    expect(section).toHaveTextContent('One Pan Turkey Sweet Potato Skillet, Cheese Tuna Orzo')

    await userEvent.click(screen.getByRole('button', { name: 'Read 2 recipes from their links' }))

    await waitFor(() => expect(readLinkedRecipes).toHaveBeenCalledTimes(1))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('✓ Read the real amounts for 1 recipe.')
    expect(status).toHaveTextContent('add screenshots in the Cookbook: Cheese Tuna Orzo.')
    expect(screen.getByRole('button', { name: 'Read 1 recipe from their links' })).toBeInTheDocument()
  })

  it('nothing linked with a guess: the section is not shown', async () => {
    loadLinkedGuesses.mockResolvedValue([])
    render(<Preferences userId="u1" />)
    await screen.findByRole('heading', { name: /dietary restrictions/i })
    await waitFor(() => expect(loadLinkedGuesses).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Recipes to read from their links' })).not.toBeInTheDocument()
  })
})
