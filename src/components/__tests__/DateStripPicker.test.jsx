import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import DateStripPicker from '../DateStripPicker'

// Anchor "today" so cell count and date math are deterministic.
const TODAY = new Date(2026, 3, 19) // 2026-04-19, a Sunday

function ymd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n)
}

const TODAY_YMD = ymd(TODAY)
const DAY_PLUS_3 = ymd(addDays(TODAY, 3))
const DAY_PLUS_8 = ymd(addDays(TODAY, 8))
const DAY_PLUS_13 = ymd(addDays(TODAY, 13))

describe('DateStripPicker', () => {
  it('renders 7 cells by default (today through today+6)', () => {
    render(
      <DateStripPicker
        selectedDates={[]}
        disabledDates={new Set()}
        onToggle={() => {}}
        today={TODAY}
      />,
    )

    const row1 = screen.getByTestId('date-strip-row-1')
    expect(within(row1).getAllByRole('button')).toHaveLength(7)
    expect(screen.queryByTestId('date-strip-row-2')).not.toBeInTheDocument()
    // The expand affordance is visible.
    expect(screen.getByTestId('date-strip-expand')).toBeInTheDocument()
  })

  it('reveals 7 more cells when "Show another 7 days" is tapped', () => {
    render(
      <DateStripPicker
        selectedDates={[]}
        disabledDates={new Set()}
        onToggle={() => {}}
        today={TODAY}
      />,
    )

    fireEvent.click(screen.getByTestId('date-strip-expand'))

    const row2 = screen.getByTestId('date-strip-row-2')
    expect(within(row2).getAllByRole('button')).toHaveLength(7)
    // Last cell of the second row is today+13.
    expect(screen.getByTestId(`date-strip-cell-${DAY_PLUS_13}`)).toBeInTheDocument()
    // The collapse link replaces the expand button.
    expect(screen.queryByTestId('date-strip-expand')).not.toBeInTheDocument()
    expect(screen.getByTestId('date-strip-collapse')).toBeInTheDocument()
  })

  it('collapses back to 7 cells when "Hide second week" is tapped', () => {
    render(
      <DateStripPicker
        selectedDates={[]}
        disabledDates={new Set()}
        onToggle={() => {}}
        today={TODAY}
      />,
    )

    fireEvent.click(screen.getByTestId('date-strip-expand'))
    fireEvent.click(screen.getByTestId('date-strip-collapse'))

    expect(screen.queryByTestId('date-strip-row-2')).not.toBeInTheDocument()
    expect(screen.getByTestId('date-strip-expand')).toBeInTheDocument()
  })

  it('starts expanded when a selected date is in the second week', () => {
    render(
      <DateStripPicker
        selectedDates={[DAY_PLUS_8]}
        disabledDates={new Set()}
        onToggle={() => {}}
        today={TODAY}
      />,
    )

    expect(screen.getByTestId('date-strip-row-2')).toBeInTheDocument()
    expect(screen.getByTestId('date-strip-collapse')).toBeInTheDocument()
  })

  it('calls onToggle with the date when a default cell is tapped', () => {
    const onToggle = vi.fn()
    render(
      <DateStripPicker
        selectedDates={[]}
        disabledDates={new Set()}
        onToggle={onToggle}
        today={TODAY}
      />,
    )

    fireEvent.click(screen.getByTestId(`date-strip-cell-${DAY_PLUS_3}`))
    expect(onToggle).toHaveBeenCalledWith(DAY_PLUS_3)
  })

  it('does not fire onToggle for disabled cells and exposes the right aria-label', () => {
    const onToggle = vi.fn()
    render(
      <DateStripPicker
        selectedDates={[]}
        disabledDates={new Set([DAY_PLUS_3])}
        onToggle={onToggle}
        today={TODAY}
      />,
    )

    const cell = screen.getByTestId(`date-strip-cell-${DAY_PLUS_3}`)
    expect(cell).toBeDisabled()
    expect(cell.getAttribute('aria-label')).toMatch(
      /Already planned in another period/i,
    )
    fireEvent.click(cell)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('marks today with the today data attribute', () => {
    render(
      <DateStripPicker
        selectedDates={[]}
        disabledDates={new Set()}
        onToggle={() => {}}
        today={TODAY}
      />,
    )

    const cell = screen.getByTestId(`date-strip-cell-${TODAY_YMD}`)
    expect(cell.dataset.today).toBe('true')
  })

  it('keeps a second-week selection in parent state when collapsed (no spurious toggle)', () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <DateStripPicker
        selectedDates={[DAY_PLUS_8]}
        disabledDates={new Set()}
        onToggle={onToggle}
        today={TODAY}
      />,
    )

    // Auto-expanded on mount because of the second-week selection.
    expect(screen.getByTestId('date-strip-collapse')).toBeInTheDocument()

    // Collapse manually — must not deselect the second-week date.
    fireEvent.click(screen.getByTestId('date-strip-collapse'))
    expect(onToggle).not.toHaveBeenCalled()

    // Parent re-render with the same selection: no row 2, but the summary
    // shows the date so the user knows it's still selected.
    rerender(
      <DateStripPicker
        selectedDates={[DAY_PLUS_8]}
        disabledDates={new Set()}
        onToggle={onToggle}
        today={TODAY}
      />,
    )
    const summary = screen.getByTestId('date-strip-summary')
    expect(summary).toHaveTextContent(/1\s+of\s+7/i)
    // The summary range reflects the offscreen second-week selection.
    expect(summary.textContent ?? '').toMatch(/of 7 days selected · /)
  })

  it('summary count reflects the visible horizon and selection range', () => {
    const dayPlus1 = ymd(addDays(TODAY, 1))
    const dayPlus5 = ymd(addDays(TODAY, 5))
    render(
      <DateStripPicker
        selectedDates={[dayPlus1, dayPlus5]}
        disabledDates={new Set()}
        onToggle={() => {}}
        today={TODAY}
      />,
    )

    const summary = screen.getByTestId('date-strip-summary')
    expect(summary).toHaveTextContent(/2\s+of\s+7\s+days/i)
  })

  it('summary horizon updates to 14 when expanded', () => {
    render(
      <DateStripPicker
        selectedDates={[]}
        disabledDates={new Set()}
        onToggle={() => {}}
        today={TODAY}
      />,
    )

    fireEvent.click(screen.getByTestId('date-strip-expand'))
    expect(screen.getByTestId('date-strip-summary')).toHaveTextContent(
      /0\s+of\s+14\s+days/i,
    )
  })
})
