/**
 * extraMatch.js — is an add-on ("Italian sausage") on a grocery list?
 *
 * Found 2026-11-15: her "Penne alla Vodka + Italian sausage" made a list with
 * no sausage on it. The AI had been asked to fold the add-on in with ~40
 * recipe ingredients and left it out; nothing checked. So now the list is
 * checked against every add-on, here, on the server (to fill the gap) and in
 * the app (so the sheet never names something that isn't there).
 *
 * The rule: an add-on is on the list when some line's name contains the
 * add-on's main word — its last real word, which in English is the thing
 * itself ("Italian sausage" → sausage, "garlic bread" → bread, "1 lb
 * shrimp" → shrimp). "Chicken sausage" or "sausage links" on the list count;
 * "Italian seasoning" doesn't. Plural and singular match ("shrimp"/"shrimps",
 * "meatball"/"meatballs").
 *
 * Pure: no AI, no database. Used by src/lib/groceryList.js (server) and
 * src/lib/groceryRecipes.js (the sheet's note).
 */

const NOT_A_THING = new Set([
  'of', 'and', 'with', 'or', 'the', 'a', 'an', 'some', 'extra', 'more', 'fresh', 'frozen',
  'lb', 'lbs', 'pound', 'pounds', 'oz', 'ounce', 'ounces', 'g', 'kg', 'cup', 'cups', 'pack', 'package', 'bag',
  'side', 'on', 'top', 'for',
])

function words(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // jalapeño → jalapeno
    .split(/[^a-z]+/)
    .filter(Boolean)
}

/** "sausages" → "sausage", "tomatoes" → "tomato", "berries" → "berry". */
function singular(w) {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`
  if (w.length > 4 && /(oes|ches|shes|xes)$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

/** The add-on's main word: its last word that names a thing. null if none. */
export function mainWord(name) {
  const ws = words(name).filter((w) => !NOT_A_THING.has(w) && !/^\d/.test(w))
  return ws.length ? singular(ws[ws.length - 1]) : null
}

/** Is `addOn` on a list whose line names are `itemNames`? */
export function isOnList(addOn, itemNames = []) {
  const key = mainWord(addOn)
  if (!key) return true // nothing to look for: don't claim it's missing
  return itemNames.some((n) => words(n).map(singular).includes(key))
}
