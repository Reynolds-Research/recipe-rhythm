import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { analyzeRecipe } from '../../lib/analyzeRecipe'
import {
  fetchVaultOptions,
  addVaultOption,
  migrateLocalStorageExtras,
} from '../../lib/vaultOptions'

/**
 * useVault — the data layer for the vault page. Owns Supabase fetches and
 * mutations: fetchRecipes, the vault_options migrate-then-fetch pair, plus
 * addRecipe / addSuggestion / updateRecipe / deleteRecipe / setRating /
 * addExtra. Returns plain async actions; the page component owns UI state
 * (saving flags, which recipe is expanded, etc.).
 *
 * Extracted from Vault.jsx in PRD-001 P0.9 (Phase 3 Step 2). The exact
 * Supabase call shapes (column lists, filter chains, update payloads) are
 * preserved so the existing test mocks continue to match without any test
 * modification.
 */
export function useVault(userId) {
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [vaultError, setVaultError] = useState(null)
  // PRD-001 P0.7: custom chip-picker tags grouped by canonical category.
  // Populated by fetchVaultOptions on mount (after migrateLocalStorageExtras
  // imports any pre-existing legacy localStorage values).
  const [extrasByCategory, setExtrasByCategory] = useState({})

  const fetchRecipes = async () => {
    setLoading(true)
    // PRD-001 P0.5: filter soft-deleted rows. The vault list never shows
    // recipes the user has deleted; the underlying rows are preserved so
    // historical references in meals.vault_id and meal_plan_items.vault_id
    // still resolve.
    const { data, error } = await supabase
      .from('vault')
      .select('id, name, cuisine_type, flavor_profile, notes, recipe_url, image_url, created_at, proteins, cooking_method, main_carb, dietary_tags, dairy_components, vegetables, fruits, auto_completed, family_rating, prep_time_minutes')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (error) console.error('[Vault] fetchRecipes failed:', error.message)
    if (!error && data) setRecipes(data)
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchRecipes() }, [])

  // PRD-001 P0.7: migrate any legacy localStorage chip-picker values into
  // the vault_options table (one-time, idempotent — see vaultOptions.js),
  // then fetch the current per-user grouping. Migration runs before fetch
  // so freshly-imported values land in extrasByCategory on the first pass.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    ;(async () => {
      await migrateLocalStorageExtras(supabase, userId)
      const grouped = await fetchVaultOptions(supabase, userId)
      if (!cancelled) setExtrasByCategory(grouped)
    })()
    return () => { cancelled = true }
  }, [userId])

  // Optimistic add: drop the new value into the grouped map immediately so
  // every ChipPicker bound to this category re-renders with the new chip;
  // fire-and-forget the upsert. On failure we log — the chip won't reappear
  // after the next refresh but the user already saw it added, so a soft
  // failure is the least surprising behavior.
  const addExtra = async (category, value) => {
    setExtrasByCategory(prev => ({
      ...prev,
      [category]: [...new Set([...(prev[category] || []), value])],
    }))
    const { error } = await addVaultOption(supabase, userId, category, value)
    if (error) {
      console.error('[Vault] failed to persist custom tag:', error)
    }
  }

  /**
   * Adds a new recipe. Returns `{ ok: true }` on success or
   * `{ ok: false, reason }` on duplicate / insert failure. The caller owns
   * UI state (saving flag, form reset, hide-form).
   */
  const addRecipe = async ({
    name,
    cuisineType,
    flavorProfile,
    notes,
    recipeUrl,
    proteins,
    cookingMethod,
    mainCarb,
    dietaryTags,
    dairyComponents,
    vegetables,
    fruits,
    prepTimeMinutes,
    imageFile,
  }) => {
    const finalName = name.trim()
    if (!finalName) return { ok: false, reason: 'no-name' }

    // PRD-001 P0.5: only block adds against ACTIVE vault rows. A user who
    // soft-deleted "Tacos" should be able to re-add "Tacos" — the deleted
    // row stays in place for history, and the new add gets its own id.
    const { data: existing } = await supabase
      .from('vault')
      .select('id')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .ilike('name', finalName)
      .limit(1)

    if (existing && existing.length > 0) {
      setVaultError(`"${finalName}" is already in your vault!`)
      return { ok: false, reason: 'duplicate' }
    }

    let publicUrl = null
    if (imageFile) {
      try {
        const compressImage = (file) => {
          return new Promise((resolve) => {
            const reader = new FileReader()
            reader.onload = (event) => {
              const img = new Image()
              img.onload = () => {
                const canvas = document.createElement('canvas')
                let width = img.width
                let height = img.height
                const maxDim = 800

                if (width > maxDim || height > maxDim) {
                  if (width > height) {
                    height = Math.round((height * maxDim) / width)
                    width = maxDim
                  } else {
                    width = Math.round((width * maxDim) / height)
                    height = maxDim
                  }
                }

                canvas.width = width
                canvas.height = height
                const ctx = canvas.getContext('2d')
                ctx.drawImage(img, 0, 0, width, height)

                canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.7)
              }
              img.src = event.target.result
            }
            reader.readAsDataURL(file)
          })
        }

        const blob = await compressImage(imageFile)
        const fileName = `${userId}/${Date.now()}.jpg`

        const { error: uploadError } = await supabase.storage
          .from('recipe_images')
          .upload(fileName, blob, { contentType: 'image/jpeg' })

        if (!uploadError) {
          const { data } = supabase.storage.from('recipe_images').getPublicUrl(fileName)
          if (data && data.publicUrl) publicUrl = data.publicUrl
        } else {
          console.error('[Vault] Image upload failed:', uploadError)
        }
      } catch (err) {
        console.error('[Vault] Error preparing image for upload:', err)
      }
    }

    const { error } = await supabase.from('vault').insert({
      user_id:           userId,
      name:              finalName,
      image_url:         publicUrl,
      cuisine_type:      cuisineType            || null,
      flavor_profile:    flavorProfile          || null,
      notes:             notes.trim()           || null,
      recipe_url:        recipeUrl.trim()       || null,
      is_wildcard:       false,
      auto_completed:    false,
      proteins:          proteins.length        ? proteins        : null,
      cooking_method:    cookingMethod          || null,
      main_carb:         mainCarb               || null,
      dietary_tags:      dietaryTags.length     ? dietaryTags     : null,
      dairy_components:  dairyComponents.length ? dairyComponents : null,
      vegetables:        vegetables.length      ? vegetables      : null,
      fruits:            fruits.length          ? fruits          : null,
      prep_time_minutes: prepTimeMinutes        ?? null,
    })

    if (error) return { ok: false, reason: 'insert-failed', error }

    await fetchRecipes()
    return { ok: true }
  }

  const addSuggestion = async (suggestionName) => {
    const analysis = await analyzeRecipe(suggestionName)
    await supabase.from('vault').insert({
      user_id:           userId,
      name:              suggestionName,
      is_wildcard:       false,
      auto_completed:    true,
      cuisine_type:      analysis?.cuisine_type      ?? null,
      flavor_profile:    analysis?.flavor_profile    ?? null,
      proteins:          analysis?.proteins          ?? [],
      cooking_method:    analysis?.cooking_method    ?? null,
      main_carb:         analysis?.main_carb         ?? null,
      dietary_tags:      analysis?.dietary_tags      ?? [],
      dairy_components:  analysis?.dairy_components  ?? [],
      vegetables:        analysis?.vegetables        ?? [],
      fruits:            analysis?.fruits            ?? [],
      prep_time_minutes: analysis?.prep_time_minutes ?? null,
    })
    await fetchRecipes()
  }

  /**
   * PRD-001 P0.5 — Soft-delete a vault recipe. Sets `deleted_at = now()`
   * rather than issuing a DELETE so historical references from
   * meals.vault_id and meal_plan_items.vault_id still resolve.
   */
  const deleteRecipe = async (id) => {
    await supabase.from('vault')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
    setRecipes(prev => prev.filter(r => r.id !== id))
  }

  const updateRecipe = async (id, fields) => {
    await supabase.from('vault').update({
      ...fields,
      cuisine_type:   fields.cuisine_type        || null,
      flavor_profile: fields.flavor_profile      || null,
      notes:          fields.notes.trim()        || null,
      recipe_url:     fields.recipe_url.trim()   || null,
      auto_completed: false,
    }).eq('id', id).eq('user_id', userId)
    await fetchRecipes()
  }

  /**
   * PRD-006 D1 — Re-extract ingredients_structured for an existing recipe,
   * pinning the user's confirmed chip values as ground truth in the AI prompt.
   * Used by:
   *   1. The vault edit flow, when a structural chip change happens (so the
   *      stored ingredient list matches the new chips).
   *   2. The Settings backfill button (one-shot refresh across the vault).
   *
   * `chips` is a partial dict shaped like the analyze-recipe userChips field
   * (protein/cooking_method/main_carb/dietary_tags/dairy_components/
   * vegetables/fruit/prep_time). Missing fields are fine — the prompt just
   * ignores them.
   *
   * Throws on failure (proxy unreachable, parse error, DB write error) so the
   * caller can surface an error toast. The chip-edit save itself has already
   * committed by the time this runs, so the user doesn't lose work on failure.
   */
  const reExtractIngredients = async (recipeId, chips) => {
    const recipe = recipes.find(r => r.id === recipeId)
    if (!recipe) throw new Error(`recipe ${recipeId} not found in local cache`)

    const components = await analyzeRecipe({
      name: recipe.name,
      url: recipe.recipe_url || '',
      userChips: chips,
    })
    if (!components) throw new Error('analyze-recipe returned no components')

    // Write back the new ingredient list plus any chip categories the model
    // returned. The prompt instructs the model not to contradict user-set
    // chips, so this either no-ops (chips identical) or fills in refinements
    // for fields the user left empty (e.g. dietary_tags).
    const update = {
      ingredients_structured: components.ingredients_structured ?? null,
    }
    if (components.proteins         !== undefined) update.proteins         = components.proteins ?? null
    if (components.cooking_method   !== undefined) update.cooking_method   = components.cooking_method ?? null
    if (components.main_carb        !== undefined) update.main_carb        = components.main_carb ?? null
    if (components.dietary_tags     !== undefined) update.dietary_tags     = components.dietary_tags ?? null
    if (components.dairy_components !== undefined) update.dairy_components = components.dairy_components ?? null
    if (components.vegetables       !== undefined) update.vegetables       = components.vegetables ?? null
    if (components.fruits           !== undefined) update.fruits           = components.fruits ?? null
    if (components.prep_time_minutes !== undefined) update.prep_time_minutes = components.prep_time_minutes ?? null

    const { data, error } = await supabase
      .from('vault')
      .update(update)
      .eq('id', recipeId)
      .eq('user_id', userId)
      .select()
      .single()

    if (error) throw new Error(`re-extract DB write failed: ${error.message}`)

    setRecipes(prev => prev.map(r => r.id === recipeId ? { ...r, ...update } : r))
    return data
  }

  /**
   * PRD-001 P1.1 — Family rating updates are immediate. Optimistically
   * updates local state first so the star fill is instant, then writes to
   * Supabase. On error we refetch authoritative state to roll back.
   */
  const setRating = async (recipeId, newRating) => {
    setRecipes(prev =>
      prev.map(r => r.id === recipeId ? { ...r, family_rating: newRating } : r)
    )

    const { error } = await supabase
      .from('vault')
      .update({ family_rating: newRating })
      .eq('id', recipeId)
      .eq('user_id', userId)

    if (error) {
      console.error('[Vault] handleRatingChange failed:', error.message)
      await fetchRecipes()
    }
  }

  return {
    recipes,
    loading,
    vaultError,
    setVaultError,
    extrasByCategory,
    addExtra,
    addRecipe,
    addSuggestion,
    deleteRecipe,
    updateRecipe,
    setRating,
    reExtractIngredients,
  }
}
