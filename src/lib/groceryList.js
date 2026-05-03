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

function buildUserMessage({ recipes, pantryStaples }) {
  const sectionsLine = GROCERY_SECTIONS.join(' | ')
  const staplesLine = pantryStaples.length ? pantryStaples.join(', ') : 'None'
  const recipeBlocks = recipes
    .map(r => `- ${r.name}\n  Ingredients: ${r.ingredients.join(', ')}`)
    .join('\n')

  return `Generate a consolidated grocery shopping list for the recipes below.

Recipes:
${recipeBlocks}

Pantry staples the user already has — EXCLUDE any matching ingredient entirely (case-insensitive substring match): ${staplesLine}

Instructions:
1. Consolidate identical or near-identical ingredients across recipes into a single line item. If olive oil appears in three recipes, it must appear ONCE in the output.
2. Estimate a reasonable quantity for a household of 4 as a free-text string (e.g. "2 lbs", "1 bunch", "3 cloves", "1 dozen"). If you cannot reasonably estimate, return null for that item's quantity.
3. Categorize each item into exactly one of these grocery store sections: ${sectionsLine}. Use exactly the spelling shown — do not invent new sections.
4. Skip any ingredient that matches a pantry staple by case-insensitive substring.

Respond with valid JSON ONLY — no prose, no markdown fences, no explanation:
{"items": [{"name": "<ingredient name>", "quantity": "<free-text quantity or null>", "section": "<one of the sections>"}, ...]}`
}

/**
 * Build a consolidated grocery list from a set of recipes.
 *
 * @param {object}   args
 * @param {Array<{name: string, ingredients: string[]}>} args.recipes
 *                                          Recipes to combine. Required, non-empty.
 * @param {string[]} [args.pantryStaples]   Items the user already has; excluded
 *                                          from the output (case-insensitive
 *                                          substring match). Default [].
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
  anthropicClient,
}) {
  if (!Array.isArray(recipes) || recipes.length === 0) {
    throw new TypeError('buildGroceryList: `recipes` must be a non-empty array')
  }
  if (!Array.isArray(pantryStaples)) {
    throw new TypeError('buildGroceryList: `pantryStaples` must be an array (may be empty)')
  }
  if (!anthropicClient || typeof anthropicClient.messages?.create !== 'function') {
    throw new TypeError('buildGroceryList: `anthropicClient` must be an Anthropic SDK client')
  }

  const userMessage = buildUserMessage({ recipes, pantryStaples })

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
