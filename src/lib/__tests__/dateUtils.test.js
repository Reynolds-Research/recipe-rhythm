import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatLocalDate, formatLastCooked } from '../dateUtils'

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

describe('formatLastCooked', () => {
  it('returns "today" when eaten_on equals the reference day', () => {
    expect(formatLastCooked('2026-05-05', '2026-05-05')).toBe('today')
  })

  it('returns "yesterday" for a one-day gap', () => {
    expect(formatLastCooked('2026-05-04', '2026-05-05')).toBe('yesterday')
  })

  it('returns "N days ago" for 2–13 days', () => {
    expect(formatLastCooked('2026-05-03', '2026-05-05')).toBe('2 days ago')
    expect(formatLastCooked('2026-04-23', '2026-05-05')).toBe('12 days ago')
    expect(formatLastCooked('2026-04-22', '2026-05-05')).toBe('13 days ago')
  })

  it('returns "N weeks ago" for 14–59 days (rounded)', () => {
    expect(formatLastCooked('2026-04-21', '2026-05-05')).toBe('2 weeks ago')   // 14 days
    expect(formatLastCooked('2026-04-07', '2026-05-05')).toBe('4 weeks ago')   // 28 days
    expect(formatLastCooked('2026-03-08', '2026-05-05')).toBe('8 weeks ago')   // 58 days
  })

  it('returns "N months ago" for 60–364 days (rounded)', () => {
    // 62 calendar days: robustly ≥60 even in DST-observing timezones where the
    // March 8 spring-forward shaves one hour off the span.
    expect(formatLastCooked('2026-03-04', '2026-05-05')).toBe('2 months ago')  // 62 days
    expect(formatLastCooked('2025-11-05', '2026-05-05')).toBe('6 months ago')  // 181 days
    expect(formatLastCooked('2025-05-15', '2026-05-05')).toBe('12 months ago') // 355 days
  })

  it('returns "over a year ago" for 365+ days', () => {
    expect(formatLastCooked('2025-05-05', '2026-05-05')).toBe('over a year ago')
    expect(formatLastCooked('2020-01-01', '2026-05-05')).toBe('over a year ago')
  })

  it('returns null for null / undefined / non-string input', () => {
    expect(formatLastCooked(null,        '2026-05-05')).toBeNull()
    expect(formatLastCooked(undefined,   '2026-05-05')).toBeNull()
    expect(formatLastCooked(12345,       '2026-05-05')).toBeNull()
  })

  it('returns null for future eatenOn (data error / clock skew)', () => {
    expect(formatLastCooked('2026-05-06', '2026-05-05')).toBeNull()
  })

  it('returns null for malformed dates', () => {
    expect(formatLastCooked('not-a-date',  '2026-05-05')).toBeNull()
    expect(formatLastCooked('2026-05-05',  'also-not-a-date')).toBeNull()
  })

  it('uses today as the default reference (smoke test)', () => {
    // Whatever today is, calling with today's date yields "today".
    const today = formatLocalDate()
    expect(formatLastCooked(today)).toBe('today')
  })
})
