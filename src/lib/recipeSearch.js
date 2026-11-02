/**
 * Client-side recipe search over an already-loaded vault array.
 *
 * Used by the Prep Table day picker and the Cookbook page (and, later, the
 * PRD-008 Phase 2 "+ add"). The whole household cookbook is in memory on those
 * screens, so this is a plain filter: no network, no debounce. Revisit if the
 * vault ever stops being loaded in full.
 *
 * Matching: every query word must appear (as a substring) somewhere in the
 * searchable fields. Case-, accent- and whitespace-insensitive.
 *
 * Ranking, best first; ties keep the input order:
 *   0. the name starts with the whole query
 *   1. every query word is in the name
 *   2. the rest (matched only via tags / notes)
 */

const SEARCH_FIELDS = [
  'name',
  'cuisine_type',
  'flavor_profile',
  'proteins',
  'main_carb',
  'cooking_method',
  'dietary_tags',
  'vegetables',
  'notes',
]

export function normalizeSearchText(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Array fields are joined; null / 'None' values (the chip pickers' "none"
// choice) are ignored so a query for "none" doesn't match every recipe.
function fieldText(value) {
  const parts = Array.isArray(value) ? value : [value]
  return parts
    .filter((v) => v != null && v !== '' && v !== 'None')
    .map(normalizeSearchText)
    .join(' ')
}

/**
 * @param {Array<Object>} recipes
 * @param {string} query
 * @returns {Array<Object>} matching recipes, ranked; [] for a blank query
 */
export function searchRecipes(recipes, query) {
  const q = normalizeSearchText(query ?? '')
  if (!q || !Array.isArray(recipes)) return []
  const words = q.split(' ')

  const ranked = []
  recipes.forEach((recipe, index) => {
    const name = fieldText(recipe?.name)
    const haystack = SEARCH_FIELDS.map((f) => fieldText(recipe?.[f])).join(' ')
    if (!words.every((w) => haystack.includes(w))) return
    let rank = 2
    if (name.startsWith(q)) rank = 0
    else if (words.every((w) => name.includes(w))) rank = 1
    ranked.push({ recipe, rank, index })
  })

  return ranked
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((r) => r.recipe)
}
