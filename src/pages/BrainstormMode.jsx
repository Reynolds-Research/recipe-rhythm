import { useState, useEffect, useMemo } from 'react'
import { Share2, RefreshCw, GripVertical, Sparkles, ExternalLink, Check, Download, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Sheet } from 'react-modal-sheet'
import { useHaptics } from '../hooks/useHaptics'
import Logo from '../components/Logo'
import { getRecommendations } from '../lib/recommendations'
import { fetchMostRecentPlan, fetchCurrentLeftovers, classifyPlanState, listUserPeriods } from '../lib/mealPlanReader'
import { createServedPlan, setItemCooked, finalizePlan, startNewPeriod } from '../lib/mealPlanWriter'
import PeriodReview from './PeriodReview'
import GapDayView from '../components/GapDayView'
import DateRangePicker from '../components/DateRangePicker'
import LeftoverPicker from '../components/LeftoverPicker'
import DateStripPicker from '../components/DateStripPicker'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  TouchSensor,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

/**
 * BrainstormMode
 * Date-strip planning screen (ADR-001 Phase 8).
 * The user selects any subset of dates in the next 7–14 days; one meal is
 * recommended per selected date. Serving writes meal_plans + meal_plan_items
 * with period_start/period_end derived from the date set.
 */

const PLAN_HORIZON_MAX_DAYS = 14
const DEFAULT_SELECTION_COUNT = 5
// The legacy seed shape: prefer Sun–Thu (a full work week) when available.
const DEFAULT_WEEKDAY_PREFERENCE = [0, 1, 2, 3, 4] // Sun, Mon, Tue, Wed, Thu

function formatLocalYmd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n)
}

function shortWeekday(ymd) {
  return parseYmd(ymd).toLocaleDateString(undefined, { weekday: 'short' })
}

function shortDateLabel(ymd) {
  return parseYmd(ymd).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

// Expand each {period_start, period_end} into the inclusive set of YYYY-MM-DD
// strings it covers. Used to disable date-strip cells for periods that already
// exist (active, finalized, or future-scheduled).
function expandPeriodDates(periods, { excludePlanId, plan } = {}) {
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
function pickDefaultDates(today, disabled, count = DEFAULT_SELECTION_COUNT) {
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

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

// One-time migration from the legacy `brainstorm_plan_days` weekday list to
// the new `brainstorm_plan_dates` date list. Maps each stored weekday to the
// next non-disabled occurrence within the horizon. Returns sorted YYYY-MM-DD.
function migrateLegacyWeekdayDates(weekdayList, today, disabled) {
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

function SortableMealItem({ slot, onSwap, isServed, onToggleCooked }) {
  const showCookedToggle = isServed && !!onToggleCooked && !!slot.item_id
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: slot.scheduled_date })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
  }

  const dow = shortWeekday(slot.scheduled_date)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-4 py-4 bg-white ${
        isDragging ? 'opacity-50 shadow-lg relative rounded-xl border-brand-200' : ''
      }`}
    >
      <div
        {...(isServed ? {} : { ...attributes, ...listeners })}
        className={isServed ? 'text-gray-200 p-2.5 cursor-not-allowed -ml-1.5' : 'cursor-grab active:cursor-grabbing text-gray-300 hover:text-brand-400 p-2.5 -ml-1.5'}
      >
        <GripVertical size={18} strokeWidth={2} />
      </div>
      <span className="text-[11px] font-bold text-brand-400 w-8 flex-shrink-0 tracking-tighter uppercase">
        {dow}
      </span>
      <span
        className={`text-sm flex-1 min-w-0 font-medium leading-snug flex flex-col items-start gap-1 ${
          showCookedToggle && slot.cooked
            ? 'line-through text-gray-400'
            : 'text-gray-900'
        }`}
      >
        <span className="truncate w-full block">{slot.name}</span>
        {slot.is_wildcard && (
          <div className="flex items-center gap-1.5">
            <span className="bg-brand-100 text-brand-700 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter shadow-sm flex items-center gap-0.5">
              <Sparkles size={8} />
              Wildcard
            </span>
            {slot.source_url && (
              <a
                href={slot.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-400 hover:text-brand-600 transition-colors"
                title="View Recipe"
                aria-label={`View recipe for ${slot.name}`}
              >
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        )}
      </span>
      {showCookedToggle ? (
        <label className="flex-shrink-0 flex items-center gap-2 cursor-pointer">
          <span className="text-[11px] font-bold text-brand-600 uppercase tracking-wide">
            Cooked
          </span>
          <input
            type="checkbox"
            checked={!!slot.cooked}
            onChange={(e) => onToggleCooked(slot.item_id, e.target.checked)}
            aria-label={`Mark "${slot.name}" cooked`}
            className="h-5 w-5 rounded border-cream-200 text-brand-500 focus:ring-brand-300 focus:ring-2"
          />
        </label>
      ) : (
        <button
          onClick={() => onSwap(slot.scheduled_date)}
          disabled={isServed}
          className={`flex-shrink-0 text-[11px] font-bold text-brand-600 bg-brand-50 border border-brand-100 rounded-full px-3.5 py-1.5 uppercase tracking-wide hover:bg-brand-100 transition-colors ${isServed ? 'opacity-30 cursor-not-allowed pointer-events-none' : ''}`}
        >
          Swap
        </button>
      )}
    </div>
  )
}

export default function BrainstormMode({ userId }) {
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
  const [isServed, setIsServed]     = useState(false)
  const [servedAt, setServedAt]     = useState(null)
  const [servingPlan, setServingPlan]   = useState(false)
  const { trigger } = useHaptics()
  const [serveError, setServeError] = useState(null)

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

  const [swapDate, setSwapDate] = useState(null)
  const [swapSuggestions, setSwapSuggestions] = useState([])
  const [loadingSwap, setLoadingSwap] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)

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

  const fetchSwapSuggestions = async (currentPlan, recentMeals) => {
    const planNames = currentPlan.map(s => s.name).filter(n => n && !n.includes('Add meals')).join(', ')
    const recentNames = recentMeals.slice(0, 14).map(m => m.name).join(', ')

    let res
    try {
      res = await fetch('/api/swap-suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planNames, recentNames }),
      })
    } catch (e) {
      console.error('[fetchSwapSuggestions] fetch failed:', e)
      return []
    }

    if (!res.ok) return []

    const data = await res.json()
    const names = Array.isArray(data.names) ? data.names : []

    return names.slice(0, 3).map((name, i) => ({
      id: `ai-suggestion-${i}`,
      name,
      is_wildcard: true,
      source_url: `https://www.allrecipes.com/search?q=${encodeURIComponent(name)}`,
    }))
  }

  const loadData = async (forceRegenerate = false) => {
    setLoading(true)
    trigger('success')

    const today = new Date()
    const ninetyDaysAgo = addDays(today, -90)

    let periods = []
    try {
      periods = await listUserPeriods(supabase, userId)
    } catch {
      periods = []
    }

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
        .select('id, name, cuisine_type, flavor_profile, is_wildcard, proteins, cooking_method, main_carb, vegetables, dairy_components, fruits')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      fetchMostRecentPlan(supabase, userId),
    ])

    const recentMeals = mealsRes.data || []
    const vaultItems = vaultRes.data || []
    const mostRecentPlan = planRes.plan

    setVault(vaultItems)

    // Last week = meals from the past 7 days, mapped to Mon–Fri slots
    const sevenDaysAgo = addDays(today, -7)
    const lastWeekMeals = recentMeals.filter(
      m => new Date(m.eaten_on) >= sevenDaysAgo
    )
    setLastWeek(buildLastWeekSlots(lastWeekMeals))

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
      const todayYmd = formatLocalYmd(today)
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
        // Pull fresh AI candidates from /api/swap-suggestions to mix alongside
        // vault hits. fetchSwapSuggestions returns [] on failure, so the
        // recommendation engine silently falls back to 100% vault picks.
        const wildcardCandidates = await fetchSwapSuggestions(plan, recentMeals)
        const suggestions = getRecommendations(
          vaultItems,
          recentMeals,
          wildcardCandidates,
          sortedSeed.length,
          servedMeals,
        )
        setPlan(buildPlan(suggestions, sortedSeed))
      }
    }

    setLoading(false)
  }

  // Optimistic cooked-toggle for items in the served plan list.
  const handleToggleCooked = async (itemId, nextCooked) => {
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

  function buildLastWeekSlots(meals) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    return days.map(day => {
      const match = meals.find(m => {
        const d = new Date(m.eaten_on)
        return d.toLocaleDateString('en-US', { weekday: 'short' }) === day
      })
      return { day, name: match?.name || null }
    })
  }

  // Pair each suggestion with a date. `dates` must be sorted ascending.
  function buildPlan(suggestions, dates) {
    return dates.map((scheduled_date, i) => ({
      scheduled_date,
      name:        suggestions[i]?.name || 'Add meals to your Cookbook to get suggestions',
      id:          suggestions[i]?.id || null,
      is_wildcard: suggestions[i]?.is_wildcard || false,
      source_url:  suggestions[i]?.source_url || null,
    }))
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
        // Pick a single fresh recommendation that isn't already on the plan.
        const taken = new Set(curr.map((s) => s.id).filter(Boolean))
        // Single-slot picks stay 100% vault — wildcards only flow through the
        // brainstorm-load path. See PRD-001 P0.8.
        const sugg = getRecommendations(
          vault,
          storedRecentMeals,
          [],
          curr.length + 1,
          loadedPlan?.items ?? [],
        ).find((s) => !taken.has(s.id))
        const newSlot = {
          scheduled_date: ymd,
          name: sugg?.name || 'Add meals to your Cookbook to get suggestions',
          id: sugg?.id || null,
          is_wildcard: sugg?.is_wildcard || false,
          source_url: sugg?.source_url || null,
        }
        return [...curr, newSlot].sort((a, b) =>
          a.scheduled_date.localeCompare(b.scheduled_date),
        )
      })
      return next
    })
  }

  const openSwap = async (date) => {
    setSwapDate(date)
    setSwapSuggestions([])
    setLoadingSwap(true)
    const suggestions = await fetchSwapSuggestions(plan, storedRecentMeals)
    setSwapSuggestions(suggestions)
    setLoadingSwap(false)
  }

  const handleSwap = (date, vaultItem) => {
    setPlan(prev =>
      prev.map(slot =>
        slot.scheduled_date === date
          ? {
              ...slot,
              name: vaultItem.name,
              id: vaultItem.id,
              is_wildcard: vaultItem.is_wildcard || false,
              source_url: vaultItem.source_url || null
            }
          : slot
      )
    )
    setSwapDate(null)
  }

  const handleDragEnd = (event) => {
    if (isServed) return
    const { active, over } = event
    if (!over || active.id === over.id) return

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
      }))
    })
  }

  const hasRealMeal = (slot) =>
    slot.name && !slot.name.startsWith('Add meals to your Cookbook')

  // Plan is servable when at least one date is selected and every selected
  // date has a real meal. The picker prevents selecting into existing periods,
  // so no overlap gate is needed in the button.
  const canServe = useMemo(() => {
    if (selectedDates.length === 0) return false
    if (plan.length === 0) return false
    return plan.every(hasRealMeal)
  }, [plan, selectedDates])

  const handleServe = async () => {
    if (isServed || servingPlan || !canServe) return
    trigger('success')
    setServingPlan(true)

    try {
      const items = plan.map((slot) => ({
        scheduled_date: slot.scheduled_date,
        name: slot.name,
        id: slot.id,
        is_wildcard: slot.is_wildcard,
        source_url: slot.source_url,
      }))
      const { served_at } = await createServedPlan(supabase, userId, items)
      setServedAt(served_at)
      setIsServed(true)
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

  const handleShare = async () => {
    const text = [
      'Meal plan:',
      '',
      ...plan.map(slot => `${shortDateLabel(slot.scheduled_date)}: ${slot.name}`),
    ].join('\n')

    if (navigator.share) {
      setSharing(true)
      try {
        await navigator.share({ title: 'Meal plan', text })
      } catch {
        // User dismissed the share sheet — not an error
      }
      setSharing(false)
    } else {
      await navigator.clipboard.writeText(text)
      alert('Plan copied to clipboard!')
    }
  }

  const handleDownloadList = () => {
    const vaultItemsInPlan = plan.map(slot => vault.find(v => v.id === slot.id)).filter(Boolean)

    const categories = {
      Proteins: new Set(),
      Carbohydrates: new Set(),
      Vegetables: new Set(),
      Dairy: new Set(),
      Fruits: new Set()
    }

    vaultItemsInPlan.forEach(item => {
      if (item.proteins) item.proteins.forEach(p => p !== 'None' && categories.Proteins.add(p))
      if (item.main_carb && item.main_carb !== 'None') categories.Carbohydrates.add(item.main_carb)
      if (item.vegetables) item.vegetables.forEach(v => categories.Vegetables.add(v))
      if (item.dairy_components) item.dairy_components.forEach(v => categories.Dairy.add(v))
      if (item.fruits) item.fruits.forEach(v => categories.Fruits.add(v))
    })

    let text = `GROCERY LIST\nFor My Wife — Meal Plan\n\n[ MEALS ]\n`
    plan.forEach(slot => {
      text += `- ${shortDateLabel(slot.scheduled_date)}: ${slot.name}\n`
    })

    const catsToPrint = [
      { name: 'PROTEINS', set: categories.Proteins },
      { name: 'CARBOHYDRATES', set: categories.Carbohydrates },
      { name: 'VEGETABLES', set: categories.Vegetables },
      { name: 'DAIRY', set: categories.Dairy },
      { name: 'FRUITS', set: categories.Fruits }
    ]

    catsToPrint.forEach(cat => {
      if (cat.set.size > 0) {
        text += `\n[ ${cat.name} ]\n`
        Array.from(cat.set).sort().forEach(item => {
          text += `- ${item}\n`
        })
      }
    })

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'GroceryList.txt'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }


  if (loading) {
    return (
      <div className="mobile-screen items-center justify-center pb-28">
        <p className="text-sm text-gray-400">Building your plan…</p>
      </div>
    )
  }

  if (showReview && loadedPlan) {
    return (
      <PeriodReview
        plan={loadedPlan}
        userId={userId}
        showFinalizeButton={planState === 'ended_unfinalized'}
        onFinalized={handleReviewFinalized}
        onClose={() => setShowReview(false)}
      />
    )
  }

  if (planState === 'gap') {
    return (
      <>
        <GapDayView
          userId={userId}
          periodEnd={loadedPlan?.period_end ?? null}
          onStartNewPeriod={openNewPeriodFlow}
        />
        {startPeriodError && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-red-50 border border-red-200 rounded-xl px-4 py-2 shadow-lg">
            <p className="text-xs text-red-700">{startPeriodError}</p>
          </div>
        )}
        {newPeriodStep === 'pick-dates' && (
          <DateRangePicker
            userId={userId}
            onCancel={handleDateRangeCancel}
            onConfirm={handleDateRangeConfirm}
          />
        )}
        {newPeriodStep === 'pick-leftovers' && pendingRange && (
          <LeftoverPicker
            leftovers={pendingLeftovers}
            periodStart={pendingRange.periodStart}
            periodEnd={pendingRange.periodEnd}
            onBack={handleLeftoverBack}
            onConfirm={handleLeftoverConfirm}
          />
        )}
        {startingPeriod && (
          <div className="fixed inset-0 bg-black/30 z-[70] flex items-center justify-center">
            <div className="bg-white rounded-xl px-5 py-3 shadow-lg flex items-center gap-2">
              <Loader2 size={16} className="animate-spin text-brand-500" />
              <span className="text-sm text-gray-700">Starting new period…</span>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="mobile-screen pb-28">

      {/* Header */}
      <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-5 text-center flex flex-col items-center">
        <Logo className="w-8 h-8 mb-2" />
        <h1 className="text-sm text-brand-600 font-bold tracking-widest uppercase">For My Wife</h1>
        <p className="text-lg text-gray-900 mt-1 font-serif italic">Brainstorm meals</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* End-of-period prompt: shown when the period has ended but the user
            hasn't reviewed it yet. */}
        {planState === 'ended_unfinalized' && (
          <div
            role="region"
            aria-label="End of period review"
            className="bg-brand-50 border border-brand-200 rounded-2xl px-4 py-4 shadow-sm space-y-3"
          >
            <div>
              <p className="text-[11px] font-bold text-brand-500 tracking-widest uppercase mb-1">
                Your period has ended
              </p>
              <p className="text-sm text-gray-700">
                Mark what you actually cooked, then lock it in.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setShowReview(true)}
                className="btn-primary w-full"
              >
                Edit what you actually ate
              </button>
              <button
                onClick={handleLockInAsIs}
                disabled={lockingIn}
                className="w-full py-3 rounded-2xl border border-brand-200 bg-white text-sm font-semibold text-brand-600 hover:bg-brand-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {lockingIn ? (
                  <><Loader2 size={14} className="animate-spin" /> Finalizing…</>
                ) : (
                  'Lock in as-is'
                )}
              </button>
            </div>
            {periodError && (
              <p className="text-xs text-red-500 text-center">{periodError}</p>
            )}
          </div>
        )}

        {/* Last week's meals */}
        <div>
          <p className="text-[11px] font-bold text-gray-400 tracking-widest mb-3 uppercase">LAST WEEK'S MEALS</p>
          <div className="bg-white border border-cream-100 rounded-2xl px-5 divide-y divide-cream-50 shadow-sm">
            {lastWeek.map(({ day, name }) => (
              <div key={day} className="flex items-center gap-3 py-3">
                <span className="text-xs font-medium text-gray-400 w-8 flex-shrink-0">{day.toUpperCase()}</span>
                <span className={`text-sm flex-1 ${name ? 'text-gray-900' : 'text-gray-300'}`}>
                  {name || '—'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Date strip + plan */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold text-gray-400 tracking-widest uppercase">YOUR MEAL PLAN</p>
            <button
              onClick={() => loadData(true)}
              disabled={isServed}
              className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${isServed ? 'text-gray-300 cursor-not-allowed' : 'text-brand-500 hover:text-brand-600'}`}
            >
              <RefreshCw size={12} strokeWidth={2.5} />
              Regenerate
            </button>
          </div>

          {!isServed && (
            <DateStripPicker
              selectedDates={selectedDates}
              disabledDates={disabledDates}
              onToggle={handleToggleDate}
            />
          )}

          <div className="bg-white border border-cream-100 rounded-2xl px-5 shadow-sm overflow-hidden">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={plan.map(s => s.scheduled_date)}
                strategy={verticalListSortingStrategy}
              >
                <div className="divide-y divide-cream-50">
                  {plan.length === 0 ? (
                    <p className="py-6 text-sm text-gray-400 text-center">
                      Pick a date above to start planning.
                    </p>
                  ) : (
                    plan.map((slot) => (
                      <SortableMealItem
                        key={slot.scheduled_date}
                        slot={slot}
                        onSwap={openSwap}
                        isServed={isServed}
                        onToggleCooked={isServed ? handleToggleCooked : null}
                      />
                    ))
                  )}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </div>

        {/* Serve + Share + Download */}
        <div className="space-y-3">

          {!isServed ? (
            <button
              onClick={handleServe}
              disabled={servingPlan || !canServe}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {servingPlan ? (
                <><Loader2 size={16} className="animate-spin" /> Saving…</>
              ) : (
                <><Check size={16} /> Serve This Plan</>
              )}
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2 bg-green-50 border border-green-200 rounded-2xl py-3">
              <Check size={16} className="text-green-600" />
              <span className="text-sm font-medium text-green-700">
                Served on {new Date(servedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          )}

          {serveError && (
            <p className="text-xs text-red-500 text-center">{serveError}</p>
          )}

          {planState === 'active' && periodError && (
            <p className="text-xs text-red-500 text-center">{periodError}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleShare}
              disabled={!isServed || sharing}
              title={!isServed ? 'Finalize plan first' : undefined}
              className={`btn-primary flex-1 flex items-center justify-center gap-2 ${!isServed ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <Share2 size={16} />
              {sharing ? 'Sharing…' : 'Share plan via text'}
            </button>
            <button
              onClick={handleDownloadList}
              disabled={!isServed}
              title={!isServed ? 'Finalize plan first' : undefined}
              className={`btn-primary flex-1 flex items-center justify-center gap-2 bg-brand-50 text-brand-600 border border-brand-200 hover:bg-brand-100 transition-colors ${!isServed ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <Download size={16} />
              Groceries
            </button>
          </div>

        </div>

      </div>

      {/* Swap picker — bottom sheet */}
      <Sheet isOpen={!!swapDate} onClose={() => setSwapDate(null)}>
        <Sheet.Container className="!rounded-t-3xl !bg-cream-50 shadow-2xl border-t border-cream-200">
          <Sheet.Header />
          <Sheet.Content>
            <div className="px-6 py-2 pb-safe">
              <p className="text-[11px] font-bold text-brand-500 tracking-widest mb-1 uppercase">
                SWAP {swapDate && shortDateLabel(swapDate).toUpperCase()}
              </p>
              <p className="text-base font-serif italic text-gray-700 mb-6">Pick from your vault</p>

              <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
                <div className="mb-4">
                  <p className="text-[11px] font-bold text-gray-400 tracking-widest mb-2 uppercase">AI Suggestions</p>
                  {loadingSwap ? (
                    <p className="text-xs text-gray-400 py-3 text-center">Finding ideas…</p>
                  ) : swapSuggestions.length === 0 ? (
                    <p className="text-xs text-gray-400 py-3 text-center">No suggestions available</p>
                  ) : (
                    <div className="space-y-1">
                      {swapSuggestions.map(item => (
                        <div key={item.id} className="flex items-center gap-2 py-2.5">
                          <button
                            onClick={() => { trigger('light'); handleSwap(swapDate, item); }}
                            className="flex-1 text-left text-sm text-brand-700 font-medium hover:text-brand-800 transition-colors"
                          >
                            {item.name}
                          </button>
                          {item.source_url && (
                            <a
                              href={item.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold text-brand-500 hover:text-brand-700 border border-brand-200 bg-brand-50 rounded-full px-2.5 py-1 transition-colors"
                              title="View recipe"
                            >
                              <ExternalLink size={10} />
                              View
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {(() => {
                  const planIds = new Set(plan.map(s => s.id).filter(Boolean))
                  const availableVault = vault.filter(item => !planIds.has(item.id))
                  return availableVault.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">
                      {vault.length === 0 ? 'Your vault is empty — save some recipes first' : 'All vault items are already in your plan'}
                    </p>
                  ) : (
                    <div className="pt-2">
                      <p className="text-[11px] font-bold text-gray-400 tracking-widest mb-2 uppercase">From Your Cookbook</p>
                      {availableVault.map(item => (
                        <button
                          key={item.id}
                          onClick={() => { trigger('light'); handleSwap(swapDate, item); }}
                          className="w-full text-left py-3 text-sm text-gray-900 hover:text-brand-600 transition-colors"
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>

              <button
                onClick={() => setSwapDate(null)}
                className="w-full mt-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-500"
              >
                Cancel
              </button>
            </div>
          </Sheet.Content>
        </Sheet.Container>
        <Sheet.Backdrop onClick={() => setSwapDate(null)} />
      </Sheet>


    </div>
  )
}
