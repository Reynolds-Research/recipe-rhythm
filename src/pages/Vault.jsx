import { useState, useEffect } from 'react'
import { Plus, Trash2, X, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../lib/supabase'

/**
 * Vault
 * The recipe library. Shows all saved recipes as a simple list.
 * Recipes can be added manually or saved from the meal log.
 */

const CUISINE_OPTIONS = [
  'American', 'Chinese', 'French', 'Greek', 'Indian',
  'Italian', 'Japanese', 'Korean', 'Mexican', 'Middle Eastern',
  'Spanish', 'Thai', 'Vietnamese', 'Other',
]

const FLAVOR_OPTIONS = [
  'Savory', 'Spicy', 'Umami', 'Fresh', 'Rich', 'Sweet', 'Tangy',
]

export default function Vault() {
  const [recipes, setRecipes]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [showForm, setShowForm]     = useState(false)
  const [saving, setSaving]         = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  // Form state
  const [name, setName]                   = useState('')
  const [cuisineType, setCuisineType]     = useState('')
  const [flavorProfile, setFlavorProfile] = useState('')
  const [notes, setNotes]                 = useState('')

  useEffect(() => {
    fetchRecipes()
  }, [])

  const fetchRecipes = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('vault')
      .select('id, name, cuisine_type, flavor_profile, notes, created_at')
      .order('created_at', { ascending: false })

    if (!error && data) setRecipes(data)
    setLoading(false)
  }

  const handleAdd = async () => {
    if (!name.trim()) return
    setSaving(true)

    const { error } = await supabase.from('vault').insert({
      name:           name.trim(),
      cuisine_type:   cuisineType  || null,
      flavor_profile: flavorProfile || null,
      notes:          notes.trim() || null,
      is_wildcard:    false,
    })

    setSaving(false)

    if (!error) {
      // Reset form and refresh list
      setName('')
      setCuisineType('')
      setFlavorProfile('')
      setNotes('')
      setShowForm(false)
      fetchRecipes()
    }
  }

  const handleDelete = async (id) => {
    await supabase.from('vault').delete().eq('id', id)
    setRecipes(prev => prev.filter(r => r.id !== id))
  }

  const toggleExpand = (id) => {
    setExpandedId(prev => prev === id ? null : id)
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
      <div className="bg-gray-50 border-b border-gray-100 px-5 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400 tracking-widest">THE VAULT</p>
          <p className="text-lg font-medium text-gray-900 mt-0.5">
            {recipes.length} {recipes.length === 1 ? 'recipe' : 'recipes'}
          </p>
        </div>
        <button
          onClick={() => setShowForm(prev => !prev)}
          className="w-10 h-10 rounded-full bg-brand-50 border border-brand-200 flex items-center justify-center"
        >
          {showForm
            ? <X size={18} className="text-brand-600" />
            : <Plus size={18} className="text-brand-600" />
          }
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

        {/* Add recipe form */}
        {showForm && (
          <div className="card space-y-3">
            <p className="text-sm font-medium text-gray-700">Add a recipe</p>

            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Recipe name (e.g. Thai meatball soup)"
              className="input-base"
            />

            {/* Cuisine type — fixed dropdown */}
            <select
              value={cuisineType}
              onChange={e => setCuisineType(e.target.value)}
              className="input-base"
            >
              <option value="">Cuisine type (optional)</option>
              {CUISINE_OPTIONS.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            {/* Flavor profile — fixed dropdown */}
            <select
              value={flavorProfile}
              onChange={e => setFlavorProfile(e.target.value)}
              className="input-base"
            >
              <option value="">Flavor profile (optional)</option>
              {FLAVOR_OPTIONS.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>

            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Notes (e.g. add more lime next time)"
              className="input-base"
            />

            <button
              onClick={handleAdd}
              disabled={!name.trim() || saving}
              className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save to vault'}
            </button>
          </div>
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
          <div key={recipe.id} className="card">
            <div
              className="flex items-center gap-3 cursor-pointer"
              onClick={() => toggleExpand(recipe.id)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{recipe.name}</p>
                {(recipe.cuisine_type || recipe.flavor_profile) && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {[recipe.cuisine_type, recipe.flavor_profile].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {expandedId === recipe.id
                  ? <ChevronUp size={16} className="text-gray-400" />
                  : <ChevronDown size={16} className="text-gray-400" />
                }
              </div>
            </div>

            {/* Expanded detail */}
            {expandedId === recipe.id && (
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                {recipe.notes && (
                  <p className="text-xs text-gray-500 leading-relaxed">{recipe.notes}</p>
                )}
                <button
                  onClick={() => handleDelete(recipe.id)}
                  className="flex items-center gap-1.5 text-xs text-red-400"
                >
                  <Trash2 size={12} />
                  Remove from vault
                </button>
              </div>
            )}
          </div>
        ))}

      </div>
    </div>
  )
}
