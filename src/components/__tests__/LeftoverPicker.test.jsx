import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import LeftoverPicker from '../LeftoverPicker'

const LEFTOVERS = [
  {
    id: 'L1',
    name: 'Pancakes',
    is_wildcard: false,
    scheduled_date: '2026-04-12',
    source_url: null,
  },
  {
    id: 'L2',
    name: 'Tacos',
    is_wildcard: false,
    scheduled_date: '2026-04-13',
    source_url: null,
  },
  {
    id: 'L3',
    name: 'Curry',
    is_wildcard: true,
    scheduled_date: '2026-04-14',
    source_url: 'https://example.com/curry',
  },
]

describe('LeftoverPicker', () => {
  it('starts with all leftovers checked and confirms with every id', () => {
    const onConfirm = vi.fn()
    render(
      <LeftoverPicker
        leftovers={LEFTOVERS}
        periodStart="2026-05-01"
        periodEnd="2026-05-05"
        onBack={() => {}}
        onConfirm={onConfirm}
      />,
    )

    const rows = screen.getAllByTestId('leftover-row')
    expect(rows).toHaveLength(3)
    // Every checkbox starts checked
    rows.forEach((row) => {
      const cb = within(row).getByRole('checkbox')
      expect(cb).toBeChecked()
    })

    expect(screen.getByTestId('leftover-counter')).toHaveTextContent(
      /3 selected \/ 5 days available/,
    )

    fireEvent.click(screen.getByTestId('leftover-confirm'))
    expect(onConfirm).toHaveBeenCalledWith(['L1', 'L2', 'L3'])
  })

  it('unchecking a row removes it from the confirmed ids', () => {
    const onConfirm = vi.fn()
    render(
      <LeftoverPicker
        leftovers={LEFTOVERS}
        periodStart="2026-05-01"
        periodEnd="2026-05-05"
        onBack={() => {}}
        onConfirm={onConfirm}
      />,
    )

    // Uncheck L2
    const rows = screen.getAllByTestId('leftover-row')
    const tacosRow = rows.find((r) => within(r).queryByText('Tacos'))
    fireEvent.click(within(tacosRow).getByRole('checkbox'))

    expect(screen.getByTestId('leftover-counter')).toHaveTextContent(
      /2 selected \/ 5 days available/,
    )

    fireEvent.click(screen.getByTestId('leftover-confirm'))
    const confirmedIds = onConfirm.mock.calls[0][0]
    expect(confirmedIds).toHaveLength(2)
    expect(confirmedIds).toEqual(expect.arrayContaining(['L1', 'L3']))
    expect(confirmedIds).not.toContain('L2')
  })

  it('shows dropped count when more selected than days available', () => {
    render(
      <LeftoverPicker
        leftovers={LEFTOVERS}
        periodStart="2026-05-01"
        periodEnd="2026-05-02" // 2-day period, 3 leftovers checked by default
        onBack={() => {}}
        onConfirm={() => {}}
      />,
    )

    expect(screen.getByTestId('leftover-counter')).toHaveTextContent(
      /3 selected \/ 2 days available/,
    )
    expect(screen.getByTestId('leftover-counter')).toHaveTextContent(
      /1 will be dropped/,
    )
  })

  it('does not show dropped count when the selection fits', () => {
    render(
      <LeftoverPicker
        leftovers={LEFTOVERS}
        periodStart="2026-05-01"
        periodEnd="2026-05-05"
        onBack={() => {}}
        onConfirm={() => {}}
      />,
    )

    expect(screen.getByTestId('leftover-counter')).not.toHaveTextContent(
      /will be dropped/,
    )
  })

  it('back button fires onBack', () => {
    const onBack = vi.fn()
    render(
      <LeftoverPicker
        leftovers={LEFTOVERS}
        periodStart="2026-05-01"
        periodEnd="2026-05-05"
        onBack={onBack}
        onConfirm={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('leftover-back'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
