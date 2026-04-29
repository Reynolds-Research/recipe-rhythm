/**
 * PRD-004 Phase A (P0.2): shared AI ingredient classifier.
 *
 * Pure logic: takes an Anthropic SDK client (injected for testability) +
 * a recipe's ingredient list and returns each ingredient classified as
 * 'essential' or 'omittable' per ADR-002.
 *
 * Used by both the local Express proxy (api-server.mjs) and the Vercel
 * serverless mirror (api/classify-ingredients.js) so the prompt + parse
 * logic exists in exactly one place.
 *
 * NO Supabase calls, NO fetch, NO Express. Phase A is foundation only —
 * `passesPreferences` and the Preferences UI are unchanged.
 */

const MODEL = 'claude-haiku-4-5-20251001'

const SYSTEM_PROMPT =
  `You classify recipe ingredients as 'essential' or 'omittable' for the named dish. Bias strongly toward 'omittable' — false-essentials cause the recipe to be wrongly hidden when a user excludes a substitutable ingredient, which is the bug this classifier is solving.

THE TEST FOR ESSENTIAL: ask "without THIS specific ingredient, is the dish still identifiable as itself?" If yes → omittable. Only mark essential when removing the ingredient would make the dish unrecognizable.

ESSENTIAL examples:
- Flour in bread, eggs in carbonara, tomato in margherita pizza.
- Beef in "Beef Stew" — the dish is literally named for the meat AND the dish-name-minus-meat ("Stew") is too generic to identify.
- Bread in any sandwich — sandwiches require bread.
- Bacon (B), Lettuce (L), Tomato (T) in BLT — branded/special-name dishes require every named component or they become a different dish.
- Cheese in "Cheeseburger" / Mozzarella in "Caprese" — the cheese is the dish identifier.

OMITTABLE examples (this is the more common case — most named ingredients are NOT essential by this strict rule):
- "with X" pattern: chicken in "Caesar Salad with Grilled Chicken", couscous in "Lamb Chops with Couscous". Caesar Salad exists without chicken; Lamb Chops exist without couscous.
- Named protein in a dish whose category exists with other proteins: chicken in "Chicken Saag" (lamb saag, paneer saag, plain saag are all valid saag); chicken in "Butter Chicken Meatballs" (any meat works in meatballs); chicken in "Chicken Caprese Orzo Bake" (the caprese identifies the dish, chicken is the protein variant).
- Substitutable filling in a category-named dish:
    * Meatballs / meatloaf can contain any meat.
    * Burgers can contain any ground meat.
    * Sushi bowls require fish but any fish works.
    * Stir-fries, curries, salads accept any protein.
- Specific shape/variety where the category-name covers it: orzo, ditalini, penne are interchangeable pasta shapes; quinoa, rice, bulgur are interchangeable grains; cabbage and lettuce are interchangeable slaw greens.
- Toppings, garnishes, accents, sauce variations, optional aromatics: lettuce on a burger, parsley garnish, lemon wedge for fish, onion in chili.
- Multi-component composed dishes (Cobb Salad, antipasto, charcuterie boards, mezze plates): the SET of components defines the dish, but EACH INDIVIDUAL component is interchangeable. Mark every component omittable.

DECISION HEURISTICS for tricky cases:
- If the recipe name minus the ingredient becomes too vague to identify a dish ("sandwich", "bowls", "stew") → ingredient is essential.
- If the recipe is a specific branded or named-author dish (Dave's Killer Sandwich, Alison Roman's Lemon Date Chicken, BLATE, Mom's Lasagna) → strict: every named component is essential because deviation makes it a different dish.
- If two named ingredients are joined by "and" (e.g., "Salmon and Quinoa") → both are essential, since each alone is just a noun, not a dish.
- If you're unsure → choose omittable. The cost of a false-essential (recipe hidden incorrectly) is higher than the cost of a false-omittable.

Return each ingredient name EXACTLY as given in the input. Do not split compound names like "onion/garlic" or "lemon/lime" into separate entries — preserve them as a single ingredient. Do not normalize, expand, or rewrite names. Skip any ingredient whose name is literally "none" — that is a placeholder, not a real ingredient.

Respond with valid JSON only, no prose:
{"classifications": [{"name": "<input name verbatim>", "essentiality": "essential" | "omittable"}, ...]}`

/**
 * Thrown when the model's response can't be parsed into the expected shape.
 * The raw response text is attached for debugging (NOT exposed to clients).
 */
export class ClassifyIngredientsError extends Error {
  constructor(message, { rawResponse } = {}) {
    super(message)
    this.name = 'ClassifyIngredientsError'
    this.rawResponse = rawResponse ?? null
  }
}

function buildUserMessage({ recipeName, cuisine, ingredients }) {
  const cuisineLine = cuisine && String(cuisine).trim() ? String(cuisine).trim() : 'unknown'
  const bullets = ingredients.map(line => `- ${line}`).join('\n')
  return `Recipe: ${recipeName}\nCuisine: ${cuisineLine}\n\nIngredients:\n${bullets}`
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

/**
 * Classify each ingredient line as 'essential' or 'omittable'.
 *
 * @param {object}   args
 * @param {string[]} args.ingredients      Raw ingredient lines (any free-text shape).
 *                                         The model is instructed to normalize names.
 * @param {string}   args.recipeName       Recipe name (required for context).
 * @param {string|null} [args.cuisine]     Cuisine type (optional context).
 * @param {object}   args.anthropicClient  Instantiated Anthropic SDK client.
 *
 * @returns {Promise<{classifications: Array<{name: string, essentiality: 'essential'|'omittable', source: 'ai'}>}>}
 *
 * @throws {ClassifyIngredientsError} if the model returns malformed JSON or
 *         the wrong shape (missing/non-array `classifications`, or any entry
 *         missing `name` / `essentiality` / using an unknown essentiality).
 */
export async function classifyIngredients({
  ingredients,
  recipeName,
  cuisine = null,
  anthropicClient,
}) {
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    throw new TypeError('classifyIngredients: `ingredients` must be a non-empty array of strings')
  }
  if (typeof recipeName !== 'string' || !recipeName.trim()) {
    throw new TypeError('classifyIngredients: `recipeName` must be a non-empty string')
  }
  if (!anthropicClient || typeof anthropicClient.messages?.create !== 'function') {
    throw new TypeError('classifyIngredients: `anthropicClient` must be an Anthropic SDK client')
  }

  const userMessage = buildUserMessage({ recipeName, cuisine, ingredients })

  // Token budget: ~30 tokens per ingredient is generous for {name, essentiality}
  // pairs. Floor at 200 to cover the JSON envelope; cap at 2000 to bound runaway
  // input.
  const maxTokens = Math.min(2000, Math.max(200, 30 * ingredients.length + 100))

  const msg = await anthropicClient.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })

  const text = msg?.content?.[0]?.text ?? ''
  const parsed = parseJsonLoose(text)

  if (!parsed || !Array.isArray(parsed.classifications)) {
    throw new ClassifyIngredientsError(
      'classifyIngredients: model response missing or non-array `classifications`',
      { rawResponse: text },
    )
  }

  const classifications = parsed.classifications.map((entry, i) => {
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) {
      throw new ClassifyIngredientsError(
        `classifyIngredients: entry ${i} missing valid \`name\``,
        { rawResponse: text },
      )
    }
    if (entry.essentiality !== 'essential' && entry.essentiality !== 'omittable') {
      throw new ClassifyIngredientsError(
        `classifyIngredients: entry ${i} has invalid \`essentiality\` (got ${JSON.stringify(entry.essentiality)})`,
        { rawResponse: text },
      )
    }
    return {
      name: entry.name.trim(),
      essentiality: entry.essentiality,
      source: 'ai',
    }
  })

  return { classifications }
}
