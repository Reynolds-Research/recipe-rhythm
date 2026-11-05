/**
 * usePrepTable — data + actions for the new Prep Table (PRD-008 phase 2b-2).
 *
 * Mental model: the database is the source of truth. Every action writes one
 * row through src/lib/plannedMeals.js, then reloads the week. The one
 * exception is a drag-and-drop, which moves the meal on screen first (see
 * dropOnDay) and undoes that if the save fails. Otherwise no optimistic
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
  keepsCookedTick,
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
import {
  confirmWeek as stampWeek,
  keepListAsIs,
  loadConfirmation,
  loadGroceryItems,
  makeWeekGroceryList,
  WeekGroceryError,
} from '../../lib/weekGroceries'

/**
 * Says which recipes the list couldn't really use, so a gap is never silent:
 * none with no ingredients at all (left off), or ones with no saved list
 * (their part is a guess). The fix for both: screenshots in the Cookbook.
 */
export function thinRecipesNote({ noIngredients = [], noList = [] } = {}) {
  const parts = []
  if (noIngredients.length) parts.push(`${noIngredients.join(', ')} added nothing (no ingredients).`)
  if (noList.length) parts.push(`${noList.join(', ')} ${noList.length === 1 ? 'has' : 'have'} no ingredient list, so ${noList.length === 1 ? 'its' : 'their'} part is a guess.`)
  return parts.length ? `${parts.join(' ')} Add screenshots in the Cookbook for the real amounts.` : null
}

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
  const [week, setWeek] = useState(null)          // { weekStart, meals, weekDays, usualDays }
  const [maybe, setMaybe] = useState([])
  const [tray, setTray] = useState([])
  const [kitchen, setKitchen] = useState({ vault: [], recentMeals: [], preferences: null })
  const [proposals, setProposals] = useState({})  // date → recipe (not saved)
  const [skipped, setSkipped] = useState([])      // recipe ids dismissed this visit
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [making, setMaking] = useState(false)     // the grocery-list AI call is running
  const [notice, setNotice] = useState(null)      // a note under "Confirmed" (not an error)
  const [groceries, setGroceries] = useState({ open: false, loading: false, failed: false, items: [] })
  // Numbered loads: only the newest one may change the screen, so a slow
  // reload (after a save) can never paint over a week opened since (← / →).
  const loadSeq = useRef(0)
  const weekRef = useRef(weekStart)          // the week on screen, for reloads
  useEffect(() => { weekRef.current = weekStart }, [weekStart])

  /** The week, its confirmation, Maybe list and tray, as plain data (no state changes here). */
  const queryWeek = useCallback((start) => Promise.all([
    loadWeek(supabase, userId, start),
    loadMaybeList(supabase, userId),
    loadDidntGetTo(supabase, userId, today),
    loadConfirmation(supabase, userId, start),
  ]), [userId, today])

  /** Show a load's result, unless a newer load has started since. */
  const applyLoad = useCallback((seq, start, [w, m, t, c]) => {
    if (seq !== loadSeq.current) return
    setWeek({ ...w, weekStart: start, confirmation: c ?? null })
    setMaybe(m)
    setTray(t)
    setError(null)
  }, [])

  const loadFailed = useCallback((seq, err) => {
    if (seq === loadSeq.current) setError("Couldn't load the plan. Check your connection and try again.")
    console.error('[PrepTable] load failed', err)
  }, [])

  /** Reload whatever week is on screen now (not the one a save started on). true if it loaded. */
  const reload = useCallback(async () => {
    const seq = ++loadSeq.current
    const start = weekRef.current
    try {
      applyLoad(seq, start, await queryWeek(start))
      return true
    } catch (err) {
      loadFailed(seq, err)
      return false
    }
  }, [queryWeek, applyLoad, loadFailed])

  // Week data: on open and on ← / →.
  useEffect(() => {
    let cancelled = false
    const seq = ++loadSeq.current
    queryWeek(weekStart)
      .then((r) => { if (!cancelled) applyLoad(seq, weekStart, r) })
      .catch((err) => { if (!cancelled) loadFailed(seq, err) })
    return () => { cancelled = true }
  }, [queryWeek, applyLoad, loadFailed, weekStart])

  // Cookbook etc.: once.
  useEffect(() => {
    let cancelled = false
    loadKitchen(userId)
      .then((k) => { if (!cancelled) setKitchen(k) })
      .catch((err) => console.error('[PrepTable] cookbook load failed', err))
    return () => { cancelled = true }
  }, [userId])

  // Belt and braces: only ever draw the week whose start matches the title.
  const current = week && week.weekStart === weekStart ? week : null
  const meals = useMemo(() => current?.meals ?? [], [current])
  const mealDates = useMemo(() => meals.map((m) => m.planned_on), [meals])
  const dayArgs = useMemo(() => ({
    weekStart,
    weekDays: current?.weekDays ?? null,
    usualDays: current?.usualDays ?? null,
    mealDates,
  }), [weekStart, current, mealDates])
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
      return true
    } catch (err) {
      console.error('[PrepTable] write failed', err)
      setError(failMsg)
      return false
    } finally {
      setBusy(false)
    }
  }, [reload])

  const leaveWeek = () => {
    setProposals({})
    setNotice(null)
    setGroceries((g) => ({ ...g, open: false }))
  }

  const goWeek = (n) => {
    if (busy) return
    leaveWeek()
    setWeek(null)
    setWeekStart((s) => shiftWeek(s, n))
  }
  const goThisWeek = () => {
    if (busy) return
    leaveWeek()
    setWeek(null)
    setWeekStart(thisWeekStart(today))
  }

  const toggleDay = (day) => {
    if (!current || busy) return
    const days = nextDays(day, dayArgs)
    // Hiding a day drops any proposal sitting on it.
    const hiddenDate = addDays(weekStart, day)
    if (!days.includes(day)) setProposals((p) => without(p, hiddenDate))
    return act(() => saveWeekDays(supabase, userId, weekStart, days), "Couldn't save the days. Try again.")
  }

  const nextPosition = (date) => (mealsByDate[date]?.length ?? 0)

  const addToDay = async (date, { name, vaultId = null, isWildcard = false, sourceUrl = null }) => {
    const ok = await act(() => addMeal(supabase, userId, {
      plannedOn: date, name, vaultId, isWildcard, sourceUrl, position: nextPosition(date),
    }), "Couldn't add that meal. Try again.")
    // The day has a meal now: any suggestion on it is settled (kept or replaced).
    if (ok) setProposals((p) => without(p, date))
    return ok
  }

  const addToMaybe = ({ name, vaultId = null }) =>
    act(() => addMeal(supabase, userId, { plannedOn: null, name, vaultId, position: maybe.length }),
      "Couldn't add to Maybe. Try again.")

  /** Move a meal (including a Maybe one) to a date, or to Maybe with null. */
  const moveTo = async (meal, date) => {
    const ok = await act(() => moveMeal(supabase, meal.id, {
      plannedOn: date,
      position: date ? nextPosition(date) : maybe.length,
      ...tickChange(meal, date, null),
    }), "Couldn't move that meal. Try again.")
    if (ok && date) setProposals((p) => without(p, date))
    return ok
  }

  /** From "Didn't get to these": a NEW meal on the day; the old one stays as history. */
  const replan = (meal, date) =>
    addToDay(date, { name: meal.name, vaultId: meal.vault_id, isWildcard: meal.is_wildcard, sourceUrl: meal.source_url })

  /**
   * The cooked tick when a meal moves (keepsCookedTick, Matt 2026-11-04):
   * `{ cooked: false }` to clear it, or nothing to leave it as it is.
   */
  const tickChange = (m, toDate, partner) =>
    (m.cooked && !keepsCookedTick(m, toDate, partner, today) ? { cooked: false } : {})

  /**
   * Drag-and-drop. The dragged meal moves to `date`; if `swapWithId` is given,
   * that meal takes the dragged meal's old day and spot (they swap). Nothing
   * else moves.
   *
   * The screen changes at once, then the saves run (one, or two for a swap).
   * If a save fails, any save that already went through is undone, the week
   * from before the drop is put straight back (no network needed, so it works
   * offline) and a message says so — never half a swap. `busy` stays on until
   * it's settled, so another drop can't start halfway.
   */
  const dropOnDay = async (mealId, date, swapWithId = null) => {
    if (busy || !current) return false
    const meal = meals.find((m) => m.id === mealId)
    const other = swapWithId ? meals.find((m) => m.id === swapWithId) : null
    if (!meal || (swapWithId && !other)) return false
    if (!other && meal.planned_on === date) return false

    const before = current
    const from = { plannedOn: meal.planned_on, position: meal.position ?? 0 }
    const to = other
      ? { plannedOn: other.planned_on, position: other.position ?? 0 }
      : { plannedOn: date, position: nextPosition(date) }
    const mealTo = { ...to, ...tickChange(meal, to.plannedOn, other) }
    const otherTo = other ? { ...from, ...tickChange(other, from.plannedOn, meal) } : null
    const onScreen = (m, dest) => ({
      ...m, planned_on: dest.plannedOn, position: dest.position,
      ...(dest.cooked === false ? { cooked: false, cooked_at: null } : {}),
    })

    setWeek((w) => (w ? {
      ...w,
      meals: w.meals.map((m) => {
        if (m.id === mealId) return onScreen(m, mealTo)
        if (other && m.id === other.id) return onScreen(m, otherTo)
        return m
      }),
    } : w))
    setBusy(true)
    let firstSaved = false
    try {
      await moveMeal(supabase, mealId, mealTo)
      firstSaved = true
      if (other) await moveMeal(supabase, other.id, otherTo)
      setProposals((p) => without(p, to.plannedOn))
      await reload()
      return true
    } catch (err) {
      console.error('[PrepTable] move failed', err)
      let undone = true
      if (firstSaved) {
        // Half a swap went through: put the dragged meal back.
        // Back to its day and spot, with its tick exactly as it was.
        const back = { ...from, ...(meal.cooked ? { cooked: true, cookedAt: meal.cooked_at } : {}) }
        undone = await moveMeal(supabase, mealId, back).then(() => true, (e) => {
          console.error('[PrepTable] undo failed', e)
          return false
        })
      }
      if (undone) {
        // Nothing changed in the database: show the week as it was.
        setWeek((w) => (w && w.weekStart === before.weekStart ? before : w))
        setError(other ? "Couldn't swap those meals. Try again." : "Couldn't move that meal. Try again.")
      } else {
        // Half-swapped and the undo failed too: show what's really saved, or,
        // if even that can't load, say plainly that a refresh is needed.
        const loaded = await reload()
        setError(loaded
          ? "Couldn't finish swapping those meals. Here's where they are now."
          : "Couldn't finish swapping those meals. Refresh to see where they are.")
      }
      return false
    } finally {
      setBusy(false)
    }
  }

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

  const acceptProposal = async (date) => {
    const recipe = proposals[date]
    if (!recipe) return
    // addToDay clears the proposal once the meal is saved; if the save fails
    // the suggestion stays, so she can tap ✓ again.
    await addToDay(date, { name: recipe.name, vaultId: recipe.id })
  }

  const dismissProposal = (date) => {
    const recipe = proposals[date]
    if (!recipe) return
    setSkipped((s) => [...s, recipe.id])
    setProposals((p) => without(p, date))
  }

  // ---- Confirm the week + groceries (2b-3) ------------------------------
  const confirmation = current?.confirmation ?? null

  /** Shown days from today on with no meal: told before confirming, never blocking. */
  const emptyDays = emptyUpcoming

  /** Meals this week that can't go on the list (no cookbook recipe). */
  const leftOff = useMemo(() => meals.filter((m) => !m.vault_id).map((m) => m.name), [meals])

  const openGroceries = async (listId = confirmation?.grocery_list_id) => {
    if (!listId) return
    // Tied to the week it was opened on: if she moves to another week while
    // it loads, the sheet stays closed (it never shows last week's list).
    const forWeek = weekRef.current
    setGroceries({ open: true, loading: true, failed: false, items: [] })
    try {
      const items = await loadGroceryItems(supabase, listId)
      if (weekRef.current === forWeek) setGroceries({ open: true, loading: false, failed: false, items })
    } catch (err) {
      console.error('[PrepTable] grocery list load failed', err)
      if (weekRef.current === forWeek) setGroceries({ open: true, loading: false, failed: true, items: [] })
    }
  }
  const closeGroceries = () => setGroceries((g) => ({ ...g, open: false }))

  /**
   * Make the list for `conf`, reload, and open it. Failures leave the week
   * confirmed (the stamp is her say; the list can be made again).
   * `failMsg` is for an unexpected failure.
   */
  const makeList = async (conf, failMsg) => {
    setMaking(true)
    let made = null
    let message = null
    try {
      made = await makeWeekGroceryList(supabase, userId, conf)
    } catch (err) {
      console.error('[PrepTable] grocery list failed', err)
      if (err instanceof WeekGroceryError && err.code === 'no_recipes') {
        setNotice("None of this week's meals are cookbook recipes with ingredients, so there's no grocery list yet.")
      } else {
        message = failMsg
      }
    } finally {
      setMaking(false)
    }
    await reload()
    if (message) setError(message)
    if (made) {
      setNotice(thinRecipesNote(made))
      openGroceries(made.listId)
    }
    return Boolean(made)
  }

  /** Her final say: stamp the week, then make its grocery list. */
  const confirm = async () => {
    if (busy || !current) return false
    setBusy(true)
    setNotice(null)
    try {
      let conf = confirmation
      if (!conf) {
        try {
          conf = await stampWeek(supabase, userId, weekStart)
        } catch (err) {
          console.error('[PrepTable] confirm failed', err)
          setError("Couldn't confirm the week. Try again.")
          return false
        }
      }
      return await makeList(conf, "The week is confirmed, but the grocery list couldn't be made. Try again.")
    } finally {
      setBusy(false)
    }
  }

  /** "Update grocery list" (after a change) or "Make the grocery list" (none yet). */
  const updateList = async () => {
    if (busy || !confirmation) return false
    setBusy(true)
    setNotice(null)
    try {
      return await makeList(confirmation, "Couldn't make the grocery list. Try again.")
    } finally {
      setBusy(false)
    }
  }

  /** "Keep as is": the list stays, the prompt goes. */
  const keepAsIs = () => {
    if (busy || !confirmation) return false
    return act(() => keepListAsIs(supabase, confirmation), "Couldn't save that. Try again.")
  }

  return {
    today,
    weekStart,
    weekEnd: addDays(weekStart, 6),
    loading: !current,
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
    dropOnDay,
    replan,
    remove,
    toggleCooked,
    suggestEmptyDays,
    suggestDay,
    acceptProposal,
    dismissProposal,
    confirmation,
    changedSinceConfirmed: Boolean(confirmation?.changed_at),
    canConfirm: !confirmation && meals.length > 0 && addDays(weekStart, 6) >= today,
    emptyDays,
    leftOff,
    making,
    notice,
    groceries,
    confirm,
    updateList,
    keepAsIs,
    openGroceries: () => openGroceries(),
    closeGroceries,
  }
}
