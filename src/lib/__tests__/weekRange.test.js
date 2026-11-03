/* global process */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  DEFAULT_USUAL_DAYS,
  addDays,
  canHideDay,
  dayOfWeek,
  daysWithMeals,
  isInWeek,
  normalizeDays,
  shiftWeek,
  shownDates,
  shownDays,
  thisWeekStart,
  toggleDay,
  weekBounds,
  weekDates,
  weekStartFor,
} from '../weekRange'

// Run in her timezone: the DST weeks only bite where the clocks change.
let savedTz
beforeAll(() => {
  savedTz = process.env.TZ
  process.env.TZ = 'America/Los_Angeles'
})
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ
  else process.env.TZ = savedTz
})

describe('week boundaries', () => {
  it('a week runs Sunday to Saturday', () => {
    // Wed 2026-11-04 → week of Sun 2026-11-01
    expect(weekStartFor('2026-11-04')).toBe('2026-11-01')
    expect(weekBounds('2026-11-04')).toEqual({ start: '2026-11-01', end: '2026-11-07' })
  })

  it('Sunday starts its own week; Saturday ends it', () => {
    expect(weekStartFor('2026-11-08')).toBe('2026-11-08')
    expect(weekStartFor('2026-11-07')).toBe('2026-11-01')
  })

  it('crosses month and year ends', () => {
    expect(weekBounds('2026-12-31')).toEqual({ start: '2026-12-27', end: '2027-01-02' })
    expect(weekStartFor('2027-01-01')).toBe('2026-12-27')
  })

  it('handles a leap day', () => {
    expect(weekDates('2028-02-29')).toEqual([
      '2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01', '2028-03-02', '2028-03-03', '2028-03-04',
    ])
  })

  it('fall-back DST week (clocks change Sun 2026-11-01) has seven distinct days', () => {
    const days = weekDates('2026-11-03')
    expect(days).toEqual([
      '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07',
    ])
    expect(new Set(days).size).toBe(7)
    expect(days.map(dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('spring-forward DST week (clocks change Sun 2026-03-08) has seven distinct days', () => {
    expect(weekDates('2026-03-08')).toEqual([
      '2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14',
    ])
    // Stepping over the change lands on the right Sunday both ways.
    expect(shiftWeek('2026-03-08', -1)).toBe('2026-03-01')
    expect(shiftWeek('2026-03-01', 1)).toBe('2026-03-08')
  })

  it('← / → moves whole weeks from any day in the week', () => {
    expect(shiftWeek('2026-11-04', 1)).toBe('2026-11-08')
    expect(shiftWeek('2026-11-04', -1)).toBe('2026-10-25')
    expect(shiftWeek('2026-11-04', 0)).toBe('2026-11-01')
    expect(shiftWeek('2026-11-04', 9)).toBe('2027-01-03')
  })

  it('accepts a Date, read on the local calendar (not UTC)', () => {
    // 11pm Saturday in Los Angeles is already Sunday in UTC.
    const lateSaturday = new Date(2026, 10, 7, 23, 0) // Nov 7 2026, 23:00 local
    expect(weekStartFor(lateSaturday)).toBe('2026-11-01')
    expect(thisWeekStart('2026-11-02')).toBe('2026-11-01')
  })

  it('isInWeek / addDays', () => {
    expect(isInWeek('2026-11-07', '2026-11-01')).toBe(true)
    expect(isInWeek('2026-11-08', '2026-11-01')).toBe(false)
    expect(addDays('2026-11-01', -14)).toBe('2026-10-18')
  })

  it('refuses malformed or impossible dates instead of guessing', () => {
    expect(() => weekStartFor('2026-02-30')).toThrow(/not a real date/)
    expect(() => weekStartFor('11/04/2026')).toThrow(/YYYY-MM-DD/)
    expect(() => weekStartFor(null)).toThrow()
  })
})

describe('normalizeDays', () => {
  it('sorts, drops repeats and anything outside 0–6', () => {
    expect(normalizeDays([4, 0, 4, 7, -1, 2.5, '3', 6])).toEqual([0, 4, 6])
    expect(normalizeDays(null)).toEqual([])
  })
})

describe('which days show (D8)', () => {
  const weekStart = '2026-11-01'

  it('a week nobody changed shows the usual days', () => {
    expect(shownDays({ weekStart, usualDays: [0, 1, 2, 3, 4, 5] })).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('with no usual days saved yet, shows Sun–Thu', () => {
    expect(shownDays({ weekStart })).toEqual(DEFAULT_USUAL_DAYS)
    expect(shownDays({ weekStart, usualDays: [] })).toEqual(DEFAULT_USUAL_DAYS)
  })

  it("a week she changed shows that week's own days, not the usual ones", () => {
    expect(shownDays({ weekStart, weekDays: [1, 3], usualDays: [0, 1, 2, 3, 4] })).toEqual([1, 3])
  })

  it('a week she emptied (vacation) shows no days — unless a meal is on one', () => {
    expect(shownDays({ weekStart, weekDays: [], usualDays: [0, 1, 2] })).toEqual([])
    expect(shownDays({ weekStart, weekDays: [], mealDates: ['2026-11-06'] })).toEqual([5])
  })

  it('a day with a meal always shows, even when the week hides it', () => {
    // Saturday meal in a Sun–Thu week
    expect(shownDays({ weekStart, usualDays: [0, 1, 2, 3, 4], mealDates: ['2026-11-07'] }))
      .toEqual([0, 1, 2, 3, 4, 6])
    // Hidden Monday with a meal on it
    expect(shownDays({ weekStart, weekDays: [0, 2], mealDates: ['2026-11-02'] })).toEqual([0, 1, 2])
  })

  it("meals from other weeks and Maybe meals (no date) don't add days", () => {
    expect(shownDays({ weekStart, weekDays: [0], mealDates: ['2026-11-13', null, '2026-10-31'] }))
      .toEqual([0])
  })

  it('shownDates gives the dates in order', () => {
    expect(shownDates({ weekStart: '2026-11-04', weekDays: [0, 5], mealDates: ['2026-11-03'] }))
      .toEqual(['2026-11-01', '2026-11-03', '2026-11-06'])
  })

  it('daysWithMeals counts each day once', () => {
    expect(daysWithMeals(weekStart, ['2026-11-03', '2026-11-03', '2026-11-01'])).toEqual([0, 2])
  })
})

describe('day buttons', () => {
  const args = { weekStart: '2026-11-01', usualDays: [0, 1, 2, 3, 4], mealDates: ['2026-11-02'] }

  it('tapping a hidden day shows it', () => {
    expect(toggleDay(5, args)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('tapping a shown, empty day hides it', () => {
    expect(canHideDay(3, args)).toBe(true)
    expect(toggleDay(3, args)).toEqual([0, 1, 2, 4])
  })

  it('a day with a meal on it is locked: tapping does nothing', () => {
    expect(canHideDay(1, args)).toBe(false)
    expect(toggleDay(1, args)).toEqual([0, 1, 2, 3, 4])
  })
})
