/**
 * groceryRecipes.js — turn planned meals into the `recipes` the grocery-list
 * AI reads (POST /api/grocery-list). Shared by the old Groceries tab
 * (GroceryListBody, meal_plan_items) and the new Prep Table's "Confirm the
 * week" (weekGroceries.js, planned_meals), so both build the list the same way.
 *
 * Moved here unchanged from GroceryListBody (PRD-008 2b-3).
 */

/** Cookbook columns the grocery list needs, for a `vault(...)` join. */
export const GROCERY_VAULT_COLUMNS =
  'name, servings, ingredients_structured, ingredients_classified, proteins, main_carb, vegetables, dairy_components, fruits'

/**
 * "8 ounces" + "ounces" → "8 ounces" (not "8 ounces ounces"). The AI often
 * writes the unit inside the quantity AND in the unit field; the unit is only
 * added when the quantity doesn't already end with it.
 */
export function formatAmount(quantity, unit) {
  const q = typeof quantity === 'string' ? quantity.trim() : ''
  const u = typeof unit === 'string' ? unit.trim() : ''
  if (!u) return q
  if (!q) return u
  const words = q.toLowerCase().split(/\s+/)
  return words[words.length - 1] === u.toLowerCase() ? q : `${q} ${u}`
}

/**
 * PRD-006 Bite δ: format a single structured-ingredient entry as a string
 * the grocery-list AI can read. The model gets quantity + unit inline so
 * it scales the actual recipe quantity instead of re-estimating from the
 * name. Examples:
 *   { name: 'olive oil', quantity: '2', unit: 'tbsp' }       → "olive oil: 2 tbsp"
 *   { name: 'garlic clove', quantity: '3', unit: null,
 *     notes: 'minced' }                                       → "garlic clove: 3, minced"
 *   { name: 'kosher salt', quantity: null, unit: null,
 *     notes: 'to taste' }                                     → "kosher salt: to taste"
 *   { name: 'olive oil' }                                     → "olive oil"
 *
 * Returns null when the entry has no usable name.
 */
export function formatStructuredIngredient(entry) {
  if (!entry || typeof entry.name !== 'string') return null
  const name = entry.name.trim()
  if (!name) return null

  const notes = typeof entry.notes === 'string' ? entry.notes.trim() : ''

  const measureParts = formatAmount(entry.quantity, entry.unit)
  const tail = [measureParts, notes].filter(Boolean).join(', ')

  return tail ? `${name}: ${tail}` : name
}

/**
 * Meals (each `{ name, vault_id, vault }`, `vault` joined with
 * GROCERY_VAULT_COLUMNS) → what the grocery-list AI needs.
 *
 * Ingredient preference order:
 *   1. ingredients_structured — names + quantities + units + notes (Bite δ)
 *   2. ingredients_classified — names only (PRD-004 Phase A backfill)
 *   3. chip arrays            — fallback for the oldest rows
 *
 * @returns {{
 *   recipes: Array<{ name: string, ingredients: string[], servings: number|null }>,
 *   notInCookbook: string[],     // meal names with no cookbook recipe (one-offs, AI picks)
 *   noIngredients: string[],     // cookbook recipes with no ingredient data at all
 *   noList: string[],            // cookbook recipes used WITHOUT a saved ingredient list
 *                                //   (names or tags only), so their part is a guess
 * }}
 */
export function recipesFromMeals(meals = []) {
  const recipes = []
  const notInCookbook = []
  const noIngredients = []
  const noList = []
  for (const item of meals ?? []) {
    if (!item.vault_id || !item.vault) {
      notInCookbook.push(item.name)
      continue
    }
    const v = item.vault

    let ingredients = null
    const structured = v.ingredients_structured
    if (Array.isArray(structured) && structured.length > 0) {
      ingredients = structured.map(formatStructuredIngredient).filter(Boolean)
    }
    if (!ingredients || ingredients.length === 0) {
      noList.push(v.name)
      const classified = v.ingredients_classified
      if (Array.isArray(classified) && classified.length > 0) {
        ingredients = classified.map(c => c?.name).filter(Boolean)
      }
    }
    if (!ingredients || ingredients.length === 0) {
      ingredients = [
        ...(v.proteins         || []),
        ...(typeof v.main_carb === 'string' && v.main_carb ? [v.main_carb] : []),
        ...(v.vegetables       || []),
        ...(v.dairy_components || []),
        ...(v.fruits           || []),
      ].filter(Boolean)
    }
    if (ingredients.length === 0) {
      noList.splice(noList.lastIndexOf(v.name), 1)
      noIngredients.push(v.name)
      continue
    }
    recipes.push({ name: v.name, ingredients, servings: v.servings ?? null })
  }
  return { recipes, notInCookbook, noIngredients, noList }
}

/** Household size + pantry staples from preferences (row defaults: 2 adults, 0 children). */
export function groceryPrefs(prefs) {
  const householdSize = Math.max(1, (prefs?.adults ?? 2) + (prefs?.children ?? 0))
  const pantryStaples = Array.isArray(prefs?.pantry_staples) ? prefs.pantry_staples : []
  return { householdSize, pantryStaples }
}
