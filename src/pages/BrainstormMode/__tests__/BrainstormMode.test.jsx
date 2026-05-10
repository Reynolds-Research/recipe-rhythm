import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import BrainstormMode from '../'

// --- Module mocks ---------------------------------------------------------

// supabase.from(...).select()...then() — chain that handles every query
// BrainstormMode issues that isn't routed through the reader/writer mocks
// below (i.e., the meals + vault queries inside loadData).
const supabaseChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),       // PRD-001 P0.5: vault SELECT now filters .is('deleted_at', null)
  gte: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  then: vi.fn((cb) => cb({ data: [], error: null })),
}

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: vi.fn(() => supabaseChain) },
}))

vi.mock('../../../lib/mealPlanReader', () => ({
  fetchMostRecentPlan: vi.fn(),
  fetchCurrentLeftovers: vi.fn(),
  classifyPlanState: vi.fn(),
  listUserPeriods: vi.fn(),
}))

vi.mock('../../../lib/mealPlanWriter', () => ({
  createServedPlan: vi.fn(),
  setItemCooked: vi.fn(),
  finalizePlan: vi.fn(),
  startNewPeriod: vi.fn(),
  addScheduledItem: vi.fn(),
  addShortlistItem: vi.fn(),
  scheduleShortlistItem: vi.fn(),
  moveItemToShortlist: vi.fn(),
  deleteMealPlanItem: vi.fn(),
  resetCurrentPlan: vi.fn(),
}))

vi.mock('../../../lib/recommendations', () => ({
  getRecommendations: vi.fn(),
}))

vi.mock('../../../lib/preferences', () => ({
  getPreferences: vi.fn(),
}))

vi.mock('../../../components/GroceryListSheet', () => ({
  default: ({ isOpen, onClose }) =>
    isOpen
      ? <div data-testid="grocery-list-sheet"><button onClick={onClose}>Close</button></div>
      : null,
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }) => <div>{children}</div>,
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  TouchSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }) => <div>{children}</div>,
  verticalListSortingStrategy: vi.fn(),
  arrayMove: vi.fn((arr, from, to) => {
    const next = [...arr]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return next
  }),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: vi.fn(() => '') } },
}))

import {
  fetchMostRecentPlan,
  fetchCurrentLeftovers,
  classifyPlanState,
  listUserPeriods,
} from '../../../lib/mealPlanReader'
import {
  createServedPlan,
  addScheduledItem,
  addShortlistItem,
  scheduleShortlistItem,
  moveItemToShortlist,
  resetCurrentPlan,
} from '../../../lib/mealPlanWriter'
import { getRecommendations } from '../../../lib/recommendations'
import { getPreferences } from '../../../lib/preferences'

// --- Time control ---------------------------------------------------------

// Anchor "today" to a known Sunday so the default-selection logic has a
// deterministic Sun-Thu shape to work with.
const TODAY_DATE = new Date(2026, 3, 19) // Sunday, April 19 2026

function setNow() {
  // Fake only the Date global so async test helpers like waitFor (which
  // depend on setTimeout) and Promise microtasks behave normally.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY_DATE)
}

function ymd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

// --- Tests ----------------------------------------------------------------

describe('BrainstormMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    // Default: /api/swap-suggestions responds with no names, so the
    // brainstorm-load call site falls back to 100% vault recommendations.
    // Individual tests override this when they need a populated response.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ names: [] }),
    })
    setNow()
    fetchMostRecentPlan.mockResolvedValue({ plan: null })
    fetchCurrentLeftovers.mockResolvedValue([])
    classifyPlanState.mockReturnValue('no_plan')
    listUserPeriods.mockResolvedValue([])
    createServedPlan.mockResolvedValue({
      id: 'plan-1',
      served_at: '2026-04-19T12:00:00Z',
      period_start: '2026-04-19',
      period_end: '2026-04-23',
    })
    addScheduledItem.mockResolvedValue({ id: 'scheduled-item-new' })
    addShortlistItem.mockResolvedValue({ id: 'shortlist-item-new' })
    scheduleShortlistItem.mockResolvedValue(undefined)
    moveItemToShortlist.mockResolvedValue(undefined)
    resetCurrentPlan.mockResolvedValue({ deleted: true })
    // PRD-002 P0.3: BrainstormMode reads household preferences once per
    // load. Default to a benign empty preferences object.
    getPreferences.mockResolvedValue({
      user_id: 'user-1',
      dietary_restrictions: [],
      excluded_ingredients: [],
      excluded_cuisines: [],
      max_prep_time_minutes: null,
    })
    getRecommendations.mockReturnValue([
      { id: 'v1', name: 'Roast',  is_wildcard: false, source_url: null },
      { id: 'v2', name: 'Tacos',  is_wildcard: false, source_url: null },
      { id: 'v3', name: 'Ramen',  is_wildcard: false, source_url: null },
      { id: 'v4', name: 'Curry',  is_wildcard: false, source_url: null },
      { id: 'v5', name: 'Pizza',  is_wildcard: false, source_url: null },
    ])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('on mount with no localStorage: default selection is next 5 non-disabled Sun-Thu dates', async () => {
    render(<BrainstormMode userId="user-1" />)

    await waitFor(() => {
      expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
    })

    // The default-selection algorithm walks the 14-day horizon and prefers
    // Sun, Mon, Tue, Wed, Thu. From Sunday April 19 the first five are
    // 04-19 (Sun), 04-20 (Mon), 04-21 (Tue), 04-22 (Wed), 04-23 (Thu).
    const expected = [
      ymd(TODAY_DATE),
      ymd(addDays(TODAY_DATE, 1)),
      ymd(addDays(TODAY_DATE, 2)),
      ymd(addDays(TODAY_DATE, 3)),
      ymd(addDays(TODAY_DATE, 4)),
    ]
    for (const d of expected) {
      const cell = screen.getByTestId(`date-strip-cell-${d}`)
      expect(cell.dataset.selected).toBe('true')
    }

    // Persisted to the new localStorage key.
    expect(JSON.parse(localStorage.getItem('brainstorm_plan_dates'))).toEqual(
      expected,
    )
  })

  it('migrates legacy brainstorm_plan_days into brainstorm_plan_dates and clears the old key', async () => {
    // Legacy stored Mon, Wed, Fri only.
    localStorage.setItem(
      'brainstorm_plan_days',
      JSON.stringify(['Mon', 'Wed', 'Fri']),
    )
    // No dates persisted yet — should fall through to the legacy migration.
    localStorage.removeItem('brainstorm_plan_dates')

    render(<BrainstormMode userId="user-1" />)

    await waitFor(() => {
      expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
    })

    // Mon = 2026-04-20, Wed = 2026-04-22, Fri = 2026-04-24.
    const expected = ['2026-04-20', '2026-04-22', '2026-04-24']
    expect(JSON.parse(localStorage.getItem('brainstorm_plan_dates'))).toEqual(
      expected,
    )
    // Legacy key cleared.
    expect(localStorage.getItem('brainstorm_plan_days')).toBeNull()
  })

  it('serving calls createServedPlan with the items array shape (via sheet)', async () => {
    render(<BrainstormMode userId="user-1" />)

    await waitFor(() => {
      expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
    })

    // Click "Serve This Plan" — opens the confirmation sheet
    const serveBtn = await screen.findByRole('button', {
      name: /Serve This Plan/i,
    })
    fireEvent.click(serveBtn)

    // Sheet is now open; click "Looks great" to commit with positive feedback
    const looksGreatBtn = await screen.findByRole('button', {
      name: /Looks great/i,
    })
    fireEvent.click(looksGreatBtn)

    await waitFor(() => {
      expect(createServedPlan).toHaveBeenCalledTimes(1)
    })
    const [, userIdArg, items, opts] = createServedPlan.mock.calls[0]
    expect(userIdArg).toBe('user-1')
    expect(Array.isArray(items)).toBe(true)
    expect(items).toHaveLength(5)
    // Every item carries a scheduled_date — no weekday strings.
    for (const item of items) {
      expect(item).toHaveProperty('scheduled_date')
      expect(item.scheduled_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(item).not.toHaveProperty('day')
    }
    expect(items.map((i) => i.scheduled_date)).toEqual([
      '2026-04-19',
      '2026-04-20',
      '2026-04-21',
      '2026-04-22',
      '2026-04-23',
    ])
    expect(items.map((i) => i.name)).toEqual([
      'Roast',
      'Tacos',
      'Ramen',
      'Curry',
      'Pizza',
    ])
    expect(opts).toEqual({ feedback: 'positive' })
  })

  it("planState === 'gap' routes to GapDayView (regression guard)", async () => {
    fetchMostRecentPlan.mockResolvedValue({
      plan: {
        id: 'plan-old',
        period_start: '2026-04-05',
        period_end: '2026-04-12',
        finalized_at: '2026-04-13T00:00:00Z',
        served_at: '2026-04-05T00:00:00Z',
        items: [],
        scheduledDates: [],
        source: 'new',
      },
    })
    classifyPlanState.mockReturnValue('gap')

    render(<BrainstormMode userId="user-1" />)

    await waitFor(() => {
      expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
    })

    // GapDayView shows the new-period CTA. We don't depend on a specific
    // button label here — just that the date-strip picker is NOT rendered.
    expect(screen.queryByTestId('date-strip-picker')).not.toBeInTheDocument()
  })

  it('regenerates plan on button click', async () => {
    render(<BrainstormMode userId="user-1" />)

    await waitFor(() => {
      expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
    })

    getRecommendations.mockReturnValueOnce([
      { id: 'v1', name: 'Sushi',     is_wildcard: false, source_url: null },
      { id: 'v2', name: 'Pasta',     is_wildcard: false, source_url: null },
      { id: 'v3', name: 'Soup',      is_wildcard: false, source_url: null },
      { id: 'v4', name: 'Sandwich',  is_wildcard: false, source_url: null },
      { id: 'v5', name: 'Salad',     is_wildcard: false, source_url: null },
    ])

    fireEvent.click(screen.getByText(/Regenerate/i))

    await waitFor(() => {
      expect(screen.getByText('Sushi')).toBeInTheDocument()
    })
  })

  it('passes wildcards from /api/swap-suggestions into getRecommendations on brainstorm-load', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ names: ['Test Wildcard 1', 'Test Wildcard 2'] }),
    })

    render(<BrainstormMode userId="user-1" />)

    await waitFor(() => {
      expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
    })

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/swap-suggestions',
      expect.objectContaining({ method: 'POST' }),
    )

    expect(getRecommendations).toHaveBeenCalled()
    const lastCallArgs = getRecommendations.mock.calls.at(-1)
    const wildcardsArg = lastCallArgs[2]
    expect(Array.isArray(wildcardsArg)).toBe(true)
    expect(wildcardsArg.length).toBe(2)
    expect(wildcardsArg.map(w => w.name)).toEqual([
      'Test Wildcard 1',
      'Test Wildcard 2',
    ])
    expect(wildcardsArg.every(w => w.is_wildcard === true)).toBe(true)
  })

  // PRD-002 P0.8: regeneration must forward the prior batch so we don't
  // re-show the same suggestions. Vault ids go through getRecommendations'
  // excludeIds option; AI candidate names go through the swap-suggestions
  // POST body's excludeNames field.
  it('regenerate forwards prior-batch ids + AI names so the next batch is unique', async () => {
    let postedBodies = []
    globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
      const body = init?.body ? JSON.parse(init.body) : {}
      postedBodies.push(body)
      // First call returns one AI name; second call (after regenerate) should
      // not see this name again.
      const callIndex = postedBodies.length - 1
      const names = callIndex === 0 ? ['First AI Pick'] : ['Second AI Pick']
      return Promise.resolve({ ok: true, json: async () => ({ names }) })
    })

    // First batch: vault picks v1 + v2, plus the AI candidate that flows
    // through wildcards. Second batch: different vault picks.
    getRecommendations
      .mockReturnValueOnce([
        { id: 'v1', name: 'Roast', is_wildcard: false, source_url: null },
        { id: 'v2', name: 'Tacos', is_wildcard: false, source_url: null },
        { id: 'v3', name: 'Ramen', is_wildcard: false, source_url: null },
        { id: 'v4', name: 'Curry', is_wildcard: false, source_url: null },
        { id: 'wA', name: 'First AI Pick', is_wildcard: true, source_url: null },
      ])
      .mockReturnValueOnce([
        { id: 'v6', name: 'Pho',     is_wildcard: false, source_url: null },
        { id: 'v7', name: 'Burger',  is_wildcard: false, source_url: null },
        { id: 'v8', name: 'Lasagna', is_wildcard: false, source_url: null },
        { id: 'v9', name: 'Salad',   is_wildcard: false, source_url: null },
        { id: 'wB', name: 'Second AI Pick', is_wildcard: true, source_url: null },
      ])

    render(<BrainstormMode userId="user-1" />)

    await waitFor(() => {
      expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
    })

    // First call body should have no excludeNames (no prior batch yet).
    expect(postedBodies[0]).toHaveProperty('excludeNames')
    expect(postedBodies[0].excludeNames).toEqual([])

    fireEvent.click(screen.getByText(/Regenerate/i))

    await waitFor(() => {
      expect(getRecommendations).toHaveBeenCalledTimes(2)
    })

    // Second swap-suggestions call body must include the AI name from batch 1.
    await waitFor(() => {
      expect(postedBodies.length).toBe(2)
    })
    expect(postedBodies[1].excludeNames).toContain('First AI Pick')

    // Second getRecommendations call must pass the prior batch's vault ids
    // through the options bag's excludeIds. The signature is
    // (vault, recent, wildcards, count, served, options).
    const secondCallArgs = getRecommendations.mock.calls[1]
    const optionsArg = secondCallArgs[5]
    expect(optionsArg).toBeDefined()
    expect(Array.isArray(optionsArg.excludeIds)).toBe(true)
    // Prior batch vault ids: v1, v2, v3, v4 (the AI one wA is is_wildcard
    // and goes to AI exclude-names, not vault excludeIds).
    for (const id of ['v1', 'v2', 'v3', 'v4']) {
      expect(optionsArg.excludeIds).toContain(id)
    }
  })

  // PRD-002 P0.3 — household preferences are loaded once on mount and
  // forwarded to getRecommendations + the swap-suggestions POST body.
  it('on mount: getPreferences is called once with userId and the result is passed to getRecommendations', async () => {
    const prefs = {
      user_id: 'user-1',
      dietary_restrictions: ['vegetarian'],
      excluded_ingredients: ['cilantro'],
      excluded_cuisines: ['Italian'],
      max_prep_time_minutes: 45,
    }
    getPreferences.mockResolvedValue(prefs)

    let postedBodies = []
    globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
      const body = init?.body ? JSON.parse(init.body) : {}
      postedBodies.push(body)
      return Promise.resolve({ ok: true, json: async () => ({ names: [] }) })
    })

    render(<BrainstormMode userId="user-1" />)
    await waitFor(() => {
      expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
    })

    // Called once per loadData with the userId.
    expect(getPreferences).toHaveBeenCalledTimes(1)
    expect(getPreferences.mock.calls[0][0]).toBe('user-1')

    // getRecommendations received the prefs in the options bag.
    const lastRecArgs = getRecommendations.mock.calls.at(-1)
    expect(lastRecArgs[5]).toEqual(
      expect.objectContaining({ preferences: prefs }),
    )

    // /api/swap-suggestions POST body carried preferences too.
    expect(postedBodies.length).toBeGreaterThan(0)
    expect(postedBodies[0]).toEqual(
      expect.objectContaining({ preferences: prefs }),
    )
  })

  it('falls back to no-preferences (and does not crash) when getPreferences errors', async () => {
    getPreferences.mockRejectedValue(new Error('boom'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(<BrainstormMode userId="user-1" />)
    await waitFor(() => {
      expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
    })

    // getRecommendations was still called; preferences came through as null.
    expect(getRecommendations).toHaveBeenCalled()
    const lastRecArgs = getRecommendations.mock.calls.at(-1)
    expect(lastRecArgs[5]).toEqual(
      expect.objectContaining({ preferences: null }),
    )

    warnSpy.mockRestore()
  })

  it('falls back to empty wildcards (and does not crash) when /api/swap-suggestions fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    })

    render(<BrainstormMode userId="user-1" />)

    await waitFor(() => {
      expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
    })

    expect(getRecommendations).toHaveBeenCalled()
    const lastCallArgs = getRecommendations.mock.calls.at(-1)
    expect(lastCallArgs[2]).toEqual([])

    // Still renders the served-plan UI without crashing.
    expect(
      screen.getByRole('button', { name: /Serve This Plan/i }),
    ).toBeInTheDocument()
  })

  // PRD-002 P0.6: shortlist / "Maybe" tray --------------------------------
  describe('shortlist (Maybe tray)', () => {
    // A served, active plan with one scheduled item (item-sched) and one
    // shortlisted item (item-maybe). Used by every shortlist test.
    function setupActivePlan({ shortlist = [] } = {}) {
      fetchMostRecentPlan.mockResolvedValue({
        plan: {
          id: 'plan-active',
          served_at: '2026-04-19T12:00:00Z',
          period_start: '2026-04-19',
          period_end: '2026-04-23',
          finalized_at: null,
          items: [
            {
              scheduled_date: '2026-04-19',
              name: 'Roast',
              id: 'v1',
              is_wildcard: false,
              source_url: null,
              item_id: 'item-sched',
              cooked: false,
              cooked_at: null,
              is_shortlisted: false,
            },
          ],
          shortlist,
          scheduledDates: ['2026-04-19'],
          source: 'new',
        },
      })
      classifyPlanState.mockReturnValue('active')
    }

    it('renders both tabs and clicking "Maybe" switches the visible region', async () => {
      setupActivePlan()
      render(<BrainstormMode userId="user-1" />)
      await waitFor(() => {
        expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
      })

      const maybeTab = screen.getByRole('tab', { name: /Maybe/i })
      const thisWeekTab = screen.getByRole('tab', { name: /This Week/i })
      expect(thisWeekTab).toHaveAttribute('aria-selected', 'true')
      expect(maybeTab).toHaveAttribute('aria-selected', 'false')

      // The day grid is visible while This Week is active.
      expect(screen.getByText('Roast')).toBeInTheDocument()

      fireEvent.click(maybeTab)

      await waitFor(() => {
        expect(maybeTab).toHaveAttribute('aria-selected', 'true')
      })
      // Empty Maybe state surfaces the prompt copy.
      expect(
        screen.getByText(/Nothing shortlisted yet/i),
      ).toBeInTheDocument()
      // The day grid is no longer rendered while Maybe is active.
      expect(screen.queryByText('Roast')).not.toBeInTheDocument()
    })

    it('clicking the bookmark on a DayPicker candidate calls addShortlistItem with the shortlisted shape', async () => {
      setupActivePlan()
      // PRD-002 P0.7: the picker fires its own /api/swap-suggestions call when
      // it opens. Surface one AI candidate so the bookmark has something to
      // attach to.
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ names: ['Tasty Wildcard'] }),
      })

      render(<BrainstormMode userId="user-1" />)
      await waitFor(() => {
        expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
      })

      // Open the picker via the "+" affordance on the filled day (4/19).
      const plusBtn = await screen.findByRole('button', {
        name: /Add another meal to/i,
      })
      fireEvent.click(plusBtn)

      // Wait for the AI candidate to render inside the picker.
      await screen.findByText('Tasty Wildcard')

      // The bookmark icon button has aria-label="Add to Maybe".
      const bookmarks = screen.getAllByLabelText('Add to Maybe')
      expect(bookmarks.length).toBeGreaterThan(0)
      // Click the bookmark on the AI row (the last visible bookmark — vault
      // section also has bookmarks, but Tasty Wildcard's is the AI one).
      const aiRow = screen.getByText('Tasty Wildcard').closest('div')
      const aiBookmark =
        aiRow?.querySelector('[aria-label="Add to Maybe"]') ?? bookmarks[0]
      fireEvent.click(aiBookmark)

      await waitFor(() => {
        expect(addShortlistItem).toHaveBeenCalledTimes(1)
      })
      const [, userIdArg, planIdArg, itemArg] = addShortlistItem.mock.calls[0]
      expect(userIdArg).toBe('user-1')
      expect(planIdArg).toBe('plan-active')
      expect(itemArg.name).toBe('Tasty Wildcard')
      expect(itemArg.is_wildcard).toBe(true)
    })

    it('with mocked shortlist items present, Maybe tab shows them; Schedule opens the day-picker sheet', async () => {
      setupActivePlan({
        shortlist: [
          {
            scheduled_date: null,
            name: 'Saved For Later',
            id: 'v9',
            is_wildcard: false,
            source_url: null,
            item_id: 'item-maybe',
            cooked: false,
            cooked_at: null,
            is_shortlisted: true,
          },
        ],
      })

      render(<BrainstormMode userId="user-1" />)
      await waitFor(() => {
        expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('tab', { name: /Maybe/i }))

      // Shortlisted item is visible.
      expect(await screen.findByText('Saved For Later')).toBeInTheDocument()

      // Click Schedule — the day-picker sheet opens (mocked Sheet renders
      // children only when isOpen).
      fireEvent.click(
        screen.getByRole('button', { name: /Schedule Saved For Later/i }),
      )

      // The schedule sheet is now mounted. Its sheet body lists the period's
      // days (Sun 4/19 through Thu 4/23).
      await waitFor(() => {
        expect(screen.getByRole('list', { name: /Days in period/i })).toBeInTheDocument()
      })
    })

    it('selecting a day from the schedule sheet calls scheduleShortlistItem with the right shape', async () => {
      setupActivePlan({
        shortlist: [
          {
            scheduled_date: null,
            name: 'Saved For Later',
            id: 'v9',
            is_wildcard: false,
            source_url: null,
            item_id: 'item-maybe',
            cooked: false,
            cooked_at: null,
            is_shortlisted: true,
          },
        ],
      })

      render(<BrainstormMode userId="user-1" />)
      await waitFor(() => {
        expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('tab', { name: /Maybe/i }))
      fireEvent.click(
        await screen.findByRole('button', { name: /Schedule Saved For Later/i }),
      )

      // Click the first listed day inside the schedule sheet.
      const dayList = await screen.findByRole('list', {
        name: /Days in period/i,
      })
      const dayButtons = dayList.querySelectorAll('button')
      expect(dayButtons.length).toBeGreaterThan(0)
      fireEvent.click(dayButtons[0])

      await waitFor(() => {
        expect(scheduleShortlistItem).toHaveBeenCalledTimes(1)
      })
      const [, itemId, scheduledDate] = scheduleShortlistItem.mock.calls[0]
      expect(itemId).toBe('item-maybe')
      // First date in the period is period_start = 2026-04-19.
      expect(scheduledDate).toBe('2026-04-19')
    })

    it('"Move to Maybe" on a scheduled item calls moveItemToShortlist with the inverse shape', async () => {
      setupActivePlan()
      render(<BrainstormMode userId="user-1" />)
      await waitFor(() => {
        expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
      })

      // The day grid renders one scheduled item with item_id='item-sched'.
      // SortableMealItem exposes a "Move to Maybe" button when isServed +
      // item_id present.
      const moveBtn = await screen.findByLabelText('Move to Maybe')
      fireEvent.click(moveBtn)

      await waitFor(() => {
        expect(moveItemToShortlist).toHaveBeenCalledTimes(1)
      })
      const [, itemIdArg] = moveItemToShortlist.mock.calls[0]
      expect(itemIdArg).toBe('item-sched')
    })
  })

  // PRD-002 P0.7: tap-a-day picker affordances ----------------------------
  describe('day picker affordances', () => {
    function setupActivePlan({ shortlist = [] } = {}) {
      fetchMostRecentPlan.mockResolvedValue({
        plan: {
          id: 'plan-active',
          served_at: '2026-04-19T12:00:00Z',
          period_start: '2026-04-19',
          period_end: '2026-04-23',
          finalized_at: null,
          items: [
            {
              scheduled_date: '2026-04-19',
              name: 'Roast',
              id: 'v1',
              is_wildcard: false,
              source_url: null,
              item_id: 'item-sched',
              cooked: false,
              cooked_at: null,
              is_shortlisted: false,
            },
          ],
          shortlist,
          scheduledDates: ['2026-04-19'],
          source: 'new',
        },
      })
      classifyPlanState.mockReturnValue('active')
    }

    it('tapping an empty day cell opens the DayPicker for that date', async () => {
      setupActivePlan()
      render(<BrainstormMode userId="user-1" />)
      await waitFor(() => {
        expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
      })

      // Period 4/19–4/23 with one item on 4/19 → 4/20–4/23 are empty cells.
      const emptyTaps = await screen.findAllByRole('button', {
        name: /Schedule a meal for/i,
      })
      expect(emptyTaps.length).toBe(4)

      // Tap one. The mocked Sheet renders children only when isOpen, so
      // querying by the picker's testid confirms it opened.
      fireEvent.click(emptyTaps[0])

      await waitFor(() => {
        expect(screen.getByTestId('day-picker')).toBeInTheDocument()
      })
    })

    it('tapping the "+" on a non-empty day opens the DayPicker', async () => {
      setupActivePlan()
      render(<BrainstormMode userId="user-1" />)
      await waitFor(() => {
        expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
      })

      const plusBtn = await screen.findByRole('button', {
        name: /Add another meal to/i,
      })
      fireEvent.click(plusBtn)

      await waitFor(() => {
        expect(screen.getByTestId('day-picker')).toBeInTheDocument()
      })
    })

    it('tapping an existing meal card does NOT open the picker', async () => {
      setupActivePlan()
      render(<BrainstormMode userId="user-1" />)
      await waitFor(() => {
        expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
      })

      // The meal card renders the name "Roast" but isn't itself a picker
      // trigger. Clicking it should NOT mount the DayPicker.
      fireEvent.click(screen.getByText('Roast'))

      // The DayPicker stays closed.
      expect(screen.queryByTestId('day-picker')).not.toBeInTheDocument()
    })

    it('the legacy always-visible candidate list / Swap UI is no longer in the rendered DOM', async () => {
      setupActivePlan()
      render(<BrainstormMode userId="user-1" />)
      await waitFor(() => {
        expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
      })

      // No more "Swap" button per row.
      expect(screen.queryByRole('button', { name: /^Swap$/ })).not.toBeInTheDocument()
      // No more "From Your Cookbook" / "AI Suggestions" headers from the old
      // swap sheet either.
      expect(screen.queryByText(/From Your Cookbook/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/^AI Suggestions$/i)).not.toBeInTheDocument()
    })
  })

  // Reset current plan ----------------------------------------------------
  describe('reset current plan', () => {
    function mockActivePlan({ finalized_at = null } = {}) {
      fetchMostRecentPlan.mockResolvedValue({
        plan: {
          id: 'plan-active',
          served_at: '2026-04-19T12:00:00Z',
          period_start: '2026-04-19',
          period_end: '2026-04-23',
          finalized_at,
          items: [
            {
              scheduled_date: '2026-04-19',
              name: 'Roast',
              id: 'v1',
              is_wildcard: false,
              source_url: null,
              item_id: 'item-sched',
              cooked: false,
              cooked_at: null,
              is_shortlisted: false,
            },
          ],
          shortlist: [],
          scheduledDates: ['2026-04-19'],
          source: 'new',
        },
      })
      classifyPlanState.mockReturnValue(finalized_at ? 'finalized' : 'active')
    }

    it('renders the Reset button on an active served plan', async () => {
      mockActivePlan()
      render(<BrainstormMode userId="user-1" />)
      await waitFor(() => {
        expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
      })
      expect(
        screen.getByRole('button', { name: /Reset this plan/i }),
      ).toBeInTheDocument()
    })

    it('does not render the Reset button when the plan is finalized', async () => {
      mockActivePlan({ finalized_at: '2026-04-24T00:00:00Z' })
      render(<BrainstormMode userId="user-1" />)
      await waitFor(() => {
        expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
      })
      expect(
        screen.queryByRole('button', { name: /Reset this plan/i }),
      ).not.toBeInTheDocument()
    })

    it('does not render the Reset button on a brand-new (unserved) page', async () => {
      // Default beforeEach: fetchMostRecentPlan → { plan: null }, planState 'no_plan'
      render(<BrainstormMode userId="user-1" />)
      await waitFor(() => {
        expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
      })
      expect(
        screen.queryByRole('button', { name: /Reset this plan/i }),
      ).not.toBeInTheDocument()
    })

    it('clicking Reset opens a confirm sheet; confirming calls resetCurrentPlan with the loaded plan id and reloads', async () => {
      mockActivePlan()
      render(<BrainstormMode userId="user-1" />)
      await waitFor(() => {
        expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
      })

      const initialFetchCalls = fetchMostRecentPlan.mock.calls.length

      fireEvent.click(
        screen.getByRole('button', { name: /Reset this plan/i }),
      )

      // The confirm sheet's destructive action button surfaces.
      const confirmBtn = await screen.findByRole('button', {
        name: /^Reset plan$/i,
      })

      // Post-reset the page should appear empty so the user falls back into
      // the date-strip planning UI. Stub fetchMostRecentPlan for the reload.
      fetchMostRecentPlan.mockResolvedValue({ plan: null })
      classifyPlanState.mockReturnValue('no_plan')

      fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(resetCurrentPlan).toHaveBeenCalledTimes(1)
      })
      const [, planIdArg] = resetCurrentPlan.mock.calls[0]
      expect(planIdArg).toBe('plan-active')

      // loadData(true) re-fetches the most recent plan after the delete.
      await waitFor(() => {
        expect(fetchMostRecentPlan.mock.calls.length).toBeGreaterThan(
          initialFetchCalls,
        )
      })
    })

    it('shows an error and does NOT reload when resetCurrentPlan returns deleted:false', async () => {
      mockActivePlan()
      resetCurrentPlan.mockResolvedValueOnce({ deleted: false })

      render(<BrainstormMode userId="user-1" />)
      await waitFor(() => {
        expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
      })

      const initialFetchCalls = fetchMostRecentPlan.mock.calls.length

      fireEvent.click(screen.getByRole('button', { name: /Reset this plan/i }))
      fireEvent.click(await screen.findByRole('button', { name: /^Reset plan$/i }))

      await waitFor(() => {
        expect(resetCurrentPlan).toHaveBeenCalledTimes(1)
      })

      // An inline error message appears.
      expect(
        screen.getAllByText(/Could not reset plan/i).length,
      ).toBeGreaterThan(0)

      // loadData is NOT re-invoked — the plan stays in its current state.
      expect(fetchMostRecentPlan.mock.calls.length).toBe(initialFetchCalls)
    })

    it('surfaces an error message when resetCurrentPlan throws', async () => {
      mockActivePlan()
      resetCurrentPlan.mockRejectedValueOnce(
        Object.assign(new Error('boom'), { code: 'reset_failed' }),
      )

      render(<BrainstormMode userId="user-1" />)
      await waitFor(() => {
        expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
      })

      fireEvent.click(
        screen.getByRole('button', { name: /Reset this plan/i }),
      )
      fireEvent.click(
        await screen.findByRole('button', { name: /^Reset plan$/i }),
      )

      // The error renders in two places: inline below the action bar and
      // inside the still-open confirm sheet.
      await waitFor(() => {
        expect(
          screen.getAllByText(/Could not reset plan\. Try again\./i).length,
        ).toBeGreaterThan(0)
      })
    })
  })

  it('Groceries button opens the grocery sheet when plan is served', async () => {
    fetchMostRecentPlan.mockResolvedValue({
      plan: {
        id: 'plan-active',
        served_at: '2026-04-19T12:00:00Z',
        period_start: '2026-04-19',
        period_end: '2026-04-23',
        finalized_at: null,
        items: [],
        shortlist: [],
        scheduledDates: [],
        source: 'new',
      },
    })
    classifyPlanState.mockReturnValue('active')

    render(<BrainstormMode userId="user-1" />)
    await waitFor(() => {
      expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
    })

    expect(screen.queryByTestId('grocery-list-sheet')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Groceries$/i }))

    expect(screen.getByTestId('grocery-list-sheet')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // PRD-002 P1.2 — serve confirmation sheet
  // ---------------------------------------------------------------------------

  describe('serve confirmation sheet (PRD-002 P1.2)', () => {
    async function renderAndOpenSheet() {
      render(<BrainstormMode userId="user-1" />)
      await waitFor(() => {
        expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
      })
      fireEvent.click(screen.getByRole('button', { name: /Serve This Plan/i }))
    }

    it('clicking "Serve This Plan" opens the confirmation sheet without calling createServedPlan', async () => {
      await renderAndOpenSheet()
      expect(screen.getByText(/Lock in this plan/i)).toBeInTheDocument()
      expect(createServedPlan).not.toHaveBeenCalled()
    })

    it('sheet shows all planned meal names', async () => {
      await renderAndOpenSheet()
      // Scope to the sheet container — meal names also appear in the plan list.
      const sheet = screen.getByTestId('mock-sheet-container')
      expect(within(sheet).getByText('Roast')).toBeInTheDocument()
      expect(within(sheet).getByText('Tacos')).toBeInTheDocument()
      expect(within(sheet).getByText('Pizza')).toBeInTheDocument()
    })

    it('"Looks great" commits with feedback="positive"', async () => {
      await renderAndOpenSheet()
      fireEvent.click(screen.getByRole('button', { name: /Looks great/i }))
      await waitFor(() => expect(createServedPlan).toHaveBeenCalledTimes(1))
      const [, , , opts] = createServedPlan.mock.calls[0]
      expect(opts).toEqual({ feedback: 'positive' })
    })

    it('"Lock in anyway" commits with feedback="negative"', async () => {
      await renderAndOpenSheet()
      fireEvent.click(screen.getByRole('button', { name: /Lock in anyway/i }))
      await waitFor(() => expect(createServedPlan).toHaveBeenCalledTimes(1))
      const [, , , opts] = createServedPlan.mock.calls[0]
      expect(opts).toEqual({ feedback: 'negative' })
    })

    it('"Let me adjust" dismisses the sheet without calling createServedPlan', async () => {
      await renderAndOpenSheet()
      fireEvent.click(screen.getByRole('button', { name: /Let me adjust/i }))
      expect(screen.queryByText(/Lock in this plan/i)).not.toBeInTheDocument()
      expect(createServedPlan).not.toHaveBeenCalled()
    })
  })
})
