import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, onClick }) => (
      <div className={className} onClick={onClick}>{children}</div>
    ),
  },
}))

import MothersDayCard from '../MothersDayCard'

const STORAGE_KEY = 'rr_mothers_day_2026_dismissed_v1'

describe('MothersDayCard', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders on 2026-05-10 when not yet dismissed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-10T10:00:00'))
    render(<MothersDayCard />)
    expect(screen.getByText(/happy mother's day/i)).toBeInTheDocument()
  })

  it('does not render on 2026-05-09', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-09T10:00:00'))
    render(<MothersDayCard />)
    expect(screen.queryByText(/happy mother's day/i)).not.toBeInTheDocument()
  })

  it('clicking Continue sets the localStorage flag and removes the card', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-10T10:00:00'))
    render(<MothersDayCard />)
    expect(screen.getByText(/happy mother's day/i)).toBeInTheDocument()

    // Restore real timers before userEvent interaction to avoid timer conflicts
    vi.useRealTimers()
    await userEvent.setup().click(screen.getByRole('button', { name: /continue/i }))

    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
    expect(screen.queryByText(/happy mother's day/i)).not.toBeInTheDocument()
  })

  it('does not render on 2026-05-10 if the dismissed flag is already set', () => {
    localStorage.setItem(STORAGE_KEY, 'true')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-10T10:00:00'))
    render(<MothersDayCard />)
    expect(screen.queryByText(/happy mother's day/i)).not.toBeInTheDocument()
  })
})
