// Phase 3 of ADR-001: write path for the new normalized schema.
// Symmetric with ./mealPlanReader.js — the reader prefers meal_plan_items
// rows and this writer creates them directly, no longer touching the
// deprecated meal_plans.{week_label, days, items} columns. Those columns
// will be dropped in ADR-001 Phase 7 after a 1–2 week stability window.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
 * Creates a new served meal plan from an explicit list of scheduled items.
 *
 * Writes to the new normalized schema only:
 *   - INSERT into meal_plans with { user_id, period_start, period_end }
 *     where period_start = min(item.scheduled_date) and period_end = max(...).
 *     (id, served_at, created_at use DB defaults; finalized_at stays NULL)
 *   - INSERT into meal_plan_items, one row per item
 *
 * Gaps between scheduled dates inside [period_start, period_end] are normal —
 * not every date in the range needs an item. The EXCLUDE constraint on
 * meal_plans enforces non-overlap at the DB level.
 *
 * Does NOT write to the deprecated columns (week_label, days, items).
 *
 * Atomicity trade-off: this is two inserts, not one transaction. If the
 * items insert fails we compensate by deleting the meal_plans row. An RPC /
 * Postgres function that wraps both writes in a single transaction would be
 * cleaner — tracked as a future improvement, explicitly out of scope.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {Array<{
 *   scheduled_date: string,   // 'YYYY-MM-DD'
 *   name: string,
 *   id: string | null,        // vault_id (null for wildcards / missing)
 *   is_wildcard: boolean,
 *   source_url: string | null,
 * }>} items
 * @returns {Promise<{ id: string, served_at: string, period_start: string, period_end: string }>}
 * @throws {Error} with `.code` set to one of:
 *   - 'period_overlap'       — EXCLUDE constraint rejected the period (PG 23P01)
 *   - 'plan_insert_failed'   — meal_plans insert failed for any other reason
 *   - 'items_insert_failed'  — meal_plan_items insert failed (cleanup ran)
 *   The original supabase error object is attached as `.cause`.
 */
export async function createServedPlan(supabase, userId, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('createServedPlan: items must be a non-empty array')
  }

  // period_start / period_end are derived from min/max of scheduled_date.
  // Lexical comparison is correct on zero-padded 'YYYY-MM-DD' strings.
  let period_start = items[0].scheduled_date
  let period_end = items[0].scheduled_date
  for (const item of items) {
    if (!item.scheduled_date) {
      throw new Error('createServedPlan: every item must have a scheduled_date')
    }
    if (item.scheduled_date < period_start) period_start = item.scheduled_date
    if (item.scheduled_date > period_end) period_end = item.scheduled_date
  }

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

  const itemRows = items.map((item) => ({
    user_id: userId,
    meal_plan_id: planRow.id,
    scheduled_date: item.scheduled_date,
    position: 0,
    vault_id: toVaultId(item.id),
    name: item.name,
    is_wildcard: !!item.is_wildcard,
    source_url: item.source_url ?? null,
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

/**
 * Toggles the cooked status of a single meal_plan_item.
 *
 * Sets cooked_at = now() (ISO string) when flipping to true; clears it when
 * flipping to false. The two fields move together — `cooked = true` with a
 * NULL `cooked_at` would lose the "when did this happen" signal that powers
 * future stats (per ADR-001 column docs in docs/schema.md).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} itemId - meal_plan_items.id
 * @param {boolean} cooked
 * @returns {Promise<void>}
 * @throws {Error} with `.code = 'toggle_failed'` on DB error.
 *   The original supabase error object is attached as `.cause`.
 */
export async function setItemCooked(supabase, itemId, cooked) {
  const update = cooked
    ? { cooked: true, cooked_at: new Date().toISOString() }
    : { cooked: false, cooked_at: null }

  const { error } = await supabase
    .from('meal_plan_items')
    .update(update)
    .eq('id', itemId)

  if (error) {
    const err = new Error(
      `Failed to toggle cooked status: ${error.message ?? 'unknown error'}`,
    )
    err.code = 'toggle_failed'
    err.cause = error
    throw err
  }
}

/**
 * Marks a meal_plan row as finalized (sets finalized_at = now()).
 *
 * Idempotent: if the row is already finalized, the update no-ops (the
 * `.is('finalized_at', null)` filter prevents overwriting the original
 * timestamp) and we read the existing value back instead. This matters
 * because finalize is a user-visible action — re-clicking it shouldn't
 * silently rewrite history.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} mealPlanId
 * @returns {Promise<{ finalized_at: string }>}
 * @throws {Error} with `.code = 'finalize_failed'` on DB error.
 *   The original supabase error object is attached as `.cause`.
 */
export async function finalizePlan(supabase, mealPlanId) {
  const finalizedAt = new Date().toISOString()

  const { data: updated, error: updateError } = await supabase
    .from('meal_plans')
    .update({ finalized_at: finalizedAt })
    .eq('id', mealPlanId)
    .is('finalized_at', null)
    .select('finalized_at')
    .maybeSingle()

  if (updateError) {
    const err = new Error(
      `Failed to finalize plan: ${updateError.message ?? 'unknown error'}`,
    )
    err.code = 'finalize_failed'
    err.cause = updateError
    throw err
  }

  if (updated?.finalized_at) {
    return { finalized_at: updated.finalized_at }
  }

  // Already finalized — read back the existing timestamp instead of pretending
  // we set one. The caller treats this as success (the plan IS finalized).
  const { data: existing, error: readError } = await supabase
    .from('meal_plans')
    .select('finalized_at')
    .eq('id', mealPlanId)
    .maybeSingle()

  if (readError) {
    const err = new Error(
      `Failed to read finalized plan: ${readError.message ?? 'unknown error'}`,
    )
    err.code = 'finalize_failed'
    err.cause = readError
    throw err
  }

  return { finalized_at: existing?.finalized_at ?? null }
}

// Add N days to a 'YYYY-MM-DD' string. UTC-based so leap/DST doesn't shift
// the date — the output is a pure date string, no time component.
function addDaysIso(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

// Inclusive day count between two 'YYYY-MM-DD' strings (end - start + 1).
function daysBetweenInclusive(startIso, endIso) {
  const [ys, ms, ds] = startIso.split('-').map(Number)
  const [ye, me, de] = endIso.split('-').map(Number)
  const start = Date.UTC(ys, ms - 1, ds)
  const end = Date.UTC(ye, me - 1, de)
  return Math.round((end - start) / 86400000) + 1
}

// Test whether two closed date ranges [aStart,aEnd] and [bStart,bEnd] overlap.
// Mirrors Postgres `daterange(..., '[]') && daterange(..., '[]')` on the client.
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd
}

/**
 * Client-side overlap check against the user's existing periods.
 *
 * Used by the date-range picker to disable invalid ranges before the user
 * confirms, so the DB's EXCLUDE constraint is a last-line-of-defense, not
 * the primary UX. The DB remains authoritative — this helper only exists
 * to give fast feedback.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {string} periodStart - 'YYYY-MM-DD'
 * @param {string} periodEnd   - 'YYYY-MM-DD'
 * @returns {Promise<{ overlaps: boolean, conflictingPeriod?: { period_start: string, period_end: string } }>}
 */
export async function checkPeriodOverlap(supabase, userId, periodStart, periodEnd) {
  const { data, error } = await supabase
    .from('meal_plans')
    .select('period_start, period_end')
    .eq('user_id', userId)
    .not('period_start', 'is', null)
    .not('period_end', 'is', null)

  if (error) throw error
  const rows = data || []

  for (const row of rows) {
    if (rangesOverlap(periodStart, periodEnd, row.period_start, row.period_end)) {
      return {
        overlaps: true,
        conflictingPeriod: {
          period_start: row.period_start,
          period_end: row.period_end,
        },
      }
    }
  }
  return { overlaps: false }
}

/**
 * Creates a new meal_plan for the given date range and (optionally) rolls
 * forward selected leftover items by updating their meal_plan_id and
 * scheduled_date to the new period.
 *
 * The leftover roll-forward works by UPDATE rather than INSERT/DELETE so that:
 *   (a) cooked_at / created_at history is preserved on the row
 *   (b) the original finalized meal_plans row keeps its item count for
 *       historical accuracy; the leftover just "moves forward" to the new
 *       period
 *
 * Spread rule: leftovers are distributed sequentially across the new period
 * starting from period_start, one per day. If there are more leftovers than
 * days, the extras are dropped and surfaced as `overflow` in the result so
 * the UI can show a warning.
 *
 * Atomicity trade-off: this is an insert + update, not a single transaction.
 * On rollforward failure we compensate by deleting the new plan row so the
 * user doesn't end up stranded with an empty period.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {string} periodStart - 'YYYY-MM-DD'
 * @param {string} periodEnd   - 'YYYY-MM-DD'
 * @param {string[]} leftoverItemIds - meal_plan_items.id values to roll forward
 * @returns {Promise<{
 *   id: string,
 *   period_start: string,
 *   period_end:   string,
 *   rolled_forward: number,
 *   overflow: number,
 * }>}
 * @throws {Error} with `.code` set to one of:
 *   - 'period_overlap'     — EXCLUDE constraint rejected the period (PG 23P01)
 *   - 'plan_insert_failed' — meal_plans insert failed for any other reason
 *   - 'rollforward_failed' — moving leftovers into the new period failed (the
 *                            just-created plan row is deleted as cleanup)
 */
export async function startNewPeriod(
  supabase,
  userId,
  periodStart,
  periodEnd,
  leftoverItemIds,
) {
  const { data: planRow, error: planError } = await supabase
    .from('meal_plans')
    .insert({
      user_id: userId,
      period_start: periodStart,
      period_end: periodEnd,
    })
    .select('id, period_start, period_end')
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

  const ids = Array.isArray(leftoverItemIds) ? leftoverItemIds : []
  if (ids.length === 0) {
    return {
      id: planRow.id,
      period_start: planRow.period_start,
      period_end: planRow.period_end,
      rolled_forward: 0,
      overflow: 0,
    }
  }

  const daysAvailable = daysBetweenInclusive(periodStart, periodEnd)
  const toMove = ids.slice(0, daysAvailable)
  const overflow = ids.length - toMove.length

  // Distribute sequentially: leftover[i] → periodStart + i days.
  // Each leftover needs a distinct scheduled_date, so we issue one UPDATE per
  // row rather than a bulk UPDATE ... WHERE id IN (...). This is O(N) round
  // trips but N is bounded by the period length, which is small (typically
  // 5–14). An RPC that does this in one transaction is a reasonable future
  // improvement, tracked as out of scope here.
  try {
    for (let i = 0; i < toMove.length; i++) {
      const scheduled = addDaysIso(periodStart, i)
      const { error: updateError } = await supabase
        .from('meal_plan_items')
        .update({ meal_plan_id: planRow.id, scheduled_date: scheduled })
        .eq('id', toMove[i])
        .eq('user_id', userId)
      if (updateError) {
        const err = new Error(
          `Failed to roll forward leftover: ${updateError.message ?? 'unknown error'}`,
        )
        err.cause = updateError
        throw err
      }
    }
  } catch (cause) {
    // Compensating delete so the user doesn't end up with a blank new period.
    try {
      await supabase.from('meal_plans').delete().eq('id', planRow.id)
    } catch {
      // best-effort cleanup
    }
    const err = new Error(
      `Failed to roll leftovers into new period: ${cause?.message ?? 'unknown error'}`,
    )
    err.code = 'rollforward_failed'
    err.cause = cause
    throw err
  }

  return {
    id: planRow.id,
    period_start: planRow.period_start,
    period_end: planRow.period_end,
    rolled_forward: toMove.length,
    overflow,
  }
}
