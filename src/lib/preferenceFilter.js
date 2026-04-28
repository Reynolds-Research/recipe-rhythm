/**
 * PRD-002 P0.3: hard preference filter for the recommender.
 *
 * `passesPreferences(item, preferences)` is a PURE predicate — no Supabase
 * calls, no fetch, no React hooks. The recommender (`recommendations.js`)
 * runs every vault candidate AND every AI candidate through this filter
 * BEFORE scoring; violators are dropped silently. The DayPicker's "Maybe"
 * section is the one carve-out: we never filter user-shortlisted items
 * (PRD-002 P0.3 — respect explicit user intent).
 *
 * Filter rules apply in order; first failure wins:
 *   1. max_prep_time_minutes  — null/undefined skips. Items with null
 *      prep_time pass (we don't punish under-tagged data).
 *   2. excluded_cuisines      — case-insensitive equality on item.cuisine_type.
 *   3. excluded_ingredients   — case-insensitive substring match against the
 *      ingredient haystack (item.ingredients in either string-blob or array
 *      shape, plus the existing vault tag arrays — proteins, vegetables,
 *      fruits, dairy_components — main_carb, name, and notes).
 *   4. dietary_restrictions   — protein-based only in v1:
 *        vegetarian   → fails when any item protein maps to meat or seafood
 *        vegan        → fails when any item protein maps to meat / seafood / animal_byproduct
 *        pescatarian  → fails when any item protein maps to meat
 *        Any other id (gluten-free, dairy-free, nut-free, kosher, halal, keto,
 *        paleo, low-carb) is stored, surfaced in the settings UI, and a NO-OP
 *        here. Enforcing them needs structured allergen tags on vault rows —
 *        see the future "allergen tags on vault" follow-up referenced in
 *        PRD-002 P0.3 OQ.
 *      Items with no proteins / unknown proteins conservatively PASS — the
 *      user can fix the vault rather than have meals silently disappear.
 */

import { PROTEIN_CATEGORIES } from './constants'

const PROTEIN_FILTERS = {
  vegetarian:  new Set(['meat', 'seafood']),
  vegan:       new Set(['meat', 'seafood', 'animal_byproduct']),
  pescatarian: new Set(['meat']),
}

function collectIngredientHaystack(item) {
  const parts = []

  if (typeof item.ingredients === 'string') {
    parts.push(item.ingredients)
  } else if (Array.isArray(item.ingredients)) {
    for (const ing of item.ingredients) {
      if (typeof ing === 'string') parts.push(ing)
      else if (ing && typeof ing.name === 'string') parts.push(ing.name)
    }
  }

  for (const arr of [
    item.proteins,
    item.vegetables,
    item.fruits,
    item.dairy_components,
  ]) {
    if (!Array.isArray(arr)) continue
    for (const v of arr) {
      if (typeof v === 'string') parts.push(v)
    }
  }

  if (typeof item.main_carb === 'string') parts.push(item.main_carb)
  if (typeof item.name === 'string')      parts.push(item.name)
  if (typeof item.notes === 'string')     parts.push(item.notes)

  return parts.join(' ').toLowerCase()
}

function violatesDietary(item, restrictions) {
  const proteins = Array.isArray(item.proteins)
    ? item.proteins
    : (typeof item.protein === 'string' ? [item.protein] : [])

  const categories = proteins
    .map(p => PROTEIN_CATEGORIES[p])
    .filter(Boolean)

  // Conservative: no recognized protein info → pass. The user can fix the
  // vault row rather than have a recipe silently vanish.
  if (categories.length === 0) return false

  for (const r of restrictions) {
    const banned = PROTEIN_FILTERS[r]
    if (!banned) continue
    if (categories.some(c => banned.has(c))) return true
  }
  return false
}

export function passesPreferences(item, preferences) {
  if (!preferences || !item) return true

  // 1. max_prep_time_minutes
  const maxPrep = preferences.max_prep_time_minutes
  if (maxPrep != null) {
    if (item.prep_time_minutes != null && item.prep_time_minutes > maxPrep) {
      return false
    }
  }

  // 2. excluded_cuisines (case-insensitive equality on the recipe's cuisine)
  const excludedCuisines = Array.isArray(preferences.excluded_cuisines)
    ? preferences.excluded_cuisines
    : []
  if (excludedCuisines.length > 0) {
    const itemCuisine = (item.cuisine_type ?? item.cuisine ?? '')
      .toString()
      .trim()
      .toLowerCase()
    if (itemCuisine) {
      for (const c of excludedCuisines) {
        if (typeof c !== 'string') continue
        if (c.trim().toLowerCase() === itemCuisine) return false
      }
    }
  }

  // 3. excluded_ingredients (case-insensitive substring against haystack)
  const excludedIngredients = Array.isArray(preferences.excluded_ingredients)
    ? preferences.excluded_ingredients
    : []
  if (excludedIngredients.length > 0) {
    const haystack = collectIngredientHaystack(item)
    if (haystack) {
      for (const ing of excludedIngredients) {
        if (typeof ing !== 'string') continue
        const needle = ing.trim().toLowerCase()
        if (!needle) continue
        if (haystack.includes(needle)) return false
      }
    }
  }

  // 4. dietary_restrictions (protein-based only in v1; see file header)
  const dietary = Array.isArray(preferences.dietary_restrictions)
    ? preferences.dietary_restrictions
    : []
  if (dietary.length > 0 && violatesDietary(item, dietary)) return false

  return true
}
