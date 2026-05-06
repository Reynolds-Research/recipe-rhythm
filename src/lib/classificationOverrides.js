/**
 * PRD-004 Phase D (P0.12): merge fresh AI classifications with existing
 * user overrides.
 *
 * Phase D introduces user-tappable essentiality overrides on each vault
 * recipe. Each user override is persisted with `source: 'user'` so future
 * AI re-classifications can detect and preserve them.
 *
 * `mergeWithUserOverrides(newAi, existing)`:
 *   - Returns `newAi` unchanged when `existing` has no user-source entries
 *     (or isn't an array).
 *   - Otherwise, indexes user overrides by lowercased `name` and replaces
 *     any matching entry in `newAi` with the user's version.
 *   - Keeps `newAi`'s order so the UI render order stays stable.
 *   - Names that exist only in `existing` (because the AI no longer
 *     classifies them — e.g. an ingredient was removed via chip edit) are
 *     dropped. We don't resurrect orphan user overrides; the new AI run is
 *     authoritative about WHICH ingredients exist.
 *
 * No Supabase, no fetch, no React. Pure transform — testable in isolation.
 */

/**
 * @typedef {Object} Classification
 * @property {string} name
 * @property {'essential' | 'omittable'} essentiality
 * @property {'ai' | 'user'} source
 */

/**
 * @param {Classification[]} newAi       New classifications (typically from
 *                                       /api/classify-ingredients via the
 *                                       analyze handler).
 * @param {Classification[]|null|undefined} existing
 *                                       Currently-stored classifications
 *                                       for the same recipe.
 * @returns {Classification[]}           The merged array.
 */
export function mergeWithUserOverrides(newAi, existing) {
  if (!Array.isArray(newAi)) return []
  if (!Array.isArray(existing)) return newAi

  const userOverrides = new Map()
  for (const c of existing) {
    if (
      c &&
      c.source === 'user' &&
      typeof c.name === 'string' &&
      (c.essentiality === 'essential' || c.essentiality === 'omittable')
    ) {
      userOverrides.set(c.name.trim().toLowerCase(), c)
    }
  }
  if (userOverrides.size === 0) return newAi

  return newAi.map(c => {
    if (!c || typeof c.name !== 'string') return c
    const override = userOverrides.get(c.name.trim().toLowerCase())
    return override || c
  })
}

/**
 * Apply a single override to a classifications array.
 *
 * Used by the UI tap handler — it doesn't have to know how the JSONB is
 * shaped, just "flip ingredient X to essentiality Y." Returns a new array
 * (no in-place mutation).
 *
 * If the named ingredient isn't in the array, returns the input unchanged
 * (defensive — a tap can't materialize a new ingredient out of nowhere).
 *
 * @param {Classification[]} classifications
 * @param {string} name
 * @param {'essential' | 'omittable'} essentiality
 * @returns {Classification[]}
 */
export function applyOverride(classifications, name, essentiality) {
  if (!Array.isArray(classifications)) return classifications
  if (typeof name !== 'string' || !name.trim()) return classifications
  if (essentiality !== 'essential' && essentiality !== 'omittable') {
    return classifications
  }
  const target = name.trim().toLowerCase()
  let touched = false
  const next = classifications.map(c => {
    if (
      c &&
      typeof c.name === 'string' &&
      c.name.trim().toLowerCase() === target
    ) {
      touched = true
      return { ...c, essentiality, source: 'user' }
    }
    return c
  })
  return touched ? next : classifications
}
