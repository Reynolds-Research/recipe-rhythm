import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import BrainstormMode from '../BrainstormMode'

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

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn(() => supabaseChain) },
}))

vi.mock('../../lib/mealPlanReader', () => ({
  fetchMostRecentPlan: vi.fn(),
  fetchCurrentLeftovers: vi.fn(),
  classifyPlanState: vi.fn(),
  listUserPeriods: vi.fn(),
}))

vi.mock('../../lib/mealPlanWriter', () => ({
  createServedPlan: vi.fn(),
  setItemCooked: vi.fn(),
  finalizePlan: vi.fn(),
  startNewPeriod: vi.fn(),
}))

vi.mock('../../lib/recommendations', () => ({
  getRecommendations: vi.fn(),
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
} from '../../lib/mealPlanReader'
import { createServedPlan } from '../../lib/mealPlanWriter'
import { getRecommendations } from '../../lib/recommendations'

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

  it('serving calls createServedPlan with the items array shape', async () => {
    render(<BrainstormMode userId="user-1" />)

    await waitFor(() => {
      expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
    })

    const serveBtn = await screen.findByRole('button', {
      name: /Serve This Plan/i,
    })
    fireEvent.click(serveBtn)

    await waitFor(() => {
      expect(createServedPlan).toHaveBeenCalledTimes(1)
    })
    const [, userIdArg, items] = createServedPlan.mock.calls[0]
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

  // PRD-002 P0.8: per-day swap dedup tracks its own state. The first ever
  // swap goes out with excludeNames=[]; the next swap excludes the names the
  // server returned the previous time.
  it('per-day swap forwards prior-swap response names so consecutive swaps stay unique', async () => {
    const postedBodies = []
    globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
      const body = init?.body ? JSON.parse(init.body) : {}
      postedBodies.push(body)
      // Call 0: brainstorm-load on mount (returns nothing — keeps lastSwapNames clean).
      // Call 1: first per-day swap → returns three names.
      // Call 2: second per-day swap → returns three different names.
      const idx = postedBodies.length - 1
      let names = []
      if (idx === 1) names = ['Swap A', 'Swap B', 'Swap C']
      else if (idx === 2) names = ['Swap D', 'Swap E', 'Swap F']
      return Promise.resolve({ ok: true, json: async () => ({ names }) })
    })

    render(<BrainstormMode userId="user-1" />)

    await waitFor(() => {
      expect(screen.queryByText('Building your plan…')).not.toBeInTheDocument()
    })

    // The brainstorm-load fetch fired on mount.
    expect(postedBodies.length).toBe(1)

    // First per-day swap.
    const swapButtons1 = screen.getAllByRole('button', { name: /^Swap$/ })
    expect(swapButtons1.length).toBeGreaterThan(0)
    fireEvent.click(swapButtons1[0])

    await waitFor(() => {
      expect(postedBodies.length).toBe(2)
    })

    // First swap call: lastSwapNames is still [] (no prior swap response).
    // Plan names may be present, but none of the swap response names.
    expect(Array.isArray(postedBodies[1].excludeNames)).toBe(true)
    expect(postedBodies[1].excludeNames).not.toContain('Swap A')
    expect(postedBodies[1].excludeNames).not.toContain('Swap B')
    expect(postedBodies[1].excludeNames).not.toContain('Swap C')

    // Wait for the first swap to render its names — confirms setLastSwapNames
    // ran before we open the second swap.
    await waitFor(() => {
      expect(screen.getByText('Swap A')).toBeInTheDocument()
    })

    // Second per-day swap (any swap button — re-query after re-render).
    const swapButtons2 = screen.getAllByRole('button', { name: /^Swap$/ })
    fireEvent.click(swapButtons2[1] || swapButtons2[0])

    await waitFor(() => {
      expect(postedBodies.length).toBe(3)
    })

    // Second swap call: excludeNames must include the names the server
    // returned for the first swap.
    expect(Array.isArray(postedBodies[2].excludeNames)).toBe(true)
    expect(postedBodies[2].excludeNames).toContain('Swap A')
    expect(postedBodies[2].excludeNames).toContain('Swap B')
    expect(postedBodies[2].excludeNames).toContain('Swap C')
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
})
