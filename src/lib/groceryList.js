/**
 * PRD-003 P0.3 (Bite B): shared AI grocery-list generator.
 *
 * Pure logic: takes an Anthropic SDK client (injected for testability) +
 * a list of recipes (each with name + ingredients + servings) + a
 * pantry-staples list + a household size, and returns a consolidated
 * grocery list grouped by the GROCERY_SECTIONS enum.
 *
 * Each ingredient in `recipes[].ingredients` is a free-text string. The
 * page that calls this lib formats per-ingredient strings either as just
 * the name (legacy / unstructured rows) or as `"name: quantity unit, notes"`
 * (PRD-006 Bite δ — when ingredients_structured is available). The prompt
 * tells the AI to honor provided quantities and estimate only when missing.
 *
 * Used by both the local Express proxy (api-server.mjs) and the Vercel
 * serverless mirror (api/grocery-list.js) so the prompt + parse logic
 * exists in exactly one place.
 *
 * Stateless transform — NO Supabase calls, NO persistence. Bite C handles
 * writing the result to the grocery_lists / grocery_list_items tables.
 */
import { GROCERY_SECTIONS } from './constants.js'
import { addUpAmount, friendlyAmount } from './groceryAmounts.js'

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

  // Per-recipe block: the recipe's yield and the exact multiplier, worked
  // out here (never by the model). `servings` is always a positive int here —
  // null was resolved to DEFAULT_SERVINGS in buildGroceryList before
  // we built the message.
  const recipeBlocks = recipes
    .map(r => {
      const f = scaleFactor(householdSize, r.servings)
      const how = f === 1 ? 'multiply amounts by 1 (as written)' : `multiply amounts by ${f}`
      return `- ${r.name} (yields ${r.servings} servings; ${how})\n  Ingredients: ${r.ingredients.join(', ')}`
    })
    .join('\n')

  return `Generate a consolidated grocery shopping list for the recipes below.

The household has ${householdSize} eaters. They cook each recipe whole and eat the leftovers, so a recipe is NEVER scaled down — only up, when it yields fewer servings than the household needs. Each recipe line gives the exact number to multiply its amounts by (1 = as written). Then consolidate across recipes.

Recipes:
${recipeBlocks}

Pantry staples the user already has — EXCLUDE any matching ingredient entirely (case-insensitive substring match): ${staplesLine}

Instructions:
1. When an ingredient is given with a quantity (e.g. "olive oil: 2 tbsp"), use that quantity as the baseline for scaling — do NOT re-estimate. When an ingredient is given without a quantity (e.g. just "olive oil"), estimate a reasonable amount for the recipe's yield first. Then multiply by that recipe's number. Use exactly the number given; never compute your own.
2. Consolidate identical or near-identical ingredients across recipes into a single line item AFTER scaling. If olive oil appears in three recipes, it must appear ONCE in the output, with quantities summed. Words for size, freshness or prep (small, large, medium, fresh, chopped, diced, uncooked) never make a different item: "small onion" and "yellow onion" are ONE line ("onion", amounts summed), as are "fresh ginger" and "ginger". Only a different variety stays apart (red onion vs. yellow onion; paprika vs. smoked paprika).
3. Give TWO amounts per item, as free-text strings. Write fractions as ½ ¼ ¾ ⅓ ⅔ ⅛ — never decimals like 1.125.
   - "recipe_quantity": the scaled, consolidated total the recipes use (e.g. "1 lb", "2 cups", "1½ tsp"). Counts are plain numbers ("2", "1½") — never the word "whole". Amounts under ¼ cup go in tbsp or tsp ("3 tbsp", not "3/16 cup"); never sixteenths. Always do the addition and give ONE total: "2 tsp", never "1½ tsp + ½ tsp"; "4 tsp", never "1 tbsp + 1 tsp".
   - "quantity": what to BUY at a US grocery store, rounded UP to how the item is sold: whole produce as a count ("2", not "1½ avocados"), herbs and green onions by the bunch, cabbage or lettuce by the head, leafy greens by the bag with a typical size ("1 bag (5 oz)"), meat and fish by weight to the next ¼ lb ("1¼ lb") — when a recipe counts pieces (4 salmon fillets, 2 chicken breasts), count about 6 oz per piece (4 fillets → "1½ lb"), tortillas and bread by the pack or loaf, sauces and spices by the container ("1 bottle", "1 jar").
   If you cannot reasonably estimate an amount, use null for it.
4. Set "assumed" to true ONLY for long-lasting cupboard items most kitchens already keep and that last for months: salt, pepper, dried spices and dried herbs, cooking oils, vinegars, soy sauce and similar bottled sauces or cooking wines (mirin, sake), sugar, honey, flour, baking soda and powder, sesame seeds. Everything else is false — fresh produce and herbs, meat, fish, dairy, eggs, bread, tortillas, pasta, canned goods and anything perishable.
5. Categorize each item into exactly one of these grocery store sections: ${sectionsLine}. Use exactly the spelling shown — do not invent new sections.
6. Skip any ingredient that matches a pantry staple by case-insensitive substring.

Respond with valid JSON ONLY — no prose, no markdown fences, no explanation:
{"items": [{"name": "<ingredient name>", "quantity": "<what to buy, or null>", "recipe_quantity": "<what the recipes use, or null>", "section": "<one of the sections>", "assumed": <true or false>}, ...]}`
}

/** Free-text amount → trimmed friendly string, or null. */
function amountOrNull(value) {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!v || v.toLowerCase() === 'null') return null
  // The AI sometimes writes "1½ tsp + ½ tsp" instead of a total; add it up.
  return addUpAmount(friendlyAmount(v))
}

/**
 * What to multiply a recipe's amounts by: household ÷ yield, but never below
 * 1 — they cook recipes whole and eat leftovers (decided 2026-11-05), so a
 * 4-serving recipe for 3 people is bought as written; for 6 people, ×1.5.
 * Rounded to 2 decimals so the prompt shows a clean number.
 */
export function scaleFactor(householdSize, servings) {
  if (!Number.isInteger(servings) || servings < 1) return 1
  return Math.max(1, Math.round((householdSize / servings) * 100) / 100)
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
 * @returns {Promise<{items: Array<{name: string, quantity: string|null,
 *   recipe_quantity: string|null, section: string, assumed: boolean}>}>}
 *   `quantity` is what to buy (store units); `recipe_quantity` what the recipes use.
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

  // Token budget: ~45 tokens per ingredient covers {name, quantity,
  // recipe_quantity, section, assumed}. Floor at 400 for the JSON envelope;
  // cap at 3000 to bound runaway input.
  const totalIngredients = recipes.reduce(
    (acc, r) => acc + (Array.isArray(r.ingredients) ? r.ingredients.length : 0),
    0,
  )
  const maxTokens = Math.min(3000, Math.max(400, 45 * totalIngredients + 200))

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

    // Amounts are free-text per OQ.A. Empty / "null" string → null; any
    // decimal the model slipped in becomes a kitchen fraction (1.125 → 1⅛).
    const quantity = amountOrNull(entry.quantity)
    const recipe_quantity = amountOrNull(entry.recipe_quantity)
    // Only a real `true` counts: anything else stays on the list.
    const assumed = entry.assumed === true

    items.push({ name, quantity, recipe_quantity, section, assumed })
  }

  return { items }
}
