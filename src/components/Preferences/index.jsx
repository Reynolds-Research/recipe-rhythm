import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronRight, Loader2, RefreshCw, X } from 'lucide-react'
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
import { loadUpcomingMeals, removeMeals } from '../../lib/plannedMeals'
import { isNewPrepTableEnabled } from '../../lib/featureFlags'
import {
  fillMissingIngredients, loadMissingIngredients, loadLinkedGuesses, readLinkedRecipes,
} from '../../lib/recipeIngredients'
import ChipPicker from '../../pages/Vault/ChipPicker'
import Logo from '../Logo'
import { useHaptics } from '../../hooks/useHaptics'

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

export default function Preferences({ userId, onOpenAbout }) {
  const { trigger } = useHaptics()
  const [prefs, setPrefs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [savedField, setSavedField] = useState(null)        // field name flashed as "Saved"
  const [errorField, setErrorField] = useState(null)        // field name with active error
  const [ingredientDraft, setIngredientDraft] = useState('')
  const [stapleDraft, setStapleDraft] = useState('')
  const [adultsDraft, setAdultsDraft] = useState('')
  const [childrenDraft, setChildrenDraft] = useState('')
  // PRD-002 P0.12: violators banner state. `null` when there's nothing to
  // show; the shape is { items: [{ id, name }] } when the most recent
  // upsert revealed active-period meals that violate the new preferences.
  const [violatorsBanner, setViolatorsBanner] = useState(null)
  const [removingViolators, setRemovingViolators] = useState(false)
  // Recipes with no ingredient list (the grocery list skips them), and the
  // one-tap fill that estimates them. Replaced the old "re-extract every
  // recipe" button (PRD-006 D1), which also rewrote recipes that were fine.
  const [missing, setMissing] = useState(null)        // recipes with no list, once loaded
  const [fillState, setFillState] = useState({ running: false, current: 0, total: 0, result: null })
  // Recipes with a saved link whose amounts are still a guess, and the one-tap
  // read of their recipe pages (2026-11-06: the links were saved but never opened).
  const [linked, setLinked] = useState(null)
  const [linkState, setLinkState] = useState({ running: false, current: 0, total: 0, result: null })

  useEffect(() => {
    let cancelled = false
    loadMissingIngredients(supabase, userId)
      .then((rows) => { if (!cancelled) setMissing(rows) })
      .catch((err) => console.warn('[Preferences] missing ingredients: load failed', err?.message || err))
    Promise.resolve()
      .then(() => loadLinkedGuesses(supabase, userId))
      .then((rows) => { if (!cancelled) setLinked(rows) })
      .catch((err) => console.warn('[Preferences] linked recipes: load failed', err?.message || err))
    return () => { cancelled = true }
  }, [userId])

  // Track per-field "saved" timeouts so a rapid second save resets the flash.
  const savedTimerRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    getPreferences(userId, supabase)
      .then(data => {
        if (cancelled) return
        setPrefs(data)
        setAdultsDraft(String(data.adults ?? 2))
        setChildrenDraft(String(data.children ?? 0))
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
      // PRD-008 2c: with the new Prep Table on, check uncooked meals dated
      // today or later (not Maybes, not past meals); off, the old active period.
      const items = isNewPrepTableEnabled()
        ? await loadUpcomingMeals(supabase, userId)
        : await getActivePeriodItems(userId, supabase)
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
      if (isNewPrepTableEnabled()) await removeMeals(supabase, ids)
      else await deleteMealPlanItems(ids, supabase)
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
        <Loader2 className="animate-spin text-brand-700" size={32} />
        <span className="sr-only">Loading preferences…</span>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-cream-50 px-5 py-10">
        <div className="px-4 py-3 bg-red-50 text-red-700 text-sm rounded-xl border border-red-100">
          {loadError}
        </div>
      </div>
    )
  }

  const dietary = prefs.dietary_restrictions || []
  const excludedCuisines = prefs.excluded_cuisines || []
  const excludedIngredients = prefs.excluded_ingredients || []
  const pantryStaples = prefs.pantry_staples || []
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
    trigger('selection')
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
    trigger('selection')
    const next = excludedIngredients.filter(v => v !== ing)
    saveField('excluded_ingredients', next, excludedIngredients)
  }

  const submitStaple = () => {
    const raw = stapleDraft.trim().toLowerCase()
    if (!raw) return
    if (pantryStaples.includes(raw)) {
      setStapleDraft('')
      return
    }
    trigger('selection')
    const next = [...pantryStaples, raw]
    setStapleDraft('')
    saveField('pantry_staples', next, pantryStaples)
  }

  const onStapleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      submitStaple()
    }
  }

  const removeStaple = (item) => {
    trigger('selection')
    const next = pantryStaples.filter(v => v !== item)
    saveField('pantry_staples', next, pantryStaples)
  }

  const onPrepBucketChange = (nextId) => {
    const bucket = MAX_PREP_TIME_BUCKETS.find(b => b.id === nextId)
    const nextValue = bucket ? bucket.storedValue : null
    saveField('max_prep_time_minutes', nextValue, prefs.max_prep_time_minutes ?? null)
  }

  const onAdultsBlur = () => {
    const next = parseInt(adultsDraft, 10)
    if (!Number.isInteger(next) || next < 1) {
      setAdultsDraft(String(prefs.adults ?? 2))
      return
    }
    if (next === (prefs.adults ?? 2)) return
    trigger('selection')
    saveField('adults', next, prefs.adults ?? 2)
  }

  const onChildrenBlur = () => {
    const next = parseInt(childrenDraft, 10)
    if (!Number.isInteger(next) || next < 0) {
      setChildrenDraft(String(prefs.children ?? 0))
      return
    }
    if (next === (prefs.children ?? 0)) return
    trigger('selection')
    saveField('children', next, prefs.children ?? 0)
  }

  // Estimate the ingredient list for every recipe that has none. Recipes that
  // already have a list are never touched.
  const runFillMissing = async () => {
    if (fillState.running) return
    setFillState({ running: true, current: 0, total: missing?.length ?? 0, result: null })
    let result = null
    try {
      result = await fillMissingIngredients(supabase, userId, {
        onProgress: ({ current, total }) => setFillState((s) => ({ ...s, current, total })),
      })
    } catch (err) {
      console.error('[Preferences] fill missing ingredients failed', err)
    }
    const left = await loadMissingIngredients(supabase, userId).catch(() => null)
    if (left) setMissing(left)
    setFillState({ running: false, current: 0, total: 0, result: result ?? { filled: [], failed: ['all'] } })
  }


  // Read the real amounts from every linked recipe's page. Only lists read
  // from a page are written; sites that refuse are named for screenshots.
  const runReadLinks = async () => {
    if (linkState.running) return
    setLinkState({ running: true, current: 0, total: linked?.length ?? 0, result: null })
    let result = null
    try {
      result = await readLinkedRecipes(supabase, userId, {
        onProgress: ({ current, total }) => setLinkState((s) => ({ ...s, current, total })),
      })
    } catch (err) {
      console.error('[Preferences] read linked recipes failed', err)
    }
    const left = await loadLinkedGuesses(supabase, userId).catch(() => null)
    if (left) setLinked(left)
    setLinkState({ running: false, current: 0, total: 0, result: result ?? { read: [], needScreenshots: [], failed: ['all'] } })
  }

  // TODO: Convert to /settings/preferences route when PRD-003 P0.11 ships react-router.
  return (
    <div className="min-h-screen bg-cream-50 pb-32">
      <header className="bg-cream-100/30 border-b border-cream-100 px-5 py-5 text-center flex flex-col items-center pt-[max(20px,env(safe-area-inset-top))]">
        <Logo className="w-8 h-8 mb-2" />
        <h1 className="text-sm text-brand-700 font-bold tracking-widest uppercase">For My Wife</h1>
        <p className="text-lg text-gray-900 mt-1 font-serif italic">Preferences</p>
        <p className="helper-text mt-2">
          These rules filter every brainstorm. Changes save automatically.
        </p>
      </header>

      <div className="px-5 pt-5 space-y-8">
        {violatorsBanner && (
          <ViolatorsBanner
            items={violatorsBanner.items}
            onKeep={dismissViolators}
            onRemoveAll={removeAllViolators}
            removing={removingViolators}
            planned={isNewPrepTableEnabled()}
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
          <p className="helper-text italic mt-2">
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
            className="input-base"
          />
          {excludedIngredients.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2" role="list" aria-label="Excluded ingredients list">
              {excludedIngredients.map(ing => (
                <span
                  key={ing}
                  role="listitem"
                  className="chip chip-selected"
                >
                  {ing}
                  <button
                    type="button"
                    onClick={() => removeIngredient(ing)}
                    aria-label={`Remove ${ing}`}
                    className="text-white/80 hover:text-white ml-1"
                  >
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="helper-text italic mt-2">
            Recipes are hidden only when an excluded ingredient is{' '}
            <span className="font-semibold not-italic">essential</span> to the dish —
            recipes that just mention it are still shown.
          </p>
        </Section>

        <Section
          field="pantry_staples"
          label="Pantry staples"
          savedField={savedField}
          errorField={errorField}
        >
          <input
            type="text"
            value={stapleDraft}
            onChange={e => setStapleDraft(e.target.value)}
            onKeyDown={onStapleKeyDown}
            placeholder="e.g., olive oil, salt, garlic"
            aria-label="Add pantry staple"
            className="input-base"
          />
          {pantryStaples.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2" role="list" aria-label="Pantry staples list">
              {pantryStaples.map(item => (
                <span
                  key={item}
                  role="listitem"
                  className="chip chip-selected"
                >
                  {item}
                  <button
                    type="button"
                    onClick={() => removeStaple(item)}
                    aria-label={`Remove ${item}`}
                    className="text-white/80 hover:text-white ml-1"
                  >
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="helper-text italic mt-2">
            Items you always have on hand. They'll be skipped on generated grocery lists.
          </p>
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

        <Section
          fields={['adults', 'children']}
          label="Household size"
          savedField={savedField}
          errorField={errorField}
        >
          <p className="helper-text mb-3">
            Used to scale grocery list quantities (PRD-006 Bite γ).
          </p>
          <div className="flex flex-col gap-3">
            <label className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-700">Adults</span>
              <input
                type="number"
                min={1}
                step={1}
                value={adultsDraft}
                onChange={e => setAdultsDraft(e.target.value)}
                onBlur={onAdultsBlur}
                aria-label="Number of adults"
                className="input-base w-20 text-center"
              />
            </label>
            <label className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-700">Children</span>
              <input
                type="number"
                min={0}
                step={1}
                value={childrenDraft}
                onChange={e => setChildrenDraft(e.target.value)}
                onBlur={onChildrenBlur}
                aria-label="Number of children"
                className="input-base w-20 text-center"
              />
            </label>
          </div>
        </Section>

        {(linked?.length > 0 || linkState.result) && (
          <section aria-labelledby="pref-links-label">
            <h2 id="pref-links-label" className="section-heading mb-2">Recipes to read from their links</h2>
            {linked?.length > 0 && (
              <>
                <p className="helper-text mb-3">
                  These have a link, but their amounts are estimates: {linked.map((r) => r.name).join(', ')}.
                  Read the real amounts from each recipe page.
                </p>
                <button
                  type="button"
                  onClick={runReadLinks}
                  disabled={linkState.running}
                  className="inline-flex items-center gap-2 px-4 py-3 min-h-[44px] text-sm font-semibold bg-brand-700 text-white rounded-full hover:bg-brand-800 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {linkState.running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  {linkState.running
                    ? `Reading ${linkState.current} of ${linkState.total}…`
                    : `Read ${linked.length} recipe${linked.length === 1 ? '' : 's'} from their links`}
                </button>
              </>
            )}
            {linkState.result && !linkState.running && (
              <div role="status" className="text-sm mt-3 space-y-1 text-gray-900">
                <p>
                  {linkState.result.read.length > 0
                    ? `✓ Read the real amounts for ${linkState.result.read.length} recipe${linkState.result.read.length === 1 ? '' : 's'}.`
                    : 'No recipe pages could be read.'}
                </p>
                {linkState.result.needScreenshots.length > 0 && (
                  <p className="text-amber-800">
                    These sites don’t let apps read them, so add screenshots in the Cookbook:{' '}
                    {linkState.result.needScreenshots.map((r) => r.name).join(', ')}.
                  </p>
                )}
                {linkState.result.failed.length > 0 && (
                  <p className="text-amber-800">Some couldn’t be read; try again later.</p>
                )}
              </div>
            )}
          </section>
        )}

        {(missing?.length > 0 || fillState.result) && (
          <section aria-labelledby="pref-missing-label">
            <h2 id="pref-missing-label" className="section-heading mb-2">Recipes with no ingredient list</h2>
            {missing?.length > 0 && (
              <>
                <p className="helper-text mb-3">
                  The grocery list can’t include these: {missing.map((r) => r.name).join(', ')}.
                  Fill them in with AI estimates now, then add screenshots in the Cookbook for the real amounts.
                </p>
                <button
                  type="button"
                  onClick={runFillMissing}
                  disabled={fillState.running}
                  className="inline-flex items-center gap-2 px-4 py-3 min-h-[44px] text-sm font-semibold bg-brand-700 text-white rounded-full hover:bg-brand-800 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {fillState.running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  {fillState.running
                    ? `Filling ${fillState.current} of ${fillState.total}…`
                    : `Fill in ${missing.length} recipe${missing.length === 1 ? '' : 's'}`}
                </button>
              </>
            )}
            {fillState.result && !fillState.running && (
              <p role="status" className={`text-sm mt-3 ${fillState.result.failed.length ? 'text-amber-800' : 'text-gray-900'}`}>
                {fillState.result.filled.length > 0
                  ? `✓ Filled in ${fillState.result.filled.length} recipe${fillState.result.filled.length === 1 ? '' : 's'}.`
                  : 'Nothing was filled in.'}
                {fillState.result.failed.length > 0 && ' Some couldn’t be filled; try again later.'}
              </p>
            )}
          </section>
        )}
      </div>

      <div className="border-t border-cream-100 mt-4">
        <button
          type="button"
          onClick={onOpenAbout}
          aria-label="About this app"
          className="w-full flex items-center justify-between px-5 py-4 min-h-[44px] text-left hover:bg-cream-100/50 transition-colors"
        >
          <span className="body-text">A Love Letter to my Wife!</span>
          <ChevronRight size={18} className="text-gray-500" />
        </button>
      </div>
    </div>
  )
}

function ViolatorsBanner({ items, onKeep, onRemoveAll, removing, planned = false }) {
  const count = items.length
  const visible = items.slice(0, VIOLATOR_NAMES_VISIBLE)
  const overflow = count - visible.length

  return (
    <div
      role="alert"
      className="px-4 py-3 bg-amber-50 text-amber-900 ring-1 ring-amber-200 rounded-xl"
    >
      <p className="text-base font-semibold">
        {count} {count === 1 ? 'meal' : 'meals'} {count === 1 ? "doesn't" : "don't"} match your current preferences:
      </p>
      <p className="text-sm text-amber-900 mt-1">
        {visible.map(v => v.name).join(', ')}
        {overflow > 0 && <span className="ml-1 italic">+ {overflow} more</span>}
      </p>
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          onClick={onKeep}
          aria-label={planned ? 'Keep these planned meals' : 'Keep these meals in the active period'}
          className="px-4 py-3 min-h-[44px] text-sm font-semibold bg-white text-amber-900 ring-1 ring-amber-200 rounded-full hover:bg-amber-100"
        >
          Keep
        </button>
        <button
          type="button"
          onClick={onRemoveAll}
          disabled={removing}
          aria-label={planned ? 'Remove these meals from the plan' : 'Remove all violating meals from the active period'}
          className="inline-flex items-center gap-1.5 px-4 py-3 min-h-[44px] text-sm font-semibold bg-amber-700 text-white rounded-full hover:bg-amber-800 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {removing
            ? <Loader2 size={14} className="animate-spin" />
            : <AlertTriangle size={14} />
          }
          {removing ? 'Removing…' : 'Remove all'}
        </button>
      </div>
    </div>
  )
}

function Section({ field, fields, label, savedField, errorField, children }) {
  const fieldList = fields ?? (field ? [field] : [])
  const anchorId = fieldList[0] ?? 'section'
  const isSaved = fieldList.some(f => savedField === f)
  const isError = fieldList.some(f => errorField === f)
  return (
    <section aria-labelledby={`pref-${anchorId}-label`}>
      <div className="flex items-center justify-between mb-2">
        <h2
          id={`pref-${anchorId}-label`}
          className="section-heading"
        >
          {label}
        </h2>
        {isSaved && (
          <span
            className="text-sm font-semibold text-brand-700 transition-opacity"
            role="status"
          >
            Saved
          </span>
        )}
      </div>
      {children}
      {isError && (
        <p className="text-xs text-red-600 mt-2" role="alert">
          Couldn't save — try again.
        </p>
      )}
    </section>
  )
}
