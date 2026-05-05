/**
 * PRD-003 P0.3 (Bite B): shared AI grocery-list generator.
 *
 * Pure logic: takes an Anthropic SDK client (injected for testability) +
 * a list of recipes (each with name + ingredients) + a pantry-staples
 * list, and returns a consolidated grocery list grouped by the
 * GROCERY_SECTIONS enum.
 *
 * Used by both the local Express proxy (api-server.mjs) and the Vercel
 * serverless mirror (api/grocery-list.js) so the prompt + parse logic
 * exists in exactly one place.
 *
 * Stateless transform — NO Supabase calls, NO persistence. Bite C handles
 * writing the result to the grocery_lists / grocery_list_items tables.
 */
import { GROCERY_SECTIONS } from './constants.js'

const MODEL = 'claude-haiku-4-5-20251001'

/**
 * Thrown when the model's response can't be parsed into the expected shape.
 * The raw response text is attached for debugging (NOT exposed to clients).
 */
export class GroceryListError extends Error {
  constructor(message, { rawResponse } = {}) {
    super(message)
    this.name = 'GroceryListError'
    this.rawResponse = rawResponse ?? null
  }
}

function parseJsonLoose(text) {
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try { return JSON.parse(match[0]) } catch { return null }
  }
}

function buildUserMessage({ recipes, pantryStaples, householdSize }) {
  const sectionsLine = GROCERY_SECTIONS.join(' | ')
  const staplesLine = pantryStaples.length ? pantryStaples.join(', ') : 'None'

  // Per-recipe block: announce the recipe yield so the model has a
  // baseline to scale FROM. `servings` is always a positive int here —
  // null was resolved to DEFAULT_SERVINGS in buildGroceryList before
  // we built the message.
  const recipeBlocks = recipes
    .map(r =>
      `- ${r.name} (yields ${r.servings} servings)\n  Ingredients: ${r.ingredients.join(', ')}`,
    )
    .join('\n')

  return `Generate a consolidated grocery shopping list for the recipes below.

The household has ${householdSize} eaters. Each recipe lists its yield (the number of servings it produces). For each recipe, scale the quantity of every ingredient by (${householdSize} / yield). Then consolidate across recipes.

Recipes:
${recipeBlocks}

Pantry staples the user already has — EXCLUDE any matching ingredient entirely (case-insensitive substring match): ${staplesLine}

Instructions:
1. Scale each recipe's ingredient quantities by (household_size / yield) — e.g. a recipe that yields 4 servings, in a 6-person household, scales every quantity by 1.5.
2. Consolidate identical or near-identical ingredients across recipes into a single line item AFTER scaling. If olive oil appears in three recipes, it must appear ONCE in the output, with quantities summed.
3. Express each consolidated quantity as a free-text string (e.g. "3 lbs", "2 bunches", "5 cloves", "1 dozen"). If you cannot reasonably estimate, return null for that item's quantity.
4. Categorize each item into exactly one of these grocery store sections: ${sectionsLine}. Use exactly the spelling shown — do not invent new sections.
5. Skip any ingredient that matches a pantry staple by case-insensitive substring.

Respond with valid JSON ONLY — no prose, no markdown fences, no explanation:
{"items": [{"name": "<ingredient name>", "quantity": "<free-text quantity or null>", "section": "<one of the sections>"}, ...]}`
}

/**
 * Default household size when the caller doesn't supply one. Matches the
 * `household_preferences.adults` default (2) plus `.children` default (0)
 * — the same effective default a brand-new user would get if they generated
 * a list before opening Settings.
 */
const DEFAULT_HOUSEHOLD_SIZE = 2

/**
 * Default per-recipe yield when `servings` is null on a vault row. Matches
 * the PRD-006 P0.3 fallback chain (AI → caller default → 4).
 */
const DEFAULT_SERVINGS = 4

/**
 * Build a consolidated grocery list from a set of recipes.
 *
 * @param {object}   args
 * @param {Array<{name: string, ingredients: string[], servings?: number|null}>} args.recipes
 *                                          Recipes to combine. Required, non-empty.
 *                                          `servings` is the per-recipe yield; null /
 *                                          missing / non-positive falls back to 4.
 * @param {string[]} [args.pantryStaples]   Items the user already has; excluded
 *                                          from the output (case-insensitive
 *                                          substring match). Default [].
 * @param {number}   [args.householdSize]   Total eaters in the household
 *                                          (adults + children). Positive integer.
 *                                          Default 2 — matches the
 *                                          household_preferences defaults.
 * @param {object}   args.anthropicClient   Instantiated Anthropic SDK client.
 *
 * @returns {Promise<{items: Array<{name: string, quantity: string|null, section: string}>}>}
 *
 * @throws {GroceryListError} if the model returns malformed JSON or the
 *         wrong shape (missing/non-array `items`).
 */
export async function buildGroceryList({
  recipes,
  pantryStaples = [],
  householdSize = DEFAULT_HOUSEHOLD_SIZE,
  anthropicClient,
}) {
  if (!Array.isArray(recipes) || recipes.length === 0) {
    throw new TypeError('buildGroceryList: `recipes` must be a non-empty array')
  }
  if (!Array.isArray(pantryStaples)) {
    throw new TypeError('buildGroceryList: `pantryStaples` must be an array (may be empty)')
  }
  if (!Number.isInteger(householdSize) || householdSize < 1) {
    throw new TypeError('buildGroceryList: `householdSize` must be a positive integer')
  }
  if (!anthropicClient || typeof anthropicClient.messages?.create !== 'function') {
    throw new TypeError('buildGroceryList: `anthropicClient` must be an Anthropic SDK client')
  }

  // Resolve per-recipe servings now so the prompt has a clean baseline.
  // Anything non-positive or non-integer falls through to DEFAULT_SERVINGS.
  const resolvedRecipes = recipes.map(r => ({
    name: r.name,
    ingredients: r.ingredients,
    servings: Number.isInteger(r.servings) && r.servings > 0
      ? r.servings
      : DEFAULT_SERVINGS,
  }))

  const userMessage = buildUserMessage({ recipes: resolvedRecipes, pantryStaples, householdSize })

  // Token budget: ~25 tokens per ingredient covers {name, quantity, section}.
  // Floor at 400 for the JSON envelope; cap at 2000 to bound runaway input.
  const totalIngredients = recipes.reduce(
    (acc, r) => acc + (Array.isArray(r.ingredients) ? r.ingredients.length : 0),
    0,
  )
  const maxTokens = Math.min(2000, Math.max(400, 25 * totalIngredients + 200))

  const msg = await anthropicClient.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userMessage }],
  })

  const text = msg?.content?.[0]?.text ?? ''
  const parsed = parseJsonLoose(text)

  if (!parsed || !Array.isArray(parsed.items)) {
    throw new GroceryListError(
      'buildGroceryList: model response missing or non-array `items`',
      { rawResponse: text },
    )
  }

  const sectionSet = new Set(GROCERY_SECTIONS)
  const stapleTokens = pantryStaples
    .filter(s => typeof s === 'string')
    .map(s => s.toLowerCase().trim())
    .filter(Boolean)

  const items = []
  for (const entry of parsed.items) {
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) continue
    const name = entry.name.trim()

    // Defense in depth: skip pantry staples even if the LLM ignored the
    // instruction. Substring match keeps "salt" from leaking through as
    // "kosher salt" / "sea salt" etc.
    const lowerName = name.toLowerCase()
    if (stapleTokens.some(t => lowerName.includes(t))) continue

    // PRD-003 OQ.E: out-of-vocabulary section → coerce to 'Other' and warn.
    // We do NOT fail the whole request — one mis-categorized item is much
    // less disruptive than a 502 the user has to retry.
    let section = typeof entry.section === 'string' ? entry.section.trim() : ''
    if (!sectionSet.has(section)) {
      console.warn(
        `[grocery-list] LLM returned out-of-vocabulary section ${JSON.stringify(entry.section)} for "${name}" — coercing to 'Other'`,
      )
      section = 'Other'
    }

    // Quantity is free-text per OQ.A. Treat empty / "null" string as null.
    let quantity = null
    if (typeof entry.quantity === 'string') {
      const q = entry.quantity.trim()
      if (q && q.toLowerCase() !== 'null') quantity = q
    }

    items.push({ name, quantity, section })
  }

  return { items }
}
