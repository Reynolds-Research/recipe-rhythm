import { useState } from 'react'
import { Plus, X, Loader2, BookmarkPlus } from 'lucide-react'
import Logo from '../components/Logo'
import { useHaptics } from '../hooks/useHaptics'
import RecipeForm from './Vault/RecipeForm'
import RecipeCard from './Vault/RecipeCard'
import { useVault } from './Vault/useVault'

/**
 * Vault
 * The recipe library. Shows all saved recipes with rich component metadata.
 * Claude auto-suggests all component fields from the recipe name.
 * Custom tags per category persist in the `vault_options` table; legacy
 * localStorage values are auto-migrated on mount via vaultOptions.js.
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

  /**
   * PRD-001 P0.5 — Soft-delete a vault recipe.
   *
   * Sets `deleted_at = now()` rather than issuing a DELETE so that historical
   * references from meals.vault_id and meal_plan_items.vault_id continue to
   * resolve to a real row (with name, image_url, etc.) for history views.
   * The Vault SELECT in fetchRecipes() filters `.is('deleted_at', null)`, so
   * the row disappears from the user-visible list immediately.
   *
   * Local state is updated synchronously so the card animates out without
   * waiting on the network round-trip.
   */
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

  /**
   * PRD-001 P1.1 — Family rating updates are immediate (no "Save changes"
   * button). The StarRating component already resolved the tap-to-toggle
   * behavior, so `newRating` is the final value to write (1..5 or null).
   *
   * Optimistically updates local state first so the star fill is instant,
   * then writes to Supabase. On error we refetch authoritative state to
   * roll back the optimistic change.
   */
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
      <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-5 text-center flex flex-col items-center relative">
        <div className="absolute top-1/2 -translate-y-1/2 right-5">
          <button
            onClick={() => { trigger('light'); setShowForm(prev => !prev) }}
            aria-label={showForm ? 'Close add recipe form' : 'Add a new recipe'}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-md active:scale-95
              ${showForm
                ? 'bg-white border border-brand-200 text-brand-500 hover:bg-brand-50'
                : 'bg-brand-500 text-white hover:bg-brand-600 shadow-brand-100'
              }`}
          >
            {showForm
              ? <X size={20} strokeWidth={2.5} />
              : <Plus size={20} strokeWidth={2.5} />
            }
          </button>
        </div>
        <Logo className="w-8 h-8 mb-2" />
        <h1 className="text-sm text-brand-600 font-bold tracking-widest uppercase">For My Wife</h1>
        <p className="text-lg text-gray-900 mt-1 font-serif italic">
          {recipes.length} {recipes.length === 1 ? 'recipe' : 'recipes'}
        </p>
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
