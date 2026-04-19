const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Parse a 'YYYY-MM-DD' string in UTC so the derived weekday is independent
// of the machine's local timezone (see AUDIT U8).
function weekdayFromScheduledDate(scheduledDate) {
  const [y, m, d] = scheduledDate.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return WEEKDAY_ABBR[dow]
}

// Format a Date as 'YYYY-MM-DD' using LOCAL components — mirrors the helper in
// mealPlanWriter.js. Kept as a private local copy to avoid cross-importing from
// the write path and creating a cycle.
function formatLocalDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dedupePreserveOrder(days) {
  const seen = new Set()
  const out = []
  for (const day of days) {
    if (!seen.has(day)) {
      seen.add(day)
      out.push(day)
    }
  }
  return out
}

/**
 * Fetches the most recent meal_plan row for a user and returns its items
 * in the UI-compatible shape, preferring the new `meal_plan_items` table
 * and falling back to the legacy `meal_plans.items` jsonb if the new table
 * has no rows for that plan.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<{
 *   plan: {
 *     id: string,
 *     served_at: string | null,
 *     period_start: string | null,
 *     period_end: string | null,
 *     finalized_at: string | null,
 *     items: Array<{
 *       day: string,
 *       name: string,
 *       id: string | null,
 *       is_wildcard: boolean,
 *       source_url: string | null
 *     }>,
 *     days: string[],
 *     source: 'new' | 'legacy'
 *   } | null
 * }>}
 */
export async function fetchMostRecentPlan(supabase, userId) {
  const { data: plan, error: planError } = await supabase
    .from('meal_plans')
    .select('id, served_at, period_start, period_end, finalized_at, days, items, week_label')
    .eq('user_id', userId)
    .order('served_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (planError) throw planError
  if (!plan) return { plan: null }

  const { data: newItemRows, error: itemsError } = await supabase
    .from('meal_plan_items')
    .select('scheduled_date, position, vault_id, name, is_wildcard, source_url')
    .eq('meal_plan_id', plan.id)
    .order('scheduled_date', { ascending: true })
    .order('position', { ascending: true })

  if (itemsError) throw itemsError

  const basePlan = {
    id: plan.id,
    served_at: plan.served_at ?? null,
    period_start: plan.period_start ?? null,
    period_end: plan.period_end ?? null,
    finalized_at: plan.finalized_at ?? null,
  }

  if (newItemRows && newItemRows.length > 0) {
    const items = newItemRows.map(row => ({
      day: weekdayFromScheduledDate(row.scheduled_date),
      name: row.name,
      id: row.vault_id ?? null,
      is_wildcard: !!row.is_wildcard,
      source_url: row.source_url ?? null,
    }))
    return {
      plan: {
        ...basePlan,
        items,
        days: dedupePreserveOrder(items.map(i => i.day)),
        source: 'new',
      },
    }
  }

  // Legacy fallback: reads items/days from the deprecated meal_plans.items jsonb.
  // ADR-001 Phase 3 (createServedPlan in ../lib/mealPlanWriter.js) only populates
  // the new-schema fields, so for any row written AFTER Phase 3 landed this
  // branch should never trigger — we only hit it for historical rows written
  // by the pre-Phase-3 handleServe path. Phase 7 drops the legacy columns and
  // deletes this branch.
  const legacyItems = Array.isArray(plan.items) ? plan.items : []
  if (legacyItems.length > 0) {
    const items = legacyItems.map(item => ({
      day: item.day,
      name: item.name,
      id: item.vault_id ?? null,
      is_wildcard: !!item.is_wildcard,
      source_url: item.source_url ?? null,
    }))
    const days = Array.isArray(plan.days) && plan.days.length > 0
      ? plan.days
      : dedupePreserveOrder(items.map(i => i.day))
    return {
      plan: {
        ...basePlan,
        items,
        days,
        source: 'legacy',
      },
    }
  }

  return {
    plan: {
      ...basePlan,
      items: [],
      days: [],
      source: 'new',
    },
  }
}

/**
 * Classifies a plan by its lifecycle state relative to `today`.
 *
 * States:
 *   'none'      — no plan at all (null/undefined input)
 *   'active'    — plan exists and is NOT finalized (user can still edit)
 *   'finalized' — plan is finalized, and today ≤ period_end (locked but still
 *                 inside the period window — rare but possible if the user
 *                 finalized early)
 *   'gap'       — plan is finalized AND today > period_end. Gap day: the old
 *                 period has ended; no new period started yet. This is the
 *                 state the gap-day view hangs off.
 *
 * ADR-001 Phase 5: replaces the old `finalized` mapping for past-end periods
 * with `gap`, which is the state routed to the gap-day view + new-period flow.
 *
 * @param {{ finalized_at?: string|null, period_end?: string|null } | null | undefined} plan
 * @param {Date} [today]
 * @returns {'none' | 'active' | 'finalized' | 'gap'}
 */
export function classifyPlanState(plan, today = new Date()) {
  if (!plan) return 'none'
  if (!plan.finalized_at) return 'active'
  if (!plan.period_end) return 'finalized'
  // Lexicographic comparison on 'YYYY-MM-DD' strings is chronological.
  const todayStr = formatLocalDate(today)
  return plan.period_end < todayStr ? 'gap' : 'finalized'
}

/**
 * Fetches the current user's "leftovers" — uncooked meal_plan_items from
 * finalized periods whose period_end is within the last 14 days. Reads from
 * the `current_leftovers` view, which handles the 14-day staleness cap server
 * side per the ADR Retention Policy.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<Array<{
 *   id: string,
 *   name: string,
 *   vault_id: string | null,
 *   is_wildcard: boolean,
 *   source_url: string | null,
 *   scheduled_date: string,
 *   source_period_start: string,
 *   source_period_end: string,
 * }>>}
 */
export async function fetchCurrentLeftovers(supabase, userId) {
  const { data, error } = await supabase
    .from('current_leftovers')
    .select(
      'id, name, vault_id, is_wildcard, source_url, scheduled_date, source_period_start, source_period_end',
    )
    .eq('user_id', userId)
    .order('scheduled_date', { ascending: true })

  if (error) throw error
  if (!data) return []

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    vault_id: row.vault_id ?? null,
    is_wildcard: !!row.is_wildcard,
    source_url: row.source_url ?? null,
    scheduled_date: row.scheduled_date,
    source_period_start: row.source_period_start,
    source_period_end: row.source_period_end,
  }))
}
