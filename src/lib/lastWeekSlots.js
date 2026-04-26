import { formatLocalDate } from './dateUtils'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

function parseYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n)
}

/**
 * Builds the Mon–Fri "last week" panel for BrainstormMode.
 *
 * Bounds: when a prior planning period is supplied, only meals whose
 * `eaten_on` falls inside `[period_start, period_end]` are eligible.
 * Otherwise we fall back to the 7-day window ending today (local time).
 * Within those bounds, the most recent meal per weekday wins. AUDIT U3.
 *
 * @param {Array<{ name: string, eaten_on: string }>} meals
 * @param {{ period_start: string, period_end: string } | null | undefined} priorPeriod
 * @param {Date} [today=new Date()] - injectable local-calendar reference
 * @returns {Array<{ day: string, name: string | null }>}
 */
export function buildLastWeekSlots(meals, priorPeriod, today = new Date()) {
  let fromYmd
  let toYmd
  if (priorPeriod?.period_start && priorPeriod?.period_end) {
    fromYmd = priorPeriod.period_start
    toYmd = priorPeriod.period_end
  } else {
    const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    fromYmd = formatLocalDate(addDays(todayLocal, -6))
    toYmd = formatLocalDate(todayLocal)
  }

  // Lexical compare is correct on zero-padded YYYY-MM-DD.
  const inRange = (meals || []).filter(
    (m) => m?.eaten_on && m.eaten_on >= fromYmd && m.eaten_on <= toYmd,
  )

  // Sort descending so .find() picks the most recent meal for each weekday.
  const sorted = [...inRange].sort((a, b) => {
    if (a.eaten_on < b.eaten_on) return 1
    if (a.eaten_on > b.eaten_on) return -1
    return 0
  })

  return WEEKDAYS.map((day) => {
    const match = sorted.find(
      (m) =>
        parseYmd(m.eaten_on).toLocaleDateString('en-US', { weekday: 'short' }) === day,
    )
    return { day, name: match?.name || null }
  })
}
