const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Parse a 'YYYY-MM-DD' string in UTC so the derived weekday is independent
// of the machine's local timezone (see AUDIT U8).
function weekdayFromScheduledDate(scheduledDate) {
  const [y, m, d] = scheduledDate.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return WEEKDAY_ABBR[dow]
}

// Format a Date as 'YYYY-MM-DD' using local-calendar components (mirrors
// the writer's formatLocalDate). Lets us compare against the DATE strings
// stored in period_start / period_end without timezone drift (AUDIT U8).
function formatLocalYmd(date) {
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
    .select('id, scheduled_date, position, vault_id, name, is_wildcard, source_url, cooked, cooked_at')
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
      item_id: row.id,
      scheduled_date: row.scheduled_date,
      cooked: !!row.cooked,
      cooked_at: row.cooked_at ?? null,
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
      // Legacy items have no normalized row, so cooked-toggle / per-item review
      // can't target them — surfaced as null so PeriodReview can disable the box.
      item_id: null,
      scheduled_date: null,
      cooked: false,
      cooked_at: null,
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
 * Classifies a plan (as returned by fetchMostRecentPlan) into one of the
 * lifecycle states the Brainstorm UI routes on.
 *
 * Compares dates as 'YYYY-MM-DD' strings (lexical comparison is correct on
 * zero-padded dates) so we never construct a Date from `period_end` — this
 * sidesteps the toISOString / UTC-shift class of bugs called out as AUDIT U8.
 *
 * @param {object|null} plan - the shape returned by fetchMostRecentPlan
 * @param {Date} [now]       - injectable "today" for tests; defaults to new Date()
 * @returns {'no_plan' | 'active' | 'ended_unfinalized' | 'finalized'}
 *
 *   'no_plan'            — plan is null
 *   'active'             — today is BETWEEN period_start AND period_end (inclusive)
 *                          A future-dated plan (period_start > today) also classifies
 *                          as 'active' — harmless, the user just hasn't reached day 1.
 *                          Plans missing period_end (legacy rows) also classify here
 *                          as a safe default until they get finalized.
 *   'ended_unfinalized'  — today > period_end AND finalized_at IS NULL
 *   'finalized'          — finalized_at IS NOT NULL (regardless of dates)
 */
export function classifyPlanState(plan, now = new Date()) {
  if (!plan) return 'no_plan'
  if (plan.finalized_at) return 'finalized'
  if (!plan.period_end) return 'active'

  const todayYmd = formatLocalYmd(now)
  if (todayYmd > plan.period_end) return 'ended_unfinalized'
  return 'active'
}
