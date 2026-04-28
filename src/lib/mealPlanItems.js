/**
 * meal_plan_items helpers (PRD-002 P0.12).
 *
 * Two functions used by the Preferences page after a successful upsert:
 *
 *   - getActivePeriodItems(userId, supabase): returns every meal_plan_items
 *     row (scheduled + shortlisted) for the user's currently-active planning
 *     period, with the joined vault columns flattened onto each item so
 *     `passesPreferences` can read them directly. Returns [] when no active
 *     period exists.
 *
 *   - deleteMealPlanItems(ids, supabase): bulk DELETE of the given item ids.
 *     RLS continues to scope to the calling user automatically — there is no
 *     `user_id` filter here. Returns the number of deleted rows.
 *
 * The "active period" is the most recent meal_plans row whose
 * [period_start, period_end] window includes today AND that has not been
 * finalized. This mirrors the "active" branch of `classifyPlanState`
 * (mealPlanReader.js) — duplicated as a focused query rather than re-using
 * `fetchMostRecentPlan` to keep this helper a single round-trip.
 */

// Local 'YYYY-MM-DD' formatter — mirrors mealPlanReader / dateUtils so the
// today comparison is timezone-stable (AUDIT U8).
function formatLocalYmd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Flatten the joined `vault` row onto the item so passesPreferences can read
// cuisine_type / proteins / prep_time_minutes / etc. directly. PostgREST
// embeds the join either as an object or as a single-element array depending
// on the version — handle both shapes defensively (mirrors mealPlanReader).
function flattenItem(row) {
  const v = Array.isArray(row.vault) ? row.vault[0] : row.vault
  return {
    id: row.id,
    name: row.name,
    vault_id: row.vault_id ?? null,
    scheduled_date: row.scheduled_date ?? null,
    is_shortlisted: !!row.is_shortlisted,
    cuisine_type:     v?.cuisine_type     ?? null,
    prep_time_minutes: v?.prep_time_minutes ?? null,
    proteins:         v?.proteins         ?? null,
    vegetables:       v?.vegetables       ?? null,
    fruits:           v?.fruits           ?? null,
    dairy_components: v?.dairy_components ?? null,
    main_carb:        v?.main_carb        ?? null,
    dietary_tags:     v?.dietary_tags     ?? null,
  }
}

/**
 * @param {string} userId
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<Array<{
 *   id: string,
 *   name: string,
 *   vault_id: string | null,
 *   scheduled_date: string | null,
 *   is_shortlisted: boolean,
 *   cuisine_type: string | null,
 *   prep_time_minutes: number | null,
 *   proteins: string[] | null,
 *   vegetables: string[] | null,
 *   fruits: string[] | null,
 *   dairy_components: string[] | null,
 *   main_carb: string | null,
 *   dietary_tags: string[] | null,
 * }>>}
 */
export async function getActivePeriodItems(userId, supabase) {
  const todayYmd = formatLocalYmd(new Date())

  const { data: plan, error: planError } = await supabase
    .from('meal_plans')
    .select('id')
    .eq('user_id', userId)
    .lte('period_start', todayYmd)
    .gte('period_end', todayYmd)
    .is('finalized_at', null)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (planError) throw planError
  if (!plan) return []

  const { data: items, error: itemsError } = await supabase
    .from('meal_plan_items')
    .select(
      'id, scheduled_date, is_shortlisted, name, vault_id, vault:vault_id (cuisine_type, prep_time_minutes, proteins, vegetables, fruits, dairy_components, main_carb, dietary_tags)',
    )
    .eq('user_id', userId)
    .eq('meal_plan_id', plan.id)

  if (itemsError) throw itemsError
  if (!items) return []

  return items.map(flattenItem)
}

/**
 * Bulk DELETE of meal_plan_items by id list. RLS scopes the DELETE to the
 * calling user automatically (the `meal_plan_items_delete_own` policy
 * enforces `auth.uid() = user_id`).
 *
 * @param {string[]} ids - meal_plan_items.id values
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<number>} count of rows actually deleted
 */
export async function deleteMealPlanItems(ids, supabase) {
  if (!Array.isArray(ids) || ids.length === 0) return 0

  const { error, count } = await supabase
    .from('meal_plan_items')
    .delete({ count: 'exact' })
    .in('id', ids)

  if (error) throw error
  return count ?? 0
}
