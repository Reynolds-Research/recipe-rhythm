import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import DayPicker from '../DayPicker'

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

vi.mock('../../../lib/recommendations', () => ({
  getRecommendations: vi.fn(),
}))

vi.mock('../../../lib/mealPlanWriter', () => ({
  addScheduledItem: vi.fn(),
  addShortlistItem: vi.fn(),
  scheduleShortlistItem: vi.fn(),
}))

import { getRecommendations } from '../../../lib/recommendations'
import {
  addScheduledItem,
  addShortlistItem,
  scheduleShortlistItem,
} from '../../../lib/mealPlanWriter'

const DATE = '2026-04-22'

const baseProps = {
  date: DATE,
  isOpen: true,
  onClose: vi.fn(),
  onScheduled: vi.fn(),
  userId: 'user-1',
  planId: 'plan-1',
  vault: [
    { id: 'v1', name: 'Roast' },
    { id: 'v2', name: 'Tacos' },
    { id: 'v3', name: 'Curry' },
  ],
  recentMeals: [],
  plan: [],
  shortlist: [],
}

describe('DayPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    addScheduledItem.mockResolvedValue({ id: 'new-item' })
    addShortlistItem.mockResolvedValue({ id: 'shortlist-new' })
    scheduleShortlistItem.mockResolvedValue(undefined)
    // Default recommender stub: 3 vault hits.
    getRecommendations.mockReturnValue([
      { id: 'v1', name: 'Roast', source: 'vault', is_wildcard: false },
      { id: 'v2', name: 'Tacos', source: 'vault', is_wildcard: false },
      { id: 'v3', name: 'Curry', source: 'vault', is_wildcard: false },
    ])
    // Default fetch: 2 AI suggestions.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ names: ['AI Pick 1', 'AI Pick 2'] }),
    })
  })

  it('renders all three section headers when each section has items', async () => {
    const props = {
      ...baseProps,
      shortlist: [
        { item_id: 'maybe-1', name: 'Saved A', is_shortlisted: true },
      ],
    }
    render(<DayPicker {...props} />)

    expect(await screen.findByText(/From your Maybe list/i)).toBeInTheDocument()
    expect(await screen.findByText(/Top from your vault/i)).toBeInTheDocument()
    expect(await screen.findByText(/New ideas/i)).toBeInTheDocument()
  })

  it('omits the Maybe header when shortlist is empty', async () => {
    render(<DayPicker {...baseProps} />)

    // Vault and AI sections appear; Maybe does not.
    await screen.findByText(/Top from your vault/i)
    expect(screen.queryByText(/From your Maybe list/i)).not.toBeInTheDocument()
  })

  it('tapping a Maybe item calls scheduleShortlistItem with the date', async () => {
    const onScheduled = vi.fn()
    const props = {
      ...baseProps,
      onScheduled,
      shortlist: [
        { item_id: 'maybe-1', name: 'Saved A', is_shortlisted: true },
      ],
    }
    render(<DayPicker {...props} />)

    fireEvent.click(await screen.findByText('Saved A'))

    await waitFor(() => {
      expect(scheduleShortlistItem).toHaveBeenCalledTimes(1)
    })
    const [, itemId, scheduledDate] = scheduleShortlistItem.mock.calls[0]
    expect(itemId).toBe('maybe-1')
    expect(scheduledDate).toBe(DATE)
    await waitFor(() => expect(onScheduled).toHaveBeenCalled())
  })

  it('tapping a Vault item calls addScheduledItem with scheduled_date + is_shortlisted=false', async () => {
    const onScheduled = vi.fn()
    render(<DayPicker {...baseProps} onScheduled={onScheduled} />)

    // Wait until vault candidates render.
    await screen.findByText('Roast')
    fireEvent.click(screen.getByText('Roast'))

    await waitFor(() => {
      expect(addScheduledItem).toHaveBeenCalledTimes(1)
    })
    const [, userIdArg, planIdArg, scheduledDate, item] =
      addScheduledItem.mock.calls[0]
    expect(userIdArg).toBe('user-1')
    expect(planIdArg).toBe('plan-1')
    expect(scheduledDate).toBe(DATE)
    expect(item.name).toBe('Roast')
    expect(item.id).toBe('v1')
    await waitFor(() => expect(onScheduled).toHaveBeenCalled())
  })

  it('tapping the bookmark on a Vault item calls addShortlistItem (scheduled_date null, is_shortlisted true)', async () => {
    render(<DayPicker {...baseProps} />)

    await screen.findByText('Roast')

    // The first bookmark button corresponds to the first vault row.
    const bookmarks = screen.getAllByLabelText('Add to Maybe')
    expect(bookmarks.length).toBeGreaterThan(0)
    fireEvent.click(bookmarks[0])

    await waitFor(() => {
      expect(addShortlistItem).toHaveBeenCalledTimes(1)
    })
    const [, userIdArg, planIdArg, item] = addShortlistItem.mock.calls[0]
    expect(userIdArg).toBe('user-1')
    expect(planIdArg).toBe('plan-1')
    expect(item.name).toBe('Roast')
    expect(item.id).toBe('v1')
    // Schedule was NOT called — we wrote a shortlist insert, not an UPDATE.
    expect(scheduleShortlistItem).not.toHaveBeenCalled()
    expect(addScheduledItem).not.toHaveBeenCalled()
  })

  it('AI items render with the "New" badge', async () => {
    render(<DayPicker {...baseProps} />)

    await screen.findByText('AI Pick 1')
    // The component tags AI rows with data-testid="ai-new-badge". Each AI
    // candidate gets one badge.
    const badges = await screen.findAllByTestId('ai-new-badge')
    expect(badges.length).toBeGreaterThanOrEqual(2)
  })

  it('regenerate forwards prior batch names via excludeNames (AI fetch) on the second call', async () => {
    const postedBodies = []
    globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
      const body = init?.body ? JSON.parse(init.body) : {}
      postedBodies.push(body)
      const idx = postedBodies.length - 1
      const names = idx === 0 ? ['AI A', 'AI B'] : ['AI C', 'AI D']
      return Promise.resolve({ ok: true, json: async () => ({ names }) })
    })

    // First call returns Roast/Tacos/Curry. Second call returns Pizza/Sushi/Salad.
    getRecommendations
      .mockReturnValueOnce([
        { id: 'v1', name: 'Roast', source: 'vault', is_wildcard: false },
        { id: 'v2', name: 'Tacos', source: 'vault', is_wildcard: false },
      ])
      .mockReturnValueOnce([
        { id: 'v4', name: 'Pizza', source: 'vault', is_wildcard: false },
        { id: 'v5', name: 'Sushi', source: 'vault', is_wildcard: false },
      ])

    render(<DayPicker {...baseProps} />)
    await screen.findByText('Roast')
    await screen.findByText('AI A')

    // First fetch body has empty excludeNames.
    expect(postedBodies[0].excludeNames).toEqual([])

    fireEvent.click(screen.getByLabelText('Regenerate suggestions'))

    await waitFor(() => {
      expect(postedBodies.length).toBe(2)
    })

    // Second AI fetch must include the names from the first batch (vault + AI).
    const second = postedBodies[1].excludeNames
    expect(second).toContain('Roast')
    expect(second).toContain('Tacos')
    expect(second).toContain('AI A')
    expect(second).toContain('AI B')

    // Second getRecommendations call: excludeIds derived from prior batch names
    // mapped through the vault list. v1/v2 should be present.
    const lastRecArgs = getRecommendations.mock.calls.at(-1)
    const optionsArg = lastRecArgs[5]
    expect(optionsArg).toBeDefined()
    expect(Array.isArray(optionsArg.excludeIds)).toBe(true)
    expect(optionsArg.excludeIds).toContain('v1')
    expect(optionsArg.excludeIds).toContain('v2')
  })

  it('renders an empty-state message when every section is empty', async () => {
    getRecommendations.mockReturnValue([])
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ names: [] }),
    })

    render(<DayPicker {...baseProps} />)

    expect(
      await screen.findByText(/No suggestions left for this day/i),
    ).toBeInTheDocument()
    // PRD-002 P0.3: empty-state copy points the user at Settings so they
    // know the hard filter may be why nothing is left.
    expect(
      await screen.findByText(/check your preferences in Settings/i),
    ).toBeInTheDocument()
  })

  // PRD-002 P0.3 — preferences plumbing.
  describe('preferences', () => {
    const PREFS = {
      dietary_restrictions: ['vegetarian'],
      excluded_ingredients: ['cilantro'],
      excluded_cuisines: ['Italian'],
      max_prep_time_minutes: 45,
    }

    it('forwards preferences to getRecommendations and the /api/swap-suggestions POST body', async () => {
      let postedBody = null
      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        postedBody = init?.body ? JSON.parse(init.body) : {}
        return Promise.resolve({ ok: true, json: async () => ({ names: [] }) })
      })

      render(<DayPicker {...baseProps} preferences={PREFS} />)
      await screen.findByText('Roast')

      // getRecommendations options bag (arg #5) carries preferences.
      const recArgs = getRecommendations.mock.calls.at(-1)
      expect(recArgs[5]).toEqual(expect.objectContaining({ preferences: PREFS }))

      // The fetch body carries preferences.
      expect(postedBody).toEqual(expect.objectContaining({ preferences: PREFS }))
    })

    it('does NOT filter Maybe items through passesPreferences (user shortlist intent wins)', async () => {
      // A shortlisted "Beef Tacos" — under vegetarian prefs this would fail
      // passesPreferences, but the Maybe section MUST still render it.
      const shortlist = [
        {
          item_id: 'maybe-beef',
          name: 'Beef Tacos',
          proteins: ['Beef'],
          is_shortlisted: true,
        },
      ]
      // Vault recs returns nothing so we know the Maybe-section render is
      // not coming from the vault path.
      getRecommendations.mockReturnValue([])
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ names: [] }),
      })

      render(<DayPicker {...baseProps} preferences={PREFS} shortlist={shortlist} />)

      // The Maybe header renders and the violator is visible in it.
      expect(await screen.findByText(/From your Maybe list/i)).toBeInTheDocument()
      expect(await screen.findByText('Beef Tacos')).toBeInTheDocument()
    })
  })
})
