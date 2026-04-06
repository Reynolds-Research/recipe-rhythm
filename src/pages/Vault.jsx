import { useState, useEffect } from 'react'
import { Plus, Trash2, X, ChevronDown, ChevronUp, Sparkles, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

/**
 * Vault
 * The recipe library. Shows all saved recipes with rich component metadata.
 * Claude Haiku auto-suggests all component fields from the recipe name.
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

const PRODUCE_OPTIONS = [
  'Tomato', 'Spinach/Greens', 'Mushrooms', 'Bell Peppers',
  'Onion/Garlic', 'Broccoli', 'Zucchini', 'Eggplant', 'Carrot',
  'Corn', 'Peas', 'Avocado', 'Cucumber', 'Asparagus', 'Sweet Potato',
]

// --- Claude Haiku: auto-suggest all component fields from recipe name ---
async function analyzeRecipe(recipeName) {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!key) return null

  let res
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Analyze this recipe name and return a JSON object. Return ONLY valid JSON with no markdown or explanation.

Recipe: "${recipeName}"

{
  "cuisine_type": one of [American, Chinese, French, Greek, Indian, Italian, Japanese, Korean, Mexican, Middle Eastern, Spanish, Thai, Vietnamese, Other] or null,
  "flavor_profile": one of [Savory, Spicy, Umami, Fresh, Rich, Sweet, Tangy] or null,
  "proteins": array from [Chicken, Beef, Pork, Fish, Shrimp/Seafood, Tofu, Eggs, Beans/Lentils, Lamb, Turkey, Duck, None],
  "cooking_method": one of [Grilled, Baked, Roasted, Stir-fried, Braised, Soup/Stew, Fried, Steamed, Raw/Salad, Pan-seared, Slow-cooked, Smoked] or null,
  "main_carb": one of [Rice, Pasta, Noodles, Bread, Potato, Quinoa, Couscous, Polenta, Tortilla/Wrap, None] or null,
  "dietary_tags": array from [Vegetarian, Vegan, Gluten-Free, Dairy-Free, Low-Carb, High-Protein, Nut-Free, Paleo],
  "dairy_components": array from [Cheese, Cream, Butter, Milk, Yogurt, Parmesan, Mozzarella, None],
  "produce": array from [Tomato, Spinach/Greens, Mushrooms, Bell Peppers, Onion/Garlic, Broccoli, Zucchini, Eggplant, Carrot, Corn, Peas, Avocado, Cucumber, Asparagus, Sweet Potato]
}`,
        }],
      }),
    })
  } catch (err) {
    console.error('[Vault AI] fetch failed:', err)
    return null
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    console.error('[Vault AI] API error', res.status, JSON.stringify(body))
    return null
  }

  const data = await res.json()
  const text = data.content?.[0]?.text
  if (!text) { console.error('[Vault AI] empty response', data); return null }

  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      try { return JSON.parse(match[0]) } catch (e) { console.error('[Vault AI] JSON parse failed', e, text) }
    }
    return null
  }
}

// --- Chip picker: multi or single select ---
function ChipPicker({ options, value, onChange, multi = true }) {
  const isActive = (opt) => multi ? (value || []).includes(opt) : value === opt
  const toggle = (opt) => {
    if (multi) {
      const cur = value || []
      onChange(cur.includes(opt) ? cur.filter(v => v !== opt) : [...cur, opt])
    } else {
      onChange(isActive(opt) ? null : opt)
    }
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(opt => (
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

// --- Component tag row used in expanded card ---
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
  const [expandedId, setExpandedId] = useState(null)
  const [suggesting, setSuggesting] = useState(false)
  const [aiApplied, setAiApplied]   = useState(false)
  const [aiError, setAiError]       = useState(false)

  const hasApiKey = !!import.meta.env.VITE_ANTHROPIC_API_KEY

  // Form state
  const [name, setName]                       = useState('')
  const [cuisineType, setCuisineType]         = useState('')
  const [flavorProfile, setFlavorProfile]     = useState('')
  const [notes, setNotes]                     = useState('')
  const [proteins, setProteins]               = useState([])
  const [cookingMethod, setCookingMethod]     = useState(null)
  const [mainCarb, setMainCarb]               = useState(null)
  const [dietaryTags, setDietaryTags]         = useState([])
  const [dairyComponents, setDairyComponents] = useState([])
  const [produce, setProduce]                 = useState([])

  useEffect(() => { fetchRecipes() }, [])

  // AI auto-suggest fires 900ms after user stops typing a name (4+ chars)
  useEffect(() => {
    console.log('[Vault AI] effect — name:', name, '| showForm:', showForm, '| key:', !!import.meta.env.VITE_ANTHROPIC_API_KEY)
    if (!showForm || name.trim().length < 4) {
      if (name.trim().length < 4) setAiApplied(false)
      return
    }
    const timer = setTimeout(async () => {
      console.log('[Vault AI] firing analyzeRecipe for:', name.trim())
      setSuggesting(true)
      setAiError(false)
      const s = await analyzeRecipe(name.trim())
      console.log('[Vault AI] result:', s)
      if (s) {
        if (s.cuisine_type)            setCuisineType(s.cuisine_type)
        if (s.flavor_profile)          setFlavorProfile(s.flavor_profile)
        if (s.proteins?.length)        setProteins(s.proteins)
        if (s.cooking_method)          setCookingMethod(s.cooking_method)
        if (s.main_carb)               setMainCarb(s.main_carb)
        if (s.dietary_tags?.length)    setDietaryTags(s.dietary_tags)
        if (s.dairy_components?.length) setDairyComponents(s.dairy_components)
        if (s.produce?.length)         setProduce(s.produce)
        setAiApplied(true)
      } else {
        setAiError(true)
      }
      setSuggesting(false)
    }, 900)
    return () => clearTimeout(timer)
  }, [name, showForm])

  const fetchRecipes = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('vault')
      .select('id, name, cuisine_type, flavor_profile, notes, created_at, proteins, cooking_method, main_carb, dietary_tags, dairy_components, produce')
      .order('created_at', { ascending: false })

    if (!error && data) setRecipes(data)
    setLoading(false)
  }

  const resetForm = () => {
    setName('')
    setCuisineType('')
    setFlavorProfile('')
    setNotes('')
    setProteins([])
    setCookingMethod(null)
    setMainCarb(null)
    setDietaryTags([])
    setDairyComponents([])
    setProduce([])
    setAiApplied(false)
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
      cuisine_type:     cuisineType             || null,
      flavor_profile:   flavorProfile           || null,
      notes:            notes.trim()            || null,
      is_wildcard:      false,
      proteins:         proteins.length         ? proteins         : null,
      cooking_method:   cookingMethod           || null,
      main_carb:        mainCarb                || null,
      dietary_tags:     dietaryTags.length      ? dietaryTags      : null,
      dairy_components: dairyComponents.length  ? dairyComponents  : null,
      produce:          produce.length          ? produce          : null,
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

  const toggleExpand = (id) => setExpandedId(prev => prev === id ? null : id)

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
                <div className="text-[10px] text-amber-500 font-medium">No API key — add VITE_ANTHROPIC_API_KEY to .env</div>
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
                <div className="text-[10px] text-red-400 font-medium">AI failed — check console</div>
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
              <ChipPicker options={PROTEIN_OPTIONS} value={proteins} onChange={setProteins} multi />
            </FieldSection>

            <FieldSection label="Cooking method">
              <ChipPicker options={COOKING_METHOD_OPTIONS} value={cookingMethod} onChange={setCookingMethod} multi={false} />
            </FieldSection>

            <FieldSection label="Main carb">
              <ChipPicker options={CARB_OPTIONS} value={mainCarb} onChange={setMainCarb} multi={false} />
            </FieldSection>

            <FieldSection label="Dietary tags">
              <ChipPicker options={DIETARY_OPTIONS} value={dietaryTags} onChange={setDietaryTags} multi />
            </FieldSection>

            <FieldSection label="Dairy">
              <ChipPicker options={DAIRY_OPTIONS} value={dairyComponents} onChange={setDairyComponents} multi />
            </FieldSection>

            <FieldSection label="Produce">
              <ChipPicker options={PRODUCE_OPTIONS} value={produce} onChange={setProduce} multi />
            </FieldSection>

            {/* Notes */}
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
                <p className="text-base font-medium text-gray-900 truncate leading-tight group-hover:text-brand-600 transition-colors">
                  {recipe.name}
                </p>
                {/* Card subtitle: cuisine · cooking method · proteins */}
                <div className="flex flex-wrap gap-x-1.5 mt-1">
                  {[
                    recipe.cuisine_type,
                    recipe.cooking_method,
                    ...(recipe.proteins || []).filter(p => p !== 'None').slice(0, 2),
                  ].filter(Boolean).map((item, i) => (
                    <span key={item} className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      {i > 0 && '· '}{item}
                    </span>
                  ))}
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
              <div className="mt-4 pt-4 border-t border-cream-100 space-y-2.5">
                <ComponentRow label="Protein"  values={recipe.proteins} />
                <ComponentRow label="Carb"     values={recipe.main_carb ? [recipe.main_carb] : []} />
                <ComponentRow label="Method"   values={recipe.cooking_method ? [recipe.cooking_method] : []} />
                <ComponentRow label="Flavor"   values={recipe.flavor_profile ? [recipe.flavor_profile] : []} />
                <ComponentRow label="Diet"     values={recipe.dietary_tags} />
                <ComponentRow label="Dairy"    values={recipe.dairy_components} />
                <ComponentRow label="Produce"  values={recipe.produce} />

                {recipe.notes && (
                  <div className="bg-cream-50 rounded-xl p-3 border border-cream-100 mt-3">
                    <p className="text-xs text-gray-600 leading-relaxed font-serif italic">{recipe.notes}</p>
                  </div>
                )}

                <button
                  onClick={() => handleDelete(recipe.id)}
                  className="flex items-center gap-1.5 text-[10px] font-bold text-red-400/80 uppercase tracking-widest hover:text-red-500 transition-colors pt-1"
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
