/**
 * Cache-aware wrapper around classifyIngredients (src/lib/classifyIngredients.js).
 *
 * See ADR-004. The flow is:
 *
 *   1. Normalize the recipe name and every input ingredient name (lowercase
 *      + whitespace-collapsed + trimmed).
 *   2. Look up (recipe_name_norm, ingredient_name_norm) pairs in
 *      ingredient_classifications_cache. One round-trip — Postgres can use
 *      the UNIQUE index for both the equality on recipe_name_norm and the
 *      ANY-IN on ingredient_name_norm.
 *   3a. If every input was a cache hit → return synthesized results, no
 *       Anthropic call.
 *   3b. If some inputs missed cache → call classifyIngredients with the
 *       FULL original ingredient list (so AI reasoning still has full
 *       context, e.g. "with X" / compound-name rules), then merge:
 *         - inputs that hit cache → cached value WINS (first-answer-wins)
 *         - inputs that missed cache → AI value, queued for cache write
 *   4. Write the new (miss-only) classifications to the cache table with
 *      ON CONFLICT DO NOTHING to honor first-answer-wins. Errors here are
 *      logged and swallowed — they must NEVER fail the request.
 *
 * Degrades gracefully: if `supabaseClient` is null/undefined, this is a
 * pass-through to classifyIngredients. Tests pass null to test the cached
 * path's logic via mocked supabase, or omit it entirely to test the
 * fall-through.
 *
 * The output contract is identical to classifyIngredients:
 *   { classifications: [{ name, essentiality, source: 'ai' }, ...] }
 *
 * `source` is always 'ai' regardless of cache origin — a cached entry is
 * still an AI classification, just one we previously paid for.
 */

import { classifyIngredients } from '../../src/lib/classifyIngredients.js'
import { normalizeForCache } from './supabaseAdmin.js'

const CACHE_TABLE = 'ingredient_classifications_cache'

/**
 * @param {object}   args
 * @param {string[]} args.ingredients          Raw ingredient lines.
 * @param {string}   args.recipeName           Recipe name (provides context).
 * @param {string|null} [args.cuisine]         Cuisine (optional context).
 * @param {object}   args.anthropicClient      Instantiated Anthropic client.
 * @param {object|null} [args.supabaseClient]  Service-role Supabase client.
 *                                             Pass null to skip caching.
 *
 * @returns {Promise<{classifications: Array<{name: string, essentiality: 'essential'|'omittable', source: 'ai'}>}>}
 */
export async function classifyIngredientsCached({
  ingredients,
  recipeName,
  cuisine = null,
  anthropicClient,
  supabaseClient = null,
}) {
  // No supabase client → pass-through. This is the equivalent of running
  // with caching disabled (e.g. the env vars weren't configured).
  if (!supabaseClient) {
    return classifyIngredients({ ingredients, recipeName, cuisine, anthropicClient })
  }

  // Defer all the input validation to classifyIngredients — it's the
  // single source of truth for what's a valid call. We just guard the
  // shapes we need to operate on here.
  if (!Array.isArray(ingredients) || ingredients.length === 0 ||
      typeof recipeName !== 'string' || !recipeName.trim()) {
    return classifyIngredients({ ingredients, recipeName, cuisine, anthropicClient })
  }

  const recipeNorm = normalizeForCache(recipeName)
  // Build parallel arrays so we can preserve input order in the result.
  const inputs = ingredients.map(s => (typeof s === 'string' ? s.trim() : ''))
  const norms  = inputs.map(normalizeForCache)

  // De-dup the lookup keys (the cache stores at most one row per pair) but
  // remember every input index so we can reconstruct order.
  const uniqueNorms = Array.from(new Set(norms.filter(n => n.length > 0)))

  // === Cache lookup ===
  // Keyed map of ingredient_name_norm → essentiality. Empty on lookup error
  // (we just degrade to all-miss).
  let cacheMap = new Map()
  if (uniqueNorms.length > 0) {
    try {
      const { data, error } = await supabaseClient
        .from(CACHE_TABLE)
        .select('ingredient_name_norm, essentiality')
        .eq('recipe_name_norm', recipeNorm)
        .in('ingredient_name_norm', uniqueNorms)
      if (error) {
        console.error('[classifyIngredientsCached] cache read error:', error.message)
      } else if (Array.isArray(data)) {
        for (const row of data) {
          if (row && typeof row.ingredient_name_norm === 'string' &&
              (row.essentiality === 'essential' || row.essentiality === 'omittable')) {
            cacheMap.set(row.ingredient_name_norm, row.essentiality)
          }
        }
      }
    } catch (err) {
      console.error('[classifyIngredientsCached] cache read threw:', err?.message || err)
    }
  }

  // Identify the inputs that missed cache. We use the unique norms (not all
  // norms) because cache misses are about WHICH normalized values to ask AI
  // for — duplicates would just inflate the AI prompt for no benefit.
  const missingNorms = uniqueNorms.filter(n => !cacheMap.has(n))

  // === Full-hit fast path ===
  if (missingNorms.length === 0) {
    return {
      classifications: inputs
        .map((name, i) => {
          const essentiality = cacheMap.get(norms[i])
          if (!essentiality) return null
          return { name, essentiality, source: 'ai' }
        })
        .filter(Boolean),
    }
  }

  // === Cache miss → call AI for the full list ===
  // We pass the FULL original ingredient list, not just the misses, so AI
  // reasoning that depends on context (compound names, "with X" patterns,
  // protein-variant rule) still works. It's slightly more tokens than
  // strictly required, but accuracy beats marginal token savings.
  const aiResponse = await classifyIngredients({
    ingredients: inputs.filter(s => s.length > 0),
    recipeName,
    cuisine,
    anthropicClient,
  })

  // Index AI responses by normalized name for lookup.
  const aiMap = new Map()
  if (aiResponse && Array.isArray(aiResponse.classifications)) {
    for (const c of aiResponse.classifications) {
      if (c && typeof c.name === 'string') {
        aiMap.set(normalizeForCache(c.name), c)
      }
    }
  }

  // === Build the output, preserving input order ===
  // Per-input position: cache hit wins; otherwise AI value; if neither
  // (e.g. AI returned fewer entries), drop the input from the result —
  // matching how the uncached classifier handles "none" placeholders.
  const classifications = inputs
    .map((name, i) => {
      const norm = norms[i]
      if (!norm) return null
      if (cacheMap.has(norm)) {
        return { name, essentiality: cacheMap.get(norm), source: 'ai' }
      }
      const aiEntry = aiMap.get(norm)
      if (aiEntry) {
        return { name, essentiality: aiEntry.essentiality, source: 'ai' }
      }
      return null
    })
    .filter(Boolean)

  // === Write the new misses back to cache ===
  // Only write rows for normalized names that (a) missed cache AND
  // (b) AI returned an answer for. ON CONFLICT DO NOTHING via upsert
  // honors first-answer-wins. Errors are logged, never thrown — a failed
  // cache write must not break the response.
  const writes = []
  for (const norm of missingNorms) {
    const aiEntry = aiMap.get(norm)
    if (aiEntry && (aiEntry.essentiality === 'essential' || aiEntry.essentiality === 'omittable')) {
      writes.push({
        recipe_name_norm:     recipeNorm,
        ingredient_name_norm: norm,
        essentiality:         aiEntry.essentiality,
      })
    }
  }
  if (writes.length > 0) {
    try {
      // upsert with ignoreDuplicates honors the unique constraint as
      // first-answer-wins. The conflict target matches our UNIQUE
      // constraint on (recipe_name_norm, ingredient_name_norm).
      const { error } = await supabaseClient
        .from(CACHE_TABLE)
        .upsert(writes, {
          onConflict:       'recipe_name_norm,ingredient_name_norm',
          ignoreDuplicates: true,
        })
      if (error) {
        console.error('[classifyIngredientsCached] cache write error:', error.message)
      }
    } catch (err) {
      console.error('[classifyIngredientsCached] cache write threw:', err?.message || err)
    }
  }

  return { classifications }
}
