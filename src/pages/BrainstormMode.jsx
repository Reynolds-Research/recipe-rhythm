import { useState, useEffect } from 'react'
import { Share2, RefreshCw, GripVertical, Sparkles, ExternalLink, ChevronDown, Check, Download, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import Logo from '../components/Logo'
import { getRecommendations } from '../lib/recommendations'
import { fetchMostRecentPlan, fetchCurrentLeftovers, classifyPlanState } from '../lib/mealPlanReader'
import { createServedPlan, startNewPeriod } from '../lib/mealPlanWriter'
import GapDayView from '../components/GapDayView'
import DateRangePicker from '../components/DateRangePicker'
import LeftoverPicker from '../components/LeftoverPicker'
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
 * The Sat–Sun planning screen.
 * Shows last week's meals, then a suggested Sun–Thu menu.
 * Each suggestion can be swapped from a Vault picker sheet.
 */

const ALL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DEFAULT_PLAN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu']

function SortableMealItem({ slot, onSwap, isServed }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: slot.day })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
  }

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
        className={isServed ? 'text-gray-200 p-1 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing text-gray-300 hover:text-brand-400 p-1'}
      >
        <GripVertical size={18} strokeWidth={2} />
      </div>
      <span className="text-[10px] font-bold text-brand-400 w-8 flex-shrink-0 tracking-tighter uppercase">
        {slot.day}
      </span>
      <span className="text-sm flex-1 text-gray-900 font-medium leading-snug flex items-center gap-2">
        {slot.name}
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
      <button
        onClick={() => onSwap(slot.day)}
        disabled={isServed}
        className={`flex-shrink-0 text-[10px] font-bold text-brand-600 bg-brand-50 border border-brand-100 rounded-full px-3.5 py-1.5 uppercase tracking-wide hover:bg-brand-100 transition-colors ${isServed ? 'opacity-30 cursor-not-allowed pointer-events-none' : ''}`}
      >
        Swap
      </button>
    </div>
  )
}

/**
 * Maps a served plan's items to pseudo-meal objects with real calendar dates
 * so the recommendation engine can apply recency/frequency scoring to them.
 */
function buildServedMealsForEngine(items, servedAtIso) {
  if (!items?.length || !servedAtIso) return []
  const dayIndexMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const servedDate = new Date(servedAtIso)
  const servedDow = servedDate.getDay()
  return items
    .filter(item => item.vault_id)
    .map(item => {
      const targetDow = dayIndexMap[item.day] ?? 0
      const offset = targetDow - servedDow
      const scheduled = new Date(servedDate)
      scheduled.setDate(servedDate.getDate() + offset)
      return { ...item, scheduled_date: scheduled.toISOString().split('T')[0] }
    })
}

export default function BrainstormMode({ userId }) {
  const [lastWeek, setLastWeek] = useState([])   // what was eaten last week
  const [plan, setPlan] = useState(() => {
    try {
      const saved = localStorage.getItem('brainstorm_plan')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [vault, setVault] = useState([])   // all vault items for the picker
  const [storedRecentMeals, setStoredRecentMeals] = useState([]) // kept for swap-time context
  const [planDays, setPlanDays] = useState(() => {
    try {
      const saved = localStorage.getItem('brainstorm_plan_days')
      return saved ? JSON.parse(saved) : DEFAULT_PLAN_DAYS
    } catch { return DEFAULT_PLAN_DAYS }
  })
  const [showDayPicker, setShowDayPicker] = useState(false)
  const [pendingDays, setPendingDays] = useState(DEFAULT_PLAN_DAYS)

  // Serve state
  const [isServed, setIsServed]     = useState(false)
  const [servedAt, setServedAt]     = useState(null)
  const [serving, setServing]       = useState(false)
  const [serveError, setServeError] = useState(null)

  // ADR-001 Phase 5: plan lifecycle routing for the gap-day + new-period flow.
  // `mostRecentPlan` is the latest plan row (used to classify the UI state);
  // `newPeriodStep` drives the two-stage modal flow (date picker → leftover
  // picker → commit). 'idle' means no modal open.
  const [mostRecentPlan, setMostRecentPlan] = useState(null)
  const [newPeriodStep, setNewPeriodStep] = useState('idle') // 'idle' | 'pick-dates' | 'pick-leftovers'
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
    localStorage.setItem('brainstorm_plan_days', JSON.stringify(planDays))
  }, [planDays])
  const [swapDay, setSwapDay] = useState(null) // which day's picker is open
  const [swapSuggestions, setSwapSuggestions] = useState([]) // fresh picks fetched on Swap click
  const [loadingSwap, setLoadingSwap] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    })
  )

  useEffect(() => {
    loadData(false)
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

    // Load 90 days of meals so the engine can compute how often each
    // vault item actually makes it to the plate (frequency signal).
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    const [mealsRes, vaultRes, planRes] = await Promise.all([
      supabase
        .from('meals')
        .select('id, name, cuisine_type, flavor_profile, vault_id, eaten_on')
        .eq('user_id', userId)
        .gte('eaten_on', ninetyDaysAgo.toISOString().split('T')[0])
        .order('eaten_on', { ascending: false }),
      supabase
        .from('vault')
        .select('id, name, cuisine_type, flavor_profile, is_wildcard, proteins, cooking_method, main_carb, vegetables, dairy_components, fruits')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      fetchMostRecentPlan(supabase, userId),
    ])

    const recentMeals = mealsRes.data || []
    const vaultItems = vaultRes.data || []
    const mostRecentPlan = planRes.plan
    setMostRecentPlan(mostRecentPlan)

    setVault(vaultItems)

    // Last week = meals from the past 7 days, mapped to Mon–Fri slots
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const lastWeekMeals = recentMeals.filter(
      m => new Date(m.eaten_on) >= sevenDaysAgo
    )
    setLastWeek(buildLastWeekSlots(lastWeekMeals))

    // Store recent meals so openSwap can pass context to Spoonacular
    setStoredRecentMeals(recentMeals)

    // Check if there's already a served plan for this week (within last 7 days)
    const isCurrentWeekServed =
      mostRecentPlan && new Date(mostRecentPlan.served_at) >= sevenDaysAgo

    if (isCurrentWeekServed) {
      // Restore the served plan as authoritative; lock the UI
      localStorage.removeItem('brainstorm_plan')
      setPlan(mostRecentPlan.items)
      setPlanDays(mostRecentPlan.days)
      setServedAt(mostRecentPlan.served_at)
      setIsServed(true)
    } else if (forceRegenerate || plan.length === 0) {
      // Pass prior week's served items to the engine for recency/frequency context
      const servedMeals = buildServedMealsForEngine(mostRecentPlan?.items, mostRecentPlan?.served_at)
      const suggestions = getRecommendations(vaultItems, recentMeals, [], planDays.length, servedMeals)
      setPlan(buildPlan(suggestions, planDays))
    }

    setLoading(false)
  }

  /**
   * Maps logged meals onto Mon–Fri day slots for the "last week" section.
   * Days with no logged meal show a dash.
   */
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

  /**
   * Pairs each suggestion with a plan day label.
   * If the vault is empty, fills with placeholder text.
   */
  function buildPlan(suggestions, days) {
    return days.map((day, i) => ({
      day,
      name:        suggestions[i]?.name || 'Add meals to your Cookbook to get suggestions',
      id:          suggestions[i]?.id || null,
      is_wildcard: suggestions[i]?.is_wildcard || false,
      source_url:  suggestions[i]?.source_url || null,
    }))
  }

  // Rebuild the plan for a new set of days without re-fetching from DB
  const applyDays = (days) => {
    const sorted = [...days].sort((a, b) => ALL_DAYS.indexOf(a) - ALL_DAYS.indexOf(b))
    const suggestions = getRecommendations(vault, storedRecentMeals, [], sorted.length)
    setPlan(buildPlan(suggestions, sorted))
    setPlanDays(sorted)
    setShowDayPicker(false)
  }

  // Open the swap picker for a day, fetching fresh AI suggestions
  const openSwap = async (day) => {
    setSwapDay(day)
    setSwapSuggestions([])
    setLoadingSwap(true)
    const suggestions = await fetchSwapSuggestions(plan, storedRecentMeals)
    setSwapSuggestions(suggestions)
    setLoadingSwap(false)
  }

  // Swap a day's suggestion with a vault pick
  const handleSwap = (day, vaultItem) => {
    setPlan(prev =>
      prev.map(slot =>
        slot.day === day
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
    setSwapDay(null)
  }

  const handleDragEnd = (event) => {
    if (isServed) return
    const { active, over } = event

    if (active.id !== over.id) {
      setPlan((items) => {
        const oldIndex = items.findIndex((item) => item.day === active.id)
        const newIndex = items.findIndex((item) => item.day === over.id)

        // We want to keep the days (Sun, Mon, etc.) fixed in order, 
        // but swap the meal *names* and *ids* at those indices.
        const newPlan = [...items]
        const movedItem = { ...items[oldIndex] }
        const targetItem = { ...items[newIndex] }

        // Actually, dnd-kit usually reorders the entire object.
        // If we want to keep DAYS fixed, we just swap the meal data.
        const reorderedMeals = arrayMove(items.map(i => ({ name: i.name, id: i.id, is_wildcard: i.is_wildcard })), oldIndex, newIndex)
        
        return items.map((item, index) => ({
          ...item,
          name:        reorderedMeals[index].name,
          id:          reorderedMeals[index].id,
          is_wildcard: reorderedMeals[index].is_wildcard,
          source_url:  reorderedMeals[index].source_url || null,
        }))
      })
    }
  }

  // All slots must have real meals (not the empty-vault placeholder) before serving
  const canServe = plan.length > 0 && plan.every(
    slot => slot.name && !slot.name.startsWith('Add meals to your Cookbook')
  )

  const handleServe = async () => {
    if (isServed || serving || !canServe) return
    setServing(true)
    setServeError(null)

    // ADR-001 Phase 3: writes to the new normalized schema only
    // (meal_plans.{period_start, period_end} + meal_plan_items rows).
    // No longer touches the deprecated week_label / days / items columns.
    try {
      const { served_at } = await createServedPlan(supabase, userId, plan, planDays)
      setServedAt(served_at)
      setIsServed(true)
      localStorage.removeItem('brainstorm_plan')
    } catch (err) {
      if (err?.code === 'period_overlap') {
        setServeError('This week overlaps with a plan you already served. Pick different days or wait.')
      } else {
        setServeError('Could not save plan. Try again.')
      }
    } finally {
      setServing(false)
    }
  }

  // --- New-period flow (ADR-001 Phase 5) ---------------------------------
  // Opens the date-range picker modal. We pre-fetch leftovers here so the
  // next step (leftover picker) can be skipped entirely when none exist.
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
      // No leftovers to roll forward — skip the picker and commit directly.
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

  // Share the plan using the native mobile share sheet
  const handleShare = async () => {
    const text = [
      'Meal plan for the week:',
      '',
      ...plan.map(slot => `${slot.day}: ${slot.name}`),
    ].join('\n')

    if (navigator.share) {
      setSharing(true)
      try {
        await navigator.share({ title: 'Meal plan', text })
      } catch (e) {
        // User dismissed the share sheet — not an error
      }
      setSharing(false)
    } else {
      // Fallback for desktop browsers that don't support navigator.share
      await navigator.clipboard.writeText(text)
      alert('Plan copied to clipboard!')
    }
  }

  const handleDownloadList = () => {
    // 1. Gather all vault items active in the plan
    const vaultItemsInPlan = plan.map(slot => vault.find(v => v.id === slot.id)).filter(Boolean)
    
    // 2. Extract categories
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

    // 3. Format as Text
    let text = `GROCERY LIST\nFor My Wife — Meal Plan\n\n[ MEALS ]\n`
    plan.forEach(slot => {
      text += `- ${slot.day}: ${slot.name}\n`
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

    // 4. Download 
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

  // ADR-001 Phase 5: gap-day routing. A finalized plan whose period_end is in
  // the past means we're between periods — show the leftovers + new-period CTA
  // instead of the "generate suggestions" flow the rest of this page renders.
  const planState = classifyPlanState(mostRecentPlan)
  if (planState === 'gap') {
    return (
      <>
        <GapDayView
          userId={userId}
          periodEnd={mostRecentPlan?.period_end ?? null}
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
        <h1 className="text-sm text-brand-600 font-bold tracking-[0.2em] uppercase">For My Wife</h1>
        <p className="text-lg text-gray-900 mt-1 font-serif italic">Brainstorm next week</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* Last week's meals */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 tracking-[0.2em] mb-3 uppercase">LAST WEEK'S MEALS</p>
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

        {/* Suggested plan */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-bold text-gray-400 tracking-[0.2em] uppercase">THIS WEEK'S MEAL PLAN</p>
              <button
                onClick={() => { setPendingDays(planDays); setShowDayPicker(v => !v) }}
                disabled={isServed}
                className={`flex items-center gap-1 text-[10px] font-bold bg-brand-50 border border-brand-200 rounded-full px-2.5 py-1 transition-colors ${isServed ? 'text-gray-300 cursor-not-allowed' : 'text-brand-500 hover:bg-brand-100'}`}
              >
                {planDays[0]} – {planDays[planDays.length - 1]}
                <ChevronDown size={10} className={`transition-transform ${showDayPicker ? 'rotate-180' : ''}`} />
              </button>
            </div>
            <button
              onClick={() => loadData(true)}
              disabled={isServed}
              className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${isServed ? 'text-gray-300 cursor-not-allowed' : 'text-brand-500 hover:text-brand-600'}`}
            >
              <RefreshCw size={12} strokeWidth={2.5} />
              Regenerate
            </button>
          </div>

          {/* Day picker */}
          {showDayPicker && (
            <div className="bg-white border border-cream-200 rounded-2xl px-4 py-4 mb-3 shadow-sm">
              <p className="text-[10px] font-bold text-gray-400 tracking-widest mb-3 uppercase">Select days to plan</p>
              <div className="flex gap-2 flex-wrap mb-4">
                {ALL_DAYS.map(day => {
                  const selected = pendingDays.includes(day)
                  return (
                    <button
                      key={day}
                      onClick={() => setPendingDays(prev =>
                        selected ? prev.filter(d => d !== day) : [...prev, day]
                      )}
                      className={`flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full border transition-colors ${
                        selected
                          ? 'bg-brand-500 border-brand-500 text-white'
                          : 'bg-white border-gray-200 text-gray-500 hover:border-brand-300'
                      }`}
                    >
                      {selected && <Check size={9} />}
                      {day}
                    </button>
                  )
                })}
              </div>
              <button
                disabled={pendingDays.length === 0}
                onClick={() => applyDays(pendingDays)}
                className="w-full py-2 rounded-xl bg-brand-500 text-white text-xs font-bold tracking-wide disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-600 transition-colors"
              >
                Apply
              </button>
            </div>
          )}
          <div className="bg-white border border-cream-100 rounded-2xl px-5 shadow-sm overflow-hidden">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={plan.map(s => s.day)}
                strategy={verticalListSortingStrategy}
              >
                <div className="divide-y divide-cream-50">
                  {plan.map((slot) => (
                    <SortableMealItem
                      key={slot.day}
                      slot={slot}
                      onSwap={openSwap}
                      isServed={isServed}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </div>

        {/* Serve + Share + Download */}
        <div className="space-y-3">

          {/* Primary CTA: serve or served badge */}
          {!isServed ? (
            <button
              onClick={handleServe}
              disabled={serving || !canServe}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {serving ? (
                <><Loader2 size={16} className="animate-spin" /> Saving…</>
              ) : (
                <><Check size={16} /> Serve This Week's Plan</>
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

          {/* Share & Download — only enabled after serving */}
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
      {swapDay && (
        <div
          className="absolute inset-0 bg-black/40 z-50 flex items-end"
          onClick={() => setSwapDay(null)}
        >
          <div
            className="w-full bg-cream-50 rounded-t-3xl px-6 py-6 shadow-2xl border-t border-cream-200"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-[10px] font-bold text-brand-500 tracking-[0.2em] mb-1 uppercase">
              SWAP {swapDay.toUpperCase()}
            </p>
            <p className="text-base font-serif italic text-gray-700 mb-6">Pick from your vault</p>

            <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
              {/* AI Suggestions — fetched fresh on each Swap click */}
              <div className="mb-4">
                <p className="text-[9px] font-bold text-gray-400 tracking-widest mb-2 uppercase">AI Suggestions</p>
                {loadingSwap ? (
                  <p className="text-xs text-gray-400 py-3 text-center">Finding ideas…</p>
                ) : swapSuggestions.length === 0 ? (
                  <p className="text-xs text-gray-400 py-3 text-center">No suggestions available</p>
                ) : (
                  <div className="space-y-1">
                    {swapSuggestions.map(item => (
                      <div key={item.id} className="flex items-center gap-2 py-2.5">
                        <button
                          onClick={() => handleSwap(swapDay, item)}
                          className="flex-1 text-left text-sm text-brand-700 font-medium hover:text-brand-800 transition-colors"
                        >
                          {item.name}
                        </button>
                        {item.source_url && (
                          <a
                            href={item.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-shrink-0 flex items-center gap-1 text-[10px] font-semibold text-brand-500 hover:text-brand-700 border border-brand-200 bg-brand-50 rounded-full px-2.5 py-1 transition-colors"
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
                    <p className="text-[9px] font-bold text-gray-400 tracking-widest mb-2 uppercase">From Your Cookbook</p>
                    {availableVault.map(item => (
                      <button
                        key={item.id}
                        onClick={() => handleSwap(swapDay, item)}
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
              onClick={() => setSwapDay(null)}
              className="w-full mt-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
