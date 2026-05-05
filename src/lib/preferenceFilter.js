/**
 * PRD-002 P0.3 + ADR-003: hard preference filter for the recommender.
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
 *   4. dietary_restrictions   — vegetarian / vegan / pescatarian, two layers:
 *      4a. Protein-category check (PRD-002 P0.3): item.proteins mapped via
 *          PROTEIN_CATEGORIES. Items with no proteins / unknown proteins
 *          conservatively pass this layer.
 *      4b. Name-keyword check (ADR-003): item.name scanned against
 *          MEAT_IMPLIED_NAME_KEYWORDS to catch dish-form-implies-meat cases
 *          (Smash burger, meatballs, BLT) the protein-category check would
 *          miss when proteins are absent or the PRD-004 essentiality
 *          classifier marked the meat as omittable per the substitutable-
 *          category rule. Bypassed by either:
 *            - dietary_tags including the positive tag ('Vegetarian'/'Vegan'),
 *            - the recipe name including a VEGETARIAN_NAME_OVERRIDES token.
 *      Other ids (gluten-free, dairy-free, nut-free, kosher, halal, keto,
 *      paleo, low-carb) are stored, surfaced in the settings UI, and remain
 *      a NO-OP here. Enforcing them needs structured allergen tags on vault
 *      rows — see the future "allergen tags on vault" follow-up referenced
 *      in PRD-002 P0.3 OQ.
 */

import {
  PROTEIN_CATEGORIES,
  MEAT_IMPLIED_NAME_KEYWORDS,
  VEGETARIAN_NAME_OVERRIDES,
} from './constants'

const PROTEIN_FILTERS = {
  vegetarian:  new Set(['meat', 'seafood']),
  vegan:       new Set(['meat', 'seafood', 'animal_byproduct']),
  pescatarian: new Set(['meat']),
}

// ADR-003: which name-keyword categories block which restriction.
// Mirrors PROTEIN_FILTERS — pescatarian still allows seafood-implying names.
const NAME_KEYWORD_FILTERS = {
  vegetarian:  ['meat', 'seafood'],
  vegan:       ['meat', 'seafood'],
  pescatarian: ['meat'],
}

// ADR-003: positive `dietary_tags` values that bypass the name-keyword
// check for a given restriction.
const DIETARY_TAG_OVERRIDES = {
  vegetarian:  ['vegetarian', 'vegan'],
  vegan:       ['vegan'],
  pescatarian: ['vegetarian', 'vegan', 'pescatarian'],
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

  // 4a. Protein-category check. A recognized banned category is a hard
  // fail — short-circuit before we look at the name layer.
  if (categories.length > 0) {
    for (const r of restrictions) {
      const banned = PROTEIN_FILTERS[r]
      if (!banned) continue
      if (categories.some(c => banned.has(c))) return true
    }
  }

  // 4b. Name-keyword check (ADR-003). Catches dish-form-implies-meat
  // recipes the protein layer missed (under-tagged proteins, or future
  // ingredient-essentiality logic that marked the meat omittable per the
  // substitutable-category rule for burgers / meatballs / etc.).
  if (nameImpliesNonVeg(item, restrictions)) return true

  return false
}

// ADR-003 helper: lowercased recipe name, '' if absent.
function itemName(item) {
  return typeof item?.name === 'string' ? item.name.toLowerCase() : ''
}

// ADR-003: does the recipe carry a positive `dietary_tags` entry that
// should bypass the name-keyword check for this restriction?
// `dietary_tags` vocabulary is defined in DIETARY_OPTIONS as
// title-cased ('Vegetarian', 'Vegan'); we lowercase before comparing.
function hasPositiveDietaryTag(item, restriction) {
  const allowed = DIETARY_TAG_OVERRIDES[restriction]
  if (!allowed) return false
  const tags = Array.isArray(item?.dietary_tags) ? item.dietary_tags : []
  for (const t of tags) {
    if (typeof t !== 'string') continue
    if (allowed.includes(t.toLowerCase())) return true
  }
  return false
}

// ADR-003: does the recipe name contain a vegetarian-positive token
// (e.g. "Veggie burger", "Beyond meatballs")? Bypasses the keyword
// fail for under-tagged recipes whose name is unambiguously veg.
function nameHasVegetarianOverride(name) {
  if (!name) return false
  for (const token of VEGETARIAN_NAME_OVERRIDES) {
    if (name.includes(token)) return true
  }
  return false
}

// ADR-003: the name-keyword half of `violatesDietary`. Returns true iff
// SOME requested restriction is broken by an implied-meat dish-name and
// no override applies for that restriction.
function nameImpliesNonVeg(item, restrictions) {
  const name = itemName(item)
  if (!name) return false

  // Single override scan: if the name itself flags vegetarian intent,
  // every restriction's name-keyword layer is bypassed (a "Veggie burger"
  // is a "Veggie burger" regardless of which dietary line is checking).
  const nameOverride = nameHasVegetarianOverride(name)

  for (const r of restrictions) {
    const cats = NAME_KEYWORD_FILTERS[r]
    if (!cats) continue
    if (nameOverride) continue
    if (hasPositiveDietaryTag(item, r)) continue
    for (const cat of cats) {
      const tokens = MEAT_IMPLIED_NAME_KEYWORDS[cat] || []
      for (const token of tokens) {
        if (name.includes(token)) return true
      }
    }
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

  // 3. excluded_ingredients
  //
  // PRD-004 Phase C (P0.7): an excluded ingredient hides a recipe only when
  // the matched ingredient appears in ingredients_classified with
  // essentiality === 'essential'. This solves the cheeseburger problem:
  // excluding 'onion' no longer hides recipes that merely mention it.
  //
  // Defensive fallback: if ingredients_classified is null or missing
  // (a row the Phase A backfill missed; rare post-Phase-A), fall back to
  // the pre-Phase-C substring behavior so we don't silently let through
  // recipes that genuinely shouldn't pass.
  const excludedIngredients = Array.isArray(preferences.excluded_ingredients)
    ? preferences.excluded_ingredients
    : []
  if (excludedIngredients.length > 0) {
    const classified = Array.isArray(item.ingredients_classified)
      ? item.ingredients_classified
      : null

    if (classified !== null) {
      // Phase C path: gate on essentiality.
      const essentialNames = classified
        .filter(c => c && c.essentiality === 'essential' && typeof c.name === 'string')
        .map(c => c.name.toLowerCase())
      for (const ing of excludedIngredients) {
        if (typeof ing !== 'string') continue
        const needle = ing.trim().toLowerCase()
        if (!needle) continue
        // Case-insensitive substring on essential names only.
        // Substring (not exact match) so 'onion' matches 'red onion', etc.
        if (essentialNames.some(n => n.includes(needle))) return false
      }
    } else {
      // Pre-Phase-C fallback: substring on the full haystack.
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
  }

  // 4. dietary_restrictions (two-layer: protein category + ADR-003 name keyword)
  const dietary = Array.isArray(preferences.dietary_restrictions)
    ? preferences.dietary_restrictions
    : []
  if (dietary.length > 0 && violatesDietary(item, dietary)) return false

  return true
}
