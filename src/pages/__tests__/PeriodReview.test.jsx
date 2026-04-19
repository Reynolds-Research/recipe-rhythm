import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PeriodReview from '../PeriodReview'

// Replace the writer with mock fns we can assert on per test. The component
// imports `setItemCooked` and `finalizePlan` from this module path, so the
// mock has to live here (not in setupTests.js).
vi.mock('../../lib/mealPlanWriter', () => ({
  setItemCooked: vi.fn(),
  finalizePlan: vi.fn(),
}))

// supabase is read by PeriodReview only as a token to pass through to the
// writer functions — we mock both, so a placeholder client is fine.
vi.mock('../../lib/supabase', () => ({
  supabase: { __mock: true },
}))

import { setItemCooked, finalizePlan } from '../../lib/mealPlanWriter'

const PLAN = {
  id: 'plan-1',
  period_start: '2026-04-19',
  period_end: '2026-04-23',
  finalized_at: null,
  served_at: '2026-04-19T12:00:00Z',
  source: 'new',
  days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'],
  items: [
    { day: 'Sun', name: 'Roast',    id: 'v1', is_wildcard: false, source_url: null, item_id: 'mpi-1', scheduled_date: '2026-04-19', cooked: false, cooked_at: null },
    { day: 'Mon', name: 'Tacos',    id: 'v2', is_wildcard: false, source_url: null, item_id: 'mpi-2', scheduled_date: '2026-04-20', cooked: true,  cooked_at: '2026-04-20T18:00:00Z' },
    { day: 'Tue', name: 'Ramen',    id: 'v3', is_wildcard: false, source_url: null, item_id: 'mpi-3', scheduled_date: '2026-04-21', cooked: false, cooked_at: null },
  ],
}

describe('PeriodReview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setItemCooked.mockResolvedValue(undefined)
    finalizePlan.mockResolvedValue({ finalized_at: '2026-04-23T18:00:00Z' })
  })

  it('renders each item with its current cooked state', () => {
    render(
      <PeriodReview
        plan={PLAN}
        userId="user-1"
        onFinalized={() => {}}
        onClose={() => {}}
        showFinalizeButton={false}
      />,
    )

    // The header shows the human-readable period range.
    expect(screen.getByText(/Apr 19 – 23, 2026/i)).toBeInTheDocument()

    // Each item label is present.
    expect(screen.getByText('Roast')).toBeInTheDocument()
    expect(screen.getByText('Tacos')).toBeInTheDocument()
    expect(screen.getByText('Ramen')).toBeInTheDocument()

    // Cooked state is reflected on the checkboxes (associated by label).
    const roastBox = screen.getByLabelText(/Roast/)
    const tacosBox = screen.getByLabelText(/Tacos/)
    expect(roastBox.checked).toBe(false)
    expect(tacosBox.checked).toBe(true)
  })

  it('optimistically toggles a checkbox and persists via setItemCooked', async () => {
    render(
      <PeriodReview
        plan={PLAN}
        userId="user-1"
        onFinalized={() => {}}
        onClose={() => {}}
        showFinalizeButton={false}
      />,
    )

    const roastBox = screen.getByLabelText(/Roast/)
    fireEvent.click(roastBox)

    // Optimistic: the box flips before the await resolves.
    expect(roastBox.checked).toBe(true)

    await waitFor(() => {
      expect(setItemCooked).toHaveBeenCalledWith(
        expect.anything(),
        'mpi-1',
        true,
      )
    })
  })

  it('rolls back the checkbox visual state when setItemCooked rejects', async () => {
    setItemCooked.mockRejectedValueOnce(new Error('network down'))

    render(
      <PeriodReview
        plan={PLAN}
        userId="user-1"
        onFinalized={() => {}}
        onClose={() => {}}
        showFinalizeButton={false}
      />,
    )

    const roastBox = screen.getByLabelText(/Roast/)
    fireEvent.click(roastBox)

    // Optimistic flip to true...
    expect(roastBox.checked).toBe(true)

    // ...then rollback after the rejection settles.
    await waitFor(() => {
      expect(roastBox.checked).toBe(false)
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/could not save/i)
  })

  it('omits the finalize button when showFinalizeButton is false', () => {
    render(
      <PeriodReview
        plan={PLAN}
        userId="user-1"
        onFinalized={() => {}}
        onClose={() => {}}
        showFinalizeButton={false}
      />,
    )

    expect(screen.queryByRole('button', { name: /lock in and finalize/i })).toBeNull()
    // Close button is always present.
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('calls finalizePlan and onFinalized when the user locks in', async () => {
    const onFinalized = vi.fn()

    render(
      <PeriodReview
        plan={PLAN}
        userId="user-1"
        onFinalized={onFinalized}
        onClose={() => {}}
        showFinalizeButton={true}
      />,
    )

    const finalizeBtn = screen.getByRole('button', { name: /lock in and finalize/i })
    fireEvent.click(finalizeBtn)

    await waitFor(() => {
      expect(finalizePlan).toHaveBeenCalledWith(expect.anything(), 'plan-1')
    })
    expect(onFinalized).toHaveBeenCalledTimes(1)
  })

  it('invokes onClose when the close button is clicked', () => {
    const onClose = vi.fn()

    render(
      <PeriodReview
        plan={PLAN}
        userId="user-1"
        onFinalized={() => {}}
        onClose={onClose}
        showFinalizeButton={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
