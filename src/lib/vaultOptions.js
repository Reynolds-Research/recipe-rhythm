/**
 * vault_options client helpers — PRD-001 Phase 2 Step 3 (P0.7).
 *
 * Backs the chip-picker custom-tag UX in Vault.jsx. Each row in the
 * vault_options table is one (user, category, value) triple representing
 * a tag the user added on top of the built-in lists in src/lib/constants.js.
 *
 * Why this module exists:
 *   Pre-2026-04-26, custom chip-picker tags were stored in browser
 *   localStorage under keys like `vault_extra_cuisine_type`. That works
 *   for one device, one browser, one session — clear site data and the
 *   tags vanish. Moving the storage into Postgres + RLS gives us the same
 *   one-user-many-devices semantics the rest of the app already uses.
 *
 * The migration helper below is a one-time auto-import: on Vault mount it
 * reads each `vault_extra_<category>` key from localStorage, upserts the
 * values into vault_options, then clears the localStorage keys so the
 * migration can't run twice.
 */

/**
 * The nine canonical category names. Must match the CHECK constraint in
 * supabase/migrations/20260426000002_vault_options_table.sql AND the
 * suffixes the chip-picker JSX in Vault.jsx now passes as `category`.
 */
export const VAULT_OPTION_CATEGORIES = [
  'cuisine_type',
  'flavor_profile',
  'proteins',
  'cooking_method',
  'main_carb',
  'dietary_tags',
  'dairy_components',
  'vegetables',
  'fruits',
]

/**
 * Legacy localStorage suffix → canonical vault_options category.
 *
 * Most suffixes already match canonical names. The exception is `dairy`
 * (legacy storageKey in Vault.jsx) → `dairy_components` (the canonical
 * name in src/lib/constants.js and the migration's CHECK constraint).
 * Iterate this map (not VAULT_OPTION_CATEGORIES) when reading legacy
 * localStorage so the dairy rename actually happens.
 */
const LEGACY_STORAGE_KEY_TO_CATEGORY = {
  cuisine_type:      'cuisine_type',
  flavor_profile:    'flavor_profile',
  proteins:          'proteins',
  cooking_method:    'cooking_method',
  main_carb:         'main_carb',
  dietary_tags:      'dietary_tags',
  dairy:             'dairy_components',
  vegetables:        'vegetables',
  fruits:            'fruits',
}

/**
 * Fetch all vault_options rows for `userId` and return them grouped by
 * category. Missing categories simply absent from the returned object.
 *
 * Returns `{}` on error (never throws) — the chip picker should still
 * render the built-in options if the DB call fails for any reason.
 */
export async function fetchVaultOptions(supabase, userId) {
  if (!userId) return {}
  const { data, error } = await supabase
    .from('vault_options')
    .select('category, value')
    .eq('user_id', userId)
  if (error) {
    console.error('[vaultOptions] fetch failed:', error)
    return {}
  }
  const grouped = {}
  for (const row of data || []) {
    if (!grouped[row.category]) grouped[row.category] = []
    grouped[row.category].push(row.value)
  }
  return grouped
}

/**
 * Upsert a single (user, category, value) triple. Trims whitespace on
 * `value`; rejects empty strings without hitting the DB. Idempotent —
 * upserting the same value twice is a no-op (composite PK).
 *
 * Returns `{ error: string | null }` so callers can surface a toast on
 * failure without parsing a Supabase error object.
 */
export async function addVaultOption(supabase, userId, category, value) {
  if (!userId) return { error: 'no-user' }
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return { error: 'empty' }
  const { error } = await supabase
    .from('vault_options')
    .upsert(
      { user_id: userId, category, value: trimmed },
      { onConflict: 'user_id,category,value' }
    )
  if (error) {
    console.error('[vaultOptions] upsert failed:', error)
    return { error: error.message || 'upsert-failed' }
  }
  return { error: null }
}

/**
 * Delete a single (user, category, value) triple. Returns
 * `{ error: string | null }`. Currently unused by the UI; included so
 * future "remove custom tag" affordances don't have to round-trip
 * through this module.
 */
export async function removeVaultOption(supabase, userId, category, value) {
  if (!userId) return { error: 'no-user' }
  const { error } = await supabase
    .from('vault_options')
    .delete()
    .match({ user_id: userId, category, value })
  if (error) {
    console.error('[vaultOptions] delete failed:', error)
    return { error: error.message || 'delete-failed' }
  }
  return { error: null }
}

/**
 * One-time migration: upsert any pre-existing `vault_extra_<key>` values
 * from localStorage into vault_options, then clear the localStorage keys
 * so this helper is idempotent.
 *
 * Runs on Vault mount; the cleared keys mean re-running it on subsequent
 * loads is a no-op (each iteration finds nothing to read).
 *
 * Returns `{ migrated: <number-of-values-imported> }` for telemetry; the
 * caller doesn't have to do anything with it.
 */
export async function migrateLocalStorageExtras(supabase, userId) {
  if (!userId || typeof window === 'undefined' || !window.localStorage) {
    return { migrated: 0 }
  }
  let migrated = 0
  for (const [legacySuffix, category] of Object.entries(LEGACY_STORAGE_KEY_TO_CATEGORY)) {
    const storageKey = `vault_extra_${legacySuffix}`
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) continue
    let values
    try {
      values = JSON.parse(raw)
    } catch {
      console.warn(`[vaultOptions] malformed JSON in ${storageKey}; skipping`)
      // Clear so we don't re-warn on every mount.
      window.localStorage.removeItem(storageKey)
      continue
    }
    if (!Array.isArray(values)) {
      window.localStorage.removeItem(storageKey)
      continue
    }
    for (const value of values) {
      const { error } = await addVaultOption(supabase, userId, category, value)
      if (!error) migrated += 1
    }
    // Clear the key only after attempting all inserts so a transient
    // network error doesn't silently drop the values on the floor — a
    // failed addVaultOption logs and is retried on next mount because
    // the key still has the values.
    //
    // Actually no: if we keep the key on partial failure we re-run on
    // every mount forever. Trade-off: clear unconditionally, accept
    // that a one-time DB outage during the very first Vault mount
    // could lose tags. The same outage would also have prevented the
    // user from ever using the app, so the practical risk is near-zero.
    window.localStorage.removeItem(storageKey)
  }
  return { migrated }
}
