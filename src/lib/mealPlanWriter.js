// Phase 3 of ADR-001: write path for the new normalized schema.
// Symmetric with ./mealPlanReader.js — the reader prefers meal_plan_items
// rows and this writer creates them directly, no longer touching the
// deprecated meal_plans.{week_label, days, items} columns. Those columns
// will be dropped in ADR-001 Phase 7 after a 1–2 week stability window.

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Format a Date as 'YYYY-MM-DD' using local-calendar components. We explicitly
// avoid toISOString() because it converts to UTC and can flip the date for
// users east/west of Greenwich — "next Monday" is a local-calendar concept.
function formatLocalDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Only real UUIDs are valid meal_plan_items.vault_id values (FK → vault.id).
// AI-suggestion slots carry synthetic ids like 'ai-suggestion-0' which must
// not be written as vault_id. `null` passes through; anything non-UUID also
// maps to null (the name snapshot is still preserved on the row).
function toVaultId(id) {
  if (!id) return null
  return typeof id === 'string' && UUID_RE.test(id) ? id : null
}

function isPeriodOverlap(err) {
  if (!err) return false
  if (err.code === '23P01') return true
  const msg = err.message || ''
  const constraint = err.constraint || err.constraint_name || ''
  return (
    constraint === 'meal_plans_no_period_overlap' ||
    msg.includes('meal_plans_no_period_overlap')
  )
}

/**
 * Pure helper: from a list of weekday strings like ['Sun','Mon','Tue','Wed','Thu']
 * and a reference "today", compute the concrete calendar dates for this upcoming
 * planning period.
 *
 * Uses LOCAL-time date math (not UTC) because "next Monday" is a local-calendar
 * concept for the user. Dates are formatted as 'YYYY-MM-DD' strings suitable for
 * Postgres DATE columns.
 *
 * Rules:
 *  - The first weekday in `planDays` resolves to the NEXT occurrence of that
 *    weekday strictly after `now` (matches the previous `buildWeekLabel` rule
 *    in BrainstormMode.jsx — if today is Sun and planDays[0] is 'Sun', pick the
 *    Sun a week from now, not today).
 *  - Remaining weekdays resolve to strictly-increasing dates relative to the first,
 *    assuming `planDays` is sorted in canonical Sun→Sat order (as the rest of the
 *    app emits them).
 *
 * @param {string[]} planDays - weekday abbreviations; each must be one of
 *                              'Sun'|'Mon'|'Tue'|'Wed'|'Thu'|'Fri'|'Sat'.
 * @param {Date} now - the "today" reference (inject for deterministic tests).
 * @returns {{
 *   period_start: string,
 *   period_end:   string,
 *   dateByDay:    Record<string,string>
 * }}
 * @throws {Error} if planDays is empty or contains an invalid weekday.
 */
export function derivePlanDates(planDays, now) {
  if (!Array.isArray(planDays) || planDays.length === 0) {
    throw new Error('derivePlanDates: planDays must be a non-empty array')
  }
  for (const day of planDays) {
    if (!Object.prototype.hasOwnProperty.call(WEEKDAY_INDEX, day)) {
      throw new Error(`derivePlanDates: invalid weekday "${day}"`)
    }
  }

  const firstDayIdx = WEEKDAY_INDEX[planDays[0]]
  const nowIdx = now.getDay()
  // Strictly-after rule: `|| 7` turns "today matches planDays[0]" into "+7".
  const daysUntilFirst = ((firstDayIdx - nowIdx + 7) % 7) || 7

  // Construct dates with local-calendar ctor; never go through toISOString.
  const firstDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + daysUntilFirst,
  )

  const dateByDay = {}
  for (const day of planDays) {
    const offset = (WEEKDAY_INDEX[day] - firstDayIdx + 7) % 7
    const d = new Date(
      firstDate.getFullYear(),
      firstDate.getMonth(),
      firstDate.getDate() + offset,
    )
    dateByDay[day] = formatLocalDate(d)
  }

  return {
    period_start: formatLocalDate(firstDate),
    period_end: dateByDay[planDays[planDays.length - 1]],
    dateByDay,
  }
}

/**
 * Creates a new served meal plan with its scheduled items.
 *
 * Writes to the new normalized schema only:
 *   - INSERT into meal_plans with { user_id, period_start, period_end }
 *     (id, served_at, created_at use DB defaults; finalized_at stays NULL)
 *   - INSERT into meal_plan_items, one row per plan slot
 *
 * Does NOT write to the deprecated columns (week_label, days, items).
 *
 * Atomicity trade-off: this is two inserts, not one transaction. If the
 * items insert fails we compensate by deleting the meal_plans row. An RPC /
 * Postgres function that wraps both writes in a single transaction would be
 * cleaner — tracked as a future improvement, explicitly out of scope for
 * Phase 3.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {Array<{day:string, name:string, id:string|null, is_wildcard:boolean, source_url:string|null}>} plan
 * @param {string[]} planDays
 * @param {Date} [now]
 * @returns {Promise<{ id: string, served_at: string, period_start: string, period_end: string }>}
 * @throws {Error} with `.code` set to one of:
 *   - 'period_overlap'       — EXCLUDE constraint rejected the period (PG 23P01)
 *   - 'plan_insert_failed'   — meal_plans insert failed for any other reason
 *   - 'items_insert_failed'  — meal_plan_items insert failed (cleanup ran)
 *   The original supabase error object is attached as `.cause`.
 */
export async function createServedPlan(
  supabase,
  userId,
  plan,
  planDays,
  now = new Date(),
) {
  const { period_start, period_end, dateByDay } = derivePlanDates(planDays, now)

  const { data: planRow, error: planError } = await supabase
    .from('meal_plans')
    .insert({ user_id: userId, period_start, period_end })
    .select('id, served_at, period_start, period_end')
    .single()

  if (planError || !planRow) {
    const overlap = isPeriodOverlap(planError)
    const err = new Error(
      overlap
        ? 'Planning period overlaps with an existing plan.'
        : `Failed to create meal plan: ${planError?.message ?? 'unknown error'}`,
    )
    err.code = overlap ? 'period_overlap' : 'plan_insert_failed'
    err.cause = planError
    throw err
  }

  const itemRows = plan.map((slot) => ({
    user_id: userId,
    meal_plan_id: planRow.id,
    scheduled_date: dateByDay[slot.day],
    position: 0,
    vault_id: toVaultId(slot.id),
    name: slot.name,
    is_wildcard: !!slot.is_wildcard,
    source_url: slot.source_url ?? null,
  }))

  const { error: itemsError } = await supabase
    .from('meal_plan_items')
    .insert(itemRows)

  if (itemsError) {
    // Compensating delete so the user doesn't end up with a blank served plan.
    // We intentionally swallow any error from the delete — surfacing the
    // original items-insert failure is more actionable for the caller.
    try {
      await supabase.from('meal_plans').delete().eq('id', planRow.id)
    } catch {
      // best-effort cleanup
    }
    const err = new Error(
      `Failed to insert meal_plan_items: ${itemsError.message ?? 'unknown error'}`,
    )
    err.code = 'items_insert_failed'
    err.cause = itemsError
    throw err
  }

  return {
    id: planRow.id,
    served_at: planRow.served_at,
    period_start: planRow.period_start,
    period_end: planRow.period_end,
  }
}
