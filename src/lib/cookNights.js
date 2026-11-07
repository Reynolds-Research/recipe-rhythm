/**
 * cookNights.js — "Matt's nights" (PRD-008 P0.5, phase 3b).
 *
 * Mental model: a night is a sticky note on a calendar day saying who cooks
 * it (`cook_nights`, one row per household + date). It is separate from the
 * meals on that day, because she usually hands a night over before there is
 * any meal. No row = an ordinary night. Taking a night back deletes the row.
 *
 * Names come from `household_members.display_name` (Settings → Your name).
 * Labels are always from the viewer's side: on her phone his night reads
 * "Matt's night", on his "Your night". Before a name is saved the other
 * person is "Partner".
 *
 * Data helpers follow plannedMeals.js: the household comes from
 * getHouseholdId(), and the security rules only let members touch a row.
 */

import { getHouseholdId } from './household'

export const NIGHT_COLUMNS = 'cooks_on, cook_id, user_id, assigned_at'

/** The household's nights from `from` to `to` (inclusive), oldest first. */
export async function loadNights(supabase, userId, from, to) {
  const householdId = await getHouseholdId(supabase, userId)
  const { data, error } = await supabase
    .from('cook_nights')
    .select(NIGHT_COLUMNS)
    .eq('household_id', householdId)
    .gte('cooks_on', from)
    .lte('cooks_on', to)
    .order('cooks_on', { ascending: true })
  if (error) throw error
  return data ?? []
}

/**
 * Hand `date` to `cookId` (or hand it to someone else: the database restarts
 * assigned_at when the cook changes). `userId` is who handed it over.
 */
export async function giveNight(supabase, userId, date, cookId) {
  const householdId = await getHouseholdId(supabase, userId)
  const { data, error } = await supabase
    .from('cook_nights')
    .upsert(
      { household_id: householdId, cooks_on: date, cook_id: cookId, user_id: userId },
      { onConflict: 'household_id,cooks_on' },
    )
    .select(NIGHT_COLUMNS)
    .single()
  if (error) throw error
  return data
}

/** Take a night back: it becomes an ordinary night again. */
export async function takeBackNight(supabase, userId, date) {
  const householdId = await getHouseholdId(supabase, userId)
  const { error } = await supabase
    .from('cook_nights')
    .delete()
    .eq('household_id', householdId)
    .eq('cooks_on', date)
  if (error) throw error
}

/** Everyone in the household, with their saved names (or null). */
export async function loadMembers(supabase, userId) {
  const householdId = await getHouseholdId(supabase, userId)
  const { data, error } = await supabase
    .from('household_members')
    .select('user_id, display_name')
    .eq('household_id', householdId)
  if (error) throw error
  return data ?? []
}

/**
 * Save your own name (Settings → Your name). Blank clears it. Only ever
 * changes the signed-in person's own name (the database function sees to it).
 * Returns the saved name, or null.
 */
export async function setMyName(supabase, name) {
  const { data, error } = await supabase.rpc('rr_set_my_display_name', { p_name: name ?? '' })
  if (error) throw error
  return data ?? null
}

// ---- Labels (pure) ----------------------------------------------------------

/** The household member who isn't the viewer, or null in a one-person household. */
export function otherMember(members = [], viewerId) {
  return members.find((m) => m.user_id !== viewerId) ?? null
}

/** A member's name as the viewer reads it: their saved name, else "Partner". */
export function memberName(members = [], userId) {
  const name = members.find((m) => m.user_id === userId)?.display_name?.trim()
  return name || 'Partner'
}

/** "Matt's night" / "Your night" / "Partner's night". */
export function nightLabel(night, viewerId, members = []) {
  if (!night) return null
  if (night.cook_id === viewerId) return 'Your night'
  return `${memberName(members, night.cook_id)}'s night`
}

/** "Give to Matt", or null when there's nobody to give it to. */
export function giveLabel(members = [], viewerId) {
  const other = otherMember(members, viewerId)
  return other ? `Give to ${memberName(members, other.user_id)}` : null
}

/**
 * The viewer's own nights still to pick: shown dates from today on that are
 * the viewer's night and have no meal yet.
 */
export function nightsToPick({ dates = [], today, nightsByDate = {}, mealsByDate = {}, viewerId }) {
  return dates.filter((d) => d >= today && nightsByDate[d]?.cook_id === viewerId && !mealsByDate[d]?.length)
}
