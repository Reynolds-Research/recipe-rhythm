import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import About from '../index'
import {
  SUBTITLE,
  WHY_THIS_EXISTS_BODY,
  THINGS_YOU_SHAPED,
  BUILT_WITH_BODY,
} from '../copy'

// ── Mocks required when rendering Preferences in test (c) ──────────────────
vi.mock('../../../lib/preferences', () => ({
  getPreferences: vi.fn(),
  upsertPreferences: vi.fn(),
}))
vi.mock('../../../lib/mealPlanItems', () => ({
  getActivePeriodItems: vi.fn(),
  deleteMealPlanItems: vi.fn(),
}))
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../../hooks/useHaptics', () => ({
  useHaptics: () => ({ trigger: vi.fn() }),
}))

import Preferences from '../../Preferences/index'
import { getPreferences } from '../../../lib/preferences'
import { getActivePeriodItems } from '../../../lib/mealPlanItems'

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
  vi.resetAllMocks()
  getPreferences.mockResolvedValue({ ...EMPTY_PREFS })
  getActivePeriodItems.mockResolvedValue([])
})

// ── About screen ────────────────────────────────────────────────────────────

describe('About', () => {
  it('renders the four section headings', () => {
    render(<About onBack={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /recipe rhythm/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /why this exists/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /things you shaped/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /built with/i })).toBeInTheDocument()
  })

  it('renders all placeholder constant values into the DOM', () => {
    render(<About onBack={vi.fn()} />)
    expect(screen.getByText(SUBTITLE)).toBeInTheDocument()
    // WHY_THIS_EXISTS_BODY and BUILT_WITH_BODY share the same placeholder text,
    // so both appear in the DOM — use getAllByText and assert count.
    expect(screen.getAllByText(WHY_THIS_EXISTS_BODY).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(BUILT_WITH_BODY).length).toBeGreaterThanOrEqual(1)
    THINGS_YOU_SHAPED.forEach(bullet => {
      expect(screen.getByText(bullet)).toBeInTheDocument()
    })
  })
})

// ── Preferences entry-point ─────────────────────────────────────────────────

describe('Preferences About entry-point', () => {
  it('renders the About list-item with correct aria-label', async () => {
    render(
      <Preferences userId={USER_ID} onOpenAbout={vi.fn()} />
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /about this app/i })).toBeInTheDocument()
    )
  })
})
