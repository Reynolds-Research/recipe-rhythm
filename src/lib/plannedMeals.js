/**
 * plannedMeals.js — data helpers for the new Prep Table (PRD-008 P0.4, phase 2b-1).
 *
 * Mental model: every planned meal is its own row in `planned_meals` with a
 * date (`planned_on`); a meal with no date is on the Maybe list. A "week" is
 * just a date range we ask for. Which days the week shows lives in two small
 * places: `week_days` (weeks she changed) and `household_preferences.usual_days`.
 *
 * Every function takes the supabase client first, so tests pass a fake
 * (same pattern as preferences.js / planDraft.js). Reads and adds scope by
 * household through getHouseholdId(); edits by id rely on the security rules,
 * which only let household members touch a row.
 *
 *   loadWeek(supabase, userId, date)          → { weekStart, weekEnd, meals, weekDays, usualDays }
 *   loadWeekMeals / loadWeekDays               → the two halves of loadWeek
 *   saveWeekDays(supabase, userId, weekStart, days) → days saved
 *   addMeal(supabase, userId, meal)            → the new row
 *   moveMeal(supabase, mealId, { plannedOn, position })
 *   removeMeal(supabase, mealId)
 *   setCooked(supabase, mealId, cooked)
 *   loadMaybeList(supabase, userId)            → meals with no date
 *   loadDidntGetTo(supabase, userId, today)    → "Didn't get to these"
 *   loadCalendarRange(supabase, userId, from, to) → Calendar tab (2c)
 *   loadUpcomingMeals / removeMeals            → Preferences' rule check (2c)
 *
 * Nothing here writes to the old plan tables. The screens that use these are
 * behind VITE_NEW_PREP_TABLE (src/lib/featureFlags.js).
 */

import { getHouseholdId } from './household'
import { formatLocalDate } from './dateUtils'
import { addDays, dayOfWeek, normalizeDays, weekBounds, weekStartFor, DEFAULT_USUAL_DAYS } from './weekRange'

export const MEAL_COLUMNS =
  'id, household_id, planned_on, position, name, vault_id, is_wildcard, source_url, ' +
  'cooked, cooked_at, assigned_to, assigned_at, user_id, created_at, updated_at'

/** How far back "Didn't get to these" looks (PRD-008 §4.7: two weeks). */
export const DIDNT_GET_TO_DAYS = 14

function check({ data, error }) {
  if (error) throw error
  return data
}

// ---------------------------------------------------------------------------
// Week: meals + which days show
// ---------------------------------------------------------------------------

/** Meals planned in the week `date` is in, by day then position. */
export async function loadWeekMeals(supabase, userId, date) {
  const householdId = await getHouseholdId(supabase, userId)
  const { start, end } = weekBounds(date)
  const rows = check(
    await supabase
      .from('planned_meals')
      .select(MEAL_COLUMNS)
      .eq('household_id', householdId)
      .gte('planned_on', start)
      .lte('planned_on', end)
      .order('planned_on', { ascending: true })
      .order('position', { ascending: true }),
  )
  return rows ?? []
}

/**
 * This week's own days (null if she never changed this week) and the
 * household's usual days (Sun–Thu if none saved yet).
 */
export async function loadWeekDays(supabase, userId, date) {
  const householdId = await getHouseholdId(supabase, userId)
  const weekStart = weekStartFor(date)
  const [week, prefs] = await Promise.all([
    supabase
      .from('week_days')
      .select('days')
      .eq('household_id', householdId)
      .eq('week_start', weekStart)
      .maybeSingle(),
    supabase
      .from('household_preferences')
      .select('usual_days')
      .eq('household_id', householdId)
      .maybeSingle(),
  ])
  const weekRow = check(week)
  const prefsRow = check(prefs)
  const usual = normalizeDays(prefsRow?.usual_days)
  return {
    weekDays: Array.isArray(weekRow?.days) ? normalizeDays(weekRow.days) : null,
    usualDays: usual.length ? usual : [...DEFAULT_USUAL_DAYS],
  }
}

/** Everything the week screen needs for the week `date` is in. */
export async function loadWeek(supabase, userId, date) {
  const { start, end } = weekBounds(date)
  const [meals, days] = await Promise.all([
    loadWeekMeals(supabase, userId, date),
    loadWeekDays(supabase, userId, date),
  ])
  return { weekStart: start, weekEnd: end, meals, ...days }
}

/**
 * Save which days a week shows. Also makes them the household's usual days,
 * so the next untouched week starts the same (D8: "a new week starts with the
 * days of the last week she changed"). An empty week (vacation) is saved for
 * that week only and leaves the usual days alone.
 *
 * Pass the week's CHOSEN days (weekRange's toggleDay / baseDays), never the
 * shown days — meal days are added on screen and must not be saved (D8).
 * Two writes, week first: if the second fails, the week is saved and the
 * error is thrown; the usual days just stay as they were (harmless).
 */
export async function saveWeekDays(supabase, userId, weekStart, days) {
  const start = weekStartFor(weekStart)
  if (start !== weekStart) throw new Error(`saveWeekDays: ${weekStart} is not a Sunday`)
  const clean = normalizeDays(days)
  const householdId = await getHouseholdId(supabase, userId)

  check(
    await supabase
      .from('week_days')
      .upsert(
        { household_id: householdId, week_start: start, days: clean, user_id: userId },
        { onConflict: 'household_id,week_start' },
      ),
  )
  if (clean.length) {
    check(
      await supabase
        .from('household_preferences')
        .upsert(
          { household_id: householdId, user_id: userId, usual_days: clean },
          { onConflict: 'household_id' },
        ),
    )
  }
  return clean
}

// ---------------------------------------------------------------------------
// Meals: add, move, remove, cooked
// ---------------------------------------------------------------------------

/**
 * Add a meal. `plannedOn` null (or left out) puts it on the Maybe list.
 * `vaultId` links a cookbook recipe; leave it out for a one-off meal.
 */
export async function addMeal(
  supabase,
  userId,
  { plannedOn = null, name, vaultId = null, isWildcard = false, sourceUrl = null, position = 0 },
) {
  const clean = typeof name === 'string' ? name.trim() : ''
  if (!clean) throw new Error('addMeal: a meal needs a name')
  if (plannedOn !== null) dayOfWeek(plannedOn) // throws on a malformed date
  const householdId = await getHouseholdId(supabase, userId)
  return check(
    await supabase
      .from('planned_meals')
      .insert({
        household_id: householdId,
        user_id: userId,
        planned_on: plannedOn,
        position,
        name: clean,
        vault_id: vaultId,
        is_wildcard: isWildcard,
        source_url: sourceUrl,
      })
      .select(MEAL_COLUMNS)
      .single(),
  )
}

/**
 * Does a meal keep its "cooked" tick when it moves? (Matt, 2026-11-04)
 *   - moved to a future day          → no: you can't have cooked the future
 *   - a plain move (no swap)         → no: it wasn't cooked on its new night
 *   - swapped with another cooked meal, on today or a past day → yes
 *   - reordered on its own day       → yes (same night)
 * A meal never gains a tick by moving.
 *
 * @param {{cooked: boolean, planned_on?: string}} meal  the meal that moves
 * @param {string} toDate               where it lands
 * @param {{cooked: boolean}|null} partner  the meal it swaps with, if any
 * @param {string} today                'YYYY-MM-DD'
 */
export function keepsCookedTick(meal, toDate, partner, today) {
  if (!meal?.cooked) return false
  if (toDate === meal.planned_on) return true      // same night, just reordered
  if (!toDate || toDate > today) return false
  return !!partner?.cooked
}

/**
 * Move a meal to another day (or to the Maybe list with plannedOn null),
 * optionally to a new position.
 *
 * `cooked`: false clears the tick (and its time); true sets it, back to
 * `cookedAt` if given (used to undo a failed swap exactly); leave it out to
 * keep the tick as it is. A meal moved to Maybe is never cooked (the database
 * refuses a cooked meal with no date).
 */
export async function moveMeal(supabase, mealId, { plannedOn, position, cooked, cookedAt } = {}) {
  if (plannedOn === undefined && position === undefined) {
    throw new Error('moveMeal: give plannedOn and/or position')
  }
  const patch = {}
  if (plannedOn !== undefined) {
    if (plannedOn !== null) dayOfWeek(plannedOn)
    patch.planned_on = plannedOn
  }
  if (position !== undefined) patch.position = position
  if (cooked === false || plannedOn === null) {
    patch.cooked = false
    patch.cooked_at = null
  } else if (cooked === true) {
    patch.cooked = true
    patch.cooked_at = cookedAt ?? new Date().toISOString()
  }
  return check(
    await supabase.from('planned_meals').update(patch).eq('id', mealId).select(MEAL_COLUMNS).single(),
  )
}

/** Remove a meal from the plan. */
export async function removeMeal(supabase, mealId) {
  check(await supabase.from('planned_meals').delete().eq('id', mealId))
}

/** Tick (or untick) "cooked". */
export async function setCooked(supabase, mealId, cooked, now = new Date()) {
  return check(
    await supabase
      .from('planned_meals')
      .update({ cooked: !!cooked, cooked_at: cooked ? now.toISOString() : null })
      .eq('id', mealId)
      .select(MEAL_COLUMNS)
      .single(),
  )
}

// ---------------------------------------------------------------------------
// Maybe list and "Didn't get to these"
// ---------------------------------------------------------------------------

/** Meals with no date, oldest first. */
export async function loadMaybeList(supabase, userId) {
  const householdId = await getHouseholdId(supabase, userId)
  const rows = check(
    await supabase
      .from('planned_meals')
      .select(MEAL_COLUMNS)
      .eq('household_id', householdId)
      .is('planned_on', null)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
  )
  return rows ?? []
}

/** Same recipe, or same name when there's no recipe link. */
function mealKey(meal) {
  return meal.vault_id ? `v:${meal.vault_id}` : `n:${meal.name.trim().toLowerCase()}`
}

/**
 * The tray's rule, without the database: past uncooked meals, newest first,
 * one per recipe, minus anything already planned from today on (she already
 * put it back on a day). Pure, so it's easy to test.
 */
export function pickDidntGetTo(pastUncooked = [], upcoming = []) {
  const planned = new Set(upcoming.map(mealKey))
  const seen = new Set()
  const out = []
  const newestFirst = [...pastUncooked].sort((a, b) =>
    a.planned_on === b.planned_on ? 0 : a.planned_on < b.planned_on ? 1 : -1,
  )
  for (const meal of newestFirst) {
    const key = mealKey(meal)
    if (planned.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(meal)
  }
  return out
}

/**
 * "Didn't get to these": uncooked meals from the last two weeks (the 14 days
 * before today; today's meal isn't missed yet). The old rows stay on their
 * dates as history (PRD-008 goal 7) — tapping one in the tray adds a NEW meal
 * on a day (addMeal), and from then on it drops out of the tray.
 */
export async function loadDidntGetTo(supabase, userId, today = formatLocalDate()) {
  const householdId = await getHouseholdId(supabase, userId)
  const from = addDays(today, -DIDNT_GET_TO_DAYS)
  const to = addDays(today, -1)
  const [past, upcoming] = await Promise.all([
    supabase
      .from('planned_meals')
      .select(MEAL_COLUMNS)
      .eq('household_id', householdId)
      .eq('cooked', false)
      .gte('planned_on', from)
      .lte('planned_on', to)
      .order('planned_on', { ascending: false }),
    supabase
      .from('planned_meals')
      .select('name, vault_id')
      .eq('household_id', householdId)
      .gte('planned_on', today),
  ])
  return pickDidntGetTo(check(past) ?? [], check(upcoming) ?? [])
}

// ---------------------------------------------------------------------------
// Other screens that move to planned_meals at the switch-over (PRD-008 2c)
// ---------------------------------------------------------------------------

/**
 * Calendar tab: the dated meals and the confirmed weeks that touch
 * [fromDate, toDate] (both 'YYYY-MM-DD', inclusive). Maybe meals (no date)
 * never show on a calendar. A confirmation counts when any of its days fall
 * in the window.
 *
 * @returns {Promise<{
 *   meals: Array<{id: string, planned_on: string, position: number, name: string, cooked: boolean}>,
 *   confirmations: Array<{id: string, starts_on: string, ends_on: string}>,
 * }>}
 */
export async function loadCalendarRange(supabase, userId, fromDate, toDate) {
  const householdId = await getHouseholdId(supabase, userId)
  const [meals, confirmations] = await Promise.all([
    supabase
      .from('planned_meals')
      .select('id, planned_on, position, name, cooked')
      .eq('household_id', householdId)
      .gte('planned_on', fromDate)
      .lte('planned_on', toDate)
      .order('planned_on', { ascending: true })
      .order('position', { ascending: true }),
    supabase
      .from('week_confirmations')
      .select('id, starts_on, ends_on')
      .eq('household_id', householdId)
      .lte('starts_on', toDate)
      .gte('ends_on', fromDate)
      .order('starts_on', { ascending: true }),
  ])
  return { meals: check(meals) ?? [], confirmations: check(confirmations) ?? [] }
}

/** The recipe tags passesPreferences reads (src/lib/preferenceFilter.js). */
const RULE_COLUMNS =
  'cuisine_type, prep_time_minutes, proteins, vegetables, fruits, dairy_components, main_carb, dietary_tags'

/**
 * Preferences: the meals a new rule could still change — uncooked meals dated
 * today or later, each with its recipe's tags flattened on (same shape the old
 * getActivePeriodItems returned, so passesPreferences reads it unchanged).
 * Left out on purpose (Matt, 2026-11-06): Maybe meals (ideas, not plans —
 * "Remove all" must not wipe them) and past meals (history).
 */
export async function loadUpcomingMeals(supabase, userId, today = formatLocalDate()) {
  const householdId = await getHouseholdId(supabase, userId)
  const rows = check(
    await supabase
      .from('planned_meals')
      .select(`id, planned_on, name, vault_id, vault:vault_id (${RULE_COLUMNS})`)
      .eq('household_id', householdId)
      .eq('cooked', false)
      .gte('planned_on', today)
      .order('planned_on', { ascending: true }),
  )
  return (rows ?? []).map((row) => {
    const v = Array.isArray(row.vault) ? row.vault[0] : row.vault
    return {
      id: row.id,
      name: row.name,
      vault_id: row.vault_id ?? null,
      planned_on: row.planned_on,
      cuisine_type: v?.cuisine_type ?? null,
      prep_time_minutes: v?.prep_time_minutes ?? null,
      proteins: v?.proteins ?? null,
      vegetables: v?.vegetables ?? null,
      fruits: v?.fruits ?? null,
      dairy_components: v?.dairy_components ?? null,
      main_carb: v?.main_carb ?? null,
      dietary_tags: v?.dietary_tags ?? null,
    }
  })
}

/** Remove several meals at once (Preferences' "Remove all"). */
export async function removeMeals(supabase, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return
  check(await supabase.from('planned_meals').delete().in('id', ids))
}
