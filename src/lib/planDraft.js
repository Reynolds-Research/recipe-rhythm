/**
 * plan_drafts data layer (TASKS.md P2-6).
 *
 * The pre-serve plan used to live only in localStorage ("a sticky note on
 * one device"). This module keeps a second copy in the user's account so the
 * same draft shows up on every device they sign in on. localStorage stays as
 * the fast, offline-friendly copy; this table is the shared one.
 *
 *   - fetchPlanDraft(supabase, userId)  → { plan, selectedDates, updatedAt } | null
 *   - savePlanDraft(supabase, userId, { plan, selectedDates }) → updatedAt (ISO)
 *   - clearPlanDraft(supabase, userId)  → deletes the row (on serve / reset)
 *   - pickNewerDraft(localSavedAt, remote) → 'remote' | 'local'
 *
 * Every function takes the supabase client as an argument so tests can pass
 * a fake instead of the real singleton (same pattern as preferences.js).
 */

const TABLE = 'plan_drafts'

/** localStorage key holding when this device last saved its draft. */
export const LOCAL_SAVED_AT_KEY = 'brainstorm_plan_saved_at'

/**
 * A draft plan is an array of slots that each carry a scheduled_date — the
 * same defensive check useBrainstorm applies to the localStorage copy, so a
 * malformed row can never crash the render path.
 */
export function isValidDraftPlan(plan) {
  return Array.isArray(plan) && plan.every((slot) => !!slot?.scheduled_date)
}

export async function fetchPlanDraft(supabase, userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('plan, selected_dates, updated_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  if (!isValidDraftPlan(data.plan) || !Array.isArray(data.selected_dates)) return null

  return {
    plan: data.plan,
    selectedDates: [...data.selected_dates].sort(),
    updatedAt: data.updated_at,
  }
}

export async function savePlanDraft(supabase, userId, { plan, selectedDates }, now = new Date()) {
  const updatedAt = now.toISOString()
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      {
        user_id: userId,
        plan,
        selected_dates: selectedDates,
        updated_at: updatedAt,
      },
      { onConflict: 'user_id' },
    )

  if (error) throw error
  return updatedAt
}

export async function clearPlanDraft(supabase, userId) {
  const { error } = await supabase.from(TABLE).delete().eq('user_id', userId)
  if (error) throw error
}

/**
 * Which copy should the planner show on load?
 *
 * The account copy wins when it exists and is newer than this device's last
 * save — or when this device has no save time recorded (e.g. a draft left in
 * localStorage before this feature shipped). Otherwise this device's copy is
 * kept, and the next save pushes it up to the account.
 */
export function pickNewerDraft(localSavedAt, remote) {
  if (!remote) return 'local'
  if (!localSavedAt) return 'remote'
  return Date.parse(remote.updatedAt) > Date.parse(localSavedAt) ? 'remote' : 'local'
}
