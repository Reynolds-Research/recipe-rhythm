import { useState } from 'react'
import { Plus, X, Loader2, BookmarkPlus } from 'lucide-react'
import Logo from '../../components/Logo'
import { useHaptics } from '../../hooks/useHaptics'
import RecipeForm from './RecipeForm'
import RecipeCard from './RecipeCard'
import { useVault } from './useVault'
import { chipsRequireReExtraction } from '../../lib/chipDiff'
import SkeletonRecipeCard from '../../components/SkeletonRecipeCard'

// PRD-006 D1: how long the success banner stays visible after a chip-driven
// re-extraction completes. Errors stick until manually dismissed.
const REEXTRACT_SUCCESS_TTL_MS = 2500

/**
 * Vault page — the recipe library. Composes the data layer (useVault) with
 * the form (RecipeForm) and the list (RecipeCard). Owns top-level UI state
 * like which recipe is expanded / being edited and the show/hide of the add
 * form.
 *
 * Decomposed from a single 999-line Vault.jsx in PRD-001 P0.9 (Phase 3
 * Step 2). The default export here is the same `Vault` component App.jsx
 * imports as `Vault from '../pages/Vault'` — Vite resolves the directory
 * path to this index.jsx now that the legacy Vault.jsx has been deleted.
 */

const STARTER_SUGGESTIONS = [
  'Spaghetti Bolognese', 'Chicken Stir-fry', 'Beef Tacos', 'Salmon with Roasted Veg',
  'Chicken Tikka Masala', 'Caesar Salad with Grilled Chicken', 'Beef Burgers',
  'Shrimp Fried Rice', 'Margherita Pizza', 'Lamb Chops with Couscous',
  'Pork Carnitas Bowls', 'Veggie Curry', 'Roast Chicken with Potatoes',
  'Pasta Primavera', 'Fish Tacos', 'Greek Salad with Falafel',
  'Beef Stir-fry with Noodles', 'Chicken Caesar Wrap', 'Shakshuka',
  'Lentil Soup', 'Korean Bibimbap', 'Teriyaki Salmon Bowl',
  'Chicken Fajitas', 'Caprese Pasta', 'Tom Yum Soup',
]

export default function Vault({ userId }) {
  const {
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
    setIngredientEssentiality,
    reExtractIngredients,
  } = useVault(userId)

  const [showForm, setShowForm]     = useState(false)
  const [saving, setSaving]         = useState(false)
  // Persist expanded card across tab switches (sessionStorage cleared on browser close).
  const [expandedId, setExpandedId] = useState(() => sessionStorage.getItem('vault-expanded-id') ?? null)
  const [addingSuggestion, setAddingSuggestion] = useState(null) // name string while in-flight
  const [editingId, setEditingId]         = useState(null)
  const [editFields, setEditFields]       = useState({})
  const [savingEdit, setSavingEdit]       = useState(false)
  // PRD-006 D1: status banner for chip-driven ingredient re-extraction. Shape:
  // { kind: 'progress' | 'success' | 'error', message: string } | null.
  const [reExtractStatus, setReExtractStatus] = useState(null)
  // PRD-004 Phase D: inline save notice for ingredient essentiality toggle.
  // Shape: { recipeId: string, kind: 'saved' | 'error' } | null.
  const [ingredientSaveNotice, setIngredientSaveNotice] = useState(null)
  const { trigger } = useHaptics()

  // Form-submit handler bridges the form's onSubmit callback to the data
  // hook. Returns `{ ok }` so the form can reset on success.
  const handleSubmitRecipe = async (input) => {
    setSaving(true)
    trigger('success')
    const result = await addRecipe(input)
    setSaving(false)
    if (result.ok) setShowForm(false)
    return result
  }

  const handleDelete = async (id) => {
    trigger('medium')
    await deleteRecipe(id)
  }

  const handleAddSuggestion = async (suggestionName) => {
    if (addingSuggestion) return
    trigger('success')
    setAddingSuggestion(suggestionName)
    await addSuggestion(suggestionName)
    setAddingSuggestion(null)
  }

  const toggleExpand = (id) => {
    trigger('light')
    setExpandedId(prev => {
      const next = prev === id ? null : id
      if (next) sessionStorage.setItem('vault-expanded-id', next)
      else sessionStorage.removeItem('vault-expanded-id')
      return next
    })
    setEditingId(null)
    setEditFields({})
  }

  const startEdit = (recipe) => {
    trigger('light')
    setEditingId(recipe.id)
    setEditFields({
      cuisine_type:     recipe.cuisine_type     || '',
      flavor_profile:   recipe.flavor_profile   || '',
      proteins:         recipe.proteins         || [],
      cooking_method:   recipe.cooking_method   || null,
      main_carb:        recipe.main_carb        || null,
      dietary_tags:     recipe.dietary_tags     || [],
      dairy_components: recipe.dairy_components || [],
      vegetables:       recipe.vegetables       || [],
      fruits:           recipe.fruits           || [],
      notes:            recipe.notes            || '',
      recipe_url:       recipe.recipe_url       || '',
      prep_time_minutes: recipe.prep_time_minutes ?? null,
    })
  }

  const handleSaveEdit = async (id) => {
    trigger('success')
    setSavingEdit(true)
    // Snapshot the pre-save chip state so we can compare after the write
    // commits and decide whether to re-extract ingredients.
    const preSave = recipes.find(r => r.id === id) ?? {}
    const nextChips = {
      proteins:         editFields.proteins         || [],
      main_carb:        editFields.main_carb        ?? null,
      dairy_components: editFields.dairy_components || [],
      vegetables:       editFields.vegetables       || [],
      fruits:           editFields.fruits           || [],
    }
    await updateRecipe(id, editFields)
    setSavingEdit(false)
    setEditingId(null)
    setEditFields({})

    // PRD-006 D1: if structural chips changed, the stored ingredient list is
    // now out of sync with what the user just confirmed. Re-extract in the
    // background — the chip save itself has already committed, so a failed
    // re-extraction doesn't cost the user any work.
    if (chipsRequireReExtraction(preSave, nextChips)) {
      setReExtractStatus({ kind: 'progress', message: 'Updating ingredients…' })
      try {
        await reExtractIngredients(id, {
          protein:          editFields.proteins,
          cooking_method:   editFields.cooking_method,
          main_carb:        editFields.main_carb,
          dietary_tags:     editFields.dietary_tags,
          dairy_components: editFields.dairy_components,
          vegetables:       editFields.vegetables,
          fruit:            editFields.fruits,
          prep_time:        editFields.prep_time_minutes,
        })
        setReExtractStatus({ kind: 'success', message: 'Ingredients updated to match' })
        setTimeout(() => {
          setReExtractStatus(prev => (prev?.kind === 'success' ? null : prev))
        }, REEXTRACT_SUCCESS_TTL_MS)
      } catch (err) {
        console.error('[Vault] re-extract ingredients failed:', err)
        setReExtractStatus({
          kind: 'error',
          message: "Couldn't refresh ingredients — try again later",
        })
      }
    }
  }

  const handleRatingChange = async (recipeId, newRating) => {
    trigger('selection')
    await setRating(recipeId, newRating)
  }

  const handleIngredientEssentialityChange = async (recipeId, ingredientName, newEssentiality) => {
    trigger('light')
    const { ok } = await setIngredientEssentiality(recipeId, ingredientName, newEssentiality)
    setIngredientSaveNotice({ recipeId, kind: ok ? 'saved' : 'error' })
    if (ok) {
      setTimeout(() => {
        setIngredientSaveNotice(prev =>
          prev?.recipeId === recipeId && prev?.kind === 'saved' ? null : prev
        )
      }, 1500)
    }
  }

  if (loading) {
    return (
      <div className="mobile-screen pb-28">
        <div role="status" aria-busy="true" className="px-5 py-4 space-y-4">
          <span className="sr-only">Loading vault…</span>
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRecipeCard key={i} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mobile-screen pb-28">

      {/* Header */}
      <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-5">
        <div className="flex items-end justify-between gap-3">
          <div className="w-11 shrink-0" aria-hidden="true" />
          <div className="flex-1 flex flex-col items-center text-center">
            <Logo className="w-8 h-8 mb-2" />
            <h1 className="text-sm text-brand-700 font-bold tracking-widest uppercase">For My Wife</h1>
            <p className="text-lg text-gray-900 mt-1 font-serif italic">
              {recipes.length} {recipes.length === 1 ? 'recipe' : 'recipes'}
            </p>
          </div>
          <button
            onClick={() => { trigger('light'); setShowForm(prev => !prev) }}
            aria-label={showForm ? 'Close add recipe form' : 'Add a new recipe'}
            className={showForm ? 'btn-icon shrink-0' : 'btn-icon-brand shrink-0'}
          >
            {showForm
              ? <X size={20} strokeWidth={2.5} />
              : <Plus size={20} strokeWidth={2.5} />
            }
          </button>
        </div>
      </div>

      {vaultError && (
        <div className="mx-5 mt-4 px-4 py-3 bg-red-50 text-red-600 text-sm rounded-xl border border-red-100 flex items-center justify-between">
          <span>{vaultError}</span>
          <button onClick={() => setVaultError(null)} className="text-red-400 hover:text-red-600"><X size={16} /></button>
        </div>
      )}

      {/* PRD-006 D1: chip-driven ingredient re-extraction status banner. */}
      {reExtractStatus && (
        <div
          role="status"
          className={`mx-5 mt-4 px-4 py-3 text-sm rounded-xl border flex items-center justify-between ${
            reExtractStatus.kind === 'error'
              ? 'bg-red-50 text-red-600 border-red-100'
              : reExtractStatus.kind === 'success'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                : 'bg-cream-100 text-gray-700 border-cream-200'
          }`}
        >
          <span className="flex items-center gap-2">
            {reExtractStatus.kind === 'progress' && <Loader2 size={14} className="animate-spin" />}
            {reExtractStatus.message}
          </span>
          {reExtractStatus.kind !== 'progress' && (
            <button
              onClick={() => setReExtractStatus(null)}
              className="opacity-70 hover:opacity-100"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

        {/* Add recipe form */}
        {showForm && (
          <RecipeForm
            saving={saving}
            extrasByCategory={extrasByCategory}
            onAddExtra={addExtra}
            onSubmit={handleSubmitRecipe}
          />
        )}

        {/* Empty state */}
        {recipes.length === 0 && !showForm && (
          <div className="text-center py-16 space-y-2">
            <p className="body-text">Your vault is empty</p>
            <p className="helper-text">Tap + to add your first recipe</p>
          </div>
        )}

        {/* Recipe list */}
        {recipes.map(recipe => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            expanded={expandedId === recipe.id}
            editing={editingId === recipe.id}
            editFields={editFields}
            setEditFields={setEditFields}
            savingEdit={savingEdit}
            extrasByCategory={extrasByCategory}
            onAddExtra={addExtra}
            onToggleExpand={toggleExpand}
            onStartEdit={startEdit}
            onCancelEdit={() => { setEditingId(null); setEditFields({}) }}
            onSaveEdit={handleSaveEdit}
            onDelete={handleDelete}
            onRatingChange={handleRatingChange}
            onIngredientEssentialityChange={handleIngredientEssentialityChange}
            ingredientSaveNotice={ingredientSaveNotice?.recipeId === recipe.id ? ingredientSaveNotice.kind : null}
          />
        ))}

        {/* Starter suggestions — shown while vault is sparse */}
        {(() => {
          const vaultNames = new Set(recipes.map(r => r.name.toLowerCase().trim()))
          const available = STARTER_SUGGESTIONS.filter(s => !vaultNames.has(s.toLowerCase()))
          if (available.length === 0 || recipes.length >= 15) return null
          return (
            <div className="pt-2 min-w-0">
              <div className="flex items-center gap-2 mb-3">
                <p className="section-heading">Need a head start?</p>
                <div className="flex-1 h-px bg-cream-200" />
              </div>
              <p className="helper-text mb-3">Tap any meal to add it to your vault with AI-filled details.</p>
              <div className="flex flex-wrap gap-2">
                {available.map(name => (
                  <button
                    key={name}
                    onClick={() => handleAddSuggestion(name)}
                    disabled={!!addingSuggestion}
                    className="chip disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {addingSuggestion === name
                      ? <Loader2 size={14} className="animate-spin text-brand-700" />
                      : <BookmarkPlus size={14} className="text-gray-700" />
                    }
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )
        })()}

      </div>
    </div>
  )
}
