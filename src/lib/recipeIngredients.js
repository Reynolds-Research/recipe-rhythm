/**
 * recipeIngredients.js — a recipe's ingredient list: read it, save it, fill gaps.
 *
 * Mental model: the grocery list can only be as good as each recipe's
 * ingredient list (vault.ingredients_structured + servings). There are two
 * ways to get one, and the Cookbook records which (vault.ingredients_source):
 *
 *   'screenshot'  she adds screenshots of the real recipe (NYT Cooking is
 *                 paywalled, so this is her way in). The AI copies the list.
 *   'page'        read from the recipe's link: the server opens the page and
 *                 the AI copies the list from it (2026-11-06). Some sites
 *                 refuse automated visits; then it falls back to:
 *   'estimated'   the AI's best guess from the recipe's name and her tags.
 *
 * Screenshots and the recipe page are the real recipe: an estimate never
 * overwrites either. Screenshots replace anything.
 *
 *   readIngredients({ name, url, images, chips })      → result | null
 *   ingredientFields(result)                           → columns to save
 *   prepareScreenshot(file)                            → { data, mediaType } (browser only)
 *   fillRecipeIngredients(supabase, userId, recipe, { images })
 *   loadMissingIngredients(supabase, userId)           → recipes with no list
 *   fillMissingIngredients(supabase, userId, { onProgress })
 *   loadLinkedGuesses / readLinkedRecipes(supabase, userId, { onProgress })
 *
 * `analyze` is injectable (tests); it defaults to the real /api/analyze-recipe call.
 */

import { analyzeRecipe } from './analyzeRecipe'
import { getHouseholdId } from './household'
import { mergeWithUserOverrides } from './classificationOverrides'

export const MAX_SCREENSHOTS = 3

/** A recipe row's tags, in the shape analyze-recipe pins as ground truth. */
export function chipsOf(recipe = {}) {
  return {
    protein:          recipe.proteins ?? null,
    cooking_method:   recipe.cooking_method ?? null,
    main_carb:        recipe.main_carb ?? null,
    dietary_tags:     recipe.dietary_tags ?? null,
    dairy_components: recipe.dairy_components ?? null,
    vegetables:       recipe.vegetables ?? null,
    fruit:            recipe.fruits ?? null,
    prep_time:        recipe.prep_time_minutes ?? null,
  }
}

/** True when a recipe has a usable ingredient list. */
export function hasIngredientList(recipe) {
  return Array.isArray(recipe?.ingredients_structured) && recipe.ingredients_structured.length > 0
}

/**
 * Ask the AI for a recipe's ingredient list. With `images`, it copies them
 * from the screenshots; without, it estimates. Returns null when nothing
 * usable came back (call failed, or no ingredients).
 *
 * `servings` is kept only when the AI actually found it (servings_inferred);
 * the API's fallback of 4 is not a fact about the recipe, so it isn't saved.
 */
export async function readIngredients({
  name = '', url = '', images = [], chips, analyze = analyzeRecipe, readPage = false,
} = {}) {
  if (images.length > MAX_SCREENSHOTS) throw new Error(`At most ${MAX_SCREENSHOTS} screenshots`)
  const arg = { name, url }
  if (images.length) arg.images = images
  if (chips) arg.userChips = chips
  if (readPage && url && !images.length) arg.readPage = true
  const components = await analyze(arg)
  if (!components || !hasIngredientList(components)) return null
  return {
    page: components.page ?? null,
    components,
    structured: components.ingredients_structured,
    classified: Array.isArray(components.ingredients_classified) ? components.ingredients_classified : null,
    servings: components.servings_inferred && Number.isInteger(components.servings) && components.servings > 0
      ? components.servings : null,
    source: sourceOf(components, images),
  }
}

/** Where a fresh analyze-recipe result's list came from. */
function sourceOf(components, images = []) {
  if (images.length) return 'screenshot'
  return components?.page?.read ? 'page' : 'estimated'
}

/** Lists that are the real recipe: an estimate never replaces these. */
export const REAL_SOURCES = ['screenshot', 'page']

/** The vault columns to save for a readIngredients result. */
export function ingredientFields(result, existingClassified = null) {
  const classified = result.classified
    ? mergeWithUserOverrides(result.classified, existingClassified)
    : existingClassified
  return {
    ingredients_structured: result.structured,
    ingredients_classified: classified && classified.length ? classified : null,
    servings: result.servings,
    ingredients_source: result.source,
  }
}

/**
 * The columns to save from an analyze-recipe response that wasn't given
 * screenshots (an estimate), or {} when it has no ingredient list. For the
 * places that already call analyze-recipe by name (Cookbook suggestions,
 * saving a logged meal to the Cookbook).
 */
export function estimateFields(components) {
  if (!components || !hasIngredientList(components)) return {}
  return ingredientFields({
    structured: components.ingredients_structured,
    classified: Array.isArray(components.ingredients_classified) ? components.ingredients_classified : null,
    servings: components.servings_inferred && Number.isInteger(components.servings) && components.servings > 0
      ? components.servings : null,
    // Asked with readPage and the page was read: it's the real recipe.
    source: sourceOf(components),
  })
}

/**
 * Fill in (or replace) one saved recipe's ingredients.
 *   - With screenshots: replaced by the real list, whatever it had.
 *   - Without: the recipe page is read when it has a link. A page list
 *     replaces a guess (or an older page list with `newLink`); when the page
 *     can't be read, an estimate fills a recipe with no real list.
 *   - `pageOnly`: write only a list read from the page (re-reading links
 *     shouldn't swap one guess for another).
 * `onPage(page)` hears what reading the link did ({ read, kind | reason }).
 * Returns the saved fields, or null if nothing was written.
 */
export async function fillRecipeIngredients(supabase, userId, recipe, {
  images = [], analyze, pageOnly = false, newLink = false, onPage,
} = {}) {
  const current = recipe.ingredients_source
  if (!images.length && current === 'screenshot') return null
  if (!images.length && current === 'page' && !newLink) return null
  const url = recipe.recipe_url || ''
  if (pageOnly && !url) return null
  const result = await readIngredients({
    name: recipe.name,
    url,
    images,
    chips: chipsOf(recipe),
    analyze,
    readPage: !images.length && Boolean(url),
  })
  if (result?.page) onPage?.(result.page)
  if (!result) return null
  if (pageOnly && result.source !== 'page') return null
  const fields = ingredientFields(result, recipe.ingredients_classified)
  const householdId = await getHouseholdId(supabase, userId)
  let query = supabase.from('vault').update(fields).eq('id', recipe.id).eq('household_id', householdId)
  // Checked against the database, not only the copy we were handed:
  // screenshots added meanwhile (e.g. while Settings works through its list)
  // win. An estimate never overwrites the page or screenshots; a page list
  // never overwrites screenshots.
  if (result.source === 'estimated') query = query.or('ingredients_source.is.null,ingredients_source.eq.estimated')
  if (result.source === 'page') query = query.or('ingredients_source.is.null,ingredients_source.eq.estimated,ingredients_source.eq.page')
  const { data, error } = await query.select('id')
  if (error) throw error
  return data?.length ? fields : null
}

/** Recipes with a saved link whose list isn't the real recipe yet. */
export async function loadLinkedGuesses(supabase, userId) {
  const householdId = await getHouseholdId(supabase, userId)
  const { data, error } = await supabase
    .from('vault')
    .select(MISSING_COLUMNS)
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .not('recipe_url', 'is', null)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []).filter((r) => r.recipe_url?.trim() && !REAL_SOURCES.includes(r.ingredients_source))
}

/**
 * Settings: read every linked recipe's real list from its page, one at a time.
 * Writes only what the pages give (pageOnly). Returns
 *   { read: [names], needScreenshots: [{ name, reason }], failed: [names] }
 * — needScreenshots: the site refused, or no ingredient list was found there.
 */
export async function readLinkedRecipes(supabase, userId, { onProgress = () => {}, analyze } = {}) {
  const recipes = await loadLinkedGuesses(supabase, userId)
  const out = { read: [], needScreenshots: [], failed: [] }
  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i]
    onProgress({ current: i + 1, total: recipes.length, name: recipe.name })
    let page = null
    try {
      const fields = await fillRecipeIngredients(supabase, userId, recipe, {
        analyze, pageOnly: true, onPage: (p) => { page = p },
      })
      if (fields) out.read.push(recipe.name)
      else if (page && !page.read) out.needScreenshots.push({ name: recipe.name, reason: page.reason })
      else out.failed.push(recipe.name)
    } catch (err) {
      console.warn('[recipeIngredients] link read failed', recipe.name, err)
      out.failed.push(recipe.name)
    }
  }
  return out
}

const MISSING_COLUMNS =
  'id, name, recipe_url, proteins, cooking_method, main_carb, dietary_tags, dairy_components, ' +
  'vegetables, fruits, prep_time_minutes, ingredients_classified, ingredients_structured, ingredients_source'

/** The household's recipes with no ingredient list (none, or an empty one). */
export async function loadMissingIngredients(supabase, userId) {
  const householdId = await getHouseholdId(supabase, userId)
  const { data, error } = await supabase
    .from('vault')
    .select(MISSING_COLUMNS)
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []).filter((r) => !hasIngredientList(r))
}

/**
 * Estimate the list for every recipe that has none, one at a time (kind to
 * rate limits). Recipes with a list are never touched. A recipe that fails is
 * counted and skipped. Returns { filled, failed, names: { filled, failed } }.
 */
export async function fillMissingIngredients(supabase, userId, { onProgress = () => {}, analyze } = {}) {
  const missing = await loadMissingIngredients(supabase, userId)
  const out = { filled: [], failed: [] }
  for (let i = 0; i < missing.length; i++) {
    const recipe = missing[i]
    onProgress({ current: i + 1, total: missing.length, name: recipe.name })
    try {
      const fields = await fillRecipeIngredients(supabase, userId, recipe, { analyze })
      ;(fields ? out.filled : out.failed).push(recipe.name)
    } catch (err) {
      console.warn('[recipeIngredients] fill failed', recipe.name, err)
      out.failed.push(recipe.name)
    }
  }
  return out
}

/**
 * Browser only: a screenshot File → { data (base64, no prefix), mediaType }.
 * Shrunk to at most 1600px on the long side as JPEG, so three fit well under
 * the server's request limit while the text stays readable.
 */
export function prepareScreenshot(file, { maxDim = 1600, quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that image'))
    reader.onload = (event) => {
      const img = new Image()
      img.onerror = () => reject(new Error('That file is not an image'))
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        resolve({ data: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg' })
      }
      img.src = event.target.result
    }
    reader.readAsDataURL(file)
  })
}
