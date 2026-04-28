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
  `You classify recipe ingredients as 'essential' or 'omittable' for the named dish.

ESSENTIAL: removing this ingredient would make the dish fundamentally different (e.g., flour in bread, eggs in carbonara, onion in onion rings, beef in beef stew).

OMITTABLE: the dish would still be recognizable without this ingredient (e.g., cilantro in tacos, onion in chili, sesame seeds on a burger bun, parsley as garnish).

For each ingredient line, return its normalized common name (strip the quantity, unit, and descriptors like 'diced' or 'fresh') and its classification.

Respond with valid JSON only, no prose:
{"classifications": [{"name": "<normalized name>", "essentiality": "essential" | "omittable"}, ...]}`

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
