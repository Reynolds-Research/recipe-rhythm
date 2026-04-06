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
      <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-brand-600 font-bold tracking-[0.2em] uppercase leading-none">THE VAULT</p>
          <p className="text-xl font-medium text-gray-900 mt-1 font-serif italic leading-none">
            {recipes.length} {recipes.length === 1 ? 'recipe' : 'recipes'}
          </p>
        </div>
        <button
          onClick={() => setShowForm(prev => !prev)}
          className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-md active:scale-95
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

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

        {/* Add recipe form */}
        {showForm && (
          <div className="card space-y-4 border-brand-100 bg-brand-50/30 backdrop-blur-sm">
            <p className="text-xs font-bold text-brand-600 tracking-wider uppercase">Add a new recipe</p>

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
          <div key={recipe.id} className="card group hover:border-brand-200 transition-colors">
            <div
              className="flex items-center gap-4 cursor-pointer"
              onClick={() => toggleExpand(recipe.id)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-base font-medium text-gray-900 truncate leading-tight group-hover:text-brand-600 transition-colors">{recipe.name}</p>
                {(recipe.cuisine_type || recipe.flavor_profile) && (
                  <p className="text-[10px] font-bold text-gray-400 mt-1 uppercase tracking-wider">
                    {[recipe.cuisine_type, recipe.flavor_profile].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 text-gray-300 group-hover:text-brand-400 transition-colors">
                {expandedId === recipe.id
                  ? <ChevronUp size={20} strokeWidth={2.5} />
                  : <ChevronDown size={20} strokeWidth={2.5} />
                }
              </div>
            </div>

            {/* Expanded detail */}
            {expandedId === recipe.id && (
              <div className="mt-4 pt-4 border-t border-cream-100 space-y-4">
                {recipe.notes && (
                  <div className="bg-cream-50 rounded-xl p-3 border border-cream-100">
                    <p className="text-xs text-gray-600 leading-relaxed font-serif italic">{recipe.notes}</p>
                  </div>
                )}
                <button
                  onClick={() => handleDelete(recipe.id)}
                  className="flex items-center gap-1.5 text-[10px] font-bold text-red-400/80 uppercase tracking-widest hover:text-red-500 transition-colors"
                >
                  <Trash2 size={12} strokeWidth={2.5} />
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
