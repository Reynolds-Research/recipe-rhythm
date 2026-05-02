import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import CalendarView from '../CalendarView'
import * as reader from '../../lib/mealPlanReader'

vi.mock('../../lib/supabase', () => ({
  supabase: {},
}))

function mockRange(rows) {
  return vi.spyOn(reader, 'fetchScheduledItemsInRange').mockResolvedValue(rows)
}

// April 2026 — April 1 is a Wednesday, so the grid's leading Sunday is Mar 29.
// We fix the month via `initialMonth` so tests don't depend on `new Date()`.
const APRIL_2026 = new Date(2026, 3, 15) // April 15 2026

describe('CalendarView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders 42 cells for the visible month (6 rows x 7 cols)', async () => {
    const spy = mockRange([])
    render(<CalendarView userId="user-1" initialMonth={APRIL_2026} />)

    await waitFor(() => expect(spy).toHaveBeenCalled())
    const grid = screen.getByTestId('calendar-grid')
    // 42 cells — 6-week stable layout, same as DateRangePicker.
    expect(within(grid).getAllByRole('button')).toHaveLength(42)
    // Month label reflects the initialMonth (UTC-stable).
    expect(screen.getByTestId('calendar-month-label')).toHaveTextContent('April 2026')
  })

  it('fetches a window that spans prev + current + next months', async () => {
    const spy = mockRange([])
    render(<CalendarView userId="user-1" initialMonth={APRIL_2026} />)

    await waitFor(() => expect(spy).toHaveBeenCalled())
    const [, userId, from, to] = spy.mock.calls[0]
    expect(userId).toBe('user-1')
    // March 1 2026 through May 31 2026 — 1 month buffer each side.
    expect(from).toBe('2026-03-01')
    expect(to).toBe('2026-05-31')
  })

  it('marks a scheduled date with the has-items dot and applies active-period shading', async () => {
    // PRD-005 Phase 6 / P0.9: cells now render just the date number + a small
    // status dot. The full meal name lives in the popover only — see the
    // tap-to-expand test below for that assertion.
    mockRange([
      {
        item_id: 'mpi-1',
        scheduled_date: '2026-04-12',
        name: 'Pancakes',
        cooked: false,
        meal_plan_id: 'plan-active',
        period_start: '2026-04-12',
        period_end: '2026-04-18',
        finalized_at: null,
      },
    ])
    render(<CalendarView userId="user-1" initialMonth={APRIL_2026} />)

    await waitFor(() => {
      expect(screen.getByTestId('calendar-dot-2026-04-12')).toBeInTheDocument()
    })
    const cell = screen.getByTestId('calendar-cell-2026-04-12')
    expect(cell).toHaveAttribute('data-period-state', 'active')
    expect(cell).toHaveAttribute('data-has-items', 'true')
  })

  it('applies finalized-period shading to dates inside a finalized period', async () => {
    mockRange([
      {
        item_id: 'mpi-fin',
        scheduled_date: '2026-04-05',
        name: 'Ramen',
        cooked: true,
        meal_plan_id: 'plan-finalized',
        period_start: '2026-04-01',
        period_end: '2026-04-07',
        finalized_at: '2026-04-08T12:00:00Z',
      },
    ])
    render(<CalendarView userId="user-1" initialMonth={APRIL_2026} />)

    await waitFor(() => {
      expect(screen.getByTestId('calendar-cell-2026-04-05')).toHaveAttribute(
        'data-period-state',
        'finalized',
      )
    })
    // An in-period date with no item should still be shaded finalized.
    expect(screen.getByTestId('calendar-cell-2026-04-03')).toHaveAttribute(
      'data-period-state',
      'finalized',
    )
  })

  it('prev/next buttons change the month header and trigger a new fetch', async () => {
    const spy = mockRange([])
    render(<CalendarView userId="user-1" initialMonth={APRIL_2026} />)

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('calendar-month-label')).toHaveTextContent('April 2026')

    fireEvent.click(screen.getByTestId('calendar-next'))
    await waitFor(() => {
      expect(screen.getByTestId('calendar-month-label')).toHaveTextContent('May 2026')
    })
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    expect(spy.mock.calls[1][2]).toBe('2026-04-01')
    expect(spy.mock.calls[1][3]).toBe('2026-06-30')

    fireEvent.click(screen.getByTestId('calendar-prev'))
    await waitFor(() => {
      expect(screen.getByTestId('calendar-month-label')).toHaveTextContent('April 2026')
    })
  })

  it('memoizes fetches per month — no duplicate request when navigating back', async () => {
    const spy = mockRange([])
    render(<CalendarView userId="user-1" initialMonth={APRIL_2026} />)
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByTestId('calendar-next'))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByTestId('calendar-prev'))
    // Returning to April hits the cache — no third call.
    await waitFor(() => {
      expect(screen.getByTestId('calendar-month-label')).toHaveTextContent('April 2026')
    })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('clicking a cell with items opens the popover; clicking outside closes it', async () => {
    mockRange([
      {
        item_id: 'mpi-1',
        scheduled_date: '2026-04-12',
        name: 'Pancakes',
        cooked: false,
        meal_plan_id: 'plan-active',
        period_start: '2026-04-12',
        period_end: '2026-04-18',
        finalized_at: null,
      },
      {
        item_id: 'mpi-2',
        scheduled_date: '2026-04-12',
        name: 'Side Salad',
        cooked: false,
        meal_plan_id: 'plan-active',
        period_start: '2026-04-12',
        period_end: '2026-04-18',
        finalized_at: null,
      },
    ])
    render(<CalendarView userId="user-1" initialMonth={APRIL_2026} />)

    await waitFor(() => {
      expect(screen.getByTestId('calendar-dot-2026-04-12')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('calendar-cell-2026-04-12'))
    expect(screen.getByTestId('calendar-popover')).toBeInTheDocument()
    const popoverItems = screen.getByTestId('calendar-popover-items')
    expect(within(popoverItems).getByText('Pancakes')).toBeInTheDocument()
    expect(within(popoverItems).getByText('Side Salad')).toBeInTheDocument()
    // Period range copy shows in the popover header.
    const popover = screen.getByTestId('calendar-popover')
    expect(within(popover).getByText(/Apr 12\s+–\s+Apr 18/)).toBeInTheDocument()

    // Click the backdrop → popover closes.
    fireEvent.click(screen.getByTestId('calendar-popover-backdrop'))
    expect(screen.queryByTestId('calendar-popover')).not.toBeInTheDocument()
  })

  it('does not open the popover for a date with no scheduled items', async () => {
    mockRange([])
    render(<CalendarView userId="user-1" initialMonth={APRIL_2026} />)

    await waitFor(() => expect(reader.fetchScheduledItemsInRange).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('calendar-cell-2026-04-10'))
    expect(screen.queryByTestId('calendar-popover')).not.toBeInTheDocument()
  })

  it('renders a legend explaining the shading', async () => {
    mockRange([])
    render(<CalendarView userId="user-1" initialMonth={APRIL_2026} />)
    await waitFor(() => expect(reader.fetchScheduledItemsInRange).toHaveBeenCalled())
    const legend = screen.getByTestId('calendar-legend')
    expect(within(legend).getByText(/Active period/i)).toBeInTheDocument()
    expect(within(legend).getByText(/Finalized/i)).toBeInTheDocument()
    expect(within(legend).getByText(/Today/i)).toBeInTheDocument()
  })
})
