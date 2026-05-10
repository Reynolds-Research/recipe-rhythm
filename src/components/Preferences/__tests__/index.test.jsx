import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock the data layer so we can drive getPreferences / upsertPreferences
// without any real Supabase client. The component imports the singleton
// supabase from src/lib/supabase, but mocked module functions ignore it.
vi.mock('../../../lib/preferences', () => ({
  getPreferences: vi.fn(),
  upsertPreferences: vi.fn(),
}))

// PRD-002 P0.12: post-upsert violator check helpers. Default each to a
// no-op success so the legacy P0.2 tests below still pass without an
// active period in scope.
vi.mock('../../../lib/mealPlanItems', () => ({
  getActivePeriodItems: vi.fn(),
  deleteMealPlanItems: vi.fn(),
}))

// Avoid pulling in the real supabase client (env-var-dependent) just to
// satisfy a side-effect import.
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))

// Capturable trigger so the haptics describe block below can assert on it.
const { mockTrigger } = vi.hoisted(() => ({ mockTrigger: vi.fn() }))
vi.mock('../../../hooks/useHaptics', () => ({
  useHaptics: () => ({ trigger: mockTrigger }),
}))

import Preferences from '../index'
import {
  getPreferences,
  upsertPreferences,
} from '../../../lib/preferences'
import {
  getActivePeriodItems,
  deleteMealPlanItems,
} from '../../../lib/mealPlanItems'

const USER_ID = '00000000-0000-4000-8000-000000000001'

const EMPTY_PREFS = {
  user_id: USER_ID,
  dietary_restrictions: [],
  excluded_ingredients: [],
  excluded_cuisines: [],
  max_prep_time_minutes: null,
  adults: 2,
  children: 0,
  pantry_staples: [],
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so any unconsumed mockResolvedValueOnce
  // queue from a prior test doesn't leak into this one. Then re-establish
  // each mock's default below.
  vi.resetAllMocks()
  // Default: getPreferences resolves with empty defaults.
  getPreferences.mockResolvedValue({ ...EMPTY_PREFS })
  // Default: upsertPreferences echoes the patch back, merged onto EMPTY_PREFS.
  upsertPreferences.mockImplementation(async (_userId, patch) => ({
    ...EMPTY_PREFS,
    ...patch,
  }))
  // P0.12: default no active-period items so the legacy P0.2 tests below
  // are unaffected by the new post-upsert check.
  getActivePeriodItems.mockResolvedValue([])
  deleteMealPlanItems.mockResolvedValue(0)
})

afterEach(() => {
  vi.useRealTimers()
})

async function renderAndLoad() {
  const utils = render(<Preferences userId={USER_ID} />)
  // Wait for getPreferences to resolve and the form to render.
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: /dietary restrictions/i })).toBeInTheDocument()
  })
  return utils
}

describe('Preferences page (PRD-002 P0.2)', () => {
  it('renders a loading state, then the five sections after getPreferences resolves', async () => {
    // Hold the promise so we can observe the loading state.
    let resolve
    getPreferences.mockReturnValueOnce(new Promise(r => { resolve = r }))

    render(<Preferences userId={USER_ID} />)

    expect(screen.getByText(/loading preferences/i)).toBeInTheDocument()

    await act(async () => {
      resolve({ ...EMPTY_PREFS })
    })

    // All five section headers are present.
    expect(await screen.findByRole('heading', { name: /dietary restrictions/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /excluded cuisines/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /excluded ingredients/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /max prep time/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /household size/i })).toBeInTheDocument()
  })

  it('toggling a dietary chip calls upsertPreferences with the updated array', async () => {
    const user = userEvent.setup()
    await renderAndLoad()

    await user.click(screen.getByRole('button', { name: 'Vegetarian' }))

    expect(upsertPreferences).toHaveBeenCalledTimes(1)
    expect(upsertPreferences).toHaveBeenCalledWith(
      USER_ID,
      { dietary_restrictions: ['vegetarian'] },
      expect.anything(),
    )

    // Local state reflects the toggle (chip is now pressed).
    expect(screen.getByRole('button', { name: 'Vegetarian' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('adding an ingredient via Enter calls upsertPreferences with the lowercased trimmed value appended', async () => {
    const user = userEvent.setup()
    await renderAndLoad()

    const input = screen.getByLabelText(/add excluded ingredient/i)
    await user.type(input, '  Cilantro  {Enter}')

    expect(upsertPreferences).toHaveBeenCalledTimes(1)
    expect(upsertPreferences).toHaveBeenCalledWith(
      USER_ID,
      { excluded_ingredients: ['cilantro'] },
      expect.anything(),
    )
  })

  it('removing an ingredient chip calls upsertPreferences with the array minus that ingredient', async () => {
    const user = userEvent.setup()
    getPreferences.mockResolvedValueOnce({
      ...EMPTY_PREFS,
      excluded_ingredients: ['cilantro', 'olives'],
    })

    await renderAndLoad()

    await user.click(screen.getByRole('button', { name: /remove cilantro/i }))

    expect(upsertPreferences).toHaveBeenCalledTimes(1)
    expect(upsertPreferences).toHaveBeenCalledWith(
      USER_ID,
      { excluded_ingredients: ['olives'] },
      expect.anything(),
    )
  })

  it('selecting "No limit" calls upsertPreferences with max_prep_time_minutes: null', async () => {
    const user = userEvent.setup()
    getPreferences.mockResolvedValueOnce({
      ...EMPTY_PREFS,
      max_prep_time_minutes: 60,
    })

    await renderAndLoad()

    await user.click(screen.getByRole('button', { name: 'No limit' }))

    expect(upsertPreferences).toHaveBeenCalledWith(
      USER_ID,
      { max_prep_time_minutes: null },
      expect.anything(),
    )
  })

  it('selecting "60 min" calls upsertPreferences with max_prep_time_minutes: 60', async () => {
    const user = userEvent.setup()
    await renderAndLoad()

    await user.click(screen.getByRole('button', { name: '60 min' }))

    expect(upsertPreferences).toHaveBeenCalledWith(
      USER_ID,
      { max_prep_time_minutes: 60 },
      expect.anything(),
    )
  })

  it('reverts local state and surfaces an inline error when upsertPreferences rejects', async () => {
    const user = userEvent.setup()
    upsertPreferences.mockRejectedValueOnce(new Error('boom'))

    await renderAndLoad()

    const chip = screen.getByRole('button', { name: 'Vegetarian' })
    await user.click(chip)

    // Inline error appears (no alert()) and state has reverted.
    expect(await screen.findByText(/couldn't save — try again/i)).toBeInTheDocument()
    expect(chip).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows a "Saved" indicator after a successful upsert and hides it after the timeout', async () => {
    const user = userEvent.setup()
    await renderAndLoad()

    await user.click(screen.getByRole('button', { name: 'Vegetarian' }))

    // Indicator appears once the upsert resolves.
    expect(await screen.findByText('Saved')).toBeInTheDocument()

    // …and disappears once the flash timeout elapses (component uses 1.5s).
    await waitFor(
      () => expect(screen.queryByText('Saved')).not.toBeInTheDocument(),
      { timeout: 3000 },
    )
  })

  it('blurring the adults input with a new value calls upsertPreferences with { adults: value }', async () => {
    const user = userEvent.setup()
    await renderAndLoad()

    const input = screen.getByLabelText(/number of adults/i)
    await user.clear(input)
    await user.type(input, '3')
    await user.tab()

    expect(upsertPreferences).toHaveBeenCalledTimes(1)
    expect(upsertPreferences).toHaveBeenCalledWith(
      USER_ID,
      { adults: 3 },
      expect.anything(),
    )
  })

  it('blurring the children input with a new value calls upsertPreferences with { children: value }', async () => {
    const user = userEvent.setup()
    await renderAndLoad()

    const input = screen.getByLabelText(/number of children/i)
    await user.clear(input)
    await user.type(input, '2')
    await user.tab()

    expect(upsertPreferences).toHaveBeenCalledTimes(1)
    expect(upsertPreferences).toHaveBeenCalledWith(
      USER_ID,
      { children: 2 },
      expect.anything(),
    )
  })

  it('adults input reverts to current value when invalid (0) is entered', async () => {
    const user = userEvent.setup()
    await renderAndLoad()

    const input = screen.getByLabelText(/number of adults/i)
    await user.clear(input)
    await user.type(input, '0')
    await user.tab()

    expect(upsertPreferences).not.toHaveBeenCalled()
    expect(input).toHaveValue(2)
  })

  it('adults input does not call upsertPreferences when the value is unchanged', async () => {
    const user = userEvent.setup()
    await renderAndLoad()

    const input = screen.getByLabelText(/number of adults/i)
    // blur without changing the value
    await user.click(input)
    await user.tab()

    expect(upsertPreferences).not.toHaveBeenCalled()
  })

  it('pantry staples section renders with existing chip when prefs include pantry_staples', async () => {
    getPreferences.mockResolvedValueOnce({
      ...EMPTY_PREFS,
      pantry_staples: ['olive oil'],
    })

    await renderAndLoad()

    expect(screen.getByRole('heading', { name: /pantry staples/i })).toBeInTheDocument()
    expect(screen.getByText('olive oil', { selector: '[role="listitem"]' })).toBeInTheDocument()
  })

  it('adding a pantry staple via Enter calls upsertPreferences with the new item appended', async () => {
    const user = userEvent.setup()
    getPreferences.mockResolvedValueOnce({
      ...EMPTY_PREFS,
      pantry_staples: ['olive oil'],
    })
    upsertPreferences.mockImplementation(async (_userId, patch) => ({
      ...EMPTY_PREFS,
      pantry_staples: ['olive oil'],
      ...patch,
    }))

    await renderAndLoad()

    const input = screen.getByLabelText(/add pantry staple/i)
    await user.type(input, 'salt{Enter}')

    expect(upsertPreferences).toHaveBeenCalledTimes(1)
    expect(upsertPreferences).toHaveBeenCalledWith(
      USER_ID,
      { pantry_staples: ['olive oil', 'salt'] },
      expect.anything(),
    )
  })

  it('removing a pantry staple chip calls upsertPreferences with the item removed', async () => {
    const user = userEvent.setup()
    getPreferences.mockResolvedValueOnce({
      ...EMPTY_PREFS,
      pantry_staples: ['olive oil', 'salt'],
    })
    upsertPreferences.mockImplementation(async (_userId, patch) => ({
      ...EMPTY_PREFS,
      ...patch,
    }))

    await renderAndLoad()

    await user.click(screen.getByRole('button', { name: /remove olive oil/i }))

    expect(upsertPreferences).toHaveBeenCalledTimes(1)
    expect(upsertPreferences).toHaveBeenCalledWith(
      USER_ID,
      { pantry_staples: ['salt'] },
      expect.anything(),
    )
  })
})

// ---------------------------------------------------------------------------
// PRD-002 P0.12 — preference-change violators banner
// ---------------------------------------------------------------------------

// One scheduled item that violates a vegetarian preference (chicken protein),
// one that doesn't (tofu).
const CHICKEN_TACOS = {
  id: 'mpi-chicken',
  name: 'Chicken Tacos',
  vault_id: 'v1',
  scheduled_date: '2026-04-27',
  is_shortlisted: false,
  cuisine_type: 'Mexican',
  prep_time_minutes: 30,
  proteins: ['Chicken'],
  vegetables: null,
  fruits: null,
  dairy_components: null,
  main_carb: 'Tortilla/Wrap',
  dietary_tags: null,
}
const TOFU_BOWL = {
  id: 'mpi-tofu',
  name: 'Tofu Bowl',
  vault_id: 'v2',
  scheduled_date: '2026-04-28',
  is_shortlisted: false,
  cuisine_type: 'Japanese',
  prep_time_minutes: 25,
  proteins: ['Tofu'],
  vegetables: null,
  fruits: null,
  dairy_components: null,
  main_carb: 'Rice',
  dietary_tags: ['Vegetarian'],
}

describe('Preferences page — violators banner (PRD-002 P0.12)', () => {
  it('does not run the violator check on initial mount', async () => {
    getActivePeriodItems.mockResolvedValueOnce([CHICKEN_TACOS])

    await renderAndLoad()

    expect(getActivePeriodItems).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('after a chip toggle, calls getActivePeriodItems and runs passesPreferences against the new prefs', async () => {
    const user = userEvent.setup()
    getActivePeriodItems.mockResolvedValueOnce([CHICKEN_TACOS, TOFU_BOWL])
    await renderAndLoad()

    await user.click(screen.getByRole('button', { name: 'Vegetarian' }))

    await waitFor(() =>
      expect(getActivePeriodItems).toHaveBeenCalledWith(USER_ID, expect.anything()),
    )
    // Chicken violates vegetarian → banner shows it; tofu doesn't.
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/Chicken Tacos/)
    expect(screen.getByRole('alert')).not.toHaveTextContent(/Tofu Bowl/)
  })

  it('renders the banner with the violator count and names when at least one item violates', async () => {
    const user = userEvent.setup()
    getActivePeriodItems.mockResolvedValueOnce([CHICKEN_TACOS])
    await renderAndLoad()

    await user.click(screen.getByRole('button', { name: 'Vegetarian' }))

    const banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent(/^1 meal/)
    expect(banner).toHaveTextContent(/Chicken Tacos/)
  })

  it('does NOT render the banner when no active-period items violate, and clears any previous banner', async () => {
    const user = userEvent.setup()
    // First upsert produces a violator and shows the banner…
    getActivePeriodItems.mockResolvedValueOnce([CHICKEN_TACOS])
    await renderAndLoad()
    await user.click(screen.getByRole('button', { name: 'Vegetarian' }))
    await screen.findByRole('alert')

    // …second upsert returns only a vegetarian-safe item → banner clears.
    getActivePeriodItems.mockResolvedValueOnce([TOFU_BOWL])
    await user.click(screen.getByRole('button', { name: /^Mexican$/ }))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('"Keep" dismisses the banner without calling deleteMealPlanItems', async () => {
    const user = userEvent.setup()
    getActivePeriodItems.mockResolvedValueOnce([CHICKEN_TACOS])
    await renderAndLoad()
    await user.click(screen.getByRole('button', { name: 'Vegetarian' }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /keep these meals/i }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(deleteMealPlanItems).not.toHaveBeenCalled()
  })

  it('"Remove all" calls deleteMealPlanItems with the violator id list and clears the banner', async () => {
    const user = userEvent.setup()
    getActivePeriodItems.mockResolvedValueOnce([CHICKEN_TACOS, TOFU_BOWL])
    await renderAndLoad()
    await user.click(screen.getByRole('button', { name: 'Vegetarian' }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /remove all/i }))

    await waitFor(() =>
      expect(deleteMealPlanItems).toHaveBeenCalledWith(
        ['mpi-chicken'],
        expect.anything(),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('two consecutive upserts with different violator sets: banner reflects the latest set', async () => {
    const user = userEvent.setup()

    // First upsert: vegetarian → CHICKEN_TACOS violates.
    getActivePeriodItems.mockResolvedValueOnce([CHICKEN_TACOS, TOFU_BOWL])
    await renderAndLoad()
    await user.click(screen.getByRole('button', { name: 'Vegetarian' }))
    let banner = await screen.findByRole('alert')
    expect(banner).toHaveTextContent(/Chicken Tacos/)
    expect(banner).not.toHaveTextContent(/Tofu Bowl/)

    // Second upsert: also exclude Japanese cuisine → TOFU_BOWL now violates,
    // CHICKEN_TACOS still violates the vegetarian rule. We assert the banner
    // reflects ONLY the second-call result, not a stacked union.
    getActivePeriodItems.mockResolvedValueOnce([TOFU_BOWL])
    await user.click(screen.getByRole('button', { name: /^Japanese$/ }))

    await waitFor(() => {
      const next = screen.getByRole('alert')
      expect(next).toHaveTextContent(/Tofu Bowl/)
      expect(next).not.toHaveTextContent(/Chicken Tacos/)
    })
  })

  it('on getActivePeriodItems error, the existing banner state is preserved and the upsert flow still completes', async () => {
    const user = userEvent.setup()

    // Establish an initial banner via a successful first upsert.
    getActivePeriodItems.mockResolvedValueOnce([CHICKEN_TACOS])
    await renderAndLoad()
    await user.click(screen.getByRole('button', { name: 'Vegetarian' }))
    await screen.findByRole('alert')

    // Second upsert: getActivePeriodItems throws — banner should remain;
    // the chip toggle should still register and the "Saved" flash appear.
    getActivePeriodItems.mockRejectedValueOnce(new Error('network down'))
    await user.click(screen.getByRole('button', { name: /^Mexican$/ }))

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/Chicken Tacos/)
  })
})

// ---------------------------------------------------------------------------
// Haptic feedback — Preferences surface
// ---------------------------------------------------------------------------
describe('Preferences — haptic feedback', () => {
  beforeEach(() => {
    mockTrigger.mockReset()
    getPreferences.mockResolvedValue({ ...EMPTY_PREFS })
    upsertPreferences.mockImplementation(async (_userId, patch) => ({
      ...EMPTY_PREFS,
      ...patch,
    }))
    getActivePeriodItems.mockResolvedValue([])
    deleteMealPlanItems.mockResolvedValue(0)
  })

  it('fires the haptic trigger when a dietary chip is toggled', async () => {
    const user = userEvent.setup()
    render(<Preferences userId={USER_ID} />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /dietary restrictions/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Vegetarian' }))

    expect(mockTrigger).toHaveBeenCalled()
  })
})
