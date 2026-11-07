import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// PRD-008 2c: the "meals that break a new rule" check reads planned_meals
// (uncooked, from today on); Maybes and past meals are never named.
vi.mock('../../../lib/preferences', () => ({ getPreferences: vi.fn(), upsertPreferences: vi.fn() }))
vi.mock('../../../lib/plannedMeals', () => ({ loadUpcomingMeals: vi.fn(), removeMeals: vi.fn() }))
vi.mock('../../../lib/recipeIngredients', () => ({
  loadMissingIngredients: vi.fn(async () => []),
  fillMissingIngredients: vi.fn(),
  loadLinkedGuesses: vi.fn(async () => []),
  readLinkedRecipes: vi.fn(),
}))
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../../hooks/useHaptics', () => ({ useHaptics: () => ({ trigger: vi.fn() }) }))

import Preferences from '../index'
import { getPreferences, upsertPreferences } from '../../../lib/preferences'
import { loadUpcomingMeals, removeMeals } from '../../../lib/plannedMeals'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const PREFS = {
  user_id: USER_ID, dietary_restrictions: [], excluded_ingredients: [], excluded_cuisines: [],
  max_prep_time_minutes: null, adults: 2, children: 0, pantry_staples: [],
}
const tags = { cuisine_type: null, prep_time_minutes: null, vegetables: null, fruits: null, dairy_components: null, dietary_tags: null }
const PORK = { id: 'pm-pork', name: 'Scallion Meatballs', vault_id: 'v1', planned_on: '2026-11-11', ...tags, proteins: ['Pork'], main_carb: null }
const SQUASH = { id: 'pm-squash', name: 'Butternut Squash Mac n Cheese', vault_id: 'v2', planned_on: '2026-11-09', ...tags, proteins: null, dietary_tags: ['Vegetarian'], main_carb: 'Pasta' }

beforeEach(() => {
  vi.resetAllMocks()
  getPreferences.mockResolvedValue({ ...PREFS })
  upsertPreferences.mockImplementation(async (_u, patch) => ({ ...PREFS, ...patch }))
  loadUpcomingMeals.mockResolvedValue([])
  removeMeals.mockResolvedValue(undefined)
})

async function renderAndToggleVegetarian() {
  const user = userEvent.setup()
  render(<Preferences userId={USER_ID} />)
  await screen.findByRole('heading', { name: /dietary restrictions/i })
  await user.click(screen.getByRole('button', { name: 'Vegetarian' }))
  return user
}

describe('Preferences: meals that break a new rule', () => {
  it('checks upcoming planned meals', async () => {
    loadUpcomingMeals.mockResolvedValueOnce([PORK, SQUASH])
    await renderAndToggleVegetarian()

    await waitFor(() => expect(loadUpcomingMeals).toHaveBeenCalledWith(expect.anything(), USER_ID))
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent(/Scallion Meatballs/)
    expect(banner).not.toHaveTextContent(/Butternut/)
  })

  it('"Remove" deletes those planned meals', async () => {
    loadUpcomingMeals.mockResolvedValueOnce([PORK, SQUASH])
    const user = await renderAndToggleVegetarian()
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /remove these meals from the plan/i }))

    await waitFor(() => expect(removeMeals).toHaveBeenCalledWith(expect.anything(), ['pm-pork']))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('"Keep" leaves the plan alone', async () => {
    loadUpcomingMeals.mockResolvedValueOnce([PORK])
    const user = await renderAndToggleVegetarian()
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /keep these planned meals/i }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(removeMeals).not.toHaveBeenCalled()
  })
})
