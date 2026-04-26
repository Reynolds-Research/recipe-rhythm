import { describe, it, expect } from 'vitest'
import { buildLastWeekSlots } from '../lastWeekSlots'

// Today reference for these tests: Sunday 2026-04-26.
const today = new Date(2026, 3, 26)

describe('buildLastWeekSlots', () => {
  it('returns a Mon–Fri shape with null names when no meals match', () => {
    expect(buildLastWeekSlots([], null, today)).toEqual([
      { day: 'Mon', name: null },
      { day: 'Tue', name: null },
      { day: 'Wed', name: null },
      { day: 'Thu', name: null },
      { day: 'Fri', name: null },
    ])
  })

  it('falls back to the last 7 calendar days when no prior period is supplied', () => {
    // 2026-04-21 (Tue) is within the 7-day window ending today.
    // 2026-04-14 (also Tue) is 12 days ago — outside the fallback window.
    const meals = [
      { name: 'Tuesday meal', eaten_on: '2026-04-21' },
      { name: 'Old Tuesday', eaten_on: '2026-04-14' },
    ]
    const slots = buildLastWeekSlots(meals, null, today)
    expect(slots.find((s) => s.day === 'Tue').name).toBe('Tuesday meal')
  })

  it('excludes meals from 14+ days ago when bounded by a prior period', () => {
    // Prior period is 2026-04-13..2026-04-19; the meal on 2026-04-01 predates
    // it and must not appear in any slot.
    const meals = [{ name: 'Way old', eaten_on: '2026-04-01' }]
    const priorPeriod = { period_start: '2026-04-13', period_end: '2026-04-19' }
    const slots = buildLastWeekSlots(meals, priorPeriod, today)
    expect(slots.every((s) => s.name === null)).toBe(true)
  })

  it('only pulls meals whose eaten_on falls inside the prior period range', () => {
    // Prior period 2026-04-13..2026-04-19. Two Wednesdays are present in the
    // dataset: 2026-04-15 (inside the period) and 2026-04-08 (one week before
    // the period). Only the in-period meal should land in the Wed slot.
    const meals = [
      { name: 'Recent Wed', eaten_on: '2026-04-15' },
      { name: 'Old Wed', eaten_on: '2026-04-08' },
    ]
    const priorPeriod = { period_start: '2026-04-13', period_end: '2026-04-19' }
    const slots = buildLastWeekSlots(meals, priorPeriod, today)
    expect(slots.find((s) => s.day === 'Wed').name).toBe('Recent Wed')
    // Mon–Tue/Thu–Fri have no meals in the period and should remain null.
    expect(slots.find((s) => s.day === 'Mon').name).toBeNull()
    expect(slots.find((s) => s.day === 'Fri').name).toBeNull()
  })

  it('prefers the most recent meal when multiple match the same weekday', () => {
    // Two Wednesdays inside the period; the later one wins.
    const meals = [
      { name: 'Earlier Wed', eaten_on: '2026-04-15' },
      { name: 'Later Wed', eaten_on: '2026-04-22' },
    ]
    const priorPeriod = { period_start: '2026-04-13', period_end: '2026-04-26' }
    const slots = buildLastWeekSlots(meals, priorPeriod, today)
    expect(slots.find((s) => s.day === 'Wed').name).toBe('Later Wed')
  })

  it('treats period bounds inclusively', () => {
    // Mon 2026-04-13 is the period_start; Sun 2026-04-19 is the period_end.
    // The Monday meal on the boundary should land in the Mon slot.
    const meals = [
      { name: 'Boundary Mon', eaten_on: '2026-04-13' },
    ]
    const priorPeriod = { period_start: '2026-04-13', period_end: '2026-04-19' }
    const slots = buildLastWeekSlots(meals, priorPeriod, today)
    expect(slots.find((s) => s.day === 'Mon').name).toBe('Boundary Mon')
  })
})
