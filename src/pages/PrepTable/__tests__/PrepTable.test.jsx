import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// PRD-008 2b-2 — the new Prep Table. The data layer (plannedMeals.js, tested on
// its own) is mocked here, so these tests check what the screen asks for. The
// week logic (weekRange.js) and suggestions (weekSuggest.js) are the real ones.
vi.mock('../../../lib/plannedMeals', () => ({
  loadWeek: vi.fn(),
  loadMaybeList: vi.fn(),
  loadDidntGetTo: vi.fn(),
  saveWeekDays: vi.fn(),
  addMeal: vi.fn(),
  moveMeal: vi.fn(),
  removeMeal: vi.fn(),
  setCooked: vi.fn(),
}))
vi.mock('../../../lib/preferences', () => ({ getPreferences: vi.fn(async () => null) }))
vi.mock('../../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

import * as pm from '../../../lib/plannedMeals'
import { supabase } from '../../../lib/supabase'
import PrepTable from '../index'

const TODAY = '2026-11-02' // Monday; the week is Sun Nov 1 – Sat Nov 7

const VAULT = [
  { id: 'v1', name: 'Green curry', cuisine_type: 'Thai', proteins: ['Chicken'] },
  { id: 'v2', name: 'Turkey tacos', cuisine_type: 'Mexican', proteins: ['Turkey'] },
  { id: 'v3', name: 'Sheet-pan gnocchi', cuisine_type: 'Italian', proteins: ['None'] },
]

function meal(over) {
  return { id: 'm1', planned_on: '2026-11-02', position: 0, name: 'Sheet-pan gnocchi', vault_id: 'v3',
    is_wildcard: false, source_url: null, cooked: false, cooked_at: null, ...over }
}

/** Cookbook + meal log queries the hook makes once. */
function kitchenQuery() {
  const chain = {}
  for (const k of ['select', 'eq', 'is', 'gte']) chain[k] = vi.fn(() => chain)
  chain.order = vi.fn(() => Promise.resolve({ data: chain._table === 'vault' ? VAULT : [], error: null }))
  return chain
}

function setWeek({ meals = [], weekDays = null, usualDays = [0, 1, 2, 3, 4] } = {}) {
  pm.loadWeek.mockImplementation(async (_sb, _u, start) => ({
    weekStart: start, weekEnd: start, meals, weekDays, usualDays,
  }))
}

function renderPage() {
  return render(<PrepTable userId="u1" today={TODAY} />)
}

const dayButton = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) })
const dayRow = (label) => screen.getByRole('region', { name: label })

beforeEach(() => {
  vi.clearAllMocks()
  supabase.from.mockImplementation((table) => { const c = kitchenQuery(); c._table = table; return c })
  setWeek()
  pm.loadMaybeList.mockResolvedValue([])
  pm.loadDidntGetTo.mockResolvedValue([])
  for (const f of ['saveWeekDays', 'addMeal', 'moveMeal', 'removeMeal', 'setCooked']) pm[f].mockResolvedValue({})
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
})
afterEach(() => vi.restoreAllMocks())

describe('week and day buttons', () => {
  it('opens on this week showing the usual days (Sun–Thu)', async () => {
    renderPage()
    expect(await screen.findByTestId('week-title')).toHaveTextContent('Nov 1 – 7')
    expect(pm.loadWeek).toHaveBeenCalledWith(supabase, 'u1', '2026-11-01')
    for (const label of ['Sun Nov 1', 'Mon Nov 2', 'Tue Nov 3', 'Wed Nov 4', 'Thu Nov 5']) {
      expect(dayRow(label)).toBeInTheDocument()
    }
    expect(screen.queryByRole('region', { name: 'Fri Nov 6' })).not.toBeInTheDocument()
    expect(dayButton('Friday')).toHaveAttribute('aria-pressed', 'false')
  })

  it('hiding a day saves the week without it', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /^Wednesday/ }))
    expect(pm.saveWeekDays).toHaveBeenCalledWith(supabase, 'u1', '2026-11-01', [0, 1, 2, 4])
  })

  it('showing a hidden day saves the week with it', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /^Saturday/ }))
    expect(pm.saveWeekDays).toHaveBeenCalledWith(supabase, 'u1', '2026-11-01', [0, 1, 2, 3, 4, 6])
  })

  it('a day with a meal is locked: shown, marked, and tapping it saves nothing', async () => {
    setWeek({ meals: [meal({ planned_on: '2026-11-02' })] })
    renderPage()
    const monday = await screen.findByRole('button', { name: /^Monday/ })
    expect(monday).toHaveAccessibleName('Monday (has a meal, always shown)')
    expect(monday).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(monday)
    expect(pm.saveWeekDays).not.toHaveBeenCalled()
  })

  it('a meal on a hidden day still shows that day', async () => {
    setWeek({ meals: [meal({ id: 'm9', planned_on: '2026-11-07', name: 'Pizza night', vault_id: null })] })
    renderPage()
    expect(await screen.findByRole('region', { name: 'Sat Nov 7' })).toHaveTextContent('Pizza night')
  })

  it('→ loads next week, and "Back to this week" returns', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Next week' }))
    expect(await screen.findByTestId('week-title')).toHaveTextContent('Nov 8 – 14')
    expect(pm.loadWeek).toHaveBeenLastCalledWith(supabase, 'u1', '2026-11-08')
    await userEvent.click(screen.getByRole('button', { name: 'Back to this week' }))
    expect(await screen.findByTestId('week-title')).toHaveTextContent('Nov 1 – 7')
  })

  it('shows a message when the week fails to load', async () => {
    pm.loadWeek.mockRejectedValue(new Error('offline'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the plan")
  })
})

describe('✨ suggest — saved only on ✓ (D3)', () => {
  it('a suggestion is shown but not saved; ✓ saves it on that day', async () => {
    renderPage()
    const wed = await screen.findByRole('region', { name: 'Wed Nov 4' })
    await waitFor(() => expect(within(wed).getByRole('button', { name: '✨ suggest' })).toBeEnabled())
    await userEvent.click(within(wed).getByRole('button', { name: '✨ suggest' }))

    expect(within(wed).getByText('Suggestion · not saved yet')).toBeInTheDocument()
    expect(pm.addMeal).not.toHaveBeenCalled()

    const keep = within(wed).getByRole('button', { name: /^Keep / })
    const name = keep.getAttribute('aria-label').replace('Keep ', '')
    await userEvent.click(keep)
    expect(pm.addMeal).toHaveBeenCalledWith(supabase, 'u1', expect.objectContaining({
      plannedOn: '2026-11-04', name, vaultId: VAULT.find((v) => v.name === name).id,
    }))
  })

  it('✕ dismisses a suggestion without saving anything', async () => {
    renderPage()
    const thu = await screen.findByRole('region', { name: 'Thu Nov 5' })
    await waitFor(() => expect(within(thu).getByRole('button', { name: '✨ suggest' })).toBeEnabled())
    await userEvent.click(within(thu).getByRole('button', { name: '✨ suggest' }))
    await userEvent.click(within(thu).getByRole('button', { name: /^Not / }))
    expect(within(thu).queryByText('Suggestion · not saved yet')).not.toBeInTheDocument()
    expect(pm.addMeal).not.toHaveBeenCalled()
  })

  it('"Suggest the empty days" fills only upcoming empty days, each with a different recipe', async () => {
    setWeek({ meals: [meal({ planned_on: '2026-11-03', vault_id: 'v2', name: 'Turkey tacos' })] })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Suggest the empty days/ }))
    // Sun Nov 1 is past: no suggestion. Tue has a meal. Mon, Wed, Thu are open
    // but the cookbook has 2 recipes left (tacos is already in the week).
    expect(within(dayRow('Sun Nov 1')).queryByText('Suggestion · not saved yet')).not.toBeInTheDocument()
    const proposed = screen.getAllByText('Suggestion · not saved yet')
    expect(proposed).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Keep Turkey tacos' })).not.toBeInTheDocument()
    expect(pm.addMeal).not.toHaveBeenCalled()
  })

  it('hiding a day drops its suggestion', async () => {
    renderPage()
    const wed = await screen.findByRole('region', { name: 'Wed Nov 4' })
    await waitFor(() => expect(within(wed).getByRole('button', { name: '✨ suggest' })).toBeEnabled())
    await userEvent.click(within(wed).getByRole('button', { name: '✨ suggest' }))
    // the save "succeeds"; the reload shows Wednesday hidden
    setWeek({ weekDays: [0, 1, 2, 4] })
    await userEvent.click(dayButton('Wednesday'))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Wed Nov 4' })).not.toBeInTheDocument())
    expect(screen.queryByText('Suggestion · not saved yet')).not.toBeInTheDocument()
  })
})

describe('+ add', () => {
  it('search the cookbook and pick a recipe → added on that day', async () => {
    renderPage()
    const wed = await screen.findByRole('region', { name: 'Wed Nov 4' })
    await userEvent.click(within(wed).getByRole('button', { name: '+ add' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search recipes' }), 'curry')
    await userEvent.click(screen.getByRole('button', { name: /Green curry/ }))
    expect(pm.addMeal).toHaveBeenCalledWith(supabase, 'u1', expect.objectContaining({
      plannedOn: '2026-11-04', name: 'Green curry', vaultId: 'v1', position: 0,
    }))
  })

  it('no match → "Add as-is" saves a one-off meal (no recipe link)', async () => {
    renderPage()
    const wed = await screen.findByRole('region', { name: 'Wed Nov 4' })
    await userEvent.click(within(wed).getByRole('button', { name: '+ add' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search recipes' }), 'Takeout pho')
    await userEvent.click(screen.getByRole('button', { name: /Add “Takeout pho” as-is/ }))
    expect(pm.addMeal).toHaveBeenCalledWith(supabase, 'u1', expect.objectContaining({
      plannedOn: '2026-11-04', name: 'Takeout pho', vaultId: null,
    }))
  })

  it('picking from the Maybe list moves that meal onto the day', async () => {
    pm.loadMaybeList.mockResolvedValue([meal({ id: 'mx', planned_on: null, name: 'Lemon orzo soup', vault_id: null })])
    renderPage()
    const wed = await screen.findByRole('region', { name: 'Wed Nov 4' })
    await userEvent.click(within(wed).getByRole('button', { name: '+ add' }))
    await userEvent.click(screen.getByRole('button', { name: /Lemon orzo soup/ }))
    expect(pm.moveMeal).toHaveBeenCalledWith(supabase, 'mx', { plannedOn: '2026-11-04', position: 0 })
    expect(pm.addMeal).not.toHaveBeenCalled()
  })
})

describe('meals on days', () => {
  it('tick cooked, move to Maybe, remove', async () => {
    setWeek({ meals: [meal()] })
    renderPage()
    const mon = await screen.findByRole('region', { name: 'Mon Nov 2' })
    await userEvent.click(within(mon).getByRole('checkbox', { name: 'Cooked Sheet-pan gnocchi' }))
    expect(pm.setCooked).toHaveBeenCalledWith(supabase, 'm1', true)

    await userEvent.click(within(mon).getByRole('button', { name: 'Move Sheet-pan gnocchi' }))
    await userEvent.click(within(screen.getByTestId('day-choice-sheet')).getByRole('button', { name: /Maybe list/ }))
    expect(pm.moveMeal).toHaveBeenCalledWith(supabase, 'm1', { plannedOn: null, position: 0 })

    await userEvent.click(within(mon).getByRole('button', { name: 'Remove Sheet-pan gnocchi' }))
    expect(pm.removeMeal).toHaveBeenCalledWith(supabase, 'm1')
  })

  it('upcoming days have no cooked box; past uncooked meals say "Not cooked"', async () => {
    setWeek({ meals: [meal({ id: 'a', planned_on: '2026-11-01', name: 'Old curry' }), meal({ id: 'b', planned_on: '2026-11-04', name: 'Later tacos' })] })
    renderPage()
    expect(await screen.findByText('Not cooked')).toBeInTheDocument()
    expect(within(dayRow('Wed Nov 4')).queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('a failed save shows a message', async () => {
    pm.removeMeal.mockRejectedValue(new Error('denied'))
    setWeek({ meals: [meal()] })
    renderPage()
    const mon = await screen.findByRole('region', { name: 'Mon Nov 2' })
    await userEvent.click(within(mon).getByRole('button', { name: 'Remove Sheet-pan gnocchi' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't remove that meal")
  })
})

describe('Maybe tab', () => {
  it('lists Maybe meals; tapping one puts it on a chosen day', async () => {
    pm.loadMaybeList.mockResolvedValue([meal({ id: 'mx', planned_on: null, name: 'Lemon orzo soup', vault_id: null })])
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: /Maybe/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Lemon orzo soup' }))
    await userEvent.click(within(screen.getByTestId('day-choice-sheet')).getByRole('button', { name: 'Thu Nov 5' }))
    expect(pm.moveMeal).toHaveBeenCalledWith(supabase, 'mx', { plannedOn: '2026-11-05', position: 0 })
  })

  it('+ Add to Maybe saves a meal with no day', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: /Maybe/ }))
    await userEvent.click(screen.getByRole('button', { name: '+ Add to Maybe' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search recipes' }), 'tacos')
    await userEvent.click(screen.getByRole('button', { name: /Turkey tacos/ }))
    expect(pm.addMeal).toHaveBeenCalledWith(supabase, 'u1', expect.objectContaining({ plannedOn: null, vaultId: 'v2' }))
  })
})

describe("Didn't get to these", () => {
  it('tapping one adds a NEW meal on the chosen day (the old one stays as history)', async () => {
    pm.loadDidntGetTo.mockResolvedValue([meal({ id: 'old', planned_on: '2026-10-29', name: 'Green curry', vault_id: 'v1' })])
    renderPage()
    const tray = await screen.findByRole('region', { name: "Didn't get to these" })
    await userEvent.click(within(tray).getByRole('button', { name: /Green curry/ }))
    await userEvent.click(within(screen.getByTestId('day-choice-sheet')).getByRole('button', { name: 'Wed Nov 4' }))
    expect(pm.addMeal).toHaveBeenCalledWith(supabase, 'u1', expect.objectContaining({
      plannedOn: '2026-11-04', name: 'Green curry', vaultId: 'v1',
    }))
    expect(pm.moveMeal).not.toHaveBeenCalled()
  })

  it('is hidden when there is nothing to show', async () => {
    renderPage()
    await screen.findByTestId('week-title')
    expect(screen.queryByRole('region', { name: "Didn't get to these" })).not.toBeInTheDocument()
  })
})
