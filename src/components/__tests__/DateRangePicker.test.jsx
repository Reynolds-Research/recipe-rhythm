import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import DateRangePicker from '../DateRangePicker'
import * as writer from '../../lib/mealPlanWriter'

vi.mock('../../lib/supabase', () => ({
  supabase: {},
}))

// The component uses a 300ms debounce before calling checkPeriodOverlap.
// We use real timers here (not vi.useFakeTimers) because Testing Library's
// waitFor drives its own timers internally; pairing real timers with a
// generous waitFor timeout is simpler than the fake-timer + act dance.
describe('DateRangePicker', () => {
  beforeEach(() => {
    vi.spyOn(writer, 'checkPeriodOverlap').mockResolvedValue({ overlaps: false })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('two-tap range selection: first tap sets start, second sets end; confirm fires prop', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <DateRangePicker
        userId="user-1"
        initialStart="2026-05-01"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByTestId('calendar-day-2026-05-05'))
    expect(screen.getByText(/Start:/)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('calendar-day-2026-05-10'))

    await waitFor(
      () => {
        expect(writer.checkPeriodOverlap).toHaveBeenCalledWith(
          expect.anything(),
          'user-1',
          '2026-05-05',
          '2026-05-10',
        )
      },
      { timeout: 2000 },
    )

    await waitFor(
      () => {
        expect(screen.getByTestId('picker-confirm')).not.toBeDisabled()
      },
      { timeout: 2000 },
    )

    fireEvent.click(screen.getByTestId('picker-confirm'))
    expect(onConfirm).toHaveBeenCalledWith({
      periodStart: '2026-05-05',
      periodEnd: '2026-05-10',
    })
  })

  it('disables confirm and shows overlap banner when a conflicting period exists', async () => {
    writer.checkPeriodOverlap.mockResolvedValueOnce({
      overlaps: true,
      conflictingPeriod: { period_start: '2026-05-04', period_end: '2026-05-08' },
    })

    render(
      <DateRangePicker
        userId="user-1"
        initialStart="2026-05-01"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    )

    fireEvent.click(screen.getByTestId('calendar-day-2026-05-05'))
    fireEvent.click(screen.getByTestId('calendar-day-2026-05-07'))

    await waitFor(
      () => {
        expect(screen.getByTestId('overlap-banner')).toBeInTheDocument()
      },
      { timeout: 2000 },
    )
    expect(screen.getByTestId('picker-confirm')).toBeDisabled()
  })

  it('swaps start and end when the user picks an earlier second tap', async () => {
    const onConfirm = vi.fn()
    render(
      <DateRangePicker
        userId="user-1"
        initialStart="2026-05-01"
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByTestId('calendar-day-2026-05-15'))
    fireEvent.click(screen.getByTestId('calendar-day-2026-05-10'))

    await waitFor(
      () => {
        expect(screen.getByTestId('picker-confirm')).not.toBeDisabled()
      },
      { timeout: 2000 },
    )
    fireEvent.click(screen.getByTestId('picker-confirm'))
    expect(onConfirm).toHaveBeenCalledWith({
      periodStart: '2026-05-10',
      periodEnd: '2026-05-15',
    })
  })

  it('cancel button fires prop', () => {
    const onCancel = vi.fn()
    render(
      <DateRangePicker
        userId="user-1"
        initialStart="2026-05-01"
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('picker-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('allows a single-day range (start == end)', async () => {
    const onConfirm = vi.fn()
    render(
      <DateRangePicker
        userId="user-1"
        initialStart="2026-05-01"
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByTestId('calendar-day-2026-05-05'))
    fireEvent.click(screen.getByTestId('calendar-day-2026-05-05'))

    await waitFor(
      () => {
        expect(screen.getByTestId('picker-confirm')).not.toBeDisabled()
      },
      { timeout: 2000 },
    )
    fireEvent.click(screen.getByTestId('picker-confirm'))
    expect(onConfirm).toHaveBeenCalledWith({
      periodStart: '2026-05-05',
      periodEnd: '2026-05-05',
    })
  })
})
