import { useState } from 'react'
import { Plus, X, Loader2, BookmarkPlus } from 'lucide-react'
import Logo from '../../components/Logo'
import { useHaptics } from '../../hooks/useHaptics'
import RecipeForm from './RecipeForm'
import RecipeCard from './RecipeCard'
import { useVault } from './useVault'

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
  } = useVault(userId)

  const [showForm, setShowForm]     = useState(false)
  const [saving, setSaving]         = useState(false)
  const [expandedId, setExpandedId]       = useState(null)
  const [addingSuggestion, setAddingSuggestion] = useState(null) // name string while in-flight
  const [editingId, setEditingId]         = useState(null)
  const [editFields, setEditFields]       = useState({})
  const [savingEdit, setSavingEdit]       = useState(false)
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
    trigger('error')
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
    setExpandedId(prev => prev === id ? null : id)
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
    await updateRecipe(id, editFields)
    setSavingEdit(false)
    setEditingId(null)
    setEditFields({})
  }

  const handleRatingChange = async (recipeId, newRating) => {
    trigger('light')
    await setRating(recipeId, newRating)
  }

  if (loading) {
    return (
      <div className="mobile-screen items-center justify-center pb-28">
        <p className="text-sm text-gray-400">Loading vault…</p>
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
            <h1 className="text-sm text-brand-600 font-bold tracking-widest uppercase">For My Wife</h1>
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
            <p className="text-gray-400 text-sm">Your vault is empty</p>
            <p className="text-gray-300 text-xs">Tap + to add your first recipe</p>
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
                <p className="text-[11px] font-bold text-gray-400 tracking-widest uppercase">Need a head start?</p>
                <div className="flex-1 h-px bg-cream-200" />
              </div>
              <p className="text-xs text-gray-400 mb-3">Tap any meal to add it to your vault with AI-filled details.</p>
              <div className="flex flex-wrap gap-2">
                {available.map(name => (
                  <button
                    key={name}
                    onClick={() => handleAddSuggestion(name)}
                    disabled={!!addingSuggestion}
                    className="flex items-center gap-1.5 bg-white border border-cream-200 rounded-full px-3.5 py-1.5 text-sm text-gray-600 font-medium transition-all active:bg-brand-50 active:border-brand-200 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {addingSuggestion === name
                      ? <Loader2 size={11} className="animate-spin text-brand-400" />
                      : <BookmarkPlus size={11} className="text-gray-400" />
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
