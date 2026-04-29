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
- Named protein in a dish whose category exists with other proteins: chicken in "Chicken Caprese Orzo Bake" (the caprese identifies the dish, chicken is the protein variant); chicken in "White Chicken Chili" (the "white" cream defines the chili, chicken is the variant); turkey in "Broccoli Cheddar Turkey Skillet" (broccoli+cheddar identifies the dish, turkey is the protein variant).
- Substitutable filling in a category-named dish:
    * Meatballs / meatloaf can contain any meat.
    * Burgers can contain any ground meat.
    * Sushi bowls require fish but any fish works.
    * Salads accept any protein.
- Specific shape/variety where the category-name covers it: orzo, ditalini, penne are interchangeable pasta shapes; quinoa, rice, bulgur are interchangeable grains; cabbage and lettuce are interchangeable slaw greens.
- Toppings, garnishes, accents, sauce variations, casual aromatics: lettuce on a burger, parsley garnish, lemon wedge for fish, onion sprinkled on a finished chili.
- Multi-component composed dishes (Cobb Salad, antipasto, charcuterie boards, mezze plates): the SET of components defines the dish, but EACH INDIVIDUAL component is interchangeable. Mark every component omittable.

CUISINE-FOUNDATIONAL AROMATICS / SAUCE BASES (narrow whitelist — apply only to specific named dishes, NOT cuisine-wide):

Aromatics are USUALLY omittable accents. The exception is a small set of named dishes where a specific aromatic/sauce IS the dish's foundation. ONLY apply this exception when the recipe name matches one of the patterns below — never "this is an Indian/Italian/Mexican dish so onion/garlic is essential." And never extend it to the protein — protein is still subject to the normal protein-variant rule below.

- Saag (Indian, e.g., "Chicken Saag"): onion/garlic AND spinach/greens are essential — the greens-onion-garlic braise IS saag. Chicken/lamb/paneer is the variant (omittable).
- Butter Chicken (Indian, e.g., "Butter Chicken Meatballs"): onion/garlic, tomato, butter, and cream are all essential — the tomato-butter-cream sauce IS the dish. The chicken (or any meat) is the variant (omittable). Butter is essential ONLY in butter-named dishes; cooking-fat butter elsewhere is omittable.
- Bolognese (e.g., "Spaghetti Bolognese"): the soffritto (onion, carrot, celery), tomato, and the ground meat (beef, since Bolognese is meat-defined) are essential. Pasta is the named carb and essential.
- "White" cream-based chili (e.g., "White Chicken Chili"): cream AND onion/garlic are essential — "white" signals the cream base. The chicken (or any meat) is the variant; the beans/lentils are typically essential to "chili" itself.
- Cream-defined pasta (e.g., "lobster pasta", "creamy X pasta"): cream, pasta, and onion/garlic are essential. The seafood/meat is the protein variant (omittable). Butter as a cooking fat in such pasta is omittable.
- Egg Roll Bowls (Chinese, deconstructed egg-roll filling): cabbage AND onion/garlic are essential — they're the filling. The pork/meat is the variant (omittable).
- Chinese dishes named for an aromatic (e.g., "Scallion Meatballs", "Ginger X", "Garlic X"): the named aromatic is essential. Other aromatics in the recipe stay omittable unless also named.
- "X Stir-fry" (Chinese): the named protein, the rice it's served over, and the wok aromatics (onion/garlic) are all essential — the dish is a complete stir-fry-with-rice plate.

OUTSIDE this whitelist, default aromatics back to omittable. Be explicit:
- Onion/garlic is OMITTABLE in: salads of any kind; bowls (Pork Carnitas Bowls, Mediterranean Chicken Bowls, taco bowls — note these are NOT in the whitelist); pasta bakes (Chicken Caprese Orzo Bake); sandwiches; named-author/branded dishes (Lemon Date Alison Roman Chicken, Dave's Killer Sandwich); pizzas; curries served as salads (Curry Chicken Rice Salad — that's a salad, not a curry-sauce dish); most skillet dishes.
- Tomato is OMITTABLE when it's a topping/garnish (sandwiches, salads, bowls, tacos, enchiladas, pork carnitas) — only essential when it IS the sauce of a named tomato-sauce dish.
- Cream is OMITTABLE in dishes that don't name a cream sauce — saag is greens-based, not cream-based; most curries are not cream-based.
- Butter is OMITTABLE as a cooking fat — only essential when the dish names it ("Butter Chicken X", "Garlic Butter X").
- Milk in French toast / pancakes / batters is OMITTABLE (water or cream works as a substitute).

MULTI-WORD DISH IDENTIFIERS (essential — every named ingredient in a compound name):

When the recipe name pairs two ingredients to identify the dish (a "compound name"), BOTH of those ingredients are essential — even if either one alone would be omittable. The compound IS the identity.

Examples:
- "Broccoli Cheddar X" → broccoli AND cheddar/cheese both essential. (The combo is the dish.)
- "Cheese X Y" or "X Cheese Y" where "Cheese" is in the title as an identifier → that cheese is essential (e.g., "Cheese Tuna Orzo" — parmesan/cheese is the identifier; tuna is still the protein variant and stays omittable).
- "Honey Garlic X", "Lemon Garlic X", "Garlic Butter X", "Sesame Ginger X", "Sweet and Sour X" → both named flavor components essential.
- "Buffalo X" → buffalo sauce / hot sauce essential.
- "Caprese X" → tomato + mozzarella + basil essential.
- "Butter Chicken X" → butter chicken's defining sauce ingredients (butter, tomato, cream, onion/garlic) are essential.

A "compound name" requires TWO ingredient words paired together as the dish identity. A single ingredient word in the title (like "Pizza" in "Pizza chickpeas", or "Burger" in "Cheeseburger Salad") does NOT make every typical-companion ingredient essential. "Pizza chickpeas" is a chickpea dish styled like pizza — the chickpeas are essential, but cheese on top is not. Similarly, "Cheeseburger Salad" is a salad styled like a cheeseburger — beef/tomato are NOT automatically essential; only the named cheese is.

PROTEIN-VARIANT RULE (very strong default — applies even when the protein is in the title):

A named protein in a recipe title is omittable when the dish-name-minus-protein still names a recognizable dish. The protein is just the variant; the dish exists with other proteins. This rule overrides "in the title = essential" — only fall back to essential if the dish-without-protein is too generic to identify ("Stew", "Sandwich", "Chops").

Protein OMITTABLE examples — the dish-without-protein is itself a dish:
- "Chicken Saag" — saag exists with paneer/lamb/none.
- "Butter Chicken Meatballs" — meatballs accept any meat; "butter chicken" identifies the sauce.
- "Chicken Feta Meatballs" — meatballs accept any meat; the feta is the identifier.
- "Mediterranean Chicken Bowls" — Mediterranean bowls accept any protein.
- "Pork Carnitas Bowls" — carnitas exists with chicken/jackfruit; bowls accept variants.
- "Curried Chicken and Rice Salad" / "Curry Chicken Rice Salad" — curry rice salad exists with other proteins.
- "White Chicken Chili" — chili is a category; "white" + cream is the identifier.
- "Egg Roll Bowls" — pork is the typical filling but cabbage+aromatics define the dish.
- "High Protein Lobsta Pasta" — the cream-pasta is the dish; seafood is the variant.
- "One Pan Chicken Feta Meatballs With Lemon Turmeric Rice" — only the feta (cheese) is the dish-defining identifier; chicken, rice, and lemon are typical-but-substitutable.

Protein ESSENTIAL examples — the dish-without-protein is too generic:
- "Beef Stew", "Pork Chops", "Lamb Chops", "Pork Carnitas" (without "bowls"), "Fried Chicken", "Turkey Sandwich" (sandwich alone is a category, but the protein in any sandwich is what makes it a specific sandwich).
- "Chicken Stir-fry" — the named protein in a stir-fry is essential per the cuisine rule above.
- "Salmon and Quinoa" — joined by "and", each alone is just a noun.

DECISION HEURISTICS for tricky cases:
- If the recipe name minus the ingredient becomes too vague to identify a dish ("sandwich", "stew") → ingredient is essential. ("Bowls" / "skillet" alone are too vague — but a rice bowl IS still essentially-rice.)
- "X Bowls" where rice is the carb base: rice is essential. Examples: "Mediterranean Chicken Bowls", "Pork Carnitas Bowls", "Taco Meatball Bowls". (Bowls always need their grain base.)
- "Caesar Salad" specifically: the dish-defining greens (romaine/spinach) and parmesan are essential. The protein "with grilled X" is omittable.
- "North Beach Salad" and similar named-author/regional salads: the title-named ingredients (or the customary defining ingredients of the named salad) are essential.
- Branded named-sandwich dishes (Dave's Killer Sandwich): bread + the deli meat / protein that makes it a sandwich are essential. Toppings (lettuce, tomato, cheese, condiments) on a sandwich are NOT automatically essential — they're toppings.
- BLATE = Bacon + Lettuce + Avocado + Tomato + Egg. The acronym is exhaustive — cheese is NOT in BLATE; do not add it as essential.
- "Pizza X" where X is the actual food (Pizza chickpeas) → the dish IS chickpeas styled like pizza. Tomato/cheese on top are omittable. EXCEPTION: when X is the actual base (e.g., "Cornmeal Crust Pizza" — actual pizza), bread/cheese/tomato are essential.
- Two ingredients joined by "and" as the WHOLE TITLE (e.g., "Salmon and Quinoa") → both essential. NOT for "and" inside a longer title (e.g., "Meat loaf meatballs polenta and veggies" — polenta is a side, not a dish identifier).
- "with X" pattern at the end of a title: X is omittable (e.g., "Lamb Chops with Couscous" — couscous omittable; "Caesar Salad with Grilled Chicken" — chicken omittable; "Chickpeas with Zucchini and Pesto" — zucchini omittable).
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
