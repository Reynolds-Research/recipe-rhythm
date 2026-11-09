import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// PRD-008 2b-2 — the new Prep Table. The data layer (plannedMeals.js, tested on
// its own) is mocked here, so these tests check what the screen asks for. The
// week logic (weekRange.js) and suggestions (weekSuggest.js) are the real ones.
vi.mock('../../../lib/plannedMeals', async (importOriginal) => ({
  // the tick rule is pure logic: use the real one
  keepsCookedTick: (await importOriginal()).keepsCookedTick,
  loadWeek: vi.fn(),
  loadMaybeList: vi.fn(),
  loadDidntGetTo: vi.fn(),
  saveWeekDays: vi.fn(),
  addMeal: vi.fn(),
  moveMeal: vi.fn(),
  removeMeal: vi.fn(),
  setCooked: vi.fn(),
}))
// 2b-3: Confirm the week + groceries. Mocked the same way (tested on its own in
// src/lib/__tests__/weekGroceries.test.js); the error class is the real one.
vi.mock('../../../lib/weekGroceries', async (importOriginal) => ({
  WeekGroceryError: (await importOriginal()).WeekGroceryError,
  loadConfirmation: vi.fn(),
  confirmWeek: vi.fn(),
  makeWeekGroceryList: vi.fn(),
  keepListAsIs: vi.fn(),
  loadGroceryItems: vi.fn(),
  setAssumed: vi.fn(),
  setAlwaysHave: vi.fn(),
  addOwnItem: vi.fn(),
  removeOwnItem: vi.fn(),
}))
vi.mock('../../../lib/preferences', () => ({ getPreferences: vi.fn(async () => null) }))
vi.mock('../../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))
// The real drag-and-drop context, wrapped so a test can "drop" a meal by
// calling its onDragEnd (jsdom can't do real pointer drags).
let dnd = null
// A test can also pretend a drag is in progress (what's dragged, over what),
// to check what the screen shows mid-drag.
let fakeDragState = null
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    DndContext: (props) => { dnd = props; return <real.DndContext {...props} /> },
    useDndContext: (...args) => {
      const ctx = real.useDndContext(...args)
      return fakeDragState ? { ...ctx, ...fakeDragState } : ctx
    },
  }
})

import * as pm from '../../../lib/plannedMeals'
import * as wg from '../../../lib/weekGroceries'
import { MouseSensor, TouchSensor, KeyboardSensor } from '@dnd-kit/core'
import { supabase } from '../../../lib/supabase'
import PrepTable from '../index'
import { thinRecipesNote } from '../usePrepTable'

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
  wg.loadConfirmation.mockResolvedValue(null)
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
})
afterEach(() => vi.restoreAllMocks())

// Freeze the clock on TODAY. The page takes `today` as a prop, but the
// recommender's "already this week" variety check still measures from the real
// clock (recommendations.js buildWeeklyAttributes), so these fixed November
// dates stopped counting as "this week" once the real date moved past
// TODAY + 7 days and the suggestion tests went red on 2026-11-09 with no code
// change. Only Date is faked, so userEvent and findBy* timers stay real.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`))
})
afterEach(() => vi.useRealTimers())

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
    expect(screen.getByText('Monday has a meal on it. Move or remove the meal to hide the day.')).toBeInTheDocument()
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

  it('hiding a day drops its suggestion (it does not come back when the day is shown again)', async () => {
    renderPage()
    const wed = await screen.findByRole('region', { name: 'Wed Nov 4' })
    await waitFor(() => expect(within(wed).getByRole('button', { name: '✨ suggest' })).toBeEnabled())
    await userEvent.click(within(wed).getByRole('button', { name: '✨ suggest' }))
    setWeek({ weekDays: [0, 1, 2, 4] })               // the save "succeeds"; reload hides Wed
    await userEvent.click(dayButton('Wednesday'))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Wed Nov 4' })).not.toBeInTheDocument())
    setWeek({ weekDays: [0, 1, 2, 3, 4] })            // show it again
    await userEvent.click(dayButton('Wednesday'))
    const back = await screen.findByRole('region', { name: 'Wed Nov 4' })
    expect(within(back).queryByText('Suggestion · not saved yet')).not.toBeInTheDocument()
    expect(within(back).getByRole('button', { name: '✨ suggest' })).toBeInTheDocument()
  })

  it('if saving ✓ fails, the suggestion stays so she can try again', async () => {
    pm.addMeal.mockRejectedValueOnce(new Error('offline'))
    renderPage()
    const wed = await screen.findByRole('region', { name: 'Wed Nov 4' })
    await waitFor(() => expect(within(wed).getByRole('button', { name: '✨ suggest' })).toBeEnabled())
    await userEvent.click(within(wed).getByRole('button', { name: '✨ suggest' }))
    await userEvent.click(within(wed).getByRole('button', { name: /^Keep / }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't add that meal")
    expect(within(wed).getByText('Suggestion · not saved yet')).toBeInTheDocument()
  })

  it('a suggestion on a day that gets a meal another way is settled, not brought back', async () => {
    pm.loadMaybeList.mockResolvedValue([meal({ id: 'mx', planned_on: null, name: 'Lemon orzo soup', vault_id: null })])
    renderPage()
    const wed = await screen.findByRole('region', { name: 'Wed Nov 4' })
    await waitFor(() => expect(within(wed).getByRole('button', { name: '✨ suggest' })).toBeEnabled())
    await userEvent.click(within(wed).getByRole('button', { name: '✨ suggest' }))
    // Instead of ✓, she puts a Maybe meal on Wednesday.
    setWeek({ meals: [meal({ id: 'mx', planned_on: '2026-11-04', name: 'Lemon orzo soup', vault_id: null })] })
    await userEvent.click(screen.getByRole('tab', { name: /Maybe/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Lemon orzo soup' }))
    await userEvent.click(within(screen.getByTestId('day-choice-sheet')).getByRole('button', { name: 'Wed Nov 4' }))
    expect(pm.moveMeal).toHaveBeenCalledWith(supabase, 'mx', { plannedOn: '2026-11-04', position: 0 })
    await userEvent.click(screen.getByRole('tab', { name: /Week/ }))
    // Later she removes it: Wednesday is empty again and the old suggestion must not reappear.
    setWeek()
    await userEvent.click(within(await screen.findByRole('region', { name: 'Wed Nov 4' }))
      .getByRole('button', { name: 'Remove Lemon orzo soup' }))
    const after = await screen.findByRole('region', { name: 'Wed Nov 4' })
    await waitFor(() => expect(within(after).getByRole('button', { name: '+ add' })).toBeInTheDocument())
    expect(within(after).queryByText('Suggestion · not saved yet')).not.toBeInTheDocument()
  })
})

describe('switching weeks is safe while data is in flight', () => {
  it('a slow load for an earlier week never replaces the week on screen', async () => {
    let releaseFirst
    pm.loadWeek.mockImplementation(async (_sb, _u, start) => {
      if (start === '2026-11-08') await new Promise((r) => { releaseFirst = r })
      const meals = start === '2026-11-15' ? [meal({ id: 'n1', planned_on: '2026-11-16', name: 'Right week' })] : [
        meal({ id: 'o1', planned_on: '2026-11-09', name: 'Wrong week' })]
      return { weekStart: start, meals, weekDays: null, usualDays: [0, 1, 2, 3, 4] }
    })
    renderPage()
    await screen.findByTestId('week-title')
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }))   // Nov 8 (slow)
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }))   // Nov 15 (fast)
    expect(await screen.findByText('Right week')).toBeInTheDocument()
    releaseFirst()
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByTestId('week-title')).toHaveTextContent('Nov 15 – 21')
    expect(screen.queryByText('Wrong week')).not.toBeInTheDocument()
    expect(screen.getByText('Right week')).toBeInTheDocument()
  })

  it('← / → wait while a save is running', async () => {
    let finish
    pm.addMeal.mockImplementation(() => new Promise((r) => { finish = r }))
    renderPage()
    const wed = await screen.findByRole('region', { name: 'Wed Nov 4' })
    await userEvent.click(within(wed).getByRole('button', { name: '+ add' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search recipes' }), 'curry')
    await userEvent.click(screen.getByRole('button', { name: /Green curry/ }))
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled()
    finish({})
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next week' })).toBeEnabled())
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

describe('drag and drop between days', () => {
  const drop = (mealId, date) => act(async () => {
    dnd.onDragEnd({ active: { id: `meal:${mealId}` }, over: { id: `day:${date}` } })
  })

  it('every meal card can be picked up (grip with a label) and every day is a drop target', async () => {
    setWeek({ meals: [meal()] })
    renderPage()
    const mon = await screen.findByRole('region', { name: 'Mon Nov 2' })
    expect(within(mon).getByLabelText('Drag Sheet-pan gnocchi to another day')).toHaveAttribute('aria-roledescription', 'draggable')
    // Mouse + touch + keyboard — NOT PointerSensor, which claims touch presses and
    // breaks scrolling (as on the old Prep Table, retired in phase 4).
    expect(dnd.sensors.map((d) => d.sensor)).toEqual([MouseSensor, TouchSensor, KeyboardSensor])
  })

  it('dropping a meal on another day moves it there at once, then saves the move', async () => {
    let finish
    pm.moveMeal.mockImplementation(() => new Promise((r) => { finish = r }))
    setWeek({ meals: [meal()] })
    renderPage()
    await screen.findByRole('region', { name: 'Mon Nov 2' })
    await drop('m1', '2026-11-04')

    // On screen right away, before the save finishes.
    expect(within(dayRow('Wed Nov 4')).getByText('Sheet-pan gnocchi')).toBeInTheDocument()
    expect(within(dayRow('Mon Nov 2')).queryByText('Sheet-pan gnocchi')).not.toBeInTheDocument()
    expect(pm.moveMeal).toHaveBeenCalledWith(supabase, 'm1', { plannedOn: '2026-11-04', position: 0 })

    setWeek({ meals: [meal({ planned_on: '2026-11-04' })] })
    await act(async () => finish({}))
    expect(within(dayRow('Wed Nov 4')).getByText('Sheet-pan gnocchi')).toBeInTheDocument()
  })

  it('a day that already has a meal: the two swap spots, on screen at once, then both saved', async () => {
    let finish
    pm.moveMeal.mockImplementationOnce(() => new Promise((r) => { finish = r }))
    setWeek({ meals: [meal(), meal({ id: 'm2', planned_on: '2026-11-04', name: 'Tacos', vault_id: 'v2' })] })
    renderPage()
    await screen.findByRole('region', { name: 'Mon Nov 2' })
    await drop('m1', '2026-11-04')
    expect(within(dayRow('Wed Nov 4')).getByText('Sheet-pan gnocchi')).toBeInTheDocument()
    expect(within(dayRow('Mon Nov 2')).getByText('Tacos')).toBeInTheDocument()
    await act(async () => finish({}))
    expect(pm.moveMeal).toHaveBeenNthCalledWith(1, supabase, 'm1', { plannedOn: '2026-11-04', position: 0 })
    expect(pm.moveMeal).toHaveBeenNthCalledWith(2, supabase, 'm2', { plannedOn: '2026-11-02', position: 0 })
  })

  it('dropped onto a meal card: swap with that meal', async () => {
    setWeek({ meals: [meal(), meal({ id: 'm2', planned_on: '2026-11-05', position: 1, name: 'Tacos', vault_id: 'v2' }),
      meal({ id: 'm3', planned_on: '2026-11-05', position: 0, name: 'Pho', vault_id: null })] })
    renderPage()
    await screen.findByRole('region', { name: 'Mon Nov 2' })
    await act(async () => { dnd.onDragEnd({ active: { id: 'meal:m1' }, over: { id: 'slot:m2' } }) })
    expect(pm.moveMeal).toHaveBeenNthCalledWith(1, supabase, 'm1', { plannedOn: '2026-11-05', position: 1 })
    expect(pm.moveMeal).toHaveBeenNthCalledWith(2, supabase, 'm2', { plannedOn: '2026-11-02', position: 0 })
    expect(pm.moveMeal).toHaveBeenCalledTimes(2)
  })

  it('a day with 2+ meals, dropped beside them (not on a card): joins the end, nothing swaps', async () => {
    setWeek({ meals: [meal(), meal({ id: 'm2', planned_on: '2026-11-05', name: 'Tacos', vault_id: 'v2' }),
      meal({ id: 'm3', planned_on: '2026-11-05', position: 1, name: 'Pho', vault_id: null })] })
    renderPage()
    await screen.findByRole('region', { name: 'Mon Nov 2' })
    await drop('m1', '2026-11-05')
    expect(pm.moveMeal).toHaveBeenCalledTimes(1)
    expect(pm.moveMeal).toHaveBeenCalledWith(supabase, 'm1', { plannedOn: '2026-11-05', position: 2 })
  })

  it('if the second half of a swap fails, the first is undone and the screen goes back', async () => {
    pm.moveMeal.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({})
    setWeek({ meals: [meal(), meal({ id: 'm2', planned_on: '2026-11-04', name: 'Tacos', vault_id: 'v2' })] })
    renderPage()
    await screen.findByRole('region', { name: 'Mon Nov 2' })
    await drop('m1', '2026-11-04')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't swap those meals")
    expect(pm.moveMeal).toHaveBeenNthCalledWith(3, supabase, 'm1', { plannedOn: '2026-11-02', position: 0 }) // undo
    expect(within(dayRow('Mon Nov 2')).getByText('Sheet-pan gnocchi')).toBeInTheDocument()
    expect(within(dayRow('Wed Nov 4')).getByText('Tacos')).toBeInTheDocument()
  })

  it('only the dragged meal moves; other days keep their meals', async () => {
    setWeek({ meals: [meal(), meal({ id: 'm2', planned_on: '2026-11-03', name: 'Tacos', vault_id: 'v2' })] })
    renderPage()
    await screen.findByRole('region', { name: 'Mon Nov 2' })
    await drop('m1', '2026-11-05')   // empty Thursday: a plain move
    expect(pm.moveMeal).toHaveBeenCalledTimes(1)
    expect(within(dayRow('Tue Nov 3')).getByText('Tacos')).toBeInTheDocument()
  })

  it('if the save fails, the meal goes back and she is told', async () => {
    pm.moveMeal.mockRejectedValueOnce(new Error('offline'))
    setWeek({ meals: [meal()] })
    renderPage()
    await screen.findByRole('region', { name: 'Mon Nov 2' })
    await drop('m1', '2026-11-04')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't move that meal")
    await waitFor(() => expect(within(dayRow('Mon Nov 2')).getByText('Sheet-pan gnocchi')).toBeInTheDocument())
  })

  it('dropping it back on its own day does nothing', async () => {
    setWeek({ meals: [meal()] })
    renderPage()
    await screen.findByRole('region', { name: 'Mon Nov 2' })
    await drop('m1', '2026-11-02')
    expect(pm.moveMeal).not.toHaveBeenCalled()
  })
})

describe('drag and drop: failure, busy, suggestions, inner buttons', () => {
  const drop = (mealId, date) => act(async () => {
    dnd.onDragEnd({ active: { id: `meal:${mealId}` }, over: { id: `day:${date}` } })
  })

  it('offline: the save AND the reload fail — the meal still goes back to its day', async () => {
    setWeek({ meals: [meal()] })
    renderPage()
    await screen.findByRole('region', { name: 'Mon Nov 2' })
    pm.moveMeal.mockRejectedValueOnce(new Error('offline'))
    pm.loadWeek.mockRejectedValue(new Error('offline'))
    await drop('m1', '2026-11-04')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't move that meal")
    expect(within(dayRow('Mon Nov 2')).getByText('Sheet-pan gnocchi')).toBeInTheDocument()
    expect(within(dayRow('Wed Nov 4')).queryByText('Sheet-pan gnocchi')).not.toBeInTheDocument()
  })

  it('a second drop while the first is still saving is ignored', async () => {
    let finish
    pm.moveMeal.mockImplementationOnce(() => new Promise((r) => { finish = r }))
    setWeek({ meals: [meal(), meal({ id: 'm2', planned_on: '2026-11-03', name: 'Tacos', vault_id: 'v2' })] })
    renderPage()
    await screen.findByRole('region', { name: 'Mon Nov 2' })
    await drop('m1', '2026-11-04')
    await drop('m2', '2026-11-05')
    expect(pm.moveMeal).toHaveBeenCalledTimes(1)
    await act(async () => finish({}))
  })

  it("a suggestion on the day she drops onto is settled (doesn't return if the meal leaves)", async () => {
    setWeek({ meals: [meal()] })
    renderPage()
    const wed = await screen.findByRole('region', { name: 'Wed Nov 4' })
    await waitFor(() => expect(within(wed).getByRole('button', { name: '✨ suggest' })).toBeEnabled())
    await userEvent.click(within(wed).getByRole('button', { name: '✨ suggest' }))
    setWeek({ meals: [meal({ planned_on: '2026-11-04' })] })
    await drop('m1', '2026-11-04')
    setWeek({ meals: [meal()] })                       // dragged back to Monday
    await drop('m1', '2026-11-02')
    await waitFor(() => expect(within(dayRow('Wed Nov 4')).getByRole('button', { name: '+ add' })).toBeInTheDocument())
    expect(within(dayRow('Wed Nov 4')).queryByText('Suggestion · not saved yet')).not.toBeInTheDocument()
  })

  it('Enter / Space on a button inside a meal card still presses that button (not a drag)', async () => {
    setWeek({ meals: [meal()] })
    renderPage()
    const mon = await screen.findByRole('region', { name: 'Mon Nov 2' })
    within(mon).getByRole('button', { name: 'Remove Sheet-pan gnocchi' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(pm.removeMeal).toHaveBeenCalledWith(supabase, 'm1')
    within(mon).getByRole('checkbox', { name: 'Cooked Sheet-pan gnocchi' }).focus()
    await userEvent.keyboard(' ')
    expect(pm.setCooked).toHaveBeenCalledWith(supabase, 'm1', true)
  })

  it('every shown day renders as its own section (a drop target; real drops checked in Chromium)', async () => {
    renderPage()
    await screen.findByRole('region', { name: 'Mon Nov 2' })
    // Only checks the sections exist; that each is wired as a dnd-kit droppable was checked with real drags.
    const ids = Array.from(document.querySelectorAll('section[data-date]')).map((el) => el.getAttribute('data-date'))
    expect(ids).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'])
  })

  it('screen readers hear meal and day names, not internal ids', async () => {
    setWeek({ meals: [meal()] })
    renderPage()
    await screen.findByRole('region', { name: 'Mon Nov 2' })
    const a = dnd.accessibility.announcements
    expect(a.onDragStart({ active: { id: 'meal:m1' } })).toBe('Picked up Sheet-pan gnocchi.')
    expect(a.onDragEnd({ active: { id: 'meal:m1' }, over: { id: 'day:2026-11-04' } })).toBe('Sheet-pan gnocchi moved to Wed Nov 4.')
  })
})

describe('swap: when the undo fails too, same-day swaps, the mid-drag hint', () => {
  const drop = (mealId, date) => act(async () => {
    dnd.onDragEnd({ active: { id: `meal:${mealId}` }, over: { id: `day:${date}` } })
  })
  const twoMeals = () => [meal(), meal({ id: 'm2', planned_on: '2026-11-04', name: 'Tacos', vault_id: 'v2' })]
  afterEach(() => { fakeDragState = null })

  it('half a swap saved and the undo fails: shows what is really saved, and says so', async () => {
    setWeek({ meals: twoMeals() })
    renderPage()
    await screen.findByRole('region', { name: 'Mon Nov 2' })
    pm.moveMeal.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'))
    // what the database really holds now: gnocchi moved to Wed, tacos still on Wed
    setWeek({ meals: [meal({ planned_on: '2026-11-04' }), meal({ id: 'm2', planned_on: '2026-11-04', name: 'Tacos', vault_id: 'v2' })] })
    await drop('m1', '2026-11-04')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't finish swapping those meals. Here's where they are now.")
    expect(within(dayRow('Wed Nov 4')).getByText('Sheet-pan gnocchi')).toBeInTheDocument()
    expect(within(dayRow('Wed Nov 4')).getByText('Tacos')).toBeInTheDocument()
  })

  it('…and if even the reload fails, it says to refresh (never a silent mismatch)', async () => {
    setWeek({ meals: twoMeals() })
    renderPage()
    await screen.findByRole('region', { name: 'Mon Nov 2' })
    pm.moveMeal.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'))
    pm.loadWeek.mockRejectedValue(new Error('offline'))
    await drop('m1', '2026-11-04')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't finish swapping those meals. Refresh to see where they are.")
  })

  it('two meals on the same day swap their order', async () => {
    setWeek({ meals: [meal({ id: 'm1', planned_on: '2026-11-04', position: 0 }),
      meal({ id: 'm2', planned_on: '2026-11-04', position: 1, name: 'Tacos', vault_id: 'v2' })] })
    renderPage()
    await screen.findByRole('region', { name: 'Wed Nov 4' })
    await act(async () => { dnd.onDragEnd({ active: { id: 'meal:m1' }, over: { id: 'slot:m2' } }) })
    expect(pm.moveMeal).toHaveBeenNthCalledWith(1, supabase, 'm1', { plannedOn: '2026-11-04', position: 1 })
    expect(pm.moveMeal).toHaveBeenNthCalledWith(2, supabase, 'm2', { plannedOn: '2026-11-04', position: 0 })
  })

  it('mid-drag, the target day says what it will swap with (card, or a one-meal day) — not for an empty day', async () => {
    setWeek({ meals: twoMeals() })
    fakeDragState = { active: { id: 'meal:m1' }, over: { id: 'slot:m2' } }
    const { rerender } = renderPage()
    expect(await within(await screen.findByRole('region', { name: 'Wed Nov 4' })).findByTestId('swap-hint')).toHaveTextContent('⇄ Swap with Tacos')
    fakeDragState = { active: { id: 'meal:m1' }, over: { id: 'day:2026-11-04' } }
    rerender(<PrepTable userId="u1" today={TODAY} />)
    expect(within(dayRow('Wed Nov 4')).getByTestId('swap-hint')).toHaveTextContent('⇄ Swap with Tacos')
    fakeDragState = { active: { id: 'meal:m1' }, over: { id: 'day:2026-11-05' } }
    rerender(<PrepTable userId="u1" today={TODAY} />)
    expect(screen.queryByTestId('swap-hint')).not.toBeInTheDocument()
  })

  it('screen readers hear "would swap" over a one-meal day too', async () => {
    setWeek({ meals: twoMeals() })
    renderPage()
    await screen.findByRole('region', { name: 'Mon Nov 2' })
    expect(dnd.accessibility.announcements.onDragOver({ active: { id: 'meal:m1' }, over: { id: 'day:2026-11-04' } }))
      .toBe('Sheet-pan gnocchi would swap with Tacos.')
  })
})

describe('the cooked tick when a meal moves (Matt, 2026-11-04)', () => {
  const dropOn = (mealId, overId) => act(async () => {
    dnd.onDragEnd({ active: { id: `meal:${mealId}` }, over: { id: overId } })
  })
  const curry = (over = {}) => meal({ id: 'c1', planned_on: '2026-11-01', name: 'Green curry', vault_id: 'v1',
    cooked: true, cooked_at: '2026-11-02T03:00:00.000Z', ...over })

  it('dragged into the future → the tick comes off (saved; future days show no tick box)', async () => {
    setWeek({ meals: [curry()] })
    renderPage()
    await screen.findByRole('region', { name: 'Sun Nov 1' })
    await dropOn('c1', 'day:2026-11-04')
    expect(pm.moveMeal).toHaveBeenCalledWith(supabase, 'c1', { plannedOn: '2026-11-04', position: 0, cooked: false })
  })

  it('swapped with another cooked meal on a past day / today → both keep their ticks', async () => {
    setWeek({ meals: [curry(), meal({ cooked: true, cooked_at: '2026-11-03T03:00:00.000Z' })] })   // Mon = today
    renderPage()
    await screen.findByRole('region', { name: 'Sun Nov 1' })
    await dropOn('c1', 'slot:m1')
    expect(pm.moveMeal).toHaveBeenNthCalledWith(1, supabase, 'c1', { plannedOn: '2026-11-02', position: 0 })
    expect(pm.moveMeal).toHaveBeenNthCalledWith(2, supabase, 'm1', { plannedOn: '2026-11-01', position: 0 })
  })

  it('a cooked meal swapped with an uncooked one → the cooked one loses its tick; the other never gains one', async () => {
    let finish
    pm.moveMeal.mockImplementationOnce(() => new Promise((r) => { finish = r }))
    setWeek({ meals: [curry(), meal()] })                       // Mon gnocchi not cooked
    renderPage()
    await screen.findByRole('region', { name: 'Sun Nov 1' })
    await dropOn('c1', 'slot:m1')
    // on screen at once: nothing ticked
    expect(within(dayRow('Mon Nov 2')).getByRole('checkbox', { name: 'Cooked Green curry' })).toHaveAttribute('aria-checked', 'false')
    expect(within(dayRow('Sun Nov 1')).getByRole('checkbox', { name: 'Cooked Sheet-pan gnocchi' })).toHaveAttribute('aria-checked', 'false')
    await act(async () => finish({}))
    expect(pm.moveMeal).toHaveBeenNthCalledWith(1, supabase, 'c1', { plannedOn: '2026-11-02', position: 0, cooked: false })
    expect(pm.moveMeal).toHaveBeenNthCalledWith(2, supabase, 'm1', { plannedOn: '2026-11-01', position: 0 })
  })

  it('moved with the "Which day?" button → same rule (tick comes off)', async () => {
    setWeek({ meals: [curry()] })
    renderPage()
    const sun = await screen.findByRole('region', { name: 'Sun Nov 1' })
    await userEvent.click(within(sun).getByRole('button', { name: 'Move Green curry' }))
    await userEvent.click(within(screen.getByTestId('day-choice-sheet')).getByRole('button', { name: 'Mon Nov 2' }))
    expect(pm.moveMeal).toHaveBeenCalledWith(supabase, 'c1', { plannedOn: '2026-11-02', position: 0, cooked: false })
  })

  it('a failed swap is undone with the tick put back exactly', async () => {
    pm.moveMeal.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({})
    setWeek({ meals: [curry(), meal()] })
    renderPage()
    await screen.findByRole('region', { name: 'Sun Nov 1' })
    await dropOn('c1', 'slot:m1')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't swap those meals")
    expect(pm.moveMeal).toHaveBeenNthCalledWith(3, supabase, 'c1',
      { plannedOn: '2026-11-01', position: 0, cooked: true, cookedAt: '2026-11-02T03:00:00.000Z' })
    expect(within(dayRow('Sun Nov 1')).getByRole('checkbox', { name: 'Cooked Green curry' })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('colours match the app (brand orange, not green)', () => {
  it("a cooked meal's tick is brand orange", async () => {
    setWeek({ meals: [meal({ cooked: true })] })
    renderPage()
    const box = await screen.findByRole('checkbox', { name: 'Cooked Sheet-pan gnocchi' })
    const dot = box.firstElementChild
    expect(dot.className).toMatch(/bg-brand-600/)
    expect(dot.className).not.toMatch(/green/)
  })
})

// ---------------------------------------------------------------------------
// 2b-3 — Confirm the week + groceries (PRD-008 §4.4–4.5, P0.6)
// ---------------------------------------------------------------------------
const FULL_WEEK = [ // a meal on every shown day from today (Mon) on
  meal({ id: 'a', planned_on: '2026-11-02', name: 'Sheet-pan gnocchi', vault_id: 'v3' }),
  meal({ id: 'b', planned_on: '2026-11-03', name: 'Green curry', vault_id: 'v1' }),
  meal({ id: 'c', planned_on: '2026-11-04', name: 'Turkey tacos', vault_id: 'v2' }),
  meal({ id: 'd', planned_on: '2026-11-05', name: 'Pizza out', vault_id: null }),
]
const CONF = {
  id: 'c1', starts_on: '2026-11-01', ends_on: '2026-11-07', user_id: 'u1',
  confirmed_at: '2026-11-02T18:00:00', changed_at: null, grocery_list_id: 'L1',
}
const ITEMS = [
  { id: 'i1', name: 'Limes', quantity: '6', section: 'Produce' },
  { id: 'i2', name: 'Ground turkey', quantity: '1 lb', section: 'Meat & Seafood' },
]
const confirmButton = () => screen.findByRole('button', { name: 'Confirm the week' })

describe('Confirm the week', () => {
  beforeEach(() => {
    wg.confirmWeek.mockResolvedValue({ ...CONF, grocery_list_id: null })
    wg.makeWeekGroceryList.mockResolvedValue({ listId: 'L1', notInCookbook: ['Pizza out'], noIngredients: [] })
    wg.loadGroceryItems.mockResolvedValue(ITEMS)
    wg.keepListAsIs.mockResolvedValue(true)
  })

  it('an empty week has nothing to confirm', async () => {
    renderPage()
    await screen.findByRole('region', { name: 'Mon Nov 2' })
    expect(screen.queryByRole('button', { name: 'Confirm the week' })).not.toBeInTheDocument()
  })

  it('confirm → stamps this week, makes its list, and opens it', async () => {
    setWeek({ meals: FULL_WEEK })
    wg.loadConfirmation.mockResolvedValueOnce(null).mockResolvedValue(CONF)
    renderPage()
    await userEvent.click(await confirmButton())

    expect(wg.confirmWeek).toHaveBeenCalledWith(supabase, 'u1', '2026-11-01')
    expect(wg.makeWeekGroceryList).toHaveBeenCalledWith(supabase, 'u1', { ...CONF, grocery_list_id: null })
    const sheet = await screen.findByTestId('grocery-sheet')
    expect(wg.loadGroceryItems).toHaveBeenCalledWith(supabase, 'L1')
    expect(within(sheet).getByRole('region', { name: 'Produce' })).toHaveTextContent('Limes6')
    expect(within(sheet).getByRole('region', { name: 'Meat & Seafood' })).toHaveTextContent('Ground turkey1 lb')
    expect(sheet).toHaveTextContent('Not on the list (not in your Cookbook): Pizza out.')
    expect(screen.getByRole('region', { name: 'Week confirmed' })).toHaveTextContent('Confirmed Mon Nov 2')
  })

  it('Assumed you have: Add saves and moves the item onto the list; Always have saves her pantry list', async () => {
    setWeek({ meals: FULL_WEEK })
    wg.loadConfirmation.mockResolvedValue(CONF)
    wg.loadGroceryItems.mockResolvedValue([
      ...ITEMS,
      { id: 'i3', name: 'soy sauce', quantity: '1 bottle', recipe_quantity: '3 tbsp', section: 'Pantry', assumed: true },
      { id: 'i4', name: 'cumin', quantity: '1 jar', recipe_quantity: '2¼ tsp', section: 'Pantry', assumed: true },
    ])
    wg.setAssumed.mockResolvedValue({ id: 'i3', assumed: false })
    wg.setAlwaysHave.mockResolvedValue(['cumin'])
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Grocery list/ }))
    const sheet = await screen.findByTestId('grocery-sheet')
    expect(sheet).toHaveTextContent('Nov 1 – 7 · 4 dinners')
    expect(within(sheet).queryByRole('region', { name: 'Pantry' })).not.toBeInTheDocument()

    await userEvent.click(within(sheet).getByRole('button', { name: /Assumed you have/ }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add Soy sauce' }))
    expect(wg.setAssumed).toHaveBeenCalledWith(supabase, 'i3', false)
    expect(await within(sheet).findByRole('region', { name: 'Pantry' })).toHaveTextContent('Soy sauceRecipes use 3 tbsp1 bottle')

    await userEvent.click(within(sheet).getByRole('button', { name: 'Always have Cumin' }))
    expect(wg.setAlwaysHave).toHaveBeenCalledWith(supabase, 'u1', 'cumin', true)
    expect(await within(sheet).findByText('Not shown, in your pantry list: cumin.')).toBeInTheDocument()
  })

  it('Added by you (2c): adds her own line to the open list, and ✕ takes it off', async () => {
    setWeek({ meals: FULL_WEEK })
    wg.loadConfirmation.mockResolvedValue(CONF)
    wg.loadGroceryItems.mockResolvedValue(ITEMS)
    wg.addOwnItem.mockResolvedValue({ id: 'own1', name: 'Paper towels', quantity: null, section: 'Other', assumed: false, is_adhoc: true })
    wg.removeOwnItem.mockResolvedValue(undefined)
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Grocery list/ }))
    const sheet = await screen.findByTestId('grocery-sheet')

    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add your own item' }), 'Paper towels{Enter}')
    expect(wg.addOwnItem).toHaveBeenCalledWith(supabase, 'L1', 'Paper towels')
    const own = await within(sheet).findByRole('region', { name: 'Added by you' })
    expect(await within(own).findByText('Paper towels')).toBeInTheDocument()

    await userEvent.click(within(own).getByRole('button', { name: 'Remove Paper towels' }))
    expect(wg.removeOwnItem).toHaveBeenCalledWith(supabase, 'own1')
    await waitFor(() => expect(within(own).queryByText('Paper towels')).not.toBeInTheDocument())
  })

  it('names the recipes whose amounts are guesses, and Update list remakes the list from the sheet', async () => {
    // Green curry's list came from her screenshots; the others are guesses.
    VAULT[0].ingredients_source = 'screenshot'
    try {
      setWeek({ meals: FULL_WEEK })
      wg.loadConfirmation.mockResolvedValue(CONF)
      wg.loadGroceryItems.mockResolvedValue(ITEMS)
      wg.makeWeekGroceryList.mockResolvedValue({ listId: 'L2', notInCookbook: [], noIngredients: [], noList: [] })
      renderPage()
      await userEvent.click(await screen.findByRole('button', { name: /Grocery list/ }))
      const sheet = await screen.findByTestId('grocery-sheet')
      const note = within(sheet).getByTestId('guessed-note')
      expect(note).toHaveTextContent('Amounts for Sheet-pan gnocchi and Turkey tacos are estimates.')
      expect(note).not.toHaveTextContent('Green curry')

      await userEvent.click(within(sheet).getByRole('button', { name: 'Update list' }))
      expect(wg.makeWeekGroceryList).toHaveBeenCalledWith(supabase, 'u1', CONF)
      await waitFor(() => expect(wg.loadGroceryItems).toHaveBeenCalledWith(supabase, 'L2'))
    } finally {
      delete VAULT[0].ingredients_source
    }
  })

  it('empty nights are told, never blocking: "Not yet" waits, "Confirm anyway" confirms', async () => {
    setWeek({ meals: [FULL_WEEK[0]] }) // only Monday has a meal
    renderPage()
    await userEvent.click(await confirmButton())
    expect(screen.getByRole('region', { name: 'Confirm the week' }))
      .toHaveTextContent('Tue Nov 3, Wed Nov 4 and Thu Nov 5 have no meal yet. The grocery list will skip them.')
    expect(wg.confirmWeek).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Not yet' }))
    expect(wg.confirmWeek).not.toHaveBeenCalled()

    await userEvent.click(await confirmButton())
    await userEvent.click(screen.getByRole('button', { name: 'Confirm anyway' }))
    expect(wg.confirmWeek).toHaveBeenCalledTimes(1)
  })

  it('one empty night reads in the singular', async () => {
    setWeek({ meals: FULL_WEEK.slice(0, 3) }) // Thursday empty
    renderPage()
    await userEvent.click(await confirmButton())
    expect(screen.getByText('Thu Nov 5 has no meal yet. The grocery list will skip it.')).toBeInTheDocument()
  })

  it('a past week offers no Confirm', async () => {
    setWeek({ meals: FULL_WEEK })
    renderPage()
    await confirmButton()
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(await screen.findByTestId('week-title')).toHaveTextContent('Oct 25 – 31')
    expect(screen.queryByRole('button', { name: 'Confirm the week' })).not.toBeInTheDocument()
  })

  it("the stamp fails: says so and makes no list", async () => {
    setWeek({ meals: FULL_WEEK })
    wg.confirmWeek.mockRejectedValue(new Error('offline'))
    renderPage()
    await userEvent.click(await confirmButton())
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't confirm the week. Try again.")
    expect(wg.makeWeekGroceryList).not.toHaveBeenCalled()
  })

  it('the list fails: the week stays confirmed and offers to make the list', async () => {
    setWeek({ meals: FULL_WEEK })
    wg.loadConfirmation.mockResolvedValueOnce(null).mockResolvedValue({ ...CONF, grocery_list_id: null })
    wg.makeWeekGroceryList.mockRejectedValueOnce(new wg.WeekGroceryError('api', 'boom'))
    renderPage()
    await userEvent.click(await confirmButton())
    expect(await screen.findByRole('alert'))
      .toHaveTextContent("The week is confirmed, but the grocery list couldn't be made. Try again.")
    expect(screen.queryByTestId('grocery-sheet')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Make the grocery list' }))
    expect(wg.confirmWeek).toHaveBeenCalledTimes(1) // not stamped twice
    expect(wg.makeWeekGroceryList).toHaveBeenCalledTimes(2)
    expect(await screen.findByTestId('grocery-sheet')).toBeInTheDocument()
  })

  it('no cookbook recipes in the week: confirmed, with a plain note instead of a list', async () => {
    setWeek({ meals: [meal({ planned_on: '2026-11-02', vault_id: null, name: 'Pizza out' })] })
    wg.loadConfirmation.mockResolvedValueOnce(null).mockResolvedValue({ ...CONF, grocery_list_id: null })
    wg.makeWeekGroceryList.mockRejectedValue(new wg.WeekGroceryError('no_recipes', 'none'))
    renderPage()
    await userEvent.click(await confirmButton())
    await userEvent.click(screen.getByRole('button', { name: 'Confirm anyway' }))
    expect(await screen.findByText(/None of this week's meals are cookbook recipes/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('changed since you confirmed → update the grocery list?', () => {
  beforeEach(() => {
    setWeek({ meals: FULL_WEEK })
    wg.makeWeekGroceryList.mockResolvedValue({ listId: 'L2', notInCookbook: [], noIngredients: [] })
    wg.loadGroceryItems.mockResolvedValue(ITEMS)
    wg.keepListAsIs.mockResolvedValue(true)
  })

  it('a confirmed, unchanged week shows the stamp and its list, no prompt', async () => {
    wg.loadConfirmation.mockResolvedValue(CONF)
    renderPage()
    expect(await screen.findByRole('region', { name: 'Week confirmed' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Changed since you confirmed' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm the week' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Grocery list' }))
    expect(await screen.findByTestId('grocery-sheet')).toHaveTextContent('Limes')
    expect(wg.loadGroceryItems).toHaveBeenCalledWith(supabase, 'L1')
  })

  it('an edit after confirming shows the prompt (the stamp is re-read after every save)', async () => {
    wg.loadConfirmation.mockResolvedValueOnce(CONF).mockResolvedValue({ ...CONF, changed_at: '2026-11-02T19:00:00+00:00' })
    renderPage()
    await screen.findByRole('region', { name: 'Week confirmed' })
    expect(screen.queryByRole('region', { name: 'Changed since you confirmed' })).not.toBeInTheDocument()

    await userEvent.click(within(dayRow('Tue Nov 3')).getByRole('button', { name: /Remove/ }))
    expect(await screen.findByRole('region', { name: 'Changed since you confirmed' }))
      .toHaveTextContent('This week changed since you confirmed it. Update the grocery list?')
  })

  it('"Update list" remakes the list from the stamp it saw, and opens it', async () => {
    const changed = { ...CONF, changed_at: '2026-11-02T19:00:00+00:00' }
    wg.loadConfirmation.mockResolvedValueOnce(changed).mockResolvedValue({ ...CONF, grocery_list_id: 'L2' })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Update list' }))
    expect(wg.makeWeekGroceryList).toHaveBeenCalledWith(supabase, 'u1', changed)
    expect(wg.confirmWeek).not.toHaveBeenCalled()
    expect(await screen.findByTestId('grocery-sheet')).toBeInTheDocument()
    expect(wg.loadGroceryItems).toHaveBeenCalledWith(supabase, 'L2')
    expect(screen.queryByRole('region', { name: 'Changed since you confirmed' })).not.toBeInTheDocument()
  })

  it('"Keep as is" clears the prompt without making a list', async () => {
    const changed = { ...CONF, changed_at: '2026-11-02T19:00:00+00:00' }
    wg.loadConfirmation.mockResolvedValueOnce(changed).mockResolvedValue(CONF)
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Keep as is' }))
    expect(wg.keepListAsIs).toHaveBeenCalledWith(supabase, changed)
    expect(wg.makeWeekGroceryList).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Changed since you confirmed' })).not.toBeInTheDocument())
  })

  it("moving to another week while the list loads never shows last week's list", async () => {
    wg.loadConfirmation.mockResolvedValue(CONF)
    let finish
    wg.loadGroceryItems.mockImplementation(() => new Promise((r) => { finish = r }))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Grocery list' }))
    expect(screen.getByTestId('grocery-sheet')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await act(async () => finish(ITEMS))
    expect(await screen.findByTestId('week-title')).toHaveTextContent('Nov 8 – 14')
    expect(screen.queryByTestId('grocery-sheet')).not.toBeInTheDocument()
  })

  it('a failed update says so and keeps the prompt', async () => {
    const changed = { ...CONF, changed_at: '2026-11-02T19:00:00+00:00' }
    wg.loadConfirmation.mockResolvedValue(changed)
    wg.makeWeekGroceryList.mockRejectedValue(new Error('offline'))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Update list' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't make the grocery list. Try again.")
    expect(screen.getByRole('region', { name: 'Changed since you confirmed' })).toBeInTheDocument()
  })
})

describe('the list says which recipes it could not really use', () => {
  it('note: no ingredients (left off) and no saved list (a guess), with the fix', () => {
    expect(thinRecipesNote({ noIngredients: [], noList: [] })).toBeNull()
    expect(thinRecipesNote({ noIngredients: ['Mystery'], noList: ['Penne alla Vodka'] })).toBe(
      'Mystery added nothing (no ingredients). Penne alla Vodka has no ingredient list, so its part is a guess. ' +
      'Add screenshots in the Cookbook for the real amounts.')
    expect(thinRecipesNote({ noList: ['A', 'B'] })).toMatch(/^A, B have no ingredient list, so their part is a guess\./)
  })

  it('shown under "Confirmed" after the list is made', async () => {
    setWeek({ meals: FULL_WEEK })
    wg.loadConfirmation.mockResolvedValueOnce(null).mockResolvedValue(CONF)
    wg.confirmWeek.mockResolvedValue({ ...CONF, grocery_list_id: null })
    wg.makeWeekGroceryList.mockResolvedValue({ listId: 'L1', notInCookbook: [], noIngredients: [], noList: ['Green curry'] })
    wg.loadGroceryItems.mockResolvedValue(ITEMS)
    renderPage()
    await userEvent.click(await confirmButton())
    expect(await screen.findByRole('region', { name: 'Week confirmed' }))
      .toHaveTextContent('Green curry has no ingredient list, so its part is a guess.')
  })
})
