import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatLocalDate } from '../dateUtils'

describe('formatLocalDate', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the local-calendar date even at the day boundary', () => {
    // 11pm local on 2026-04-26. Under the old `toISOString().split('T')[0]`
    // approach this would shift forward a day in any timezone west of UTC
    // (e.g. Pacific) — that is exactly the AUDIT U8 regression we're guarding
    // against. The Date is built from local components, so the assertion
    // holds regardless of where the test runs.
    const lateAtNight = new Date(2026, 3, 26, 23, 0, 0)
    expect(formatLocalDate(lateAtNight)).toBe('2026-04-26')
  })

  it('zero-pads single-digit months and days', () => {
    expect(formatLocalDate(new Date(2026, 0, 5, 12))).toBe('2026-01-05')
  })

  it('defaults to today (local time) when called with no args', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 26, 15, 30))
    expect(formatLocalDate()).toBe('2026-04-26')
  })
})
