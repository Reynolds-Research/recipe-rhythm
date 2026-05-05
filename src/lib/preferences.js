/**
 * household_preferences data layer (PRD-002 P0.1).
 *
 * Two functions wrapping the Supabase calls behind the
 * `household_preferences` table:
 *
 *   - getPreferences(userId, supabase): returns the user's row, or a
 *     defaults object when the row does not exist. The defaults shape
 *     keeps callers branch-free — the recommender (P0.3) and the
 *     settings UI (P0.2) both treat preferences as a plain object,
 *     never `null`.
 *
 *   - upsertPreferences(userId, patch, supabase): merges `patch` into
 *     the user's row, validates app-side vocabularies first, and
 *     normalizes free-text excluded_ingredients (trim + lowercase +
 *     dedupe).
 *
 * Both functions accept an injected supabase client so tests can
 * mock without monkey-patching the singleton in src/lib/supabase.js.
 *
 * No defaults overwrite logic on read: a NULL `max_prep_time_minutes`
 * is returned as `null`. The recommender owns the
 * DEFAULT_MAX_PREP_TIME_MINUTES fallback — this module is dumb
 * storage.
 */

import { CUISINE_OPTIONS, DIETARY_RESTRICTIONS } from './constants'

const TABLE = 'household_preferences'

/** PostgREST "no rows returned" code from .single() — expected when a
 * user has never saved preferences. NOT an error condition for us. */
const PGRST_NO_ROWS = 'PGRST116'

const KNOWN_DIETARY_IDS = new Set(DIETARY_RESTRICTIONS.map(r => r.id))
const KNOWN_CUISINES = new Set(CUISINE_OPTIONS)

/**
 * Error thrown when an upsert patch contains a value not in the
 * app-side vocabulary (DIETARY_RESTRICTIONS or CUISINE_OPTIONS). The
 * `field` and `invalidValue` properties let the P0.2 settings UI
 * surface a precise message ("Unknown dietary restriction: pescetarian")
 * without parsing the message string.
 */
export class InvalidPreferenceError extends Error {
  constructor(field, invalidValue) {
    super(`Invalid ${field}: ${JSON.stringify(invalidValue)}`)
    this.name = 'InvalidPreferenceError'
    this.field = field
    this.invalidValue = invalidValue
  }
}

function defaults(userId) {
  return {
    user_id: userId,
    dietary_restrictions: [],
    excluded_ingredients: [],
    excluded_cuisines: [],
    max_prep_time_minutes: null,
    adults: 2,
    children: 0,
    pantry_staples: [],
  }
}

/**
 * Trim, lowercase, and dedupe a list of free-text strings while
 * preserving first-seen order. Non-string entries and empties drop
 * out silently — the UI shouldn't be writing those, and rejecting
 * them here would surface as a confusing error in P0.2.
 */
function normalizeIngredients(values) {
  const seen = new Set()
  const out = []
  for (const raw of values) {
    if (typeof raw !== 'string') continue
    const v = raw.trim().toLowerCase()
    if (!v) continue
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

export async function getPreferences(userId, supabase) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error) {
    if (error.code === PGRST_NO_ROWS) return defaults(userId)
    throw error
  }
  return data
}

export async function upsertPreferences(userId, patch, supabase) {
  // Validate before touching the DB so a typo in a chip-picker write
  // does not produce a half-applied row. Validation is intentionally
  // strict: case-sensitive, exact-match against the app vocabulary.
  if (Array.isArray(patch.dietary_restrictions)) {
    for (const id of patch.dietary_restrictions) {
      if (!KNOWN_DIETARY_IDS.has(id)) {
        throw new InvalidPreferenceError('dietary_restriction', id)
      }
    }
  }
  if (Array.isArray(patch.excluded_cuisines)) {
    for (const cuisine of patch.excluded_cuisines) {
      if (!KNOWN_CUISINES.has(cuisine)) {
        throw new InvalidPreferenceError('excluded_cuisine', cuisine)
      }
    }
  }
  if ('adults' in patch) {
    const v = patch.adults
    if (!Number.isInteger(v) || v < 1) {
      throw new InvalidPreferenceError('adults', v)
    }
  }
  if ('children' in patch) {
    const v = patch.children
    if (!Number.isInteger(v) || v < 0) {
      throw new InvalidPreferenceError('children', v)
    }
  }

  const row = { user_id: userId, ...patch }
  if (Array.isArray(patch.excluded_ingredients)) {
    row.excluded_ingredients = normalizeIngredients(patch.excluded_ingredients)
  }
  if (Array.isArray(patch.pantry_staples)) {
    row.pantry_staples = normalizeIngredients(patch.pantry_staples)
  }

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) throw error
  return data
}
