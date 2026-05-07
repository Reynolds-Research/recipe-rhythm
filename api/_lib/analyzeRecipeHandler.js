/**
 * PRD-006 P0.2: shared request handler for /api/analyze-recipe.
 *
 * Both api-server.mjs (local Express proxy) and api/analyze-recipe.js
 * (Vercel serverless mirror) delegate here so the prompt, servings-fallback
 * logic, and response shape exist in exactly one place.
 *
 * The shape `(req, res) => Promise<void>` matches both runtimes — Express and
 * Vercel both expose req.body (JSON-parsed by the framework) and a Node-style
 * res with .status().json().
 *
 * Method-not-allowed handling stays in the Vercel mirror (Express dispatches
 * by method already via app.post).
 */
import { parseJsonLoose } from './anthropic.js'
import { buildAnalyzeRecipePromptBlock } from '../../src/lib/constants.js'
import { ClassifyIngredientsError } from '../../src/lib/classifyIngredients.js'
import { classifyIngredientsCached } from './classifyIngredientsCached.js'

// When the AI can't infer servings and the caller didn't supply a default,
// fall back to 4 (a reasonable single-household serving count).
const SERVINGS_HARDCODED_FALLBACK = 4

/**
 * PRD-006 D1: build an optional chip-grounding block that pins user-confirmed
 * chip values as ground truth for the extractor. Returns '' when userChips is
 * absent / empty / has no presentable values — in that case the rest of the
 * prompt is byte-for-byte identical to the pre-D1 behavior.
 *
 * Protein/fruit are singular here (matching the PRD-006 chip vocabulary in the
 * RecipeCard edit UI), even though the AI response uses the plural array
 * column names from the DB schema (proteins/fruits).
 */
function buildUserChipsBlock(userChips) {
  if (!userChips || typeof userChips !== 'object') return ''
  const fields = [
    ['Protein',          userChips.protein],
    ['Cooking method',   userChips.cooking_method],
    ['Main carb',        userChips.main_carb],
    ['Dietary tags',     userChips.dietary_tags],
    ['Dairy components', userChips.dairy_components],
    ['Vegetables',       userChips.vegetables],
    ['Fruit',            userChips.fruit],
    ['Prep time',        userChips.prep_time],
  ]
  const lines = []
  for (const [label, raw] of fields) {
    if (raw === null || raw === undefined) continue
    if (Array.isArray(raw)) {
      if (raw.length === 0) continue
      lines.push(`- ${label}: ${raw.join(', ')}`)
    } else if (raw !== '') {
      lines.push(`- ${label}: ${raw}`)
    }
  }
  if (lines.length === 0) return ''
  return (
    'USER-CONFIRMED CHIPS:\n' +
    lines.join('\n') + '\n\n' +
    'These chip values were confirmed by the user after the original extraction. Use them as follows:\n' +
    '1. Recipe URL and name remain the primary source of truth for what dish is being made and what its ingredients should be.\n' +
    '2. User-confirmed chips are authoritative for the categorical attributes they cover (protein, main_carb, dairy_components, vegetables, fruit, dietary_tags, cooking_method, prep_time). When a chip and the recipe identity disagree on a categorical attribute, defer to the user\'s chip.\n' +
    '3. Do not fabricate ingredients to satisfy a chip. If the URL clearly describes a different dish than the chips suggest, extract ingredients accurately based on the URL/name; do not confabulate ingredients that fit the chip but not the dish.\n' +
    '4. You may incorporate or ignore any individual chip if it doesn\'t usefully constrain ingredient extraction.\n\n'
  )
}

export function createAnalyzeRecipeHandler({ anthropic, supabase = null, tag = 'analyze-recipe' } = {}) {
  return async function analyzeRecipeHandler(req, res) {
    if (!anthropic) return res.status(503).json({ error: 'api_key_missing' })

    const {
      name = '',
      url = '',
      imageBase64 = null,
      mediaType = null,
      default_servings,
      userChips = null,
    } = req.body || {}

    // Validate default_servings: must be a positive integer if supplied.
    // Any other value (omitted, null, float, string, negative) falls through
    // to the hardcoded fallback of 4.
    const defaultServings = (
      typeof default_servings === 'number' &&
      Number.isInteger(default_servings) &&
      default_servings > 0
    ) ? default_servings : SERVINGS_HARDCODED_FALLBACK

    // Build the content array — image (if present) + text prompt.
    const content = []
    if (imageBase64 && mediaType) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: imageBase64 },
      })
    }

    // PRD-006 D1: when the caller supplies user-confirmed chip values, pin them
    // as ground truth. When userChips is absent / empty, the chip block is the
    // empty string and the rest of the prompt is byte-for-byte unchanged.
    const userChipsBlock = buildUserChipsBlock(userChips)

    let textPrompt = userChipsBlock + `Analyze this meal/recipe and return a JSON object with its components. Return ONLY valid JSON with no markdown or explanation.\n`
    if (name) textPrompt += `\nRecipe Name: "${name}"`
    if (url) textPrompt += `\nRecipe URL: "${url}"`
    if (imageBase64) textPrompt += `\n(See attached image)`
    textPrompt += '\n\n' + buildAnalyzeRecipePromptBlock()
    // Belt-and-suspenders reminder to never drop ingredients. The JSON shape
    // block already states this but repeating it outside the shape block gives
    // the model a clear instruction outside the template.
    textPrompt += '\n\nIMPORTANT: In ingredients_structured, include every ingredient from the recipe. If an ingredient cannot be cleanly parsed, include it with name populated and quantity/unit/notes set to null. Never omit an ingredient.'

    content.push({ type: 'text', text: textPrompt })

    try {
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content }],
      })
      const text = msg.content?.[0]?.text ?? ''
      const parsed = parseJsonLoose(text, /\{[\s\S]*\}/)
      if (!parsed) return res.status(502).json({ error: 'parse_failed' })

      // Resolve servings: use the AI-returned value when it's a positive integer;
      // otherwise apply the caller's default_servings or the hardcoded fallback.
      const rawServings = (
        typeof parsed.servings === 'number' &&
        Number.isInteger(parsed.servings) &&
        parsed.servings > 0
      ) ? parsed.servings : null
      const servings = rawServings ?? defaultServings
      const servings_inferred = rawServings !== null

      // ingredients_structured: use the AI array if present, else null.
      const ingredients_structured = Array.isArray(parsed.ingredients_structured)
        ? parsed.ingredients_structured
        : null

      // PRD-004 Phase C (P0.8): auto-classify ingredients on save so newly added
      // recipes don't ship to the filter with ingredients_classified === null.
      // Failure here degrades gracefully — we still save the recipe; the next
      // backfill run will retry classification.
      let ingredients_classified = null
      if (Array.isArray(ingredients_structured) && ingredients_structured.length > 0) {
        const ingredientNames = ingredients_structured
          .map(i => i?.name)
          .filter(n => typeof n === 'string' && n.trim().length > 0)
          .map(n => n.trim())
        if (ingredientNames.length > 0) {
          try {
            // ADR-004: classifyIngredientsCached transparently consults the
            // ingredient_classifications_cache table before calling Anthropic;
            // misses are written back. With supabase=null this is a pure
            // pass-through to classifyIngredients.
            const result = await classifyIngredientsCached({
              ingredients: ingredientNames,
              recipeName: (parsed.name || name || '').trim() || 'Untitled recipe',
              cuisine: parsed.cuisine_type || null,
              anthropicClient: anthropic,
              supabaseClient: supabase,
            })
            ingredients_classified = Array.isArray(result?.classifications)
              ? result.classifications
              : null
          } catch (err) {
            console.error(
              `[api] ${tag} auto-classify failed:`,
              err instanceof ClassifyIngredientsError ? 'parse_failed' : '',
              err?.status || '',
              err?.message || err
            )
          }
        }
      }

      return res.json({
        components: {
          ...parsed,
          // Override the raw AI servings with the resolved (fallback-applied) value.
          servings,
          servings_inferred,
          // Explicit to guarantee the field is always present in the response.
          ingredients_structured,
          ingredients_classified,
        },
      })
    } catch (err) {
      console.error(`[api] ${tag} upstream error:`, err?.status || '', err?.message || err)
      return res.status(502).json({ error: 'upstream_failed' })
    }
  }
}
