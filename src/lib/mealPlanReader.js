const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Parse a 'YYYY-MM-DD' string in UTC so the derived weekday is independent
// of the machine's local timezone (see AUDIT U8).
function weekdayFromScheduledDate(scheduledDate) {
  const [y, m, d] = scheduledDate.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return WEEKDAY_ABBR[dow]
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
