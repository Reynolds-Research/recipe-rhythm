/**
 * Date labels for the Prep Table. Built from the 'YYYY-MM-DD' parts in UTC so
 * the label can never drift a day in any timezone.
 */
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })
const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** 'YYYY-MM-DD' → { weekday: 'Mon', monthDay: 'Nov 2' } */
export function dateLabel(date) {
  const [y, m, d] = date.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  return { weekday: WEEKDAY.format(utc), monthDay: MONTH_DAY.format(utc) }
}

/** "Nov 1 – 7", or "Nov 29 – Dec 5" across a month. */
export function weekTitle(start, end) {
  const a = dateLabel(start).monthDay
  const b = dateLabel(end).monthDay
  return a.split(' ')[0] === b.split(' ')[0] ? `${a} – ${b.split(' ')[1]}` : `${a} – ${b}`
}
