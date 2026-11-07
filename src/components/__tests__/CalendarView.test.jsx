import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import CalendarView from '../CalendarView'
import * as planned from '../../lib/plannedMeals'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

// The Calendar tab reads planned_meals and shades the weeks she confirmed
// (PRD-008 2c; the old period tables were retired in phase 4). Her real
// November, roughly.
const NOV_2026 = new Date(2026, 10, 15)

function mockPlanned({ meals = [], confirmations = [] } = {}) {
  return vi.spyOn(planned, 'loadCalendarRange').mockResolvedValue({ meals, confirmations })
}

describe('CalendarView', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('reads planned_meals for prev + current + next month', async () => {
    const spy = mockPlanned()
    render(<CalendarView userId="user-1" initialMonth={NOV_2026} />)

    await waitFor(() => expect(spy).toHaveBeenCalled())
    const [, userId, from, to] = spy.mock.calls[0]
    expect([userId, from, to]).toEqual(['user-1', '2026-10-01', '2026-12-31'])
  })

  // Kept from the old calendar tests (they never depended on periods).
  it('renders 42 cells for the visible month (6 rows x 7 cols)', async () => {
    const spy = mockPlanned()
    render(<CalendarView userId="user-1" initialMonth={NOV_2026} />)
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(within(screen.getByTestId('calendar-grid')).getAllByRole('button')).toHaveLength(42)
    expect(screen.getByTestId('calendar-month-label')).toHaveTextContent('November 2026')
  })

  it('prev/next change the month and fetch its window; going back uses the cache', async () => {
    const spy = mockPlanned()
    render(<CalendarView userId="user-1" initialMonth={NOV_2026} />)
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByTestId('calendar-next'))
    await waitFor(() => expect(screen.getByTestId('calendar-month-label')).toHaveTextContent('December 2026'))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    expect(spy.mock.calls[1].slice(2)).toEqual(['2026-11-01', '2027-01-31'])

    fireEvent.click(screen.getByTestId('calendar-prev'))
    await waitFor(() => expect(screen.getByTestId('calendar-month-label')).toHaveTextContent('November 2026'))
    expect(spy).toHaveBeenCalledTimes(2) // November came from the cache
  })

  it('no popover for a day with no meals; the backdrop closes an open one', async () => {
    mockPlanned({ meals: [{ id: 'm1', planned_on: '2026-11-12', position: 0, name: 'Pancakes', cooked: false }] })
    render(<CalendarView userId="user-1" initialMonth={NOV_2026} />)
    await waitFor(() =>
      expect(screen.getByTestId('calendar-cell-2026-11-12')).toHaveAttribute('data-has-items', 'true'),
    )
    fireEvent.click(screen.getByTestId('calendar-cell-2026-11-10'))
    expect(screen.queryByTestId('calendar-popover')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('calendar-cell-2026-11-12'))
    expect(screen.getByTestId('calendar-popover')).toHaveTextContent('Pancakes')
    fireEvent.click(screen.getByTestId('calendar-popover-backdrop'))
    expect(screen.queryByTestId('calendar-popover')).not.toBeInTheDocument()
  })

  it('dots days with a meal and shades the days of a confirmed week', async () => {
    mockPlanned({
      meals: [{ id: 'm1', planned_on: '2026-11-09', position: 0, name: 'Butternut Squash Mac n Cheese', cooked: false }],
      confirmations: [{ id: 'c1', starts_on: '2026-11-08', ends_on: '2026-11-14' }],
    })
    render(<CalendarView userId="user-1" initialMonth={NOV_2026} />)

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
    render(<CalendarView userId="user-1" initialMonth={NOV_2026} />)
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
    render(<CalendarView userId="user-1" initialMonth={NOV_2026} />)
    await waitFor(() =>
      expect(screen.getByTestId('calendar-cell-2026-11-20')).toHaveAttribute('data-has-items', 'true'),
    )
    fireEvent.click(screen.getByTestId('calendar-cell-2026-11-20'))
    expect(screen.queryByTestId('calendar-popover-confirmed')).not.toBeInTheDocument()
  })

  it('the legend explains the shading (no periods, no gap days)', async () => {
    mockPlanned()
    render(<CalendarView userId="user-1" initialMonth={NOV_2026} />)
    const legend = screen.getByTestId('calendar-legend')
    expect(legend).toHaveTextContent('Confirmed week')
    expect(legend).not.toHaveTextContent(/Active period|Finalized|Gap day/)
  })

  it('a failed read shows an empty month, not an error', async () => {
    vi.spyOn(planned, 'loadCalendarRange').mockRejectedValue(new Error('offline'))
    render(<CalendarView userId="user-1" initialMonth={NOV_2026} />)
    await waitFor(() => expect(screen.getByTestId('calendar-grid').className).toMatch(/opacity-100/))
    expect(screen.getByTestId('calendar-cell-2026-11-03')).toHaveAttribute('data-has-items', 'false')
  })
})
