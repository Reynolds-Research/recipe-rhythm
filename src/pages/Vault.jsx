import { useState, useEffect } from 'react'
import { Plus, Trash2, X, ChevronDown, ChevronUp, Sparkles, Loader2, BookmarkPlus, ExternalLink } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { analyzeRecipe } from '../lib/analyzeRecipe'

/**
 * Vault
 * The recipe library. Shows all saved recipes with rich component metadata.
 * Claude auto-suggests all component fields from the recipe name.
 * Custom tags per category persist via localStorage.
 */

const CUISINE_OPTIONS = [
  'American', 'Chinese', 'French', 'Greek', 'Indian',
  'Italian', 'Japanese', 'Korean', 'Mexican', 'Middle Eastern',
  'Spanish', 'Thai', 'Vietnamese', 'Other',
]

const FLAVOR_OPTIONS = [
  'Savory', 'Spicy', 'Umami', 'Fresh', 'Rich', 'Sweet', 'Tangy',
]

const PROTEIN_OPTIONS = [
  'Chicken', 'Beef', 'Pork', 'Fish', 'Shrimp/Seafood',
  'Tofu', 'Eggs', 'Beans/Lentils', 'Lamb', 'Turkey', 'Duck', 'None',
]

const COOKING_METHOD_OPTIONS = [
  'Grilled', 'Baked', 'Roasted', 'Stir-fried', 'Braised',
  'Soup/Stew', 'Fried', 'Steamed', 'Raw/Salad', 'Pan-seared',
  'Slow-cooked', 'Smoked',
]

const CARB_OPTIONS = [
  'Rice', 'Pasta', 'Noodles', 'Bread', 'Potato',
  'Quinoa', 'Couscous', 'Polenta', 'Tortilla/Wrap', 'None',
]

const DIETARY_OPTIONS = [
  'Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free',
  'Low-Carb', 'High-Protein', 'Nut-Free', 'Paleo',
]

const DAIRY_OPTIONS = [
  'Cheese', 'Cream', 'Butter', 'Milk', 'Yogurt',
  'Parmesan', 'Mozzarella', 'None',
]

const VEGETABLE_OPTIONS = [
  'Tomato', 'Spinach/Greens', 'Mushrooms', 'Bell Peppers',
  'Onion/Garlic', 'Broccoli', 'Zucchini', 'Eggplant', 'Carrot',
  'Corn', 'Peas', 'Cucumber', 'Asparagus', 'Sweet Potato',
  'Cauliflower', 'Brussels Sprouts', 'Celery', 'Cabbage',
]

const FRUIT_OPTIONS = [
  'Avocado', 'Lemon/Lime', 'Orange', 'Apple', 'Mango',
  'Pineapple', 'Berries', 'Banana', 'Coconut', 'Peach',
  'Pomegranate', 'Grapes',
]

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

// localStorage helpers for persisting custom tags per category
function loadExtras(key) {
  try { return JSON.parse(localStorage.getItem(`vault_extra_${key}`) || '[]') }
  catch { return [] }
}
function saveExtras(key, tags) {
  localStorage.setItem(`vault_extra_${key}`, JSON.stringify(tags))
}

// --- Chip picker with custom tag support ---
function ChipPicker({ options, value, onChange, multi = true, storageKey = null }) {
  const [showAdd, setShowAdd]   = useState(false)
  const [draft, setDraft]       = useState('')
  const [extras, setExtras]     = useState(() => storageKey ? loadExtras(storageKey) : [])

  const allOptions = [...options, ...extras.filter(e => !options.includes(e))]

  const isActive = (opt) => multi ? (value || []).includes(opt) : value === opt

  const toggle = (opt) => {
    if (multi) {
      const cur = value || []
      onChange(cur.includes(opt) ? cur.filter(v => v !== opt) : [...cur, opt])
    } else {
      onChange(isActive(opt) ? null : opt)
    }
  }

  const commitCustom = () => {
    const tag = draft.trim()
    if (!tag) { setShowAdd(false); return }
    const next = [...new Set([...extras, tag])]
    setExtras(next)
    if (storageKey) saveExtras(storageKey, next)
    // Auto-select the new tag
    if (multi) onChange([...(value || []).filter(v => v !== tag), tag])
    else onChange(tag)
    setDraft('')
    setShowAdd(false)
  }

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {allOptions.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
            isActive(opt)
              ? 'bg-brand-500 text-white border-brand-500'
              : 'bg-white text-gray-500 border-cream-200 hover:border-brand-300 hover:text-brand-600'
          }`}
        >
          {opt}
        </button>
      ))}

      {showAdd ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitCustom() }
              if (e.key === 'Escape') { setShowAdd(false); setDraft('') }
            }}
            placeholder="Type & press Enter"
            className="w-32 px-2.5 py-1 text-xs border border-brand-300 rounded-full outline-none focus:ring-1 focus:ring-brand-400 bg-white"
          />
          <button
            type="button"
            onClick={() => { setShowAdd(false); setDraft('') }}
            className="text-gray-300 hover:text-gray-500 transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="px-2.5 py-1 rounded-full text-xs text-gray-400 border border-dashed border-gray-200 hover:border-brand-300 hover:text-brand-500 transition-all"
        >
          + custom
        </button>
      )}
    </div>
  )
}

function FieldSection({ label, children }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</p>
      {children}
    </div>
  )
}

function ComponentRow({ label, values }) {
  if (!values || values.length === 0) return null
  const filtered = values.filter(v => v && v !== 'None')
  if (filtered.length === 0) return null
  return (
    <div className="flex gap-2 items-start">
      <span className="text-[9px] font-bold text-gray-300 uppercase tracking-wider pt-0.5 w-12 shrink-0">{label}</span>
      <div className="flex flex-wrap gap-1">
        {filtered.map(v => (
          <span key={v} className="px-2 py-0.5 bg-cream-100 text-gray-600 text-xs rounded-full">{v}</span>
        ))}
      </div>
    </div>
  )
}

export default function Vault() {
  const [recipes, setRecipes]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [showForm, setShowForm]     = useState(false)
  const [saving, setSaving]         = useState(false)
  const [expandedId, setExpandedId]       = useState(null)
  const [suggesting, setSuggesting]       = useState(false)
  const [aiApplied, setAiApplied]         = useState(false)
  const [aiError, setAiError]             = useState(false)
  const [addingSuggestion, setAddingSuggestion] = useState(null) // name string while in-flight
  const [editingId, setEditingId]         = useState(null)
  const [editFields, setEditFields]       = useState({})
  const [savingEdit, setSavingEdit]       = useState(false)

  const hasApiKey = !!import.meta.env.VITE_ANTHROPIC_API_KEY

  // Form state
  const [name, setName]                       = useState('')
  const [cuisineType, setCuisineType]         = useState('')
  const [flavorProfile, setFlavorProfile]     = useState('')
  const [notes, setNotes]                     = useState('')
  const [recipeUrl, setRecipeUrl]             = useState('')
  const [proteins, setProteins]               = useState([])
  const [cookingMethod, setCookingMethod]     = useState(null)
  const [mainCarb, setMainCarb]               = useState(null)
  const [dietaryTags, setDietaryTags]         = useState([])
  const [dairyComponents, setDairyComponents] = useState([])
  const [vegetables, setVegetables]           = useState([])
  const [fruits, setFruits]                   = useState([])

  useEffect(() => { fetchRecipes() }, [])

  // AI auto-suggest fires 1.5s after user stops typing (4+ chars)
  useEffect(() => {
    if (!showForm || name.trim().length < 4) {
      if (name.trim().length < 4) setAiApplied(false)
      return
    }
    const timer = setTimeout(async () => {
      if (suggesting) return
      setSuggesting(true)
      setAiError(false)
      const s = await analyzeRecipe(name.trim())
      if (s) {
        if (s.cuisine_type)             setCuisineType(s.cuisine_type)
        if (s.flavor_profile)           setFlavorProfile(s.flavor_profile)
        if (s.proteins?.length)         setProteins(s.proteins)
        if (s.cooking_method)           setCookingMethod(s.cooking_method)
        if (s.main_carb)                setMainCarb(s.main_carb)
        if (s.dietary_tags?.length)     setDietaryTags(s.dietary_tags)
        if (s.dairy_components?.length) setDairyComponents(s.dairy_components)
        if (s.vegetables?.length)       setVegetables(s.vegetables)
        if (s.fruits?.length)           setFruits(s.fruits)
        setAiApplied(true)
      } else {
        setAiError(true)
      }
      setSuggesting(false)
    }, 1500)
    return () => clearTimeout(timer)
  }, [name, showForm])

  const fetchRecipes = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('vault')
      .select('id, name, cuisine_type, flavor_profile, notes, recipe_url, created_at, proteins, cooking_method, main_carb, dietary_tags, dairy_components, vegetables, fruits, auto_completed')
      .order('created_at', { ascending: false })

    if (error) console.error('[Vault] fetchRecipes failed:', error.message)
    if (!error && data) setRecipes(data)
    setLoading(false)
  }

  const resetForm = () => {
    setName('')
    setCuisineType('')
    setFlavorProfile('')
    setNotes('')
    setRecipeUrl('')
    setProteins([])
    setCookingMethod(null)
    setMainCarb(null)
    setDietaryTags([])
    setDairyComponents([])
    setVegetables([])
    setFruits([])
    setAiApplied(false)
    setAiError(false)
  }

  const handleAdd = async () => {
    const finalName = name.trim()
    if (!finalName) return
    setSaving(true)

    const { data: existing } = await supabase
      .from('vault')
      .select('id')
      .ilike('name', finalName)
      .limit(1)

    if (existing && existing.length > 0) {
      alert(`"${finalName}" is already in your vault!`)
      setSaving(false)
      return
    }

    const { error } = await supabase.from('vault').insert({
      name:             finalName,
      cuisine_type:     cuisineType            || null,
      flavor_profile:   flavorProfile          || null,
      notes:            notes.trim()           || null,
      recipe_url:       recipeUrl.trim()       || null,
      is_wildcard:      false,
      auto_completed:   false,
      proteins:         proteins.length        ? proteins        : null,
      cooking_method:   cookingMethod          || null,
      main_carb:        mainCarb               || null,
      dietary_tags:     dietaryTags.length     ? dietaryTags     : null,
      dairy_components: dairyComponents.length ? dairyComponents : null,
      vegetables:       vegetables.length      ? vegetables      : null,
      fruits:           fruits.length          ? fruits          : null,
    })

    setSaving(false)
    if (!error) {
      resetForm()
      setShowForm(false)
      fetchRecipes()
    }
  }

  const handleDelete = async (id) => {
    await supabase.from('vault').delete().eq('id', id)
    setRecipes(prev => prev.filter(r => r.id !== id))
  }

  const handleAddSuggestion = async (suggestionName) => {
    if (addingSuggestion) return
    setAddingSuggestion(suggestionName)
    const analysis = await analyzeRecipe(suggestionName)
    await supabase.from('vault').insert({
      name:             suggestionName,
      is_wildcard:      false,
      auto_completed:   true,
      cuisine_type:     analysis?.cuisine_type     ?? null,
      flavor_profile:   analysis?.flavor_profile   ?? null,
      proteins:         analysis?.proteins         ?? [],
      cooking_method:   analysis?.cooking_method   ?? null,
      main_carb:        analysis?.main_carb        ?? null,
      dietary_tags:     analysis?.dietary_tags     ?? [],
      dairy_components: analysis?.dairy_components ?? [],
      vegetables:       analysis?.vegetables       ?? [],
      fruits:           analysis?.fruits           ?? [],
    })
    setAddingSuggestion(null)
    fetchRecipes()
  }

  const toggleExpand = (id) => {
    setExpandedId(prev => prev === id ? null : id)
    setEditingId(null)
    setEditFields({})
  }

  const startEdit = (recipe) => {
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
    setSavingEdit(true)
    await supabase.from('vault').update({
      ...editFields,
      cuisine_type:   editFields.cuisine_type        || null,
      flavor_profile: editFields.flavor_profile      || null,
      notes:          editFields.notes.trim()        || null,
      recipe_url:     editFields.recipe_url.trim()   || null,
      auto_completed: false,
    }).eq('id', id)
    setSavingEdit(false)
    setEditingId(null)
    setEditFields({})
    fetchRecipes()
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
          onClick={() => { setShowForm(prev => !prev); if (showForm) resetForm() }}
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
          <div className="card space-y-5 border-brand-100 bg-brand-50/30 backdrop-blur-sm">

            {/* Form header with AI status */}
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-brand-600 tracking-wider uppercase">Add a new recipe</p>
              {!hasApiKey && (
                <p className="text-[10px] text-amber-500 font-medium">Add VITE_ANTHROPIC_API_KEY to .env</p>
              )}
              {hasApiKey && suggesting && (
                <div className="flex items-center gap-1.5 text-[10px] text-brand-400 font-medium">
                  <Loader2 size={10} className="animate-spin" />
                  Analyzing…
                </div>
              )}
              {hasApiKey && aiApplied && !suggesting && (
                <div className="flex items-center gap-1 text-[10px] text-brand-500 font-medium">
                  <Sparkles size={10} />
                  AI filled — tweak as needed
                </div>
              )}
              {hasApiKey && aiError && !suggesting && (
                <p className="text-[10px] text-red-400 font-medium">AI failed — check console</p>
              )}
            </div>

            {/* Name */}
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setAiApplied(false) }}
              placeholder="Recipe name (e.g. Thai meatball soup)"
              className="input-base"
            />

            {/* Cuisine + Flavor row */}
            <div className="grid grid-cols-2 gap-3">
              <select value={cuisineType} onChange={e => setCuisineType(e.target.value)} className="input-base text-sm">
                <option value="">Cuisine…</option>
                {CUISINE_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={flavorProfile} onChange={e => setFlavorProfile(e.target.value)} className="input-base text-sm">
                <option value="">Flavor…</option>
                {FLAVOR_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>

            <FieldSection label="Protein">
              <ChipPicker options={PROTEIN_OPTIONS} value={proteins} onChange={setProteins} multi storageKey="proteins" />
            </FieldSection>

            <FieldSection label="Cooking method">
              <ChipPicker options={COOKING_METHOD_OPTIONS} value={cookingMethod} onChange={setCookingMethod} multi={false} storageKey="cooking_method" />
            </FieldSection>

            <FieldSection label="Main carb">
              <ChipPicker options={CARB_OPTIONS} value={mainCarb} onChange={setMainCarb} multi={false} storageKey="main_carb" />
            </FieldSection>

            <FieldSection label="Dietary tags">
              <ChipPicker options={DIETARY_OPTIONS} value={dietaryTags} onChange={setDietaryTags} multi storageKey="dietary_tags" />
            </FieldSection>

            <FieldSection label="Dairy">
              <ChipPicker options={DAIRY_OPTIONS} value={dairyComponents} onChange={setDairyComponents} multi storageKey="dairy" />
            </FieldSection>

            <FieldSection label="Vegetables">
              <ChipPicker options={VEGETABLE_OPTIONS} value={vegetables} onChange={setVegetables} multi storageKey="vegetables" />
            </FieldSection>

            <FieldSection label="Fruit">
              <ChipPicker options={FRUIT_OPTIONS} value={fruits} onChange={setFruits} multi storageKey="fruits" />
            </FieldSection>

            {/* Notes */}
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Notes (e.g. add more lime next time)"
              className="input-base"
            />

            {/* Recipe URL */}
            <input
              type="url"
              value={recipeUrl}
              onChange={e => setRecipeUrl(e.target.value)}
              placeholder="Recipe URL (optional)"
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
                <p className="text-base font-medium text-gray-900 truncate leading-tight group-hover:text-brand-600 transition-colors">
                  {recipe.name}
                </p>
                <div className="flex flex-wrap items-center gap-x-1.5 mt-1">
                  {[
                    recipe.cuisine_type,
                    recipe.cooking_method,
                    ...(recipe.proteins || []).filter(p => p !== 'None').slice(0, 2),
                  ].filter(Boolean).map((item, i) => (
                    <span key={item} className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      {i > 0 && '· '}{item}
                    </span>
                  ))}
                  {recipe.auto_completed && (
                    <span className="text-[9px] font-bold text-amber-500/80 border border-amber-200 bg-amber-50 rounded-full px-1.5 py-0.5 uppercase tracking-wide leading-none">
                      auto-completed
                    </span>
                  )}
                </div>
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
              <div className="mt-4 pt-4 border-t border-cream-100 space-y-3">
                {editingId === recipe.id ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <select value={editFields.cuisine_type} onChange={e => setEditFields(f => ({ ...f, cuisine_type: e.target.value }))} className="input-base text-sm">
                        <option value="">Cuisine…</option>
                        {CUISINE_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select value={editFields.flavor_profile} onChange={e => setEditFields(f => ({ ...f, flavor_profile: e.target.value }))} className="input-base text-sm">
                        <option value="">Flavor…</option>
                        {FLAVOR_OPTIONS.map(fl => <option key={fl} value={fl}>{fl}</option>)}
                      </select>
                    </div>
                    <FieldSection label="Protein">
                      <ChipPicker options={PROTEIN_OPTIONS} value={editFields.proteins} onChange={v => setEditFields(f => ({ ...f, proteins: v }))} multi storageKey="proteins" />
                    </FieldSection>
                    <FieldSection label="Cooking method">
                      <ChipPicker options={COOKING_METHOD_OPTIONS} value={editFields.cooking_method} onChange={v => setEditFields(f => ({ ...f, cooking_method: v }))} multi={false} storageKey="cooking_method" />
                    </FieldSection>
                    <FieldSection label="Main carb">
                      <ChipPicker options={CARB_OPTIONS} value={editFields.main_carb} onChange={v => setEditFields(f => ({ ...f, main_carb: v }))} multi={false} storageKey="main_carb" />
                    </FieldSection>
                    <FieldSection label="Dietary tags">
                      <ChipPicker options={DIETARY_OPTIONS} value={editFields.dietary_tags} onChange={v => setEditFields(f => ({ ...f, dietary_tags: v }))} multi storageKey="dietary_tags" />
                    </FieldSection>
                    <FieldSection label="Dairy">
                      <ChipPicker options={DAIRY_OPTIONS} value={editFields.dairy_components} onChange={v => setEditFields(f => ({ ...f, dairy_components: v }))} multi storageKey="dairy" />
                    </FieldSection>
                    <FieldSection label="Vegetables">
                      <ChipPicker options={VEGETABLE_OPTIONS} value={editFields.vegetables} onChange={v => setEditFields(f => ({ ...f, vegetables: v }))} multi storageKey="vegetables" />
                    </FieldSection>
                    <FieldSection label="Fruit">
                      <ChipPicker options={FRUIT_OPTIONS} value={editFields.fruits} onChange={v => setEditFields(f => ({ ...f, fruits: v }))} multi storageKey="fruits" />
                    </FieldSection>
                    <input
                      type="text"
                      value={editFields.notes}
                      onChange={e => setEditFields(f => ({ ...f, notes: e.target.value }))}
                      placeholder="Notes (e.g. add more lime next time)"
                      className="input-base"
                    />
                    <input
                      type="url"
                      value={editFields.recipe_url}
                      onChange={e => setEditFields(f => ({ ...f, recipe_url: e.target.value }))}
                      placeholder="Recipe URL (optional)"
                      className="input-base"
                    />
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleSaveEdit(recipe.id)}
                        disabled={savingEdit}
                        className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {savingEdit ? 'Saving…' : 'Save changes'}
                      </button>
                      <button
                        onClick={() => { setEditingId(null); setEditFields({}) }}
                        className="px-4 py-2 rounded-2xl border border-gray-200 text-sm text-gray-500"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <ComponentRow label="Protein"  values={recipe.proteins} />
                    <ComponentRow label="Carb"     values={recipe.main_carb ? [recipe.main_carb] : []} />
                    <ComponentRow label="Method"   values={recipe.cooking_method ? [recipe.cooking_method] : []} />
                    <ComponentRow label="Flavor"   values={recipe.flavor_profile ? [recipe.flavor_profile] : []} />
                    <ComponentRow label="Diet"     values={recipe.dietary_tags} />
                    <ComponentRow label="Dairy"    values={recipe.dairy_components} />
                    <ComponentRow label="Veg"      values={recipe.vegetables} />
                    <ComponentRow label="Fruit"    values={recipe.fruits} />

                    {recipe.notes && (
                      <div className="bg-cream-50 rounded-xl p-3 border border-cream-100">
                        <p className="text-xs text-gray-600 leading-relaxed font-serif italic">{recipe.notes}</p>
                      </div>
                    )}
                    {recipe.recipe_url && (
                      <a
                        href={recipe.recipe_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-brand-500 hover:text-brand-700 transition-colors truncate"
                      >
                        <ExternalLink size={11} className="shrink-0" />
                        <span className="truncate">{recipe.recipe_url.replace(/^https?:\/\//, '')}</span>
                      </a>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <button
                        onClick={() => startEdit(recipe)}
                        className="text-[10px] font-bold text-brand-500 uppercase tracking-widest hover:text-brand-600 transition-colors"
                      >
                        Edit components
                      </button>
                      <button
                        onClick={() => handleDelete(recipe.id)}
                        className="flex items-center gap-1.5 text-[10px] font-bold text-red-400/80 uppercase tracking-widest hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={12} strokeWidth={2.5} />
                        Remove
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Starter suggestions — shown while vault is sparse */}
        {(() => {
          const vaultNames = new Set(recipes.map(r => r.name.toLowerCase().trim()))
          const available = STARTER_SUGGESTIONS.filter(s => !vaultNames.has(s.toLowerCase()))
          if (available.length === 0 || recipes.length >= 15) return null
          return (
            <div className="pt-2">
              <div className="flex items-center gap-2 mb-3">
                <p className="text-[10px] font-bold text-gray-400 tracking-[0.2em] uppercase">Need a head start?</p>
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
