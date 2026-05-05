import { useState } from 'react'
import { Sparkles, Loader2, X, Camera, Image as ImageIcon } from 'lucide-react'
import { analyzeRecipe } from '../../lib/analyzeRecipe'
import { normalizeMealName, toTitleCase } from '../../lib/mealNameNormalize'
import { useHaptics } from '../../hooks/useHaptics'
import ChipPicker from './ChipPicker'
import MealNameConfirmSheet from '../../components/MealNameConfirmSheet'
import {
  CUISINE_OPTIONS, FLAVOR_OPTIONS, PROTEIN_OPTIONS,
  COOKING_METHOD_OPTIONS, CARB_OPTIONS, DIETARY_OPTIONS,
  DAIRY_OPTIONS, VEGETABLE_OPTIONS, FRUIT_OPTIONS,
  PREP_TIME_BUCKETS, bucketForMinutes,
} from '../../lib/constants'

const PREP_TIME_LABELS = PREP_TIME_BUCKETS.map(b => b.label)
const labelToStoredValue = (label) =>
  PREP_TIME_BUCKETS.find(b => b.label === label)?.storedValue ?? null
const labelForMinutes = (minutes) => {
  const id = bucketForMinutes(minutes)
  return id == null ? null : PREP_TIME_BUCKETS.find(b => b.id === id)?.label ?? null
}

/**
 * RecipeForm — the add-recipe form. Owns its own draft state, the AI-suggest
 * lifecycle, and the image-upload preview. On submit it calls back into the
 * page which dispatches to useVault.addRecipe; on `{ ok: true }` we reset
 * the form (the page is responsible for hiding it).
 *
 * Extracted from Vault.jsx in PRD-001 P0.9 (Phase 3 Step 2). The JSX, the
 * field set, and the AI-suggest behavior are byte-identical to the previous
 * inline definition.
 */
function FieldSection({ label, children }) {
  return (
    <div className="space-y-2">
      <p className="section-heading">{label}</p>
      {children}
    </div>
  )
}

export default function RecipeForm({
  saving,
  extrasByCategory,
  onAddExtra,
  onSubmit,
}) {
  const { trigger } = useHaptics()

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
  // PRD-002 P0.4: prep time stored as the bucket's representative integer
  // (or null when no chip is selected).
  const [prepTimeMinutes, setPrepTimeMinutes] = useState(null)
  // PRD-004 Phase C (P0.8): when AI analyze runs, store the classification
  // result so it flows through to the vault insert.
  const [ingredientsClassified, setIngredientsClassified] = useState(null)

  const [imageFile, setImageFile]       = useState(null)
  const [imagePreview, setImagePreview] = useState(null)

  const [suggesting, setSuggesting] = useState(false)
  const [aiApplied, setAiApplied]   = useState(false)
  const [aiError, setAiError]       = useState(false)

  // Spell-check confirmation state. Set when the normalize-meal-name API
  // returns a corrected name that differs from the user's input — the
  // confirm sheet asks the user which to use before persisting.
  const [nameConfirm, setNameConfirm] = useState(null) // { original, corrected }
  const [normalizing, setNormalizing] = useState(false)

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
    setAiApplied(false)
  }

  const handleManualSuggest = async () => {
    if (!name.trim() && !recipeUrl.trim() && !imageFile) return
    if (suggesting) return
    trigger('light')
    setSuggesting(true)
    setAiError(false)

    // For AI suggestion, we'd need to convert file to base64 or URL
    // This assumes backend handles URLs or we implement base64 conversion
    const s = await analyzeRecipe({
      name: name.trim(),
      url: recipeUrl.trim()
    })

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
      // PRD-002 P0.4: AI-estimated prep time only fills the chip when the
      // user hasn't already selected one — manual edits always win.
      if (s.prep_time_minutes != null && prepTimeMinutes == null) {
        setPrepTimeMinutes(s.prep_time_minutes)
      }
      setIngredientsClassified(s.ingredients_classified ?? null)
      setAiApplied(true)
    } else {
      setAiError(true)
    }
    setSuggesting(false)
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
    setPrepTimeMinutes(null)
    setIngredientsClassified(null)
    setAiApplied(false)
    setAiError(false)
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImageFile(null)
    setImagePreview(null)
  }

  // Persist the form using the supplied final name (already normalized).
  const persist = async (finalName) => {
    const result = await onSubmit({
      name: finalName,
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
      ingredientsClassified,
    })
    if (result?.ok) resetForm()
  }

  const handleSubmit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (normalizing) return

    setNormalizing(true)
    const { corrected, hasChanges } = await normalizeMealName(trimmed)
    setNormalizing(false)

    if (hasChanges) {
      // Open the confirm sheet — persist happens in onAccept / onReject.
      setNameConfirm({ original: trimmed, corrected })
      return
    }

    // No spelling/casing changes — corrected is already title-cased.
    await persist(corrected || toTitleCase(trimmed))
  }

  const handleConfirmAccept = async () => {
    if (!nameConfirm) return
    const finalName = nameConfirm.corrected
    setNameConfirm(null)
    await persist(finalName)
  }

  const handleConfirmReject = async () => {
    if (!nameConfirm) return
    // User kept their version — still apply local title-case so casing is
    // standardized even when they reject the spell-check suggestion.
    const finalName = toTitleCase(nameConfirm.original)
    setNameConfirm(null)
    await persist(finalName)
  }

  return (
    <div className="card space-y-5 border-brand-100 bg-brand-50/30 backdrop-blur-sm">

      {/* Form header with AI status */}
      <div className="flex items-center justify-between gap-3">
        <p className="section-heading text-brand-700">Add a new recipe</p>
        {suggesting && (
          <div className="flex items-center gap-1.5 text-xs text-brand-700 font-medium">
            <Loader2 size={12} className="animate-spin" />
            Analyzing…
          </div>
        )}
        {aiApplied && !suggesting && (
          <div className="flex items-center gap-1 text-xs text-brand-700 font-medium">
            <Sparkles size={12} />
            AI filled — tweak as needed
          </div>
        )}
        {aiError && !suggesting && (
          <p className="text-xs text-red-600 font-medium">Couldn't analyze. Fill manually.</p>
        )}
      </div>

      {/* Base info for AI */}
      <div className="space-y-3">
        <input
          type="text"
          value={name}
          onChange={e => { setName(e.target.value); setAiApplied(false) }}
          placeholder="Recipe name (e.g. Thai meatball soup)"
          className="input-base"
        />
        <div className="flex gap-2">
          <input
            type="url"
            value={recipeUrl}
            onChange={e => { setRecipeUrl(e.target.value); setAiApplied(false) }}
            placeholder="Recipe URL (optional)"
            className="input-base flex-1"
          />
          <div className="relative">
            <button
              type="button"
              className={`h-full border rounded-xl px-4 flex items-center justify-center transition-colors relative overflow-hidden ${
                imagePreview ? 'bg-brand-50 border-brand-500 text-brand-600' : 'bg-white border-cream-200 text-brand-500 hover:bg-brand-50'
              }`}
              title="Upload recipe image"
              aria-label="Upload recipe image"
            >
              {imagePreview ? <ImageIcon size={20} /> : <Camera size={20} />}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={handleImageUpload}
              />
            </button>
          </div>
        </div>

        {imagePreview && (
          <div className="relative inline-block mt-4 mb-2">
            <img
              src={imagePreview}
              alt="Preview"
              className="h-32 w-32 object-cover rounded-xl shadow-sm border border-cream-200"
            />
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(imagePreview)
                setImageFile(null)
                setImagePreview(null)
              }}
              aria-label="Remove image"
              className="absolute -top-2 -right-2 bg-white text-gray-700 rounded-full p-1 shadow-sm border border-cream-100 hover:text-red-600 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={handleManualSuggest}
          disabled={suggesting || (!name.trim() && !recipeUrl.trim() && !imageFile)}
          className="btn-secondary inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {suggesting ? (
            <><Loader2 size={16} className="animate-spin" /> Analyzing…</>
          ) : (
            <><Sparkles size={16} /> Auto-fill Components</>
          )}
        </button>
      </div>

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
        <ChipPicker options={PROTEIN_OPTIONS} value={proteins} onChange={setProteins} multi category="proteins" extras={extrasByCategory.proteins || []} onExtraAdded={onAddExtra} />
      </FieldSection>

      <FieldSection label="Cooking method">
        <ChipPicker options={COOKING_METHOD_OPTIONS} value={cookingMethod} onChange={setCookingMethod} multi={false} category="cooking_method" extras={extrasByCategory.cooking_method || []} onExtraAdded={onAddExtra} />
      </FieldSection>

      <FieldSection label="Main carb">
        <ChipPicker options={CARB_OPTIONS} value={mainCarb} onChange={setMainCarb} multi={false} category="main_carb" extras={extrasByCategory.main_carb || []} onExtraAdded={onAddExtra} />
      </FieldSection>

      <FieldSection label="Dietary tags">
        <ChipPicker options={DIETARY_OPTIONS} value={dietaryTags} onChange={setDietaryTags} multi category="dietary_tags" extras={extrasByCategory.dietary_tags || []} onExtraAdded={onAddExtra} />
      </FieldSection>

      <FieldSection label="Dairy">
        <ChipPicker options={DAIRY_OPTIONS} value={dairyComponents} onChange={setDairyComponents} multi category="dairy_components" extras={extrasByCategory.dairy_components || []} onExtraAdded={onAddExtra} />
      </FieldSection>

      <FieldSection label="Vegetables">
        <ChipPicker options={VEGETABLE_OPTIONS} value={vegetables} onChange={setVegetables} multi category="vegetables" extras={extrasByCategory.vegetables || []} onExtraAdded={onAddExtra} />
      </FieldSection>

      <FieldSection label="Fruit">
        <ChipPicker options={FRUIT_OPTIONS} value={fruits} onChange={setFruits} multi category="fruits" extras={extrasByCategory.fruits || []} onExtraAdded={onAddExtra} />
      </FieldSection>

      <FieldSection label="Prep time">
        <ChipPicker
          options={PREP_TIME_LABELS}
          value={labelForMinutes(prepTimeMinutes)}
          onChange={(label) => setPrepTimeMinutes(label ? labelToStoredValue(label) : null)}
          multi={false}
          allowCustom={false}
        />
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
        onClick={handleSubmit}
        disabled={!name.trim() || saving || normalizing}
        className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving…' : normalizing ? 'Checking spelling…' : 'Save to vault'}
      </button>

      <MealNameConfirmSheet
        isOpen={!!nameConfirm}
        original={nameConfirm?.original || ''}
        corrected={nameConfirm?.corrected || ''}
        onAccept={handleConfirmAccept}
        onReject={handleConfirmReject}
        onClose={handleConfirmReject}
      />
    </div>
  )
}
