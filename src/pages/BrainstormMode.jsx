import { useState, useEffect, useMemo } from 'react'
import { Share2, RefreshCw, GripVertical, Sparkles, ExternalLink, Check, Download, Loader2, Bookmark, BookmarkPlus, Plus, Trash2, ShoppingCart } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Sheet } from 'react-modal-sheet'
import { useHaptics } from '../hooks/useHaptics'
import Logo from '../components/Logo'
import { getRecommendations } from '../lib/recommendations'
import { buildLastWeekSlots } from '../lib/lastWeekSlots'
import { fetchMostRecentPlan, fetchCurrentLeftovers, classifyPlanState, listUserPeriods } from '../lib/mealPlanReader'
import { getPreferences } from '../lib/preferences'
import {
  createServedPlan,
  setItemCooked,
  finalizePlan,
  startNewPeriod,
  scheduleShortlistItem,
  moveItemToShortlist,
  deleteMealPlanItem,
  resetCurrentPlan,
} from '../lib/mealPlanWriter'
import { AI_CANDIDATE_COUNT } from '../lib/constants'
import PeriodReview from './PeriodReview'
import GapDayView from '../components/GapDayView'
import DateRangePicker from '../components/DateRangePicker'
import LeftoverPicker from '../components/LeftoverPicker'
import DateStripPicker from '../components/DateStripPicker'
import DayPicker from '../components/Brainstorm/DayPicker'
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

// PRD-002 P0.7: per-day card. The legacy Swap button has been removed — the
// day picker (tap on the day cell or its "+") is the new way to browse vault
// + AI candidates. Move-to-Maybe stays for scheduled rows. Tapping the meal
// card itself is intentionally a no-op (per acceptance criterion #3).
function SortableMealItem({ slot, isServed, onToggleCooked, onMoveToMaybe }) {
  const showCookedToggle = isServed && !!onToggleCooked && !!slot.item_id
  // PRD-002 P0.6: only allow Move-to-Maybe on rows that exist in DB (item_id
  // present) — pre-serve plan slots are local-only and have no FK target.
  const canMoveToMaybe = isServed && !!onMoveToMaybe && !!slot.item_id
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 py-3 bg-white ${
        isDragging ? 'opacity-50 shadow-lg relative rounded-xl border-brand-200' : ''
      }`}
    >
      <div
        {...(isServed ? {} : { ...attributes, ...listeners })}
        aria-label={isServed ? undefined : `Drag to reorder ${slot.name}`}
        className={
          isServed
            ? 'w-11 h-11 -ml-2 flex items-center justify-center text-gray-500 cursor-not-allowed flex-shrink-0'
            : 'w-11 h-11 -ml-2 flex items-center justify-center cursor-grab active:cursor-grabbing text-gray-500 hover:text-brand-700 flex-shrink-0'
        }
      >
        <GripVertical size={20} strokeWidth={2} />
      </div>
      <span
        className={`flex-1 min-w-0 font-medium leading-snug flex flex-col items-start gap-1 text-base ${
          showCookedToggle && slot.cooked
            ? 'line-through text-gray-500'
            : 'text-gray-900'
        }`}
      >
        <span className="line-clamp-2 w-full break-words">{slot.name}</span>
        {slot.is_wildcard && (
          <div className="flex items-center gap-2">
            <span className="bg-brand-100 text-brand-700 text-xs font-bold px-2 py-1 rounded uppercase tracking-tighter shadow-sm flex items-center gap-1">
              <Sparkles size={10} />
              New
            </span>
            {slot.source_url && (
              <a
                href={slot.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-700 hover:text-brand-800 transition-colors"
                title="View Recipe"
                aria-label={`View recipe for ${slot.name}`}
              >
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        )}
      </span>
      {canMoveToMaybe && (
        <button
          onClick={() => onMoveToMaybe(slot.item_id)}
          aria-label="Move to Maybe"
          title="Move to Maybe"
          className="flex-shrink-0 w-11 h-11 -mr-2 flex items-center justify-center text-brand-700 hover:text-brand-800 transition-colors"
        >
          <BookmarkPlus size={18} strokeWidth={2} />
        </button>
      )}
      {showCookedToggle && (
        <label className="flex-shrink-0 flex items-center gap-2 cursor-pointer">
          <span className="text-sm font-bold text-brand-700 uppercase tracking-wide">
            Cooked
          </span>
          <input
            type="checkbox"
            checked={!!slot.cooked}
            onChange={(e) => onToggleCooked(slot.item_id, e.target.checked)}
            aria-label={`Mark "${slot.name}" cooked`}
            style={{ accentColor: '#D74520' }}
            className="h-5 w-5 rounded border-cream-200 focus:ring-brand-300 focus:ring-2"
          />
        </label>
      )}
    </div>
  )
}

// PRD-002 P0.7: a single day's worth of the grid.
//   - 0 items: the whole cell is a tap-target (placeholder + Plus icon).
//   - 1+ items: each item renders as a card; a "+" button below opens the
//     picker for adding another meal to that day.
// Tapping an existing meal card is intentionally NOT a picker trigger.
function DayCell({
  date,
  items,
  isServed,
  onOpenPicker,
  onToggleCooked,
  onMoveToMaybe,
}) {
  const dow = shortWeekday(date)
  const dateLabel = shortDateLabel(date)

  if (items.length === 0) {
    return (
      <div className="py-3">
        <div className="flex items-start gap-3">
          <span className="text-sm font-bold text-brand-700 w-8 flex-shrink-0 tracking-tighter uppercase pt-3">
            {dow}
          </span>
          <button
            type="button"
            role="button"
            aria-label={`Schedule a meal for ${dateLabel}`}
            onClick={() => onOpenPicker(date)}
            className="flex-1 flex items-center justify-center gap-2 py-4 rounded-xl border border-dashed border-cream-200 text-gray-700 hover:text-brand-700 hover:border-brand-200 hover:bg-brand-50/30 transition-colors min-h-[44px]"
          >
            <Plus size={16} strokeWidth={2.5} />
            <span className="text-sm italic">Tap to add a meal</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="py-2">
      <div className="flex items-start gap-3">
        <span className="text-sm font-bold text-brand-700 w-8 flex-shrink-0 tracking-tighter uppercase pt-4">
          {dow}
        </span>
        <div className="flex-1 min-w-0">
          {items.map((slot) => (
            <SortableMealItem
              key={slot.item_id ?? `${slot.scheduled_date}-${slot.name}`}
              slot={slot}
              isServed={isServed}
              onToggleCooked={isServed ? onToggleCooked : null}
              onMoveToMaybe={isServed ? onMoveToMaybe : null}
            />
          ))}
          <button
            type="button"
            role="button"
            aria-label={`Add another meal to ${dateLabel}`}
            onClick={() => onOpenPicker(date)}
            className="btn-text"
          >
            <Plus size={14} strokeWidth={2.5} />
            Add another meal
          </button>
        </div>
      </div>
    </div>
  )
}

// PRD-002 P0.6: the "Maybe" tab view. Renders the shortlist for the active
// period; each item exposes a "Schedule" button that hands the row up to
// BrainstormMode's day-picker sheet.
function ShortlistTab({ items, isServed, onSchedule }) {
  if (!isServed) {
    return (
      <div className="bg-white border border-cream-100 rounded-2xl px-5 py-8 text-center shadow-sm">
        <p className="helper-text">
          Serve a plan to start shortlisting candidates for the period.
        </p>
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <div className="bg-white border border-cream-100 rounded-2xl px-5 py-8 text-center shadow-sm">
        <p className="helper-text">
          Nothing shortlisted yet. Tap a candidate's bookmark to save it for later.
        </p>
      </div>
    )
  }
  return (
    <div className="bg-white border border-cream-100 rounded-2xl px-5 divide-y divide-cream-50 shadow-sm">
      {items.map((item) => (
        <div
          key={item.item_id}
          className="flex items-center gap-3 py-4"
          data-testid={`shortlist-item-${item.item_id}`}
        >
          <Bookmark size={16} strokeWidth={2} className="text-brand-700 flex-shrink-0" />
          <span className="text-base text-gray-900 flex-1 min-w-0 truncate font-medium">
            {item.name}
          </span>
          <button
            onClick={() => onSchedule(item)}
            aria-label={`Schedule ${item.name}`}
            className="flex-shrink-0 text-xs font-bold text-brand-700 bg-brand-50 border border-brand-100 rounded-full px-4 py-3 min-h-[44px] uppercase tracking-wide hover:bg-brand-100 transition-colors"
          >
            Schedule
          </button>
        </div>
      ))}
    </div>
  )
}

export default function BrainstormMode({ userId, onNavigate }) {
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
  const [justServed, setJustServed] = useState(false)

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
    trigger('success')

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
    trigger('success')
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

  // Reset clears the loaded period entirely (deletes meal_plans row; items
  // cascade). Only enabled when the loaded plan is the most recent and not
  // yet finalized — past periods are read-only history.
  const canResetPlan = !!loadedPlan?.id && !loadedPlan?.finalized_at && isServed

  const handleResetPlan = async () => {
    if (!canResetPlan || resetting) return
    setResetting(true)
    setResetError(null)
    try {
      await resetCurrentPlan(supabase, loadedPlan.id)
      trigger('success')
      setShowResetConfirm(false)
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

  // Pair each suggestion with a date. `dates` must be sorted ascending.
  function buildPlan(suggestions, dates) {
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
        <p className="helper-text">Building your plan…</p>
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
              <Loader2 size={16} className="animate-spin text-brand-700" />
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
        <h1 className="text-sm text-brand-700 font-bold tracking-widest uppercase">For My Wife</h1>
        <p className="text-lg text-gray-900 mt-1 font-serif italic">Brainstorm meals</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* PRD-002 P0.6: This Week / Maybe segmented tab. */}
        <div
          role="tablist"
          aria-label="Plan view"
          className="grid grid-cols-2 gap-1 bg-cream-100 rounded-full p-1"
        >
          <button
            role="tab"
            aria-selected={activeTab === 'thisWeek'}
            onClick={() => setActiveTab('thisWeek')}
            className={`py-3 min-h-[44px] rounded-full text-sm font-bold uppercase tracking-wider transition-colors ${
              activeTab === 'thisWeek'
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-gray-700 hover:text-brand-700'
            }`}
          >
            This Week
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'maybe'}
            onClick={() => setActiveTab('maybe')}
            className={`py-3 min-h-[44px] rounded-full text-sm font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'maybe'
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-gray-700 hover:text-brand-700'
            }`}
          >
            Maybe
            {shortlist.length > 0 && (
              <span className="text-sm font-bold px-2 py-1 rounded-full bg-brand-50 text-brand-700">
                {shortlist.length}
              </span>
            )}
          </button>
        </div>

        {shortlistError && (
          <p className="text-xs text-red-600 text-center">{shortlistError}</p>
        )}

        {activeTab === 'thisWeek' && (
        <>

        {/* End-of-period prompt: shown when the period has ended but the user
            hasn't reviewed it yet. */}
        {planState === 'ended_unfinalized' && (
          <div
            role="region"
            aria-label="End of period review"
            className="bg-brand-50 border border-brand-200 rounded-2xl px-4 py-4 shadow-sm space-y-3"
          >
            <div>
              <p className="section-heading text-brand-700 mb-1">
                Your period has ended
              </p>
              <p className="body-text">
                Mark what you actually cooked, then lock it in.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setShowReview(true)}
                className="btn-primary"
              >
                Edit what you actually ate
              </button>
              <button
                onClick={handleLockInAsIs}
                disabled={lockingIn}
                className="btn-secondary disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {lockingIn ? (
                  <><Loader2 size={16} className="animate-spin" /> Finalizing…</>
                ) : (
                  'Lock in as-is'
                )}
              </button>
            </div>
            {periodError && (
              <p className="text-xs text-red-600 text-center">{periodError}</p>
            )}
          </div>
        )}

        {/* Last week's meals */}
        <div>
          <p className="section-heading mb-3">Last week's meals</p>
          <div className="bg-white border border-cream-100 rounded-2xl px-5 divide-y divide-cream-50 shadow-sm">
            {lastWeek.map(({ day, name }) => (
              <div key={day} className="flex items-center gap-3 py-3">
                <span className="text-sm font-bold text-gray-700 w-8 flex-shrink-0 uppercase tracking-wider">{day.toUpperCase()}</span>
                <span className={`text-base flex-1 ${name ? 'text-gray-900' : 'text-gray-500 italic'}`}>
                  {name || '—'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Date strip + plan */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="section-heading">Your meal plan</p>
            <button
              onClick={() => loadData(true)}
              disabled={isServed}
              className={`btn-text ${isServed ? 'text-gray-500 cursor-not-allowed pointer-events-none' : ''}`}
            >
              <RefreshCw size={14} strokeWidth={2.5} />
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
                  {dayGridDates.length === 0 ? (
                    <p className="py-6 helper-text text-center">
                      Pick a date above to start planning.
                    </p>
                  ) : (
                    dayGridDates.map((date) => (
                      <DayCell
                        key={date}
                        date={date}
                        items={itemsByDate.get(date) ?? []}
                        isServed={isServed}
                        onOpenPicker={handleOpenPicker}
                        onToggleCooked={handleToggleCooked}
                        onMoveToMaybe={handleMoveToMaybe}
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
              className="btn-primary flex items-center justify-center gap-2"
            >
              {servingPlan ? (
                <><Loader2 size={16} className="animate-spin" /> Saving…</>
              ) : (
                <><Check size={16} /> Serve This Plan</>
              )}
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2 bg-green-50 border border-green-200 rounded-2xl py-3 min-h-[44px]">
              <Check size={16} className="text-green-700" />
              <span className="text-sm font-medium text-green-700">
                Served on {new Date(servedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          )}

          {serveError && (
            <p className="text-xs text-red-600 text-center">{serveError}</p>
          )}

          {isServed && justServed && onNavigate && (
            <button
              onClick={() => { setJustServed(false); onNavigate('grocery') }}
              className="btn-primary flex items-center justify-center gap-2"
            >
              <ShoppingCart size={16} />
              Generate grocery list →
            </button>
          )}

          {planState === 'active' && periodError && (
            <p className="text-xs text-red-600 text-center">{periodError}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleShare}
              disabled={!isServed || sharing}
              title={!isServed ? 'Finalize plan first' : undefined}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              <Share2 size={16} />
              {sharing ? 'Sharing…' : 'Share plan via text'}
            </button>
            <button
              onClick={handleDownloadList}
              disabled={!isServed}
              title={!isServed ? 'Finalize plan first' : undefined}
              className="btn-secondary flex-1 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={16} />
              Groceries
            </button>
          </div>

          {canResetPlan && (
            <button
              onClick={() => {
                setResetError(null)
                setShowResetConfirm(true)
              }}
              className="w-full flex items-center justify-center gap-2 py-3 min-h-[44px] rounded-2xl border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 transition-colors text-sm font-semibold"
            >
              <Trash2 size={16} />
              Reset this plan
            </button>
          )}

          {resetError && (
            <p className="text-xs text-red-600 text-center">{resetError}</p>
          )}

        </div>

        </>
        )}

        {activeTab === 'maybe' && (
          <ShortlistTab
            items={shortlist}
            isServed={isServed}
            onSchedule={(item) => setScheduleSheetItem(item)}
          />
        )}

      </div>

      {/* PRD-002 P0.7: tap-a-day picker. Owns its own data fetch + DB writes;
          the parent only opens (setPickerDate(date)) and refetches on success. */}
      <DayPicker
        date={pickerDate}
        isOpen={!!pickerDate}
        onClose={() => setPickerDate(null)}
        onScheduled={handlePickerScheduled}
        userId={userId}
        planId={loadedPlan?.id ?? null}
        vault={vault}
        recentMeals={storedRecentMeals}
        plan={plan}
        shortlist={shortlist}
        preferences={preferences}
      />

      {/* PRD-002 P0.6: Schedule-from-Maybe — bottom sheet.
          Lists every date in the active period. Selecting a date promotes the
          shortlist row to scheduled (single UPDATE). "Remove" hard-deletes the
          row. */}
      <Sheet
        isOpen={!!scheduleSheetItem}
        onClose={() => setScheduleSheetItem(null)}
      >
        <Sheet.Container className="!rounded-t-3xl !bg-cream-50 shadow-2xl border-t border-cream-200">
          <Sheet.Header />
          <Sheet.Content>
            <div className="px-6 py-2 pb-safe">
              <p className="section-heading text-brand-700 mb-1">
                Schedule from Maybe
              </p>
              <p className="text-base font-serif italic text-gray-700 mb-6">
                {scheduleSheetItem?.name}
              </p>

              <div
                role="list"
                aria-label="Days in period"
                className="divide-y divide-gray-100 max-h-72 overflow-y-auto"
              >
                {(() => {
                  const periodDates = []
                  if (loadedPlan?.period_start && loadedPlan?.period_end) {
                    const start = parseYmd(loadedPlan.period_start)
                    const end = parseYmd(loadedPlan.period_end)
                    let cursor = start
                    while (cursor <= end) {
                      periodDates.push(formatLocalYmd(cursor))
                      cursor = addDays(cursor, 1)
                    }
                  }
                  if (periodDates.length === 0) {
                    return (
                      <p className="helper-text py-4 text-center">
                        No active period.
                      </p>
                    )
                  }
                  return periodDates.map((d) => (
                    <button
                      key={d}
                      role="listitem"
                      onClick={() =>
                        handleScheduleFromShortlist(scheduleSheetItem, d)
                      }
                      className="w-full text-left py-3 min-h-[44px] text-base text-gray-900 hover:text-brand-700 transition-colors"
                    >
                      {shortDateLabel(d)}
                    </button>
                  ))
                })()}
              </div>

              <button
                onClick={() => handleRemoveShortlist(scheduleSheetItem)}
                className="w-full mt-4 py-3 min-h-[44px] rounded-2xl border border-red-200 text-sm font-semibold text-red-700 bg-red-50 hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 size={16} />
                Remove
              </button>

              <button
                onClick={() => setScheduleSheetItem(null)}
                className="btn-secondary mt-2"
              >
                Cancel
              </button>
            </div>
          </Sheet.Content>
        </Sheet.Container>
        <Sheet.Backdrop onClick={() => setScheduleSheetItem(null)} />
      </Sheet>

      {/* Reset-plan confirmation sheet. */}
      <Sheet
        isOpen={showResetConfirm}
        onClose={() => !resetting && setShowResetConfirm(false)}
      >
        <Sheet.Container className="!rounded-t-3xl !bg-cream-50 shadow-2xl border-t border-cream-200">
          <Sheet.Header />
          <Sheet.Content>
            <div className="px-6 py-2 pb-safe">
              <p className="section-heading text-red-700 mb-1">
                Reset this plan?
              </p>
              <p className="text-base font-serif italic text-gray-700 mb-2">
                Clear the current period.
              </p>
              <p className="helper-text mb-6">
                This deletes the dates and every meal in your current plan.
                It can't be undone. Past, finalized periods aren't affected.
              </p>

              {resetError && (
                <p className="text-xs text-red-600 text-center mb-3">
                  {resetError}
                </p>
              )}

              <button
                onClick={handleResetPlan}
                disabled={resetting}
                className="w-full py-3 min-h-[44px] rounded-2xl border border-red-200 bg-red-50 text-sm font-semibold text-red-700 hover:bg-red-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {resetting ? (
                  <><Loader2 size={16} className="animate-spin" /> Resetting…</>
                ) : (
                  <><Trash2 size={16} /> Reset plan</>
                )}
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                disabled={resetting}
                className="btn-secondary mt-2 disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </Sheet.Content>
        </Sheet.Container>
        <Sheet.Backdrop onClick={() => !resetting && setShowResetConfirm(false)} />
      </Sheet>

    </div>
  )
}
