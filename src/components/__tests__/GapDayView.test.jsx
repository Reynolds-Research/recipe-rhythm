import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import GapDayView from '../GapDayView'

// The component fetches leftovers via the supabase client singleton. We mock
// the whole module so tests control what fetchCurrentLeftovers sees.
const mockQuery = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  then: vi.fn((cb) => cb({ data: [], error: null })),
}
vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn(() => mockQuery) },
}))

function mockLeftovers(rows) {
  mockQuery.then.mockImplementation((cb) => cb({ data: rows, error: null }))
}

describe('GapDayView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.select.mockReturnThis()
    mockQuery.eq.mockReturnThis()
    mockQuery.order.mockReturnThis()
  })

  it('renders the leftover list when there are leftovers', async () => {
    mockLeftovers([
      {
        id: 'item-1',
        name: 'Pancakes',
        vault_id: 'v1',
        is_wildcard: false,
        source_url: null,
        scheduled_date: '2026-04-12',
        source_period_start: '2026-04-12',
        source_period_end: '2026-04-18',
      },
      {
        id: 'item-2',
        name: 'Curry',
        vault_id: null,
        is_wildcard: true,
        source_url: 'https://example.com/curry',
        scheduled_date: '2026-04-14',
        source_period_start: '2026-04-12',
        source_period_end: '2026-04-18',
      },
    ])

    render(
      <GapDayView
        userId="user-1"
        periodEnd="2026-04-18"
        onStartNewPeriod={() => {}}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('Pancakes')).toBeInTheDocument()
    })
    expect(screen.getByText('Curry')).toBeInTheDocument()
    expect(screen.getByTestId('gap-leftover-list')).toBeInTheDocument()
    expect(screen.queryByTestId('gap-no-leftovers')).not.toBeInTheDocument()
    // Wildcard badge shows for the wildcard row
    expect(screen.getByText(/wildcard/i)).toBeInTheDocument()
  })

  it('renders the empty-state message when there are no leftovers', async () => {
    mockLeftovers([])

    render(
      <GapDayView
        userId="user-1"
        periodEnd="2026-04-18"
        onStartNewPeriod={() => {}}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('gap-no-leftovers')).toBeInTheDocument()
    })
    expect(screen.getByText(/nothing left over/i)).toBeInTheDocument()
    expect(screen.queryByTestId('gap-leftover-list')).not.toBeInTheDocument()
  })

  it('calls onStartNewPeriod when the CTA is clicked', async () => {
    mockLeftovers([])
    const onStart = vi.fn()

    render(
      <GapDayView
        userId="user-1"
        periodEnd="2026-04-18"
        onStartNewPeriod={onStart}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('start-new-period-btn')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('start-new-period-btn'))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('shows the formatted period end date in the header copy', async () => {
    mockLeftovers([])

    render(
      <GapDayView
        userId="user-1"
        periodEnd="2026-04-18"
        onStartNewPeriod={() => {}}
      />,
    )

    await waitFor(() => {
      // "Apr 18" — timezone-stable via UTC parsing
      expect(screen.getByText(/Apr 18/)).toBeInTheDocument()
    })
  })
})
