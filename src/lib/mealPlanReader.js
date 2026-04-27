const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Format a Date as 'YYYY-MM-DD' using local-calendar components (mirrors
// the writer's formatLocalDate). Lets us compare against the DATE strings
// stored in period_start / period_end without timezone drift (AUDIT U8).
function formatLocalYmd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function sortedUnique(values) {
  return Array.from(new Set(values)).sort()
}

// Map a legacy item's weekday string + the parent plan's served_at into a
// concrete 'YYYY-MM-DD' scheduled_date. Mirrors the buildServedMealsForEngine
// logic that lived in BrainstormMode.jsx pre-Phase-8. Returns null if the
// inputs are malformed (so the caller can drop the item rather than emit a
// bad date).
function legacyScheduledDate(item, servedAtIso) {
  if (!servedAtIso) return null
  const targetDow = WEEKDAY_ABBR.indexOf(item?.day)
  if (targetDow < 0) return null
  const servedDate = new Date(servedAtIso)
  if (Number.isNaN(servedDate.getTime())) return null
  const offset = targetDow - servedDate.getDay()
  const scheduled = new Date(
    servedDate.getFullYear(),
    servedDate.getMonth(),
    servedDate.getDate() + offset,
  )
  return formatLocalYmd(scheduled)
}

/**
 * Fetches the most recent meal_plan row for a user and returns its items
 * in the UI-compatible shape, preferring the new `meal_plan_items` table
 * and falling back to the legacy `meal_plans.items` jsonb if the new table
 * has no rows for that plan.
 *
 * Items always carry `scheduled_date: 'YYYY-MM-DD'`. For legacy rows we
 * derive scheduled_date from the item's weekday + the plan's served_at;
 * malformed legacy items are dropped rather than emitted with invalid dates.
 *
 * The returned `scheduledDates` field is a sorted, deduplicated list of
 * 'YYYY-MM-DD' strings — replaces the old weekday-string `days` field.
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
 *       scheduled_date: string,
 *       name: string,
 *       id: string | null,
 *       is_wildcard: boolean,
 *       source_url: string | null,
 *       item_id: string | null,
 *       cooked: boolean,
 *       cooked_at: string | null,
 *     }>,
 *     scheduledDates: string[],
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

  // PRD-002 P0.6: shortlisted rows have scheduled_date = NULL; ordering by
  // scheduled_date sorts NULLs last in PostgREST default behavior, but to
  // keep ordering deterministic across both tables we partition them client
  // side after the fetch.
  const { data: newItemRows, error: itemsError } = await supabase
    .from('meal_plan_items')
    .select('id, scheduled_date, position, vault_id, name, is_wildcard, source_url, cooked, cooked_at, is_shortlisted')
    .eq('meal_plan_id', plan.id)
    .order('scheduled_date', { ascending: true, nullsFirst: false })
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
    const mapRow = (row) => ({
      scheduled_date: row.scheduled_date,
      name: row.name,
      id: row.vault_id ?? null,
      is_wildcard: !!row.is_wildcard,
      source_url: row.source_url ?? null,
      item_id: row.id,
      cooked: !!row.cooked,
      cooked_at: row.cooked_at ?? null,
      is_shortlisted: !!row.is_shortlisted,
    })
    const scheduledItems  = newItemRows.filter(r => !r.is_shortlisted).map(mapRow)
    const shortlistItems  = newItemRows.filter(r =>  r.is_shortlisted).map(mapRow)
    return {
      plan: {
        ...basePlan,
        items: scheduledItems,
        shortlist: shortlistItems,
        scheduledDates: sortedUnique(scheduledItems.map(i => i.scheduled_date)),
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
    const items = legacyItems
      .map(item => {
        const scheduled_date = legacyScheduledDate(item, plan.served_at)
        if (!scheduled_date) return null
        return {
          scheduled_date,
          name: item.name,
          id: item.vault_id ?? null,
          is_wildcard: !!item.is_wildcard,
          source_url: item.source_url ?? null,
          // Legacy items have no normalized row, so cooked-toggle / per-item
          // review can't target them — surfaced as null so PeriodReview can
          // disable the box.
          item_id: null,
          cooked: false,
          cooked_at: null,
        }
      })
      .filter(Boolean)
    return {
      plan: {
        ...basePlan,
        items,
        shortlist: [],
        scheduledDates: sortedUnique(items.map(i => i.scheduled_date)),
        source: 'legacy',
      },
    }
  }

  return {
    plan: {
      ...basePlan,
      items: [],
      shortlist: [],
      scheduledDates: [],
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
 * @returns {'no_plan' | 'active' | 'ended_unfinalized' | 'finalized' | 'gap'}
 *
 *   'no_plan'            — plan is null
 *   'active'             — today is BETWEEN period_start AND period_end (inclusive)
 *                          A future-dated plan (period_start > today) also classifies
 *                          as 'active' — harmless, the user just hasn't reached day 1.
 *                          Plans missing period_end (legacy rows) also classify here
 *                          as a safe default until they get finalized.
 *   'ended_unfinalized'  — today > period_end AND finalized_at IS NULL
 *   'finalized'          — finalized_at IS NOT NULL AND today ≤ period_end (the
 *                          period is locked but the window hasn't ended yet — rare
 *                          in practice but possible if the user finalized early)
 *   'gap'                — finalized_at IS NOT NULL AND today > period_end.
 *                          Gap day: the previous period is done and no new period
 *                          has started yet. ADR-001 Phase 5: this is the state
 *                          routed to the gap-day view + new-period flow.
 */
export function classifyPlanState(plan, now = new Date()) {
  if (!plan) return 'no_plan'
  const todayYmd = formatLocalYmd(now)
  if (plan.finalized_at) {
    if (plan.period_end && todayYmd > plan.period_end) return 'gap'
    return 'finalized'
  }
  if (!plan.period_end) return 'active'
  if (todayYmd > plan.period_end) return 'ended_unfinalized'
  return 'active'
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

/**
 * Fetches all meal_plan_items for a user within a date window, joined with
 * enough meal_plans metadata (period bounds + finalized_at) to render
 * calendar cells. Used by the read-only CalendarView (ADR-001 Phase 6).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {string} fromDate - 'YYYY-MM-DD' inclusive
 * @param {string} toDate   - 'YYYY-MM-DD' inclusive
 * @returns {Promise<Array<{
 *   item_id: string,
 *   scheduled_date: string,
 *   name: string,
 *   cooked: boolean,
 *   meal_plan_id: string,
 *   period_start: string,
 *   period_end: string,
 *   finalized_at: string | null,
 * }>>}
 */
export async function fetchScheduledItemsInRange(supabase, userId, fromDate, toDate) {
  const { data, error } = await supabase
    .from('meal_plan_items')
    .select(
      'id, scheduled_date, name, cooked, meal_plan_id, meal_plans!inner(period_start, period_end, finalized_at)',
    )
    .eq('user_id', userId)
    .gte('scheduled_date', fromDate)
    .lte('scheduled_date', toDate)
    .order('scheduled_date', { ascending: true })
    .order('position', { ascending: true })

  if (error) throw error
  if (!data) return []

  return data.map((row) => {
    // Supabase embeds the joined row as an object (when meal_plans is an FK),
    // but in some PostgREST versions it comes through as a single-element array.
    // Handle both defensively.
    const plan = Array.isArray(row.meal_plans) ? row.meal_plans[0] : row.meal_plans
    return {
      item_id: row.id,
      scheduled_date: row.scheduled_date,
      name: row.name,
      cooked: !!row.cooked,
      meal_plan_id: row.meal_plan_id,
      period_start: plan?.period_start ?? null,
      period_end: plan?.period_end ?? null,
      finalized_at: plan?.finalized_at ?? null,
    }
  })
}

/**
 * Returns all of the user's meal_plans period ranges. Used by the Brainstorm
 * tab to expand into a concrete set of disabled dates for the date-strip
 * picker. Rows with NULL period bounds are excluded.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<Array<{ period_start: string, period_end: string }>>}
 */
export async function listUserPeriods(supabase, userId) {
  const { data, error } = await supabase
    .from('meal_plans')
    .select('period_start, period_end')
    .eq('user_id', userId)
    .not('period_start', 'is', null)
    .not('period_end', 'is', null)

  if (error) throw error
  if (!data) return []

  return data.map((row) => ({
    period_start: row.period_start,
    period_end: row.period_end,
  }))
}
