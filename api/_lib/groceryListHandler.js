/**
 * PRD-003 P0.3 (Bite B): shared request handler for /api/grocery-list.
 *
 * Both api-server.mjs (local Express proxy) and api/grocery-list.js
 * (Vercel serverless mirror) delegate to this single function so
 * validation + the prompt + parse logic exist in exactly one place.
 *
 * The shape `(req, res) => Promise<void>` matches both runtimes — Express 5
 * and Vercel both expose req.body (JSON-parsed by the framework) and a
 * Node-style res with .status().json().
 *
 * Method-not-allowed handling stays in the Vercel mirror (Express dispatches
 * by method already via app.post).
 */
import { buildGroceryList, GroceryListError } from '../../src/lib/groceryList.js'

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0
}

function isValidRecipe(r) {
  return r
    && typeof r === 'object'
    && isNonEmptyString(r.name)
    && Array.isArray(r.ingredients)
    && r.ingredients.length > 0
    && r.ingredients.every(isNonEmptyString)
}

export function createGroceryListHandler({ anthropic, buildImpl = buildGroceryList, tag = 'grocery-list' } = {}) {
  return async function groceryListHandler(req, res) {
    if (!anthropic) return res.status(503).json({ error: 'api_key_missing' })

    const { recipes, pantryStaples = [] } = req.body || {}

    if (!Array.isArray(recipes) || recipes.length === 0) {
      return res.status(400).json({
        error: 'invalid_recipes',
        message: '`recipes` must be a non-empty array of {name, ingredients[]}',
      })
    }
    if (!recipes.every(isValidRecipe)) {
      return res.status(400).json({
        error: 'invalid_recipes',
        message: '`recipes` entries must be {name, ingredients[]} where both name and every ingredient are non-empty strings',
      })
    }
    if (!Array.isArray(pantryStaples) || !pantryStaples.every(s => typeof s === 'string')) {
      return res.status(400).json({
        error: 'invalid_pantry_staples',
        message: '`pantryStaples` must be an array of strings (may be empty)',
      })
    }

    try {
      const result = await buildImpl({
        recipes: recipes.map(r => ({
          name: r.name.trim(),
          ingredients: r.ingredients.map(s => s.trim()).filter(Boolean),
        })),
        pantryStaples: pantryStaples.map(s => s.trim()).filter(Boolean),
        anthropicClient: anthropic,
      })
      return res.status(200).json(result)
    } catch (err) {
      // Sanitized to the client; full error (including raw model output for
      // GroceryListError) stays in the server log.
      const isParseFail = err instanceof GroceryListError
      console.error(
        `[api] ${tag} error:`,
        err?.status || '',
        err?.message || err,
        isParseFail ? `\nraw=${err.rawResponse}` : '',
      )
      return res.status(isParseFail ? 502 : 500).json({
        error: isParseFail ? 'parse_failed' : 'grocery_list_failed',
      })
    }
  }
}
