/**
 * weekGroceries.js — "Confirm the week" and its grocery list (PRD-008 P0.6, phase 2b-3).
 *
 * Mental model: a confirmation is a STAMP, not a lock (D4). One
 * `week_confirmations` row per household per week (Sun–Sat), pointing at the
 * week's grocery list. When a meal in the week is added, removed, renamed,
 * re-linked or moved, a database trigger sets the row's `changed_at` (phase
 * 2a). The screen reads that stamp to say "changed since you confirmed".
 * Making the list again, or "Keep as is", clears it.
 *
 * Making the list never edits the old one in place: it builds a NEW list,
 * points the confirmation at it, then deletes the old one. So if anything
 * fails halfway (the AI call, a write), the old list is still whole.
 *
 *   loadConfirmation(supabase, userId, weekStart) → row | null
 *   confirmWeek(supabase, userId, weekStart)      → row (the existing one if already confirmed)
 *   makeWeekGroceryList(supabase, userId, confirmation, { fetchApi })
 *                                                → { listId, notInCookbook, noIngredients }
 *   keepListAsIs(supabase, confirmation)          → true if the stamp was cleared
 *   loadGroceryItems(supabase, listId)            → items
 *
 * Supabase client first, like plannedMeals.js, so tests pass a fake.
 */

import { getHouseholdId } from './household'
import { getPreferences } from './preferences'
import { apiFetch } from './apiClient'
import { GROCERY_VAULT_COLUMNS, groceryPrefs, recipesFromMeals } from './groceryRecipes'
import { weekBounds, weekStartFor } from './weekRange'

export const CONFIRMATION_COLUMNS =
  'id, household_id, starts_on, ends_on, user_id, confirmed_at, changed_at, grocery_list_id'

/**
 * Why a list couldn't be made. `code`:
 *   'no_recipes' — none of the week's meals are cookbook recipes with ingredients
 *   'api'        — the grocery-list AI call failed
 */
export class WeekGroceryError extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'WeekGroceryError'
    this.code = code
    Object.assign(this, extra)
  }
}

function check({ data, error }) {
  if (error) throw error
  return data
}

function sundayOf(weekStart) {
  const start = weekStartFor(weekStart)
  if (start !== weekStart) throw new Error(`${weekStart} is not a Sunday`)
  return weekBounds(start)
}

/** This week's confirmation (exactly Sun–Sat), or null. */
export async function loadConfirmation(supabase, userId, weekStart) {
  const { start, end } = sundayOf(weekStart)
  const householdId = await getHouseholdId(supabase, userId)
  return check(
    await supabase
      .from('week_confirmations')
      .select(CONFIRMATION_COLUMNS)
      .eq('household_id', householdId)
      .eq('starts_on', start)
      .eq('ends_on', end)
      .maybeSingle(),
  ) ?? null
}

/**
 * Stamp the week confirmed. If it already is (her partner got there first,
 * or a double tap), the existing row comes back unchanged.
 */
export async function confirmWeek(supabase, userId, weekStart) {
  const { start, end } = sundayOf(weekStart)
  const householdId = await getHouseholdId(supabase, userId)
  const { data, error } = await supabase
    .from('week_confirmations')
    .insert({ household_id: householdId, starts_on: start, ends_on: end, user_id: userId })
    .select(CONFIRMATION_COLUMNS)
    .single()
  if (!error) return data
  if (error.code === '23505') { // one confirmation per week: someone beat us to it
    const existing = await loadConfirmation(supabase, userId, start)
    if (existing) return existing
  }
  throw error
}

/**
 * Clear "changed since you confirmed" — but only if nobody changed the week
 * again since we looked. The stamp we saw is the guard: a newer edit has a
 * newer stamp, the update matches nothing, and the prompt stays.
 */
async function clearChanged(supabase, confirmation) {
  if (!confirmation.changed_at) return true
  const rows = check(
    await supabase
      .from('week_confirmations')
      .update({ changed_at: null })
      .eq('id', confirmation.id)
      .eq('changed_at', confirmation.changed_at)
      .select('id'),
  )
  return (rows?.length ?? 0) > 0
}

/** "Keep as is": the list stays; the prompt goes away. */
export function keepListAsIs(supabase, confirmation) {
  return clearChanged(supabase, confirmation)
}

/** The week's meals with their cookbook recipe, for the list. */
async function loadMealsForList(supabase, userId, start, end) {
  const householdId = await getHouseholdId(supabase, userId)
  return check(
    await supabase
      .from('planned_meals')
      .select(`name, vault_id, vault(${GROCERY_VAULT_COLUMNS})`)
      .eq('household_id', householdId)
      .gte('planned_on', start)
      .lte('planned_on', end)
      .order('planned_on', { ascending: true })
      .order('position', { ascending: true }),
  ) ?? []
}

/**
 * Make (or remake) the grocery list for a confirmed week, from exactly that
 * week's meals. Meals that aren't cookbook recipes are left off and named in
 * the result, never a reason to fail.
 *
 * Order matters (see the top of the file): read the stamp we were given →
 * read the meals → AI → write a new list + items → point the confirmation at
 * it → clear the stamp (guarded) → delete the old list. An edit that lands
 * after we read the meals leaves the stamp set, so the prompt comes back.
 */
export async function makeWeekGroceryList(supabase, userId, confirmation, { fetchApi = apiFetch } = {}) {
  const meals = await loadMealsForList(supabase, userId, confirmation.starts_on, confirmation.ends_on)
  const { recipes, notInCookbook, noIngredients } = recipesFromMeals(meals)
  if (recipes.length === 0) {
    throw new WeekGroceryError('no_recipes', 'No cookbook recipes with ingredients this week', {
      notInCookbook, noIngredients,
    })
  }

  const prefs = await getPreferences(userId, supabase).catch(() => null)
  const { householdSize, pantryStaples } = groceryPrefs(prefs)

  const res = await fetchApi('/api/grocery-list', {
    method: 'POST',
    body: JSON.stringify({ recipes, pantryStaples, householdSize }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new WeekGroceryError('api', `grocery-list API ${res.status}`, { status: res.status, body })
  }
  const { items = [] } = await res.json()

  // A brand-new list (no meal_plan_id: it belongs to the confirmation).
  const list = check(
    await supabase.from('grocery_lists').insert({ user_id: userId }).select('id').single(),
  )
  try {
    if (items.length > 0) {
      check(await supabase.from('grocery_list_items').insert(items.map((item) => ({
        list_id: list.id,
        name: item.name,
        quantity: item.quantity ?? null,
        section: item.section ?? 'Other',
        is_bought: false,
        is_adhoc: false,
      }))))
    }
    const linked = check(
      await supabase
        .from('week_confirmations')
        .update({ grocery_list_id: list.id })
        .eq('id', confirmation.id)
        .select('id'),
    )
    if (!linked?.length) throw new Error('makeWeekGroceryList: the confirmation is gone')
  } catch (err) {
    // Not linked yet: throw the half-made list away; the old one is untouched.
    await supabase.from('grocery_lists').delete().eq('id', list.id).then(() => {}, () => {})
    throw err
  }

  // The list is made and linked: a failure from here on is not a failure to
  // make it. Worst case the prompt stays, or an old list is left over.
  await clearChanged(supabase, confirmation).catch((err) =>
    console.warn('[weekGroceries] "changed" stamp not cleared', err))

  const oldId = confirmation.grocery_list_id
  if (oldId && oldId !== list.id) {
    // Best effort: a leftover old list is harmless (nothing points at it).
    const { error } = await supabase.from('grocery_lists').delete().eq('id', oldId)
    if (error) console.warn('[weekGroceries] old list not deleted', error)
  }

  return { listId: list.id, notInCookbook, noIngredients }
}

/** A list's items, oldest first. */
export async function loadGroceryItems(supabase, listId) {
  return check(
    await supabase
      .from('grocery_list_items')
      .select('id, name, quantity, section')
      .eq('list_id', listId)
      .order('created_at', { ascending: true }),
  ) ?? []
}
