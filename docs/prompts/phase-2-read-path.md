# Claude Code prompt — ADR-001 Phase 2: read-path migration

_Hand the block between the two `---` markers to Claude Code._

---

## Context

You are working on **Recipe Rhythm**, a React 19 + Vite 8 + Supabase meal-tracking app. The relevant docs are:

- `docs/adr/ADR-001-planning-period-save-state.md` — the full ADR. Read the "Phase 2" block under **Action Items** (lines 338-340) and the `Detailed Decisions` sections.
- `docs/schema.md` — current database schema, including the new `meal_plan_items` table and the deprecated columns on `meal_plans`.
- `supabase/migrations/20260418000001_planning_periods_schema.sql` — the already-merged Phase 1 migration that created the new schema.

**Phase 1 is done and merged.** The database now has:

- `meal_plans.period_start DATE`, `meal_plans.period_end DATE`, `meal_plans.finalized_at TIMESTAMPTZ` (all nullable during soft migration).
- `meal_plan_items` table: one row per scheduled meal, with `user_id`, `meal_plan_id`, `scheduled_date DATE`, `position int`, `vault_id uuid`, `name text`, `is_wildcard bool`, `source_url text`, `cooked bool`, `cooked_at timestamptz`, `created_at timestamptz`.
- RLS on `meal_plan_items` scoped to `auth.uid() = user_id`.
- Existing rows have been backfilled: `period_start`/`period_end`/`finalized_at` set, and old `items` jsonb unpacked into `meal_plan_items` rows (all marked `cooked = true`).

**The old columns (`meal_plans.days`, `meal_plans.week_label`, `meal_plans.items`) are NOT dropped yet.** They will be dropped in Phase 7. They remain populated by the current write path (we have not yet done Phase 3).

## Task

Implement Phase 2: the **read-path migration**. Change `src/pages/BrainstormMode.jsx` so that when it loads the user's most recent meal plan, it prefers data from the new normalized schema (`meal_plan_items`) and falls back to the old jsonb (`meal_plans.items`) only if the normalized table has no rows for that plan.

**The user should see zero behavior change.** This is purely an internal plumbing swap, exactly as described in the ADR. Do not change any UI.

## Deliverables

### 1. Create `src/lib/mealPlanReader.js`

A new module that encapsulates the fetch + fallback logic. Export one async function:

```js
/**
 * Fetches the most recent meal_plan row for a user and returns its items
 * in the UI-compatible shape, preferring the new `meal_plan_items` table
 * and falling back to the legacy `meal_plans.items` jsonb if the new table
 * has no rows for that plan.
 *
 * @param {SupabaseClient} supabase - Supabase client (from src/lib/supabase.js)
 * @param {string} userId - current user's auth id
 * @returns {Promise<{
 *   plan: {
 *     id: string,
 *     served_at: string | null,
 *     period_start: string | null,
 *     period_end: string | null,
 *     finalized_at: string | null,
 *     items: Array<{
 *       day: string,            // 'Sun' | 'Mon' | ... | 'Sat'
 *       name: string,
 *       id: string | null,      // vault_id mapped to `id` for UI compatibility
 *       is_wildcard: boolean,
 *       source_url: string | null
 *     }>,
 *     days: string[],           // weekday strings in chronological order, deduped
 *     source: 'new' | 'legacy'  // which schema the items came from
 *   } | null
 * }>}
 */
export async function fetchMostRecentPlan(supabase, userId) { /* ... */ }
```

Behavior:

1. Query `meal_plans` for the user's most recent row:
   `select('id, served_at, period_start, period_end, finalized_at, days, items, week_label').eq('user_id', userId).order('served_at', { ascending: false }).limit(1).maybeSingle()`.
   - If no row is returned, return `{ plan: null }`.
2. If the row was found, query `meal_plan_items` for that plan:
   `select('scheduled_date, position, vault_id, name, is_wildcard, source_url').eq('meal_plan_id', plan.id).order('scheduled_date', { ascending: true }).order('position', { ascending: true })`.
3. **Primary path (new schema):** if `meal_plan_items` returned any rows, map them into the UI shape:
   - `day` = weekday string derived from `scheduled_date`. **Use UTC methods or explicit parsing to avoid timezone drift** (see AUDIT U8). Prefer:
     ```js
     const [y, m, d] = scheduled_date.split('-').map(Number);
     const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
     const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow];
     ```
   - `name` = `item.name`
   - `id` = `item.vault_id` (the UI code uses `id` to mean `vault_id`)
   - `is_wildcard` = `item.is_wildcard`
   - `source_url` = `item.source_url ?? null`
   - Set `source: 'new'`.
   - Derive `days` from the sorted, de-duplicated list of weekday strings (preserving chronological order from the query).
4. **Fallback path (legacy schema):** if `meal_plan_items` returned zero rows BUT `plan.items` is a non-empty array, map the legacy jsonb entries into the same UI shape:
   - `day` = `item.day` (already a weekday string)
   - `id` = `item.vault_id ?? null`
   - other fields pass through as-is
   - Set `source: 'legacy'`.
   - `days` = `plan.days` if present, otherwise derived from the items' `day` fields.
5. **Both empty:** if both paths produce zero items, return the plan row with `items: []`, `days: []`, `source: 'new'`.
6. Surface supabase errors by throwing — let the caller decide how to display.

Do **not** import React or any Supabase instance directly. Take `supabase` as an argument so it's trivial to mock in tests.

### 2. Integrate into `src/pages/BrainstormMode.jsx`

In `loadData` (currently around line 223-288):

- Replace the inline `supabase.from('meal_plans').select(...).maybeSingle()` query with a call to `fetchMostRecentPlan(supabase, userId)`.
- The existing code that uses `mostRecentPlan.items`, `mostRecentPlan.days`, `mostRecentPlan.served_at` should now read from the returned `plan` object's `items`, `days`, `served_at` fields — same shape, so most of it just works.
- Keep the "is current week served" check using `plan.served_at` for now. Phase 3 will revisit.
- `buildServedMealsForEngine(plan.items, plan.served_at)` should keep working because the items now have the same `day` + `vault_id` shape regardless of source.

Do **not** touch `handleServe` or anything on the write side — Phase 3 will do that.
Do **not** change the UI, the recommendation engine, or the localStorage behavior.

### 3. Add tests at `src/lib/__tests__/mealPlanReader.test.js`

Use Vitest (style matches `src/lib/__tests__/recommendations.test.js`). Mock the Supabase client manually — a small handwritten fake is fine; no need for a mocking library. Required test cases:

1. **No plan exists** → returns `{ plan: null }`.
2. **New schema, happy path** → given a plan row + 5 `meal_plan_items` spanning consecutive dates, returns 5 items in chronological order with correct weekday strings and `source: 'new'`.
3. **Fallback path** → given a plan row with a non-empty legacy `items` jsonb AND zero `meal_plan_items` rows, returns the items from the jsonb with `source: 'legacy'`.
4. **Preference: new wins over legacy** → given a plan that has BOTH `meal_plan_items` rows AND a legacy `items` jsonb, the function returns only the `meal_plan_items` data with `source: 'new'`.
5. **Empty on both sides** → plan exists but no items either place → returns the plan with `items: []`, `days: []`, `source: 'new'`.
6. **Timezone safety** → a `scheduled_date` of `'2026-04-20'` maps to `'Mon'` regardless of the test machine's local timezone. (Mocking the fetch response is enough; the internal parsing must not use `new Date(scheduled_date)` without UTC handling.)
7. **Supabase error surfaces** → when the mocked client returns an `error` on the `meal_plans` fetch, `fetchMostRecentPlan` throws.

Do **not** add a test that requires a live database — these are pure unit tests against a mocked client.

## Acceptance criteria

- `src/lib/mealPlanReader.js` exists and exports `fetchMostRecentPlan` with the contract above.
- `BrainstormMode.jsx` calls the helper instead of its inline `meal_plans` query.
- `npm run test:unit -- --run` passes. Pay attention to existing test files too — nothing in `BrainstormMode.test.jsx`, `analyzeRecipe.test.js`, `recommendations.test.js` should regress.
- `npm run lint` passes (or surfaces only pre-existing warnings — flag any new ones you introduce).
- `npm run build` succeeds.
- Manual sanity check (describe in the PR, don't need to actually run a browser): if you loaded the app today, the Brainstorm page would look identical to before because either (a) the user has recent served plans that were backfilled into `meal_plan_items`, so we read from the new schema and produce the same shape, or (b) fallback kicks in for anything the backfill missed.

## Out of scope (explicitly)

- Any write-path change (Phase 3).
- Cooked-toggle UI, end-of-period review screen (Phase 4).
- Gap-day view / new-period flow (Phase 5).
- Calendar view (Phase 6).
- Dropping the deprecated columns (Phase 7).
- Touching `localStorage` usage or the recommendation engine.
- Refactoring `BrainstormMode.jsx` beyond the minimum needed to wire in the helper (audit M1 God-component split is a separate task).

## Deliverable format

One pull request against `main` with:
- `src/lib/mealPlanReader.js` (new file)
- `src/lib/__tests__/mealPlanReader.test.js` (new file)
- `src/pages/BrainstormMode.jsx` (edited — minimal change)
- PR description summarizing: what changed, why (link to ADR-001 Phase 2), what was verified, and a note that old columns remain populated by the current write path pending Phase 3.

---

## Notes for the human (you)

**Why this is the right shape:**

- The helper (`mealPlanReader.js`) keeps the fallback logic in one testable place. When Phase 3 lands, only the write path changes; this read helper keeps working. When Phase 7 drops the legacy columns, you delete the fallback branch and one test — clean surgical removal.
- The test list is tight but covers the two behaviors the ADR explicitly mentions ("read from new schema, fall back to old if new is empty") plus timezone safety (AUDIT U8), which the new `scheduled_date` DATE column invites bugs around if parsed carelessly.
- Setting `source: 'new' | 'legacy'` on the return value is optional telemetry — useful for a future log line that tells you how often fallback is actually triggered. If it stays at zero for a week, you can confidently do Phase 7.

**What you'll want to verify before merging the Claude Code PR:**

1. The `planDays` derivation preserves the chronological order the old code produced. If your backfilled periods span, say, Sun-Thu, `planDays` should be `['Sun','Mon','Tue','Wed','Thu']`, not alphabetical.
2. The existing Vitest tests for `BrainstormMode.test.jsx` still pass — that file mocks Supabase, and the mock's shape may need a minor update to include the new query path.
3. Take one screenshot of the Brainstorm page before and after on your deployed environment to confirm "zero visible change."
