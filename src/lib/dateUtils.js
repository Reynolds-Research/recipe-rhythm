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
