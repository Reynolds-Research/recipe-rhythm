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

// Avoid pulling in the real supabase client (env-var-dependent) just to
// satisfy a side-effect import.
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))

// Quiet the haptics import — jsdom has no navigator.vibrate.
vi.mock('../../../hooks/useHaptics', () => ({
  useHaptics: () => ({ trigger: vi.fn() }),
}))

import Preferences from '../index'
import {
  getPreferences,
  upsertPreferences,
} from '../../../lib/preferences'

const USER_ID = '00000000-0000-4000-8000-000000000001'

const EMPTY_PREFS = {
  user_id: USER_ID,
  dietary_restrictions: [],
  excluded_ingredients: [],
  excluded_cuisines: [],
  max_prep_time_minutes: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: getPreferences resolves with empty defaults.
  getPreferences.mockResolvedValue({ ...EMPTY_PREFS })
  // Default: upsertPreferences echoes the patch back, merged onto EMPTY_PREFS.
  upsertPreferences.mockImplementation(async (_userId, patch) => ({
    ...EMPTY_PREFS,
    ...patch,
  }))
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
  it('renders a loading state, then the four sections after getPreferences resolves', async () => {
    // Hold the promise so we can observe the loading state.
    let resolve
    getPreferences.mockReturnValueOnce(new Promise(r => { resolve = r }))

    render(<Preferences userId={USER_ID} />)

    expect(screen.getByText(/loading preferences/i)).toBeInTheDocument()

    await act(async () => {
      resolve({ ...EMPTY_PREFS })
    })

    // All four section headers are present.
    expect(await screen.findByRole('heading', { name: /dietary restrictions/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /excluded cuisines/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /excluded ingredients/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /max prep time/i })).toBeInTheDocument()
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
})
