import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import About from '../index'
import { SUBTITLE, LETTER_HEADING, LETTER_BODY } from '../copy'

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
  it('renders the app title and letter heading', () => {
    render(<About onBack={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /recipe rhythm/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: new RegExp(LETTER_HEADING, 'i') })).toBeInTheDocument()
  })

  it('renders the subtitle and all letter body paragraphs', () => {
    render(<About onBack={vi.fn()} />)
    expect(screen.getByText(SUBTITLE)).toBeInTheDocument()
    LETTER_BODY.forEach(paragraph => {
      expect(screen.getByText(paragraph)).toBeInTheDocument()
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
