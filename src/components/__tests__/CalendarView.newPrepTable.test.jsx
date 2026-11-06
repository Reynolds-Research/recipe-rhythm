import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CalendarView from '../CalendarView'
import * as reader from '../../lib/mealPlanReader'
import * as planned from '../../lib/plannedMeals'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

// PRD-008 2c: with the new Prep Table on, the Calendar tab reads planned_meals
// and shades the weeks she confirmed. Her real November, roughly.
const NOV_2026 = new Date(2026, 10, 15)

function mockPlanned({ meals = [], confirmations = [] } = {}) {
  return vi.spyOn(planned, 'loadCalendarRange').mockResolvedValue({ meals, confirmations })
}

describe('CalendarView — new Prep Table', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.unstubAllEnvs())

  it('reads planned_meals for prev + current + next month, never the old plan tables', async () => {
    const spy = mockPlanned()
    const old = vi.spyOn(reader, 'fetchScheduledItemsInRange').mockResolvedValue([])
    render(<CalendarView userId="user-1" initialMonth={NOV_2026} newPrepTable />)

    await waitFor(() => expect(spy).toHaveBeenCalled())
    const [, userId, from, to] = spy.mock.calls[0]
    expect([userId, from, to]).toEqual(['user-1', '2026-10-01', '2026-12-31'])
    expect(old).not.toHaveBeenCalled()
  })

  it('follows the VITE_NEW_PREP_TABLE switch when no prop is given', async () => {
    vi.stubEnv('VITE_NEW_PREP_TABLE', 'true')
    const spy = mockPlanned()
    render(<CalendarView userId="user-1" initialMonth={NOV_2026} />)
    await waitFor(() => expect(spy).toHaveBeenCalled())
  })

  it('dots days with a meal and shades the days of a confirmed week', async () => {
    mockPlanned({
      meals: [{ id: 'm1', planned_on: '2026-11-09', position: 0, name: 'Butternut Squash Mac n Cheese', cooked: false }],
      confirmations: [{ id: 'c1', starts_on: '2026-11-08', ends_on: '2026-11-14' }],
    })
    render(<CalendarView userId="user-1" initialMonth={NOV_2026} newPrepTable />)

    await waitFor(() =>
      expect(screen.getByTestId('calendar-cell-2026-11-09')).toHaveAttribute('data-has-items', 'true'),
    )
    expect(screen.getByTestId('calendar-cell-2026-11-08')).toHaveAttribute('data-period-state', 'confirmed')
    expect(screen.getByTestId('calendar-cell-2026-11-14')).toHaveAttribute('data-period-state', 'confirmed')
    expect(screen.getByTestId('calendar-cell-2026-11-15')).toHaveAttribute('data-period-state', 'none')
  })

  it('the popover lists the meals, marks cooked ones, and names the confirmed week', async () => {
    mockPlanned({
      meals: [{ id: 'm1', planned_on: '2026-11-03', position: 0, name: 'Shrimp Tacos', cooked: true }],
      confirmations: [{ id: 'c1', starts_on: '2026-11-01', ends_on: '2026-11-07' }],
    })
    render(<CalendarView userId="user-1" initialMonth={NOV_2026} newPrepTable />)
    await waitFor(() =>
      expect(screen.getByTestId('calendar-cell-2026-11-03')).toHaveAttribute('data-has-items', 'true'),
    )

    fireEvent.click(screen.getByTestId('calendar-cell-2026-11-03'))
    expect(screen.getByTestId('calendar-popover')).toHaveTextContent('Shrimp Tacos')
    expect(screen.getByTestId('calendar-popover')).toHaveTextContent(/Cooked/i)
    expect(screen.getByTestId('calendar-popover-confirmed')).toHaveTextContent('Confirmed Nov 1 – Nov 7')
  })

  it('a meal outside any confirmed week shows no confirmed line', async () => {
    mockPlanned({ meals: [{ id: 'm1', planned_on: '2026-11-20', position: 0, name: 'Curry', cooked: false }] })
    render(<CalendarView userId="user-1" initialMonth={NOV_2026} newPrepTable />)
    await waitFor(() =>
      expect(screen.getByTestId('calendar-cell-2026-11-20')).toHaveAttribute('data-has-items', 'true'),
    )
    fireEvent.click(screen.getByTestId('calendar-cell-2026-11-20'))
    expect(screen.queryByTestId('calendar-popover-confirmed')).not.toBeInTheDocument()
  })

  it('the legend speaks the new language (no periods, no gap days)', async () => {
    mockPlanned()
    render(<CalendarView userId="user-1" initialMonth={NOV_2026} newPrepTable />)
    const legend = screen.getByTestId('calendar-legend')
    expect(legend).toHaveTextContent('Confirmed week')
    expect(legend).not.toHaveTextContent(/Active period|Finalized|Gap day/)
  })

  it('a failed read shows an empty month, not an error', async () => {
    vi.spyOn(planned, 'loadCalendarRange').mockRejectedValue(new Error('offline'))
    render(<CalendarView userId="user-1" initialMonth={NOV_2026} newPrepTable />)
    await waitFor(() => expect(screen.getByTestId('calendar-grid').className).toMatch(/opacity-100/))
    expect(screen.getByTestId('calendar-cell-2026-11-03')).toHaveAttribute('data-has-items', 'false')
  })
})
