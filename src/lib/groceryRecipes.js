/**
 * groceryRecipes.js — turn planned meals into the `recipes` the grocery-list
 * AI reads (POST /api/grocery-list), for the Prep Table's "Confirm the week"
 * (weekGroceries.js, planned_meals).
 *
 * Moved here from the old Groceries tab (PRD-008 2b-3), which was retired in phase 4.
 */

import { isOnList } from './extraMatch'

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
 *   extras: Array<{ name: string, with: string|null, servings: number|null }>,
 *                                // for the AI to estimate ("Meal shapes", 2026-11-14):
 *                                //   an add-on ("shrimp" with "Penne alla Vodka"), or a
 *                                //   meal with no recipe (with: null). Before this, a
 *                                //   meal with no recipe added nothing to the list.
 * }}
 */
/**
 * A night that isn't cooked at home: nothing to buy. Matched on the shape of
 * the whole name, never a word inside a dish, so "Inside-Out Burgers",
 * "Takeout-Style Orange Chicken" and "Leftover Turkey Pot Pie" are meals:
 *   - ends in " out": "Pizza out", "Eat out", "Sushi out"
 *   - is just "Takeout" / "Delivery" / "Leftovers" / "Ordering in" / "Restaurant"
 *   - starts with "Takeout " / "Delivery ": "Takeout sushi" (not "Takeout-Style …")
 * Named on the sheet as "Not shopped for", so it's never silent.
 */
const NOT_COOKING = [
  /(^|\s)out\s*$/i,
  /^\s*(takeout|take-out|take out|delivery|leftovers?|order(ing)? in|restaurant|eating out|dining out)\s*$/i,
  /^\s*(takeout|take-out|delivery)\s+\S/i,
]
export function isNotCooking(name) {
  return typeof name === 'string' && NOT_COOKING.some((re) => re.test(name))
}

/** The week's nights off (meals with no recipe that aren't cooked), for the sheet's line. */
export function nightsOffNames(meals = []) {
  const names = []
  for (const meal of meals ?? []) {
    if (!meal?.vault_id && isNotCooking(meal?.name) && !names.includes(meal.name.trim())) names.push(meal.name.trim())
  }
  return names
}

export function recipesFromMeals(meals = []) {
  const recipes = []
  const notInCookbook = []
  const noIngredients = []
  const noList = []
  const extras = []
  for (const item of meals ?? []) {
    if (!item.vault_id || !item.vault) {
      notInCookbook.push(item.name)
      // A meal with no recipe: the AI lists the main things its name says.
      // Its add-on (rare: the app offers one only on recipes) rides along in the name.
      const name = item.add_on ? `${item.name} + ${item.add_on}` : item.name
      if (typeof name === 'string' && name.trim() && !isNotCooking(item.name)) {
        extras.push({ name: name.trim(), with: null, servings: null })
      }
      continue
    }
    const v = item.vault
    // The add-on goes to the AI with the recipe it's added to — even when the
    // recipe itself has no ingredients to add.
    if (typeof item.add_on === 'string' && item.add_on.trim()) {
      extras.push({ name: item.add_on.trim(), with: v.name, servings: v.servings ?? null })
    }

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
  return { recipes, notInCookbook, noIngredients, noList, extras }
}

/**
 * What the grocery list estimates from words alone, for the sheet's note:
 * add-ons ("shrimp") and meals with no recipe, once each, in plan order.
 */
export function estimatedExtraNames(meals = []) {
  const names = []
  for (const meal of meals ?? []) {
    const label = !meal?.vault_id
      ? (isNotCooking(meal?.name) ? null : meal?.name)
      : meal?.add_on
    const clean = typeof label === 'string' ? label.trim() : ''
    if (clean && !names.includes(clean)) names.push(clean)
  }
  return names
}

/**
 * The sheet's notes, checked against the list itself (2026-11-15: the note
 * named "Italian sausage" as an estimate while the list had no sausage).
 *   estimated — add-ons that ARE on the list, and meals with no recipe
 *   notOnList — add-ons the list doesn't have (a list made before the add-on
 *               was set, or before the server checked) → "tap Update list"
 * `itemNames` are the list's line names.
 */
export function extrasStatus(meals = [], itemNames = []) {
  const estimated = []
  const notOnList = []
  for (const name of estimatedExtraNames(meals)) {
    const isAddOn = (meals ?? []).some((m) => m?.vault_id && typeof m.add_on === 'string' && m.add_on.trim() === name)
    const target = isAddOn && !isOnList(name, itemNames) ? notOnList : estimated
    if (!target.includes(name)) target.push(name)
  }
  return { estimated, notOnList }
}

/** Household size + pantry staples from preferences (row defaults: 2 adults, 0 children). */
export function groceryPrefs(prefs) {
  const householdSize = Math.max(1, (prefs?.adults ?? 2) + (prefs?.children ?? 0))
  const pantryStaples = Array.isArray(prefs?.pantry_staples) ? prefs.pantry_staples : []
  return { householdSize, pantryStaples }
}

/**
 * Where a recipe's amounts are REAL: copied from the recipe itself — her
 * screenshots, or the recipe page read from its link (2026-11-06).
 * Anything else is the AI's guess from the recipe's name and tags: lists marked
 * 'estimated', the May 2026 backfill's lists (no source; the script sent the
 * name only), and recipes with no list at all. Matches the Cookbook card's
 * "Amounts estimated" (src/pages/Vault/RecipeSource.jsx) for every recipe with
 * a list; one edge differs: a 'screenshot' recipe with no list is not named
 * here (it adds nothing to the list; the card says "No amounts saved yet").
 */
export const EXACT_SOURCES = ['screenshot', 'page']

export function amountsAreGuess(recipe) {
  return !EXACT_SOURCES.includes(recipe?.ingredients_source)
}

/**
 * The week's cookbook recipes whose amounts are guesses, by name, once each,
 * in the order they're planned. `meals` are planned_meals rows; `vault` is the
 * household cookbook (needs id, name, ingredients_source). Meals with no
 * recipe and add-ons aren't here: see estimatedExtraNames.
 */
export function guessedRecipeNames(meals = [], vault = []) {
  const byId = new Map(vault.map((v) => [v.id, v]))
  const names = []
  for (const meal of meals) {
    const recipe = meal?.vault_id ? byId.get(meal.vault_id) : null
    if (recipe && amountsAreGuess(recipe) && !names.includes(recipe.name)) names.push(recipe.name)
  }
  return names
}
