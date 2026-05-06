/**
 * Local-calendar date helpers.
 *
 * Calendar-date columns (`eaten_on`, `scheduled_date`) describe a day on the
 * user's wall clock, not a UTC instant. Going through `toISOString()` shifts
 * the day west-of-UTC after sundown — logging at 11pm Pacific would write
 * tomorrow's date. AUDIT U8.
 */

/**
 * Returns the local-calendar date as 'YYYY-MM-DD'.
 *
 * @param {Date} [date=new Date()] - the moment to format; defaults to now
 * @returns {string} 'YYYY-MM-DD' in the runtime's local timezone
 */
export function formatLocalDate(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Format a `meals.eaten_on` date (YYYY-MM-DD, local calendar) as a
 * human-readable "last cooked" phrase relative to a reference day.
 *
 * Returns null when the input is missing or in the future (defensive
 * against data errors / clock skew). Callers should treat null as
 * "no badge" — never as "never cooked" (the absence of input IS the
 * never-cooked signal).
 *
 * Breakpoints (calibrated for cookbook-planning cognition):
 *   - 0 days     → "today"
 *   - 1 day      → "yesterday"
 *   - 2–13 days  → "N days ago"
 *   - 14–59 days → "N weeks ago" (rounded)
 *   - 60–364 days → "N months ago" (rounded)
 *   - 365+ days  → "over a year ago"
 *
 * @param {string|null|undefined} eatenOn  YYYY-MM-DD local-calendar date
 * @param {string} [today]                 reference day; defaults to today
 * @returns {string|null}                  the phrase, or null
 */
export function formatLastCooked(eatenOn, today = formatLocalDate()) {
  if (!eatenOn || typeof eatenOn !== 'string') return null

  // Parse both inputs as local-calendar dates by appending T00:00:00 so the
  // Date constructor reads them as local midnight, not UTC. Without the
  // suffix, 'YYYY-MM-DD' is parsed as UTC and the day-difference math drifts
  // off by one west of UTC.
  const eaten = new Date(eatenOn + 'T00:00:00')
  const ref   = new Date(today   + 'T00:00:00')
  if (Number.isNaN(eaten.getTime()) || Number.isNaN(ref.getTime())) return null

  const msPerDay = 1000 * 60 * 60 * 24
  const days = Math.floor((ref - eaten) / msPerDay)

  if (days < 0)   return null            // future date — data error, ignore
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14)  return `${days} days ago`
  if (days < 60)  return `${Math.round(days / 7)} weeks ago`
  if (days < 365) return `${Math.round(days / 30)} months ago`
  return 'over a year ago'
}
