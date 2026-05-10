import { useState, useEffect, useMemo } from 'react'
import {
  PointerSensor,
  useSensor,
  useSensors,
  TouchSensor,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { supabase } from '../../lib/supabase'
import { useHaptics } from '../../hooks/useHaptics'
import { getRecommendations } from '../../lib/recommendations'
import { buildLastWeekSlots } from '../../lib/lastWeekSlots'
import { fetchMostRecentPlan, fetchCurrentLeftovers, classifyPlanState, listUserPeriods } from '../../lib/mealPlanReader'
import { getPreferences } from '../../lib/preferences'
import {
  createServedPlan,
  setItemCooked,
  finalizePlan,
  startNewPeriod,
  scheduleShortlistItem,
  moveItemToShortlist,
  deleteMealPlanItem,
  resetCurrentPlan,
} from '../../lib/mealPlanWriter'
import { AI_CANDIDATE_COUNT } from '../../lib/constants'

// --- Module-level constants ------------------------------------------------

const PLAN_HORIZON_MAX_DAYS = 14
const DEFAULT_SELECTION_COUNT = 5
// The legacy seed shape: prefer Sun–Thu (a full work week) when available.
const DEFAULT_WEEKDAY_PREFERENCE = [0, 1, 2, 3, 4] // Sun, Mon, Tue, Wed, Thu
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

// --- Module-level helpers (also exported for child components) -------------

export function formatLocalYmd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n)
}

export function shortWeekday(ymd) {
  return parseYmd(ymd).toLocaleDateString(undefined, { weekday: 'short' })
}

export function shortDateLabel(ymd) {
  return parseYmd(ymd).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

// Expand each {period_start, period_end} into the inclusive set of YYYY-MM-DD
// strings it covers. Used to disable date-strip cells for periods that already
// exist (active, finalized, or future-scheduled).
export function expandPeriodDates(periods, { excludePlanId, plan } = {}) {
  const out = new Set()
  for (const p of periods) {
    if (excludePlanId && p.id === excludePlanId) continue
    if (!p.period_start || !p.period_end) continue
    const start = parseYmd(p.period_start)
    const end = parseYmd(p.period_end)
    let cursor = start
    while (cursor <= end) {
      out.add(formatLocalYmd(cursor))
      cursor = addDays(cursor, 1)
    }
  }
  // The currently-loaded plan's own dates shouldn't disable themselves while
  // we're restoring it (the user may want to re-edit if it isn't finalized).
  if (plan?.scheduledDates) {
    for (const d of plan.scheduledDates) out.delete(d)
  }
  return out
}

// Pick the next N upcoming non-disabled dates whose weekday matches the
// preferred shape. We walk the visible horizon greedily, preferring weekdays
// from `preferredWeekdays` (in order). Falls back to any non-disabled date if
// the preferred set runs out.
export function pickDefaultDates(today, disabled, count = DEFAULT_SELECTION_COUNT) {
  const horizon = []
  for (let i = 0; i < PLAN_HORIZON_MAX_DAYS; i++) {
    const ymd = formatLocalYmd(addDays(today, i))
    if (!disabled.has(ymd)) horizon.push(ymd)
  }
  const picked = []
  // First pass: take dates whose weekday is in the preferred set.
  for (const ymd of horizon) {
    if (picked.length === count) break
    const dow = parseYmd(ymd).getDay()
    if (DEFAULT_WEEKDAY_PREFERENCE.includes(dow)) picked.push(ymd)
  }
  // Second pass: top up with any remaining non-disabled dates.
  for (const ymd of horizon) {
    if (picked.length === count) break
    if (!picked.includes(ymd)) picked.push(ymd)
  }
  return picked.sort()
}

// One-time migration from the legacy `brainstorm_plan_days` weekday list to
// the new `brainstorm_plan_dates` date list. Maps each stored weekday to the
// next non-disabled occurrence within the horizon. Returns sorted YYYY-MM-DD.
export function migrateLegacyWeekdayDates(weekdayList, today, disabled) {
  if (!Array.isArray(weekdayList) || weekdayList.length === 0) return []
  const horizonDates = []
  for (let i = 0; i < PLAN_HORIZON_MAX_DAYS; i++) {
    horizonDates.push(addDays(today, i))
  }
  const used = new Set()
  const out = []
  for (const day of weekdayList) {
    const wantDow = WEEKDAY_INDEX[day]
    if (wantDow === undefined) continue
    for (const dt of horizonDates) {
      if (dt.getDay() !== wantDow) continue
      const ymd = formatLocalYmd(dt)
      if (used.has(ymd) || disabled.has(ymd)) continue
      used.add(ymd)
      out.push(ymd)
      break
    }
  }
  return out.sort()
}

// Pair each suggestion with a date. `dates` must be sorted ascending.
export function buildPlan(suggestions, dates) {
  return dates.map((scheduled_date, i) => ({
    scheduled_date,
    name:        suggestions[i]?.name || 'Add meals to your Cookbook to get suggestions',
    id:          suggestions[i]?.id || null,
    is_wildcard: suggestions[i]?.is_wildcard || false,
    source_url:  suggestions[i]?.source_url || null,
    // PRD-002 P0.9: carry the recommender's source tag through so the
    // SortableMealItem render path can show the "New" badge correctly.
    source:      suggestions[i]?.source || null,
  }))
}

export function hasRealMeal(slot) {
  return slot.name && !slot.name.startsWith('Add meals to your Cookbook')
}

// --- Hook ------------------------------------------------------------------

export function useBrainstorm(userId) {
  const [lastWeek, setLastWeek] = useState([])
  const [plan, setPlan] = useState(() => {
    try {
      const saved = localStorage.getItem('brainstorm_plan')
      const parsed = saved ? JSON.parse(saved) : []
      // Defensive: only restore if items have scheduled_date (the new shape).
      // Legacy `brainstorm_plan` blobs from pre-Phase-8 used `day` and would
      // crash the new render path — drop them.
      return Array.isArray(parsed) && parsed.every((s) => s?.scheduled_date)
        ? parsed
        : []
    } catch { return [] }
  })
  const [vault, setVault] = useState([])
  const [storedRecentMeals, setStoredRecentMeals] = useState([])
  const [selectedDates, setSelectedDates] = useState(() => {
    try {
      const saved = localStorage.getItem('brainstorm_plan_dates')
      const parsed = saved ? JSON.parse(saved) : null
      return Array.isArray(parsed) ? [...parsed].sort() : []
    } catch { return [] }
  })
  const [disabledDates, setDisabledDates] = useState(() => new Set())

  // Serve state
  const [isServed, setIsServed]       = useState(false)
  const [servedAt, setServedAt]       = useState(null)
  const [servingPlan, setServingPlan] = useState(false)
  const { trigger } = useHaptics()
  const [serveError, setServeError]   = useState(null)
  const [justServed, setJustServed]   = useState(false)
  const [serveSheetOpen, setServeSheetOpen] = useState(false)
  const [groceriesOpen, setGroceriesOpen] = useState(false)

  // ADR-001 Phase 4: end-of-period review surface.
  const [loadedPlan, setLoadedPlan] = useState(null)
  const [planState, setPlanState]   = useState('no_plan')
  const [showReview, setShowReview] = useState(false)
  const [lockingIn, setLockingIn]   = useState(false)
  const [periodError, setPeriodError] = useState(null)

  // ADR-001 Phase 5: two-stage modal flow for starting a new period from the
  // gap-day view. 'idle' means no modal open.
  const [newPeriodStep, setNewPeriodStep] = useState('idle')
  const [pendingRange, setPendingRange] = useState(null)
  const [pendingLeftovers, setPendingLeftovers] = useState([])
  const [startingPeriod, setStartingPeriod] = useState(false)
  const [startPeriodError, setStartPeriodError] = useState(null)

  useEffect(() => {
    if (!isServed) {
      localStorage.setItem('brainstorm_plan', JSON.stringify(plan))
    }
  }, [plan, isServed])

  useEffect(() => {
    localStorage.setItem('brainstorm_plan_dates', JSON.stringify(selectedDates))
  }, [selectedDates])

  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)

  // PRD-002 P0.6: "Maybe" / shortlist state.
  // - activeTab toggles between the day-grid view and the shortlist tray.
  // - shortlist holds the active period's is_shortlisted=TRUE rows.
  // - scheduleSheetItem is the shortlist row currently in the day-picker sheet
  //   (null when the sheet is closed).
  const [activeTab, setActiveTab] = useState('thisWeek')
  const [shortlist, setShortlist] = useState([])
  const [scheduleSheetItem, setScheduleSheetItem] = useState(null)
  const [shortlistError, setShortlistError] = useState(null)

  // PRD-002 P0.7: a tap on a day cell or its "+" sets pickerDate, which opens
  // the DayPicker sheet anchored to that date.
  const [pickerDate, setPickerDate] = useState(null)

  // Reset-current-plan flow: confirm sheet + in-flight + error.
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetError, setResetError] = useState(null)

  // PRD-002 P0.3: household preferences are read once on mount and forwarded
  // to every getRecommendations() call (hard filter) and to the swap-suggestions
  // POST body (so the AI prompt also gets them). null means "no filtering" —
  // both on first paint (before fetch resolves) and on getPreferences error;
  // either way the picker still opens, just without the hard filter.
  const [preferences, setPreferences] = useState(null)

  // PRD-002 P0.8: track the prior batch so "regenerate" / single-slot picks
  // exclude items already shown. Vault hits go through getRecommendations'
  // excludeIds; AI candidate names from the brainstorm-load are forwarded to
  // /api/swap-suggestions via fetchSwapSuggestions(excludeNames).
  const [lastBatchVaultIds, setLastBatchVaultIds] = useState([])
  const [lastBatchAiNames,  setLastBatchAiNames]  = useState([])

  // PRD-002 P0.7: PointerSensor distance is 8px so a single tap on a day cell
  // never starts a drag. TouchSensor uses a delay-based constraint already.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    })
  )

  useEffect(() => {
    loadData(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchSwapSuggestions = async (currentPlan, recentMeals, excludeNames = [], count = AI_CANDIDATE_COUNT, prefs = null) => {
    const planNames = currentPlan.map(s => s.name).filter(n => n && !n.includes('Add meals')).join(', ')
    const recentNames = recentMeals.slice(0, 14).map(m => m.name).join(', ')
    // PRD-002 P0.8: excludeNames is forwarded as a string[] so the server can
    // both render a bulleted "do not suggest" prompt and post-filter responses.
    const excludeNamesArr = excludeNames.filter(Boolean)

    let res
    try {
      res = await fetch('/api/swap-suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // PRD-002 P0.9: `count` lets the recommender ask for AI_CANDIDATE_COUNT
        // suggestions instead of the API's default of 1.
        // PRD-002 P0.3: forward `preferences` so the system prompt can ask the
        // model to honor dietary restrictions / exclusions / max prep time.
        body: JSON.stringify({ planNames, recentNames, excludeNames: excludeNamesArr, count, preferences: prefs }),
      })
    } catch (e) {
      console.error('[fetchSwapSuggestions] fetch failed:', e)
      return []
    }

    if (!res.ok) return []

    const data = await res.json()
    const names = Array.isArray(data.names) ? data.names : []

    return names.slice(0, count).map((name, i) => ({
      id: `ai-suggestion-${i}`,
      name,
      is_wildcard: true,
      source_url: `https://www.allrecipes.com/search?q=${encodeURIComponent(name)}`,
    }))
  }

  const loadData = async (forceRegenerate = false) => {
    setLoading(true)

    const today = new Date()
    const ninetyDaysAgo = addDays(today, -90)

    let periods = []
    try {
      periods = await listUserPeriods(supabase, userId)
    } catch {
      periods = []
    }

    // PRD-002 P0.3: pull household preferences once per load so every
    // getRecommendations() / fetchSwapSuggestions() call below can hard-filter
    // against them. On error we proceed with prefs=null (no filtering) — the
    // picker should never fail to open over a missing preferences row.
    let prefs = null
    try {
      prefs = await getPreferences(userId, supabase)
    } catch (err) {
      console.warn('[BrainstormMode] getPreferences failed; continuing without preferences', err)
    }
    setPreferences(prefs)

    const [mealsRes, vaultRes, planRes] = await Promise.all([
      supabase
        .from('meals')
        .select('id, name, cuisine_type, flavor_profile, vault_id, eaten_on')
        .eq('user_id', userId)
        .gte('eaten_on', formatLocalYmd(ninetyDaysAgo))
        .order('eaten_on', { ascending: false }),
      // PRD-001 P0.5: filter soft-deleted vault rows out of brainstorm /
      // recommendation candidates.
      supabase
        .from('vault')
        .select('id, name, cuisine_type, flavor_profile, is_wildcard, proteins, cooking_method, main_carb, vegetables, dairy_components, fruits, family_rating, prep_time_minutes, ingredients_classified')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      fetchMostRecentPlan(supabase, userId),
    ])

    const recentMeals = mealsRes.data || []
    const vaultItems = vaultRes.data || []
    const mostRecentPlan = planRes.plan

    setVault(vaultItems)

    // Last-week panel: bound to the immediately prior planning period when one
    // exists, otherwise the last 7 calendar days ending today (local). AUDIT U3.
    const todayYmd = formatLocalYmd(today)
    const priorPeriod = periods
      .filter((p) => p.period_end && p.period_end < todayYmd)
      .reduce(
        (best, p) => (!best || p.period_end > best.period_end ? p : best),
        null,
      )
    setLastWeek(buildLastWeekSlots(recentMeals, priorPeriod, today))

    setStoredRecentMeals(recentMeals)

    const state = classifyPlanState(mostRecentPlan, today)
    setPlanState(state)
    setLoadedPlan(mostRecentPlan)

    // Compute disabled dates for the strip picker. The currently-loaded
    // active/ended_unfinalized plan's own dates are NOT disabled (the user is
    // editing that plan). Future-scheduled and finalized periods always block.
    const disabled = expandPeriodDates(periods, {
      plan:
        state === 'active' || state === 'ended_unfinalized'
          ? mostRecentPlan
          : null,
    })
    // Past dates can't be planned even though the constraint doesn't block
    // them — the strip only renders today+0..+13 anyway. We don't pre-mark
    // them since they're not in the visible horizon.
    setDisabledDates(disabled)

    // PRD-002 P0.6: shortlist tray reflects the active plan's shortlisted rows.
    setShortlist(mostRecentPlan?.shortlist ?? [])

    if (state === 'active' || state === 'ended_unfinalized') {
      // Restore the served plan as authoritative; lock the UI
      localStorage.removeItem('brainstorm_plan')
      setPlan(mostRecentPlan.items)
      setSelectedDates(mostRecentPlan.scheduledDates ?? [])
      setServedAt(mostRecentPlan.served_at)
      setIsServed(true)
    } else {
      setIsServed(false)
      setServedAt(null)

      // Determine selection seed.
      let seed = selectedDates
      // Drop any past or now-disabled dates from the persisted selection.
      seed = seed.filter((d) => d >= todayYmd && !disabled.has(d))

      if (seed.length === 0) {
        const legacyRaw = localStorage.getItem('brainstorm_plan_days')
        if (legacyRaw) {
          try {
            const legacy = JSON.parse(legacyRaw)
            seed = migrateLegacyWeekdayDates(legacy, today, disabled)
          } catch {
            seed = []
          }
          // Migrate-once: clear the old key whether or not it parsed.
          localStorage.removeItem('brainstorm_plan_days')
        }
      }
      if (seed.length === 0) {
        seed = pickDefaultDates(today, disabled)
      }

      const sortedSeed = [...seed].sort()
      setSelectedDates(sortedSeed)

      if (forceRegenerate || plan.length === 0 || seed.length !== plan.length) {
        const servedMeals = mostRecentPlan?.items ?? []
        // PRD-002 P0.8: forward prior-batch names so the AI doesn't re-suggest
        // anything we already showed in the previous regeneration.
        const aiExcludeNames = [
          ...lastBatchAiNames,
          ...plan.map(s => s.name).filter(Boolean),
        ]
        // Pull fresh AI candidates from /api/swap-suggestions to mix alongside
        // vault hits. fetchSwapSuggestions returns [] on failure, so the
        // recommendation engine silently falls back to 100% vault picks.
        const wildcardCandidates = await fetchSwapSuggestions(plan, recentMeals, aiExcludeNames, AI_CANDIDATE_COUNT, prefs)
        // PRD-002 P0.8: union of current plan ids + last batch ids so the
        // engine never returns a recipe that's already in the plan or that
        // we just suggested in the prior regeneration.
        const excludeIds = [
          ...plan.map(s => s.id).filter(Boolean),
          ...lastBatchVaultIds,
        ]
        const suggestions = getRecommendations(
          vaultItems,
          recentMeals,
          wildcardCandidates,
          sortedSeed.length,
          servedMeals,
          // PRD-002 P0.3: hard-filter the result against household preferences.
          { excludeIds, preferences: prefs },
        )
        // PRD-002 P0.8: snapshot what we just returned so the next regeneration
        // can exclude it.
        setLastBatchVaultIds(suggestions.filter(s => !s.is_wildcard).map(s => s.id).filter(Boolean))
        setLastBatchAiNames(suggestions.filter(s => s.is_wildcard).map(s => s.name).filter(Boolean))
        setPlan(buildPlan(suggestions, sortedSeed))
      }
    }

    setLoading(false)
  }

  // Optimistic cooked-toggle for items in the served plan list.
  const handleToggleCooked = async (itemId, nextCooked) => {
    trigger('light')
    setPeriodError(null)
    setPlan((prev) =>
      prev.map((slot) =>
        slot.item_id === itemId ? { ...slot, cooked: nextCooked } : slot,
      ),
    )
    try {
      await setItemCooked(supabase, itemId, nextCooked)
    } catch {
      setPlan((prev) =>
        prev.map((slot) =>
          slot.item_id === itemId ? { ...slot, cooked: !nextCooked } : slot,
        ),
      )
      setPeriodError('Could not save cooked status. Try again.')
    }
  }

  // PRD-002 P0.6: shortlist handlers ------------------------------------
  // Shortlist rows live on the active meal_plan, so every action is gated on
  // an existing loadedPlan.id. Pre-serve, the bookmark affordance is hidden.

  const handleScheduleFromShortlist = async (item, date) => {
    if (!item?.item_id || !date) return
    setShortlistError(null)
    trigger('light')
    try {
      await scheduleShortlistItem(supabase, item.item_id, date)
      setScheduleSheetItem(null)
      await loadData(false)
    } catch {
      setShortlistError('Could not schedule. Try again.')
    }
  }

  const handleRemoveShortlist = async (item) => {
    if (!item?.item_id) return
    setShortlistError(null)
    try {
      await deleteMealPlanItem(supabase, item.item_id)
      setScheduleSheetItem(null)
      setShortlist((prev) => prev.filter((s) => s.item_id !== item.item_id))
    } catch {
      setShortlistError('Could not remove. Try again.')
    }
  }

  const handleMoveToMaybe = async (itemId) => {
    if (!itemId) return
    trigger('light')
    setShortlistError(null)
    try {
      await moveItemToShortlist(supabase, itemId)
      await loadData(false)
    } catch {
      setShortlistError('Could not move to Maybe. Try again.')
    }
  }

  const handleLockInAsIs = async () => {
    if (!loadedPlan?.id || lockingIn) return
    setLockingIn(true)
    setPeriodError(null)
    try {
      await finalizePlan(supabase, loadedPlan.id)
      await loadData(false)
    } catch {
      setPeriodError('Could not finalize plan. Try again.')
    } finally {
      setLockingIn(false)
    }
  }

  const handleReviewFinalized = async () => {
    setShowReview(false)
    await loadData(false)
  }

  const handleResetPlan = async () => {
    if (!canResetPlan || resetting) return
    setResetting(true)
    setResetError(null)
    try {
      const { deleted } = await resetCurrentPlan(supabase, loadedPlan.id)
      if (!deleted) {
        setResetError('Could not reset plan (it may already be locked). Try refreshing.')
        return
      }
      trigger('medium')
      setShowResetConfirm(false)
      // Eagerly clear served state before loadData so the UI doesn't flash
      // back to the "Served on…" banner if the reload finds an older plan.
      setIsServed(false)
      setServedAt(null)
      setLoadedPlan(null)
      // Wipe local-storage seeds so the post-reset page starts from a true
      // clean slate (no stale draft plan or selected dates).
      localStorage.removeItem('brainstorm_plan')
      localStorage.removeItem('brainstorm_plan_dates')
      setPlan([])
      setSelectedDates([])
      await loadData(true)
    } catch {
      setResetError('Could not reset plan. Try again.')
    } finally {
      setResetting(false)
    }
  }

  // Toggle a date in the strip. Adds a new slot (with a fresh recommendation)
  // when selecting; removes the matching slot when deselecting.
  const handleToggleDate = (ymd) => {
    if (isServed) return
    setSelectedDates((prev) => {
      if (prev.includes(ymd)) {
        const next = prev.filter((d) => d !== ymd).sort()
        setPlan((curr) => curr.filter((slot) => slot.scheduled_date !== ymd))
        return next
      }
      const next = [...prev, ymd].sort()
      setPlan((curr) => {
        if (curr.find((slot) => slot.scheduled_date === ymd)) return curr
        // PRD-002 P0.8: hard-exclude current-plan + last-batch ids in the
        // engine itself rather than picking-then-filtering. Single-slot picks
        // stay 100% vault — wildcards only flow through the brainstorm-load
        // path (see PRD-001 P0.8).
        const excludeIds = [
          ...curr.map((s) => s.id).filter(Boolean),
          ...lastBatchVaultIds,
        ]
        const sugg = getRecommendations(
          vault,
          storedRecentMeals,
          [],
          1,
          loadedPlan?.items ?? [],
          // PRD-002 P0.3: single-slot picks honor the same hard filter.
          { excludeIds, preferences },
        )[0]
        const newSlot = {
          scheduled_date: ymd,
          name: sugg?.name || 'Add meals to your Cookbook to get suggestions',
          id: sugg?.id || null,
          is_wildcard: sugg?.is_wildcard || false,
          source_url: sugg?.source_url || null,
          source: sugg?.source || null,
        }
        return [...curr, newSlot].sort((a, b) =>
          a.scheduled_date.localeCompare(b.scheduled_date),
        )
      })
      return next
    })
  }

  // PRD-002 P0.7: opening the day picker. Tapping an empty cell or the "+"
  // affordance on a filled cell sets pickerDate. The DayPicker component
  // owns its own data fetch and DB writes; on success it calls onScheduled
  // which closes the sheet and refetches the plan from Supabase.
  const handleOpenPicker = (date) => {
    if (!date) return
    setPickerDate(date)
  }

  const handlePickerScheduled = async (preServeItem) => {
    setPickerDate(null)
    if (preServeItem && !loadedPlan?.id) {
      // Pre-serve pick: update the local plan slot without touching the DB.
      setPlan(prev => prev.map(slot =>
        slot.scheduled_date === pickerDate
          ? {
              scheduled_date: pickerDate,
              name:        preServeItem.name,
              id:          preServeItem.id ?? null,
              is_wildcard: !!preServeItem.is_wildcard,
              source_url:  preServeItem.source_url ?? null,
              source:      preServeItem.source ?? null,
            }
          : slot
      ))
      return
    }
    await loadData(false)
  }

  const handleDragEnd = (event) => {
    if (isServed) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    trigger('light')
    setPlan((items) => {
      const oldIndex = items.findIndex((item) => item.scheduled_date === active.id)
      const newIndex = items.findIndex((item) => item.scheduled_date === over.id)
      if (oldIndex < 0 || newIndex < 0) return items

      // Dates stay fixed in chronological order; meals swap between dates.
      const reorderedMeals = arrayMove(
        items.map((i) => ({
          name: i.name,
          id: i.id,
          is_wildcard: i.is_wildcard,
          source_url: i.source_url ?? null,
          source: i.source ?? null,
        })),
        oldIndex,
        newIndex,
      )
      return items.map((item, index) => ({
        ...item,
        name:        reorderedMeals[index].name,
        id:          reorderedMeals[index].id,
        is_wildcard: reorderedMeals[index].is_wildcard,
        source_url:  reorderedMeals[index].source_url || null,
        source:      reorderedMeals[index].source || null,
      }))
    })
  }

  const handleServe = () => {
    if (isServed || servingPlan || !canServe) return
    setServeSheetOpen(true)
  }

  const commitServe = async (feedback) => {
    setServeSheetOpen(false)
    setServingPlan(true)
    trigger('medium')

    try {
      const items = plan.map((slot) => ({
        scheduled_date: slot.scheduled_date,
        name: slot.name,
        id: slot.id,
        is_wildcard: slot.is_wildcard,
        source_url: slot.source_url,
      }))
      const { served_at } = await createServedPlan(supabase, userId, items, { feedback })
      setServedAt(served_at)
      setIsServed(true)
      setJustServed(true)
      localStorage.removeItem('brainstorm_plan')
      // Refresh disabled dates so the just-served period blocks itself if the
      // user immediately tries to plan more (rare but possible mid-session).
      try {
        const periods = await listUserPeriods(supabase, userId)
        setDisabledDates(expandPeriodDates(periods))
      } catch {
        // best-effort
      }
    } catch (err) {
      if (err?.code === 'period_overlap') {
        setServeError('These dates overlap with a plan you already served. Pick different dates.')
      } else {
        setServeError('Could not save plan. Try again.')
      }
    } finally {
      setServingPlan(false)
    }
  }

  // --- New-period flow (ADR-001 Phase 5) ---------------------------------
  const openNewPeriodFlow = async () => {
    setStartPeriodError(null)
    try {
      const rows = await fetchCurrentLeftovers(supabase, userId)
      setPendingLeftovers(rows)
    } catch {
      setPendingLeftovers([])
    }
    setNewPeriodStep('pick-dates')
  }

  const handleDateRangeConfirm = ({ periodStart, periodEnd }) => {
    setPendingRange({ periodStart, periodEnd })
    if (pendingLeftovers.length === 0) {
      commitNewPeriod({ periodStart, periodEnd }, [])
    } else {
      setNewPeriodStep('pick-leftovers')
    }
  }

  const handleDateRangeCancel = () => {
    setNewPeriodStep('idle')
    setPendingRange(null)
    setPendingLeftovers([])
    setStartPeriodError(null)
  }

  const handleLeftoverBack = () => {
    setNewPeriodStep('pick-dates')
  }

  const commitNewPeriod = async (range, selectedIds) => {
    if (!range) return
    setStartingPeriod(true)
    setStartPeriodError(null)
    try {
      await startNewPeriod(
        supabase,
        userId,
        range.periodStart,
        range.periodEnd,
        selectedIds,
      )
      setNewPeriodStep('idle')
      setPendingRange(null)
      setPendingLeftovers([])
      await loadData(false)
    } catch (err) {
      if (err?.code === 'period_overlap') {
        setStartPeriodError('That range overlaps with an existing plan.')
        setNewPeriodStep('pick-dates')
      } else {
        setStartPeriodError('Could not start new period. Try again.')
      }
    } finally {
      setStartingPeriod(false)
    }
  }

  const handleLeftoverConfirm = (selectedIds) => {
    commitNewPeriod(pendingRange, selectedIds)
  }

  // --- Memos ---------------------------------------------------------------

  // Plan is servable when at least one date is selected and every selected
  // date has a real meal. The picker prevents selecting into existing periods,
  // so no overlap gate is needed in the button.
  const canServe = useMemo(() => {
    if (selectedDates.length === 0) return false
    if (plan.length === 0) return false
    return plan.every(hasRealMeal)
  }, [plan, selectedDates])

  // Reset clears the loaded period entirely (deletes meal_plans row; items
  // cascade). Only enabled when the loaded plan is the most recent and not
  // yet finalized — past periods are read-only history.
  const canResetPlan = !!loadedPlan?.id && !loadedPlan?.finalized_at && isServed

  // PRD-002 P0.7: dates rendered in the day grid.
  // Pre-serve: the user's selected dates from the strip picker.
  // Post-serve: every date in the active period (so empty days get a tappable
  // placeholder, not just dates with scheduled rows).
  const dayGridDates = useMemo(() => {
    if (
      isServed &&
      loadedPlan?.period_start &&
      loadedPlan?.period_end
    ) {
      const out = []
      let cursor = parseYmd(loadedPlan.period_start)
      const end = parseYmd(loadedPlan.period_end)
      while (cursor <= end) {
        out.push(formatLocalYmd(cursor))
        cursor = addDays(cursor, 1)
      }
      return out
    }
    return [...selectedDates].sort()
  }, [isServed, loadedPlan, selectedDates])

  // PRD-002 P0.7: bucket plan slots by scheduled_date so each DayCell can
  // render its own list of items. Pre-serve every date has 0 or 1; post-serve
  // a date can hold multiple after the picker inserts a second meal.
  const itemsByDate = useMemo(() => {
    const map = new Map()
    for (const slot of plan) {
      if (!slot.scheduled_date) continue
      const arr = map.get(slot.scheduled_date) ?? []
      arr.push(slot)
      map.set(slot.scheduled_date, arr)
    }
    return map
  }, [plan])

  return {
    // Data state
    loading,
    vault,
    lastWeek,
    plan,
    selectedDates,
    disabledDates,
    loadedPlan,
    planState,
    shortlist,
    preferences,
    storedRecentMeals,
    // UI state
    isServed,
    servedAt,
    servingPlan,
    serveError,
    justServed, setJustServed,
    serveSheetOpen, setServeSheetOpen,
    groceriesOpen, setGroceriesOpen,
    showReview, setShowReview,
    lockingIn,
    periodError,
    newPeriodStep,
    pendingRange,
    pendingLeftovers,
    startingPeriod,
    startPeriodError,
    sharing, setSharing,
    activeTab, setActiveTab,
    scheduleSheetItem, setScheduleSheetItem,
    shortlistError,
    pickerDate, setPickerDate,
    showResetConfirm, setShowResetConfirm,
    resetting,
    resetError, setResetError,
    // Memoized values
    canServe,
    dayGridDates,
    itemsByDate,
    canResetPlan,
    // Configuration
    sensors,
    // Action handlers
    loadData,
    handleToggleCooked,
    handleScheduleFromShortlist,
    handleRemoveShortlist,
    handleMoveToMaybe,
    handleLockInAsIs,
    handleReviewFinalized,
    handleResetPlan,
    handleToggleDate,
    handleOpenPicker,
    handlePickerScheduled,
    handleDragEnd,
    handleServe,
    commitServe,
    openNewPeriodFlow,
    handleDateRangeConfirm,
    handleDateRangeCancel,
    handleLeftoverBack,
    handleLeftoverConfirm,
  }
}
