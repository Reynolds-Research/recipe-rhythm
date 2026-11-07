import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// PRD-008 phase 3b — Matt's nights on the Prep Table. Same set-up as
// PrepTable.test.jsx: the data layers are mocked (each is tested on its own);
// the week logic, suggestions and night labels are the real ones.
vi.mock('../../../lib/plannedMeals', async (importOriginal) => ({
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
vi.mock('../../../lib/cookNights', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real, // labels are pure logic: the real ones
    loadNights: vi.fn(),
    loadMembers: vi.fn(),
    giveNight: vi.fn(),
    takeBackNight: vi.fn(),
  }
})
vi.mock('../../../lib/preferences', () => ({ getPreferences: vi.fn(async () => null) }))
vi.mock('../../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

import * as pm from '../../../lib/plannedMeals'
import * as wg from '../../../lib/weekGroceries'
import * as cn from '../../../lib/cookNights'
import { supabase } from '../../../lib/supabase'
import PrepTable from '../index'

const TODAY = '2026-11-02' // Monday; the week is Sun Nov 1 – Sat Nov 7
const HER = 'u-her'
const MATT = 'u-matt'
const MEMBERS = [{ user_id: HER, display_name: 'Sara' }, { user_id: MATT, display_name: 'Matt' }]

// Her week has chicken (Thai); the cookbook offers another chicken dish, and
// turkey and a vegetarian one.
const VAULT = [
  { id: 'v1', name: 'Green curry', cuisine_type: 'Thai', proteins: ['Chicken'] },
  { id: 'v2', name: 'Chicken satay', cuisine_type: 'Thai', proteins: ['Chicken'] },
  { id: 'v3', name: 'Turkey tacos', cuisine_type: 'Mexican', proteins: ['Turkey'] },
]

function meal(over) {
  return { id: 'm1', planned_on: '2026-11-02', position: 0, name: 'Green curry', vault_id: 'v1',
    is_wildcard: false, source_url: null, cooked: false, cooked_at: null, user_id: HER, ...over }
}

function kitchenQuery() {
  const chain = {}
  for (const k of ['select', 'eq', 'is', 'gte']) chain[k] = vi.fn(() => chain)
  chain.order = vi.fn(() => Promise.resolve({ data: chain._table === 'vault' ? VAULT : [], error: null }))
  return chain
}

function setWeek({ meals = [], nights = [] } = {}) {
  pm.loadWeek.mockImplementation(async (_sb, _u, start) => ({
    weekStart: start, weekEnd: start, meals, weekDays: null, usualDays: [0, 1, 2, 3, 4],
  }))
  cn.loadNights.mockResolvedValue(nights)
}

const dayRow = (label) => screen.getByRole('region', { name: label })
const renderAs = (userId) => render(<PrepTable userId={userId} today={TODAY} />)

beforeEach(() => {
  vi.clearAllMocks()
  supabase.from.mockImplementation((table) => { const c = kitchenQuery(); c._table = table; return c })
  setWeek()
  pm.loadMaybeList.mockResolvedValue([])
  pm.loadDidntGetTo.mockResolvedValue([])
  for (const f of ['saveWeekDays', 'addMeal', 'moveMeal', 'removeMeal', 'setCooked']) pm[f].mockResolvedValue({})
  wg.loadConfirmation.mockResolvedValue(null)
  cn.loadMembers.mockResolvedValue(MEMBERS)
  cn.giveNight.mockResolvedValue({})
  cn.takeBackNight.mockResolvedValue()
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
})
afterEach(() => vi.restoreAllMocks())

describe('her phone: handing a night to Matt', () => {
  it('"Give to Matt" on an upcoming day hands that night to him', async () => {
    renderAs(HER)
    await userEvent.click(await screen.findByRole('button', { name: 'Give to Matt: Tue' }))
    expect(cn.giveNight).toHaveBeenCalledWith(supabase, HER, '2026-11-03', MATT)
    expect(cn.loadNights).toHaveBeenLastCalledWith(supabase, HER, '2026-11-01', '2026-11-07') // reloaded
  })

  it('no "Give to" on a past day', async () => {
    renderAs(HER)
    await screen.findByRole('button', { name: 'Give to Matt: Tue' })
    expect(screen.queryByRole('button', { name: 'Give to Matt: Sun' })).not.toBeInTheDocument()
  })

  it('his night reads "Matt\'s night"; tapping it takes the night back', async () => {
    setWeek({ nights: [{ cooks_on: '2026-11-03', cook_id: MATT }] })
    renderAs(HER)
    const chip = await screen.findByRole('button', { name: "Matt's night on Tue. Tap to take it back" })
    await userEvent.click(chip)
    expect(cn.takeBackNight).toHaveBeenCalledWith(supabase, HER, '2026-11-03')
  })

  it('his empty night waits for him: no + add or ✨ there', async () => {
    setWeek({ nights: [{ cooks_on: '2026-11-03', cook_id: MATT }] })
    renderAs(HER)
    const tue = await screen.findByRole('region', { name: 'Tue Nov 3' })
    expect(within(tue).getByText('Matt’s picking')).toBeInTheDocument()
    expect(within(tue).queryByRole('button', { name: '+ add' })).not.toBeInTheDocument()
    expect(within(tue).queryByRole('button', { name: '✨ suggest' })).not.toBeInTheDocument()
  })

  it('"Suggest the empty days" leaves his night alone', async () => {
    setWeek({ nights: [{ cooks_on: '2026-11-03', cook_id: MATT }] })
    renderAs(HER)
    await userEvent.click(await screen.findByRole('button', { name: /Suggest the empty days/ }))
    expect(within(dayRow('Wed Nov 4')).getByText('Suggestion · not saved yet')).toBeInTheDocument()
    expect(within(dayRow('Tue Nov 3')).queryByText('Suggestion · not saved yet')).not.toBeInTheDocument()
  })

  it('a meal he picked on his night says so', async () => {
    setWeek({
      nights: [{ cooks_on: '2026-11-03', cook_id: MATT }],
      meals: [meal({ id: 'm9', planned_on: '2026-11-03', name: 'Turkey tacos', vault_id: 'v3', user_id: MATT })],
    })
    renderAs(HER)
    expect(await screen.findByText('Matt picked this')).toBeInTheDocument()
  })

  it('Confirm names his empty night and offers to wait for him', async () => {
    setWeek({
      meals: [meal({ planned_on: '2026-11-02' })],
      nights: [{ cooks_on: '2026-11-03', cook_id: MATT }],
    })
    renderAs(HER)
    await userEvent.click(await screen.findByRole('button', { name: /Confirm the week/ }))
    const section = screen.getByRole('region', { name: 'Confirm the week' })
    expect(section).toHaveTextContent('Tue Nov 3 is Matt’s night. Nothing picked yet.')
    expect(section).toHaveTextContent('Wed Nov 4 and Thu Nov 5 have no meal yet. The grocery list will skip them.')
    expect(within(section).getByRole('button', { name: 'Wait for Matt' })).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Confirm anyway' })).toBeInTheDocument()
  })

  it('if nights can\'t be read, the week still loads (just without nights)', async () => {
    cn.loadNights.mockRejectedValue(new Error('relation "cook_nights" does not exist'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderAs(HER)
    expect(await screen.findByRole('region', { name: 'Tue Nov 3' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('with nobody else in the household there\'s no "Give to" button', async () => {
    cn.loadMembers.mockResolvedValue([{ user_id: HER, display_name: 'Sara' }])
    renderAs(HER)
    await screen.findByRole('region', { name: 'Tue Nov 3' })
    expect(screen.queryByRole('button', { name: /^Give to/ })).not.toBeInTheDocument()
  })
})

describe('his phone: "Your night · Pick something"', () => {
  beforeEach(() => {
    setWeek({
      meals: [meal({ planned_on: '2026-11-02' })], // her Monday: Green curry (Thai, chicken)
      nights: [{ cooks_on: '2026-11-03', cook_id: MATT }],
    })
  })

  it('his night reads "Your night" with "Pick something", and a banner counts it', async () => {
    renderAs(MATT)
    const tue = await screen.findByRole('region', { name: 'Tue Nov 3' })
    expect(within(tue).getByRole('button', { name: 'Your night on Tue. Tap to take it back' })).toBeInTheDocument()
    expect(within(tue).getByText('Pick something')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Your nights to pick' })).toHaveTextContent('1 night to pick this week: Tue.')
  })

  it('one suggestion is ready, and it doesn\'t echo her nights (no second Thai chicken dish)', async () => {
    renderAs(MATT)
    const tue = await screen.findByRole('region', { name: 'Tue Nov 3' })
    expect(await within(tue).findByText('Suggestion · not saved yet')).toBeInTheDocument()
    expect(within(tue).getByText('Turkey tacos')).toBeInTheDocument()
    expect(within(tue).queryByText('Chicken satay')).not.toBeInTheDocument()
  })

  it('✓ saves his pick on his night; the banner goes once it\'s filled', async () => {
    renderAs(MATT)
    const tue = await screen.findByRole('region', { name: 'Tue Nov 3' })
    await userEvent.click(await within(tue).findByRole('button', { name: 'Keep Turkey tacos' }))
    expect(pm.addMeal).toHaveBeenCalledWith(supabase, MATT, expect.objectContaining({
      plannedOn: '2026-11-03', name: 'Turkey tacos', vaultId: 'v3',
    }))
  })

  it('✕ on the ready suggestion sticks (no new one pops back)', async () => {
    renderAs(MATT)
    const tue = await screen.findByRole('region', { name: 'Tue Nov 3' })
    await userEvent.click(await within(tue).findByRole('button', { name: 'Not Turkey tacos' }))
    expect(within(tue).queryByText('Suggestion · not saved yet')).not.toBeInTheDocument()
    expect(within(tue).getByRole('button', { name: '✨ suggest' })).toBeInTheDocument()
  })
})
