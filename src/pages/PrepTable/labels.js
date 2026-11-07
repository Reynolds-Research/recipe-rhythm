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

/**
 * "Amounts for X are estimates…": recipes whose ingredient list is the AI's
 * guess, not copied from the recipe (her first real week, 2026-11-06: chili
 * powder 1 tsp on the list, 1 tbsp in the recipe).
 */
export function guessNote(names) {
  const list = names.length <= 1
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `Amounts for ${list} are estimates. For exact amounts, add a screenshot of the recipe in your Cookbook, then Update list.`
}
