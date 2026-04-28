import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  CUISINE_OPTIONS,
  DIETARY_RESTRICTIONS,
  MAX_PREP_TIME_BUCKETS,
} from '../../lib/constants'
import { getPreferences, upsertPreferences } from '../../lib/preferences'
import { passesPreferences } from '../../lib/preferenceFilter'
import {
  getActivePeriodItems,
  deleteMealPlanItems,
} from '../../lib/mealPlanItems'
import ChipPicker from '../../pages/Vault/ChipPicker'

/**
 * Preferences page (PRD-002 P0.2). Per-section auto-save: each chip toggle,
 * ingredient add/remove, or prep-time bucket choice fires its own
 * `upsertPreferences(userId, { [field]: value })` patch. Local state updates
 * optimistically; on error we revert and surface an inline message.
 *
 * Wired into the existing page-state router in App.jsx as `page === 'settings'`
 * — no react-router yet (PRD-003 P0.11 will swap this for a real route).
 */

const SAVED_FLASH_MS = 1500

// How many violator names to render inline before truncating with "+ N more".
const VIOLATOR_NAMES_VISIBLE = 6

// Cuisine list lives in constants as a string[]; the chip picker's items API
// wants { id, label }. id === label here because the DB column stores the
// human-readable cuisine string verbatim (matches vault.cuisine_type values).
const CUISINE_ITEMS = CUISINE_OPTIONS.map(c => ({ id: c, label: c }))

function bucketIdForMinutes(minutes) {
  const match = MAX_PREP_TIME_BUCKETS.find(b => b.storedValue === (minutes ?? null))
  return match ? match.id : null
}

export default function Preferences({ userId }) {
  const [prefs, setPrefs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [savedField, setSavedField] = useState(null)        // field name flashed as "Saved"
  const [errorField, setErrorField] = useState(null)        // field name with active error
  const [ingredientDraft, setIngredientDraft] = useState('')
  // PRD-002 P0.12: violators banner state. `null` when there's nothing to
  // show; the shape is { items: [{ id, name }] } when the most recent
  // upsert revealed active-period meals that violate the new preferences.
  const [violatorsBanner, setViolatorsBanner] = useState(null)
  const [removingViolators, setRemovingViolators] = useState(false)

  // Track per-field "saved" timeouts so a rapid second save resets the flash.
  const savedTimerRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    getPreferences(userId, supabase)
      .then(data => {
        if (cancelled) return
        setPrefs(data)
        setLoadError(null)
      })
      .catch(err => {
        if (cancelled) return
        setLoadError(err.message || 'Could not load preferences.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId])

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
  }, [])

  const flashSaved = (field) => {
    setSavedField(field)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setSavedField(null), SAVED_FLASH_MS)
  }

  // Optimistic auto-save. `nextValue` is what the field becomes; on success we
  // accept the server's row (which may have normalized the value, e.g. ingredients).
  // On error we revert to `previousValue` and surface an inline message.
  const saveField = async (field, nextValue, previousValue) => {
    setPrefs(p => ({ ...p, [field]: nextValue }))
    setErrorField(null)
    let updated
    try {
      updated = await upsertPreferences(userId, { [field]: nextValue }, supabase)
      setPrefs(p => ({ ...p, ...updated }))
      flashSaved(field)
    } catch {
      // Local state reverted; preferences didn't change in the DB, so we
      // intentionally do NOT run the violator check here.
      setPrefs(p => ({ ...p, [field]: previousValue }))
      setErrorField(field)
      return
    }
    // PRD-002 P0.12: after every successful upsert, check the active-period
    // items against the new preferences. The banner replaces (not stacks)
    // on repeated changes — a clean run with zero violators clears any
    // stale banner.
    try {
      const items = await getActivePeriodItems(userId, supabase)
      const violators = items.filter(it => !passesPreferences(it, updated))
      if (violators.length > 0) {
        setViolatorsBanner({
          items: violators.map(v => ({ id: v.id, name: v.name })),
        })
      } else {
        setViolatorsBanner(null)
      }
    } catch (err) {
      // Don't fail the upsert flow on a check failure — leave whatever
      // banner state we already had alone.
      console.warn('Failed to check active-period items against new preferences:', err)
    }
  }

  const dismissViolators = () => setViolatorsBanner(null)

  const removeAllViolators = async () => {
    if (!violatorsBanner || removingViolators) return
    const ids = violatorsBanner.items.map(i => i.id)
    setRemovingViolators(true)
    try {
      await deleteMealPlanItems(ids, supabase)
      setViolatorsBanner(null)
    } catch (err) {
      console.warn('Failed to delete violator meal_plan_items:', err)
    } finally {
      setRemovingViolators(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-brand-500" size={32} />
        <span className="sr-only">Loading preferences…</span>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-cream-50 px-5 py-10">
        <div className="px-4 py-3 bg-red-50 text-red-600 text-sm rounded-xl border border-red-100">
          {loadError}
        </div>
      </div>
    )
  }

  const dietary = prefs.dietary_restrictions || []
  const excludedCuisines = prefs.excluded_cuisines || []
  const excludedIngredients = prefs.excluded_ingredients || []
  const maxPrepBucketId = bucketIdForMinutes(prefs.max_prep_time_minutes)

  const onDietaryChange = (next) => {
    saveField('dietary_restrictions', next, dietary)
  }

  const onCuisinesChange = (next) => {
    saveField('excluded_cuisines', next, excludedCuisines)
  }

  const submitIngredient = () => {
    const raw = ingredientDraft.trim().toLowerCase()
    if (!raw) return
    if (excludedIngredients.includes(raw)) {
      setIngredientDraft('')
      return
    }
    const next = [...excludedIngredients, raw]
    setIngredientDraft('')
    saveField('excluded_ingredients', next, excludedIngredients)
  }

  const onIngredientKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      submitIngredient()
    }
  }

  const removeIngredient = (ing) => {
    const next = excludedIngredients.filter(v => v !== ing)
    saveField('excluded_ingredients', next, excludedIngredients)
  }

  const onPrepBucketChange = (nextId) => {
    const bucket = MAX_PREP_TIME_BUCKETS.find(b => b.id === nextId)
    const nextValue = bucket ? bucket.storedValue : null
    saveField('max_prep_time_minutes', nextValue, prefs.max_prep_time_minutes ?? null)
  }

  // TODO: Convert to /settings/preferences route when PRD-003 P0.11 ships react-router.
  return (
    <div className="min-h-screen bg-cream-50 pb-32">
      <header className="px-5 pt-[max(20px,env(safe-area-inset-top))] pb-4">
        <h1 className="text-sm text-brand-600 font-bold tracking-widest uppercase">Settings</h1>
        <p className="text-2xl text-gray-900 font-serif italic mt-1">Preferences</p>
        <p className="text-xs text-gray-500 mt-2">
          These rules filter every brainstorm. Changes save automatically.
        </p>
      </header>

      <div className="px-5 space-y-8">
        {violatorsBanner && (
          <ViolatorsBanner
            items={violatorsBanner.items}
            onKeep={dismissViolators}
            onRemoveAll={removeAllViolators}
            removing={removingViolators}
          />
        )}

        <Section
          field="dietary_restrictions"
          label="Dietary restrictions"
          savedField={savedField}
          errorField={errorField}
        >
          <ChipPicker
            items={DIETARY_RESTRICTIONS}
            value={dietary}
            onChange={onDietaryChange}
            multi
            allowCustom={false}
            ariaLabel="Dietary restrictions"
          />
          {/* PRD-002 P0.3: in v1 only protein-based restrictions are
              actually enforced by the recommender's hard filter; the rest
              are stored + surfaced here, but use Excluded ingredients to
              be specific. */}
          <p className="text-sm text-gray-500 italic mt-2">
            Vegetarian, vegan, and pescatarian are enforced via the recipe's
            protein. Other restrictions are stored but not yet enforced — use
            Excluded ingredients to be specific.
          </p>
        </Section>

        <Section
          field="excluded_cuisines"
          label="Excluded cuisines"
          savedField={savedField}
          errorField={errorField}
        >
          <ChipPicker
            items={CUISINE_ITEMS}
            value={excludedCuisines}
            onChange={onCuisinesChange}
            multi
            allowCustom={false}
            ariaLabel="Excluded cuisines"
          />
        </Section>

        <Section
          field="excluded_ingredients"
          label="Excluded ingredients"
          savedField={savedField}
          errorField={errorField}
        >
          <input
            type="text"
            value={ingredientDraft}
            onChange={e => setIngredientDraft(e.target.value)}
            onKeyDown={onIngredientKeyDown}
            placeholder="e.g., cilantro, mushrooms"
            aria-label="Add excluded ingredient"
            className="w-full px-3 py-2 text-sm border border-cream-200 rounded-xl outline-none focus:ring-1 focus:ring-brand-400 bg-white"
          />
          {excludedIngredients.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2" role="list" aria-label="Excluded ingredients list">
              {excludedIngredients.map(ing => (
                <span
                  key={ing}
                  role="listitem"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-brand-500 text-white border border-brand-500"
                >
                  {ing}
                  <button
                    type="button"
                    onClick={() => removeIngredient(ing)}
                    aria-label={`Remove ${ing}`}
                    className="text-white/80 hover:text-white"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Section>

        <Section
          field="max_prep_time_minutes"
          label="Max prep time"
          savedField={savedField}
          errorField={errorField}
        >
          <ChipPicker
            items={MAX_PREP_TIME_BUCKETS}
            value={maxPrepBucketId}
            onChange={onPrepBucketChange}
            multi={false}
            allowCustom={false}
            ariaLabel="Max prep time"
          />
        </Section>
      </div>
    </div>
  )
}

function ViolatorsBanner({ items, onKeep, onRemoveAll, removing }) {
  const count = items.length
  const visible = items.slice(0, VIOLATOR_NAMES_VISIBLE)
  const overflow = count - visible.length

  return (
    <div
      role="alert"
      className="px-4 py-3 bg-amber-50 text-amber-900 ring-1 ring-amber-200 rounded-xl"
    >
      <p className="text-sm font-medium">
        {count} {count === 1 ? 'meal' : 'meals'} {count === 1 ? "doesn't" : "don't"} match your current preferences:
      </p>
      <p className="text-xs text-amber-800 mt-1">
        {visible.map(v => v.name).join(', ')}
        {overflow > 0 && <span className="ml-1 italic">+ {overflow} more</span>}
      </p>
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={onKeep}
          aria-label="Keep these meals in the active period"
          className="px-3 py-1.5 text-xs font-medium bg-white text-amber-900 ring-1 ring-amber-200 rounded-full hover:bg-amber-100"
        >
          Keep
        </button>
        <button
          type="button"
          onClick={onRemoveAll}
          disabled={removing}
          aria-label="Remove all violating meals from the active period"
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-full hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {removing
            ? <Loader2 size={12} className="animate-spin" />
            : <AlertTriangle size={12} />
          }
          {removing ? 'Removing…' : 'Remove all'}
        </button>
      </div>
    </div>
  )
}

function Section({ field, label, savedField, errorField, children }) {
  const isSaved = savedField === field
  const isError = errorField === field
  return (
    <section aria-labelledby={`pref-${field}-label`}>
      <div className="flex items-center justify-between mb-2">
        <h2
          id={`pref-${field}-label`}
          className="text-xs font-bold tracking-widest uppercase text-gray-600"
        >
          {label}
        </h2>
        {isSaved && (
          <span
            className="text-[11px] font-medium text-brand-600 transition-opacity"
            role="status"
          >
            Saved
          </span>
        )}
      </div>
      {children}
      {isError && (
        <p className="text-xs text-red-500 mt-2" role="alert">
          Couldn't save — try again.
        </p>
      )}
    </section>
  )
}
