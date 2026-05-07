/**
 * PRD-004 Phase A (P0.2): shared request handler for /api/classify-ingredients.
 *
 * Both api-server.mjs (local Express proxy) and api/classify-ingredients.js
 * (Vercel serverless mirror) delegate to this single function so validation
 * + the prompt + parse logic exist in exactly one place.
 *
 * The shape `(req, res) => Promise<void>` matches both runtimes — Express 5
 * and Vercel both expose req.body (JSON-parsed by the framework) and a
 * Node-style res with .status().json().
 *
 * Method-not-allowed handling stays in the Vercel mirror (Express dispatches
 * by method already via app.post).
 */
import { ClassifyIngredientsError } from '../../src/lib/classifyIngredients.js'
import { classifyIngredientsCached } from './classifyIngredientsCached.js'

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0
}

export function createClassifyIngredientsHandler({ anthropic, supabase = null, classifyImpl = classifyIngredientsCached, tag = 'classify-ingredients' } = {}) {
  return async function classifyIngredientsHandler(req, res) {
    if (!anthropic) return res.status(503).json({ error: 'api_key_missing' })

    const { ingredients, recipeName, cuisine = null } = req.body || {}

    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({ error: 'invalid_ingredients', message: '`ingredients` must be a non-empty array of strings' })
    }
    if (!ingredients.every(isNonEmptyString)) {
      return res.status(400).json({ error: 'invalid_ingredients', message: '`ingredients` entries must be non-empty strings' })
    }
    if (!isNonEmptyString(recipeName)) {
      return res.status(400).json({ error: 'invalid_recipe_name', message: '`recipeName` must be a non-empty string' })
    }
    if (cuisine != null && typeof cuisine !== 'string') {
      return res.status(400).json({ error: 'invalid_cuisine', message: '`cuisine` must be a string or null' })
    }

    try {
      // ADR-004: classifyImpl defaults to classifyIngredientsCached, which
      // consults ingredient_classifications_cache before calling Anthropic.
      // Tests can inject a mock via classifyImpl. supabase=null falls
      // through to the uncached path automatically.
      const result = await classifyImpl({
        ingredients: ingredients.map(s => s.trim()),
        recipeName: recipeName.trim(),
        cuisine: cuisine == null ? null : cuisine.trim() || null,
        anthropicClient: anthropic,
        supabaseClient: supabase,
      })
      return res.status(200).json(result)
    } catch (err) {
      // Sanitized to the client; full error (including raw model output for
      // ClassifyIngredientsError) stays in the server log.
      const isParseFail = err instanceof ClassifyIngredientsError
      console.error(`[api] ${tag} error:`, err?.status || '', err?.message || err, isParseFail ? `\nraw=${err.rawResponse}` : '')
      return res.status(isParseFail ? 502 : 500).json({
        error: isParseFail ? 'parse_failed' : 'classification_failed',
      })
    }
  }
}
