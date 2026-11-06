import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// PRD-008 2c: with the new Prep Table on (VITE_NEW_PREP_TABLE=true), the
// "meals that break a new rule" check reads planned_meals, not the old plan.
vi.mock('../../../lib/preferences', () => ({ getPreferences: vi.fn(), upsertPreferences: vi.fn() }))
vi.mock('../../../lib/mealPlanItems', () => ({ getActivePeriodItems: vi.fn(), deleteMealPlanItems: vi.fn() }))
vi.mock('../../../lib/plannedMeals', () => ({ loadUpcomingMeals: vi.fn(), removeMeals: vi.fn() }))
vi.mock('../../../lib/recipeIngredients', () => ({
  loadMissingIngredients: vi.fn(async () => []),
  fillMissingIngredients: vi.fn(),
}))
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../../hooks/useHaptics', () => ({ useHaptics: () => ({ trigger: vi.fn() }) }))

import Preferences from '../index'
import { getPreferences, upsertPreferences } from '../../../lib/preferences'
import { getActivePeriodItems, deleteMealPlanItems } from '../../../lib/mealPlanItems'
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
  vi.stubEnv('VITE_NEW_PREP_TABLE', 'true')
  getPreferences.mockResolvedValue({ ...PREFS })
  upsertPreferences.mockImplementation(async (_u, patch) => ({ ...PREFS, ...patch }))
  loadUpcomingMeals.mockResolvedValue([])
  removeMeals.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())

async function renderAndToggleVegetarian() {
  const user = userEvent.setup()
  render(<Preferences userId={USER_ID} />)
  await screen.findByRole('heading', { name: /dietary restrictions/i })
  await user.click(screen.getByRole('button', { name: 'Vegetarian' }))
  return user
}

describe('Preferences with the new Prep Table on', () => {
  it('checks upcoming planned meals, never the old plan', async () => {
    loadUpcomingMeals.mockResolvedValueOnce([PORK, SQUASH])
    await renderAndToggleVegetarian()

    await waitFor(() => expect(loadUpcomingMeals).toHaveBeenCalledWith(expect.anything(), USER_ID))
    expect(getActivePeriodItems).not.toHaveBeenCalled()
    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent(/Scallion Meatballs/)
    expect(banner).not.toHaveTextContent(/Butternut/)
  })

  it('"Remove" deletes those planned meals and nothing in the old tables', async () => {
    loadUpcomingMeals.mockResolvedValueOnce([PORK, SQUASH])
    const user = await renderAndToggleVegetarian()
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /remove these meals from the plan/i }))

    await waitFor(() => expect(removeMeals).toHaveBeenCalledWith(expect.anything(), ['pm-pork']))
    expect(deleteMealPlanItems).not.toHaveBeenCalled()
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

  it('switch off: the old active-period check runs, as before', async () => {
    vi.stubEnv('VITE_NEW_PREP_TABLE', '')
    getActivePeriodItems.mockResolvedValue([])
    await renderAndToggleVegetarian()
    await waitFor(() => expect(getActivePeriodItems).toHaveBeenCalled())
    expect(loadUpcomingMeals).not.toHaveBeenCalled()
  })
})
