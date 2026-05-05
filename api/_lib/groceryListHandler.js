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
  if (!r || typeof r !== 'object') return false
  if (!isNonEmptyString(r.name)) return false
  if (!Array.isArray(r.ingredients) || r.ingredients.length === 0) return false
  if (!r.ingredients.every(isNonEmptyString)) return false
  // servings is optional; if present, must be a positive integer.
  // Null is allowed and represents "the vault row has no AI-extracted servings"
  // — buildGroceryList falls back to the default in that case.
  if (r.servings !== undefined && r.servings !== null) {
    if (!Number.isInteger(r.servings) || r.servings < 1) return false
  }
  return true
}

export function createGroceryListHandler({ anthropic, buildImpl = buildGroceryList, tag = 'grocery-list' } = {}) {
  return async function groceryListHandler(req, res) {
    if (!anthropic) return res.status(503).json({ error: 'api_key_missing' })

    const { recipes, pantryStaples = [], householdSize } = req.body || {}

    if (!Array.isArray(recipes) || recipes.length === 0) {
      return res.status(400).json({
        error: 'invalid_recipes',
        message: '`recipes` must be a non-empty array of {name, ingredients[], servings?}',
      })
    }
    if (!recipes.every(isValidRecipe)) {
      return res.status(400).json({
        error: 'invalid_recipes',
        message: '`recipes` entries must be {name, ingredients[], servings?} where name and every ingredient are non-empty strings, and servings (if present) is a positive integer or null',
      })
    }
    if (!Array.isArray(pantryStaples) || !pantryStaples.every(s => typeof s === 'string')) {
      return res.status(400).json({
        error: 'invalid_pantry_staples',
        message: '`pantryStaples` must be an array of strings (may be empty)',
      })
    }
    // householdSize is optional at the HTTP layer — buildGroceryList applies
    // the default when undefined. If the caller does send it, it must be a
    // positive integer.
    if (householdSize !== undefined) {
      if (!Number.isInteger(householdSize) || householdSize < 1) {
        return res.status(400).json({
          error: 'invalid_household_size',
          message: '`householdSize`, if present, must be a positive integer',
        })
      }
    }

    try {
      const result = await buildImpl({
        recipes: recipes.map(r => ({
          name: r.name.trim(),
          ingredients: r.ingredients.map(s => s.trim()).filter(Boolean),
          servings: r.servings ?? null,
        })),
        pantryStaples: pantryStaples.map(s => s.trim()).filter(Boolean),
        householdSize,
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
