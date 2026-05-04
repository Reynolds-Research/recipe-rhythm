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

// When the AI can't infer servings and the caller didn't supply a default,
// fall back to 4 (a reasonable single-household serving count).
const SERVINGS_HARDCODED_FALLBACK = 4

export function createAnalyzeRecipeHandler({ anthropic, tag = 'analyze-recipe' } = {}) {
  return async function analyzeRecipeHandler(req, res) {
    if (!anthropic) return res.status(503).json({ error: 'api_key_missing' })

    const {
      name = '',
      url = '',
      imageBase64 = null,
      mediaType = null,
      default_servings,
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

    let textPrompt = `Analyze this meal/recipe and return a JSON object with its components. Return ONLY valid JSON with no markdown or explanation.\n`
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

      return res.json({
        components: {
          ...parsed,
          // Override the raw AI servings with the resolved (fallback-applied) value.
          servings,
          servings_inferred,
          // Explicit to guarantee the field is always present in the response.
          ingredients_structured,
        },
      })
    } catch (err) {
      console.error(`[api] ${tag} upstream error:`, err?.status || '', err?.message || err)
      return res.status(502).json({ error: 'upstream_failed' })
    }
  }
}
