/**
 * weekRange.js — weeks on the new Prep Table (PRD-008 D8, phase 2b-1).
 *
 * Mental model: a week is just seven dates, Sunday to Saturday. Nothing is
 * stored about a week except, optionally, which of its days to show. Every
 * function here is pure: dates in, dates out, no database.
 *
 * Dates are 'YYYY-MM-DD' strings on the wall calendar (same as `planned_on`
 * and `formatLocalDate()`). Days of the week are numbers, Sunday = 0 …
 * Saturday = 6 (JavaScript's getDay()).
 *
 * Why the math runs in UTC: a local Date at midnight can land on the wrong
 * day when the clocks change (a "day" of 23 or 25 hours). Doing the
 * arithmetic on UTC dates, where every day is exactly 24 hours, and only
 * ever reading back the year / month / day, keeps DST weeks correct.
 *
 * Which days show (D8):
 *   1. the week's own days, if she changed this week (a `week_days` row),
 *   2. otherwise the household's usual days (`household_preferences.usual_days`),
 *   3. otherwise Sun–Thu,
 *   plus, always, any day that has a meal on it — so a planned meal can
 *   never be hidden.
 */

import { formatLocalDate } from './dateUtils'

/** Sun–Thu: the household's first "usual days" (PRD-008 D8). */
export const DEFAULT_USUAL_DAYS = Object.freeze([0, 1, 2, 3, 4])

/** Short labels for the day buttons, Sunday first. */
export const DAY_LABELS = Object.freeze(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'])

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** 'YYYY-MM-DD' → UTC milliseconds at midnight. Throws on anything else. */
function toUtc(dateStr) {
  const m = typeof dateStr === 'string' ? DATE_RE.exec(dateStr) : null
  if (!m) throw new Error(`weekRange: expected a 'YYYY-MM-DD' date, got ${JSON.stringify(dateStr)}`)
  const [, y, mo, d] = m.map(Number)
  const ms = Date.UTC(y, mo - 1, d)
  const back = new Date(ms)
  // Rejects impossible dates like 2026-02-30 (Date would roll them over).
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new Error(`weekRange: not a real date: ${dateStr}`)
  }
  return ms
}

/** UTC milliseconds → 'YYYY-MM-DD'. */
function fromUtc(ms) {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Accept a 'YYYY-MM-DD' string or a Date (read on the local calendar). */
function asDateStr(date) {
  return date instanceof Date ? formatLocalDate(date) : date
}

/** Day of the week for a date: Sunday = 0 … Saturday = 6. */
export function dayOfWeek(date) {
  return new Date(toUtc(asDateStr(date))).getUTCDay()
}

/** The date `n` days after `date` (negative n = before). */
export function addDays(date, n) {
  return fromUtc(toUtc(asDateStr(date)) + n * MS_PER_DAY)
}

/** The Sunday that starts the week `date` is in. */
export function weekStartFor(date) {
  const s = asDateStr(date)
  return addDays(s, -dayOfWeek(s))
}

/** The Sunday that starts this week (on this device's calendar). */
export function thisWeekStart(today = formatLocalDate()) {
  return weekStartFor(today)
}

/** ← / →: the week `n` weeks from the week `date` is in. */
export function shiftWeek(date, n) {
  return addDays(weekStartFor(date), 7 * n)
}

/** All seven dates of the week `date` is in, Sunday first. */
export function weekDates(date) {
  const start = weekStartFor(date)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** { start, end } of the week `date` is in — Sunday and Saturday. */
export function weekBounds(date) {
  const start = weekStartFor(date)
  return { start, end: addDays(start, 6) }
}

/** True when `date` falls in the week starting `weekStart`. */
export function isInWeek(date, weekStart) {
  return weekStartFor(date) === weekStartFor(weekStart)
}

/**
 * Clean a list of days: whole numbers 0–6 only, no repeats, in order.
 * Anything else is dropped (the database would refuse it).
 */
export function normalizeDays(days) {
  if (!Array.isArray(days)) return []
  const set = new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))
  return [...set].sort((a, b) => a - b)
}

/** Days of the week (0–6) in `weekStart`'s week that have a meal on them. */
export function daysWithMeals(weekStart, mealDates = []) {
  return normalizeDays(
    mealDates.filter((d) => d && isInWeek(d, weekStart)).map((d) => dayOfWeek(d)),
  )
}

/**
 * Which days the week shows (D8), as day numbers in order.
 *
 * @param {object} args
 * @param {string} args.weekStart       any date in the week (usually its Sunday)
 * @param {number[]|null} [args.weekDays]   this week's own days (null = she never changed it)
 * @param {number[]|null} [args.usualDays]  the household's usual days
 * @param {string[]} [args.mealDates]   planned_on of the week's meals
 */
export function shownDays({ weekStart, weekDays = null, usualDays = null, mealDates = [] }) {
  return normalizeDays([...baseDays({ weekDays, usualDays }), ...daysWithMeals(weekStart, mealDates)])
}

/**
 * The days the week shows by choice, before meal days are added: the week's
 * own days, else the usual days, else Sun–Thu. This is what gets saved —
 * meal days never are (D8), or a one-off Saturday meal would keep Saturday
 * showing in every later week.
 */
export function baseDays({ weekDays = null, usualDays = null } = {}) {
  if (Array.isArray(weekDays)) return normalizeDays(weekDays)   // she changed this week (may be [])
  const usual = normalizeDays(usualDays)
  return usual.length ? usual : [...DEFAULT_USUAL_DAYS]
}

/** The same as shownDays, as dates. */
export function shownDates(args) {
  const start = weekStartFor(args.weekStart)
  return shownDays(args).map((d) => addDays(start, d))
}

/** A day can be hidden only when nothing is planned on it. */
export function canHideDay(day, { weekStart, mealDates = [] }) {
  return !daysWithMeals(weekStart, mealDates).includes(day)
}

/**
 * Tap a day button: show it if hidden, hide it if shown. Returns the week's
 * new chosen days (baseDays) — the list to save with saveWeekDays. Meal days
 * are never added to it; they show anyway. A day with a meal is locked: the
 * tap changes nothing.
 */
export function toggleDay(day, args) {
  const base = baseDays(args)
  if (!shownDays(args).includes(day)) return normalizeDays([...base, day])
  if (!canHideDay(day, args)) return base
  return base.filter((d) => d !== day)
}
