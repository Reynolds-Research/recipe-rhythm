/**
 * usePrepTable — data + actions for the new Prep Table (PRD-008 phase 2b-2).
 *
 * Mental model: the database is the source of truth. Every action writes one
 * row through src/lib/plannedMeals.js, then reloads the week. No optimistic
 * copies to keep in sync — with a household of two and a handful of meals a
 * week, a reload is instant and it means both partners always see the same
 * thing after a refresh (PRD non-goal 4: no live sync).
 *
 * Suggestions (✨) are the one thing kept only in memory, on purpose (D3):
 * they're proposals until she taps ✓.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getHouseholdId } from '../../lib/household'
import { getPreferences } from '../../lib/preferences'
import { formatLocalDate } from '../../lib/dateUtils'
import {
  addMeal,
  loadDidntGetTo,
  loadMaybeList,
  loadWeek,
  moveMeal,
  removeMeal,
  saveWeekDays,
  setCooked,
} from '../../lib/plannedMeals'
import { addDays, shiftWeek, shownDates, thisWeekStart, toggleDay as nextDays } from '../../lib/weekRange'
import { suggestForDays } from '../../lib/weekSuggest'

/** A copy of `obj` without `key` (for dropping one proposal). */
function without(obj, key) {
  const next = { ...obj }
  delete next[key]
  return next
}

const VAULT_COLUMNS =
  'id, name, cuisine_type, flavor_profile, is_wildcard, proteins, cooking_method, main_carb, ' +
  'vegetables, dairy_components, fruits, family_rating, prep_time_minutes, dietary_tags, notes'

/** Cookbook, recent meal log and preferences: loaded once per visit. */
async function loadKitchen(userId) {
  const householdId = await getHouseholdId(supabase, userId)
  const since = addDays(formatLocalDate(), -90)
  const [vaultRes, mealsRes, preferences] = await Promise.all([
    supabase.from('vault').select(VAULT_COLUMNS).eq('household_id', householdId)
      .is('deleted_at', null).order('name', { ascending: true }),
    supabase.from('meals').select('id, name, vault_id, eaten_on').eq('household_id', householdId)
      .gte('eaten_on', since).order('eaten_on', { ascending: false }),
    getPreferences(userId, supabase).catch(() => null), // suggestions work without them
  ])
  if (vaultRes.error) throw vaultRes.error
  if (mealsRes.error) throw mealsRes.error
  return { vault: vaultRes.data ?? [], recentMeals: mealsRes.data ?? [], preferences }
}

export function usePrepTable(userId, { today = formatLocalDate() } = {}) {
  const [weekStart, setWeekStart] = useState(() => thisWeekStart(today))
  const [week, setWeek] = useState(null)          // { meals, weekDays, usualDays, weekEnd }
  const [maybe, setMaybe] = useState([])
  const [tray, setTray] = useState([])
  const [kitchen, setKitchen] = useState({ vault: [], recentMeals: [], preferences: null })
  const [proposals, setProposals] = useState({})  // date → recipe (not saved)
  const [skipped, setSkipped] = useState([])      // recipe ids dismissed this visit
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const loadSeq = useRef(0)

  const reload = useCallback(async (start = weekStart) => {
    const seq = ++loadSeq.current
    try {
      const [w, m, t] = await Promise.all([
        loadWeek(supabase, userId, start),
        loadMaybeList(supabase, userId),
        loadDidntGetTo(supabase, userId, today),
      ])
      if (seq !== loadSeq.current) return // a newer load (← / →) won
      setWeek(w)
      setMaybe(m)
      setTray(t)
      setError(null)
    } catch (err) {
      if (seq === loadSeq.current) setError("Couldn't load the plan. Pull down or try again.")
      console.error('[PrepTable] load failed', err)
    }
  }, [userId, today, weekStart])

  // Week data: on open and on ← / →.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadWeek(supabase, userId, weekStart),
      loadMaybeList(supabase, userId),
      loadDidntGetTo(supabase, userId, today),
    ]).then(([w, m, t]) => {
      if (cancelled) return
      setWeek(w); setMaybe(m); setTray(t); setError(null)
    }).catch((err) => {
      if (cancelled) return
      setError("Couldn't load the plan. Pull down or try again.")
      console.error('[PrepTable] load failed', err)
    })
    return () => { cancelled = true }
  }, [userId, weekStart, today])

  // Cookbook etc.: once.
  useEffect(() => {
    let cancelled = false
    loadKitchen(userId)
      .then((k) => { if (!cancelled) setKitchen(k) })
      .catch((err) => console.error('[PrepTable] cookbook load failed', err))
    return () => { cancelled = true }
  }, [userId])

  const meals = useMemo(() => week?.meals ?? [], [week])
  const mealDates = useMemo(() => meals.map((m) => m.planned_on), [meals])
  const dayArgs = useMemo(() => ({
    weekStart,
    weekDays: week?.weekDays ?? null,
    usualDays: week?.usualDays ?? null,
    mealDates,
  }), [weekStart, week, mealDates])
  const dates = useMemo(() => shownDates(dayArgs), [dayArgs])
  const mealsByDate = useMemo(() => {
    const by = {}
    for (const m of meals) (by[m.planned_on] ||= []).push(m)
    return by
  }, [meals])

  /** Run one write, then reload. Shows a plain message if it fails. */
  const act = useCallback(async (fn, failMsg) => {
    setBusy(true)
    try {
      await fn()
      await reload()
    } catch (err) {
      console.error('[PrepTable] write failed', err)
      setError(failMsg)
    } finally {
      setBusy(false)
    }
  }, [reload])

  const goWeek = (n) => {
    setProposals({})
    setWeek(null)
    setWeekStart((s) => shiftWeek(s, n))
  }
  const goThisWeek = () => {
    setProposals({})
    setWeek(null)
    setWeekStart(thisWeekStart(today))
  }

  const toggleDay = (day) => {
    if (!week) return
    const days = nextDays(day, dayArgs)
    // Hiding a day drops any proposal sitting on it.
    const hiddenDate = addDays(weekStart, day)
    if (!days.includes(day)) setProposals((p) => without(p, hiddenDate))
    return act(() => saveWeekDays(supabase, userId, weekStart, days), "Couldn't save the days. Try again.")
  }

  const nextPosition = (date) => (mealsByDate[date]?.length ?? 0)

  const addToDay = (date, { name, vaultId = null, isWildcard = false, sourceUrl = null }) =>
    act(() => addMeal(supabase, userId, {
      plannedOn: date, name, vaultId, isWildcard, sourceUrl, position: nextPosition(date),
    }), "Couldn't add that meal. Try again.")

  const addToMaybe = ({ name, vaultId = null }) =>
    act(() => addMeal(supabase, userId, { plannedOn: null, name, vaultId, position: maybe.length }),
      "Couldn't add to Maybe. Try again.")

  /** Move a meal (including a Maybe one) to a date, or to Maybe with null. */
  const moveTo = (meal, date) =>
    act(() => moveMeal(supabase, meal.id, {
      plannedOn: date,
      position: date ? nextPosition(date) : maybe.length,
    }), "Couldn't move that meal. Try again.")

  /** From "Didn't get to these": a NEW meal on the day; the old one stays as history. */
  const replan = (meal, date) =>
    addToDay(date, { name: meal.name, vaultId: meal.vault_id, isWildcard: meal.is_wildcard, sourceUrl: meal.source_url })

  const remove = (meal) => act(() => removeMeal(supabase, meal.id), "Couldn't remove that meal. Try again.")

  const toggleCooked = (meal) =>
    act(() => setCooked(supabase, meal.id, !meal.cooked), "Couldn't update that meal. Try again.")

  // ---- ✨ suggest (D3: proposals only) ----------------------------------
  const emptyUpcoming = useMemo(
    () => dates.filter((d) => d >= today && !mealsByDate[d]?.length),
    [dates, today, mealsByDate],
  )

  const propose = (forDates) => {
    const taken = Object.values(proposals).map((r) => r.id)
    const fresh = suggestForDays({
      dates: forDates,
      vault: kitchen.vault,
      recentMeals: kitchen.recentMeals,
      weekMeals: meals,
      preferences: kitchen.preferences,
      skipIds: [...skipped, ...taken],
    })
    setProposals((p) => ({ ...p, ...fresh }))
    return fresh
  }

  /** ✨ for the whole visible week: every empty day from today on. */
  const suggestEmptyDays = () => propose(emptyUpcoming.filter((d) => !proposals[d]))

  /** ✨ for one day; tapping again swaps in a different recipe. */
  const suggestDay = (date) => {
    const current = proposals[date]
    if (current) {
      setSkipped((s) => [...s, current.id])
      setProposals((p) => without(p, date))
    }
    const taken = Object.entries(proposals).filter(([d]) => d !== date).map(([, r]) => r.id)
    const fresh = suggestForDays({
      dates: [date],
      vault: kitchen.vault,
      recentMeals: kitchen.recentMeals,
      weekMeals: meals,
      preferences: kitchen.preferences,
      skipIds: [...skipped, ...taken, ...(current ? [current.id] : [])],
    })
    setProposals((p) => ({ ...p, ...fresh }))
  }

  const acceptProposal = (date) => {
    const recipe = proposals[date]
    if (!recipe) return
    setProposals((p) => without(p, date))
    return addToDay(date, { name: recipe.name, vaultId: recipe.id })
  }

  const dismissProposal = (date) => {
    const recipe = proposals[date]
    if (!recipe) return
    setSkipped((s) => [...s, recipe.id])
    setProposals((p) => without(p, date))
  }

  return {
    today,
    weekStart,
    weekEnd: addDays(weekStart, 6),
    loading: !week,
    error,
    clearError: () => setError(null),
    busy,
    dayArgs,
    dates,
    mealsByDate,
    maybe,
    tray,
    vault: kitchen.vault,
    proposals,
    canSuggest: kitchen.vault.length > 0 && emptyUpcoming.length > 0,
    goWeek,
    goThisWeek,
    toggleDay,
    addToDay,
    addToMaybe,
    moveTo,
    replan,
    remove,
    toggleCooked,
    suggestEmptyDays,
    suggestDay,
    acceptProposal,
    dismissProposal,
  }
}
