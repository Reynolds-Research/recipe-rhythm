# Claude Code prompt — ADR-001 Phase 3: write-path migration

_Hand the block between the two `---` markers to Claude Code._

**Dependency:** ADR-001 Phase 2 (`docs/prompts/phase-2-read-path.md`) must be merged to `main` first. This phase assumes `src/lib/mealPlanReader.js` exists and is already wired into `BrainstormMode.jsx`.

---

## Context

You are working on **Recipe Rhythm**, a React 19 + Vite 8 + Supabase meal-tracking app.

**Required reading** (in this order):

- `docs/adr/ADR-001-planning-period-save-state.md` — full ADR. Focus on `Action Items → Phase 3` (lines 342-345), Decision 2, Decision 4, and the `Q1 / Q2 resolved` block (lines 367-376).
- `docs/schema.md` — current database schema, especially the `meal_plans` and `meal_plan_items` sections.
- `supabase/migrations/20260418000001_planning_periods_schema.sql` — the Phase 1 migration (already applied).
- `src/lib/mealPlanReader.js` — the Phase 2 read helper. Your new write helper should be symmetric.
- `src/pages/BrainstormMode.jsx` — the page component whose `handleServe` function you will modify. The current implementation is around lines 391-420.

**State of the system right now:**

- The new schema (`meal_plans.period_start/period_end/finalized_at`, `meal_plan_items` table, `current_leftovers` view, EXCLUDE constraint on non-overlapping periods) is live in Supabase.
- Phase 2 is merged: the UI reads from `meal_plan_items` first, falling back to the legacy `meal_plans.items` jsonb.
- Phase 3 (this phase) is the last piece before the system is fully on the new schema for all newly-created plans.
- The write path in `handleServe` **still writes** to the deprecated columns (`week_label`, `days`, `items` jsonb) and **does not write** to `period_start` / `period_end` / `meal_plan_items`.

## Task

Implement Phase 3: the **write-path migration**. Change `handleServe` in `BrainstormMode.jsx` so it writes to the new normalized schema only. Stop writing to the deprecated columns. Extract the write logic into a new helper module so it's unit-testable, symmetric with the Phase 2 read helper, and easy to delete / refactor in Phase 7.

The user should see zero change in normal operation: clicking "Serve" still locks the plan, still persists it, still restores on reload. What changes is where the data lives in the database.

## Deliverables

### 1. Create `src/lib/mealPlanWriter.js`

A new module that encapsulates the write logic. Two exports:

```js
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
 *    weekday strictly after `now` (matches the existing `buildWeekLabel` rule
 *    in BrainstormMode.jsx — if today is Sun and planDays[0] is 'Sun', pick the
 *    Sun a week from now, not today).
 *  - Remaining weekdays resolve to strictly-increasing dates relative to the first.
 *
 * @param {string[]} planDays - weekday abbreviations; must be one of
 *                              'Sun'|'Mon'|'Tue'|'Wed'|'Thu'|'Fri'|'Sat'.
 *                              Expected to be sorted in the canonical Sun->Sat order
 *                              as the rest of the app emits them.
 * @param {Date} now - the "today" reference (inject for deterministic tests)
 * @returns {{
 *   period_start: string,           // 'YYYY-MM-DD'
 *   period_end:   string,           // 'YYYY-MM-DD'
 *   dateByDay:    Record<string,string>  // 'Mon' -> 'YYYY-MM-DD'
 * }}
 * @throws {Error} if planDays is empty or contains an invalid weekday.
 */
export function derivePlanDates(planDays, now) { /* ... */ }

/**
 * Creates a new served meal plan with its scheduled items.
 *
 * Writes to the new normalized schema only:
 *   - INSERT into meal_plans with period_start, period_end, user_id
 *     (served_at defaults to now() in the DB; finalized_at stays NULL)
 *   - INSERT into meal_plan_items, one row per plan slot
 *
 * Does NOT write to the deprecated columns (week_label, days, items).
 *
 * Atomicity: performs two inserts (meal_plans then meal_plan_items). If the items
 * insert fails, deletes the just-created meal_plans row so the user doesn't end up
 * with a blank served plan. See "Atomicity trade-off" in the notes section.
 *
 * @param {SupabaseClient} supabase
 * @param {string} userId
 * @param {Array<{day:string, name:string, id:string|null, is_wildcard:boolean, source_url:string|null}>} plan
 * @param {string[]} planDays - weekday abbreviations (same semantics as derivePlanDates)
 * @param {Date} [now] - injectable "today" for tests; defaults to new Date()
 * @returns {Promise<{ id: string, served_at: string, period_start: string, period_end: string }>}
 * @throws {Error} Thrown errors have a `code` string for known failure modes:
 *                 - 'period_overlap' when the EXCLUDE constraint rejects the insert
 *                   (PG error code '23P01' — exclusion_violation)
 *                 - 'plan_insert_failed' / 'items_insert_failed' for other DB errors
 *                 The original supabase error is attached as `cause`.
 */
export async function createServedPlan(supabase, userId, plan, planDays, now = new Date()) { /* ... */ }
```

Implementation notes:

- `derivePlanDates` must be timezone-stable: given a fixed `now`, output must be identical on any machine. Do all math with `now.getFullYear()`, `.getMonth()`, `.getDate()` and construct new `Date` objects — avoid `toISOString()` for the final format (it converts to UTC and can flip the date). Format as `YYYY-MM-DD` manually.
- `createServedPlan` should insert `meal_plans` with only `{ user_id, period_start, period_end }` — let DB defaults handle `id`, `served_at`, `created_at`. Do NOT include `week_label`, `days`, or `items`.
- `meal_plan_items` rows need: `user_id`, `meal_plan_id`, `scheduled_date`, `position` (use 0 — current UI is one-meal-per-day), `vault_id` (null if wildcard with no vault record), `name`, `is_wildcard`, `source_url`. Leave `cooked` / `cooked_at` / `created_at` at defaults.
- When mapping each plan slot, use `dateByDay[slot.day]` for `scheduled_date`.
- Detect the period-overlap error by the PG code (`error.code === '23P01'` or a `constraint_name` match on `meal_plans_no_period_overlap`) and throw with `.code = 'period_overlap'` so the caller can show a specific message.

### 2. Update `src/pages/BrainstormMode.jsx`

In `handleServe` (currently around lines 391-420):

- Replace the `supabase.from('meal_plans').insert({ week_label, days, items })` call with a call to `createServedPlan(supabase, userId, plan, planDays)`.
- Handle the three error codes distinctly:
  - `period_overlap` → set `setServeError('This week overlaps with a plan you already served. Pick different days or wait.')`
  - Any other error → keep the existing generic `'Could not save plan. Try again.'`
- On success, use the returned `served_at` exactly like the current code does to drive `setServedAt` and `setIsServed(true)`.

Also:

- Delete the `buildWeekLabel` helper function (lines 99-116) — it's no longer called from anywhere. If `buildLastWeekSlots` or any other code still references `week_label`, update those to use `period_start`/`period_end` or the helper from `mealPlanReader.js`. If nothing else uses `buildWeekLabel`, the deletion is clean.
- Search the rest of the repo for any other code that writes to `meal_plans.items` / `.days` / `.week_label`. If `src/App.jsx`, `src/pages/LogMode.jsx`, `src/pages/Vault.jsx`, or any other file inserts into `meal_plans`, update those too. (Grep: `from\('meal_plans'\)` and look for `.insert`.)

### 3. Update `src/lib/mealPlanReader.js` (minor)

If the Phase 2 reader still falls back to reading `week_label`/`days` from the main table, that's still fine — the deprecated columns are still present and some historical rows have them populated. **Do not remove the legacy-schema branch yet** — Phase 7 is the cleanup phase. But do add a short comment noting that new rows written by `createServedPlan` will only have the new-schema fields populated, so for new rows the legacy branch should never trigger.

### 4. Add tests at `src/lib/__tests__/mealPlanWriter.test.js`

Vitest style, mirroring `src/lib/__tests__/mealPlanReader.test.js`. Mock the Supabase client with a handwritten fake. Required tests:

1. **`derivePlanDates` — basic case:** given `planDays = ['Sun','Mon','Tue','Wed','Thu']` and `now = new Date(2026, 3, 18)` (a Saturday), `period_start` is `'2026-04-19'` (Sun), `period_end` is `'2026-04-23'` (Thu), and `dateByDay` has all five entries.
2. **`derivePlanDates` — "if today matches planDays[0], skip to next week":** given `planDays = ['Sun', ...]` and `now = new Date(2026, 3, 19)` (a Sunday), `period_start` is `'2026-04-26'` (next Sun), not today.
3. **`derivePlanDates` — timezone stability:** the result must match the expected `'YYYY-MM-DD'` strings regardless of the process timezone. (If Vitest lets you, set `process.env.TZ` before the test; otherwise just construct `now` explicitly and check that the output depends only on `now`, not on `Intl.DateTimeFormat().resolvedOptions().timeZone`.)
4. **`derivePlanDates` — bad input:** empty array → throws; unknown weekday string → throws.
5. **`createServedPlan` — happy path:** given a 5-day plan, the mock client receives exactly (a) one `INSERT meal_plans` call with `{ user_id, period_start, period_end }` and no deprecated fields, then (b) one `INSERT meal_plan_items` call with 5 rows whose `scheduled_date`, `name`, `vault_id`, `is_wildcard`, `source_url` match the input. Return the inserted plan id + served_at.
6. **`createServedPlan` — overlap error:** mock the first insert to return a supabase error `{ code: '23P01', message: '...meal_plans_no_period_overlap...' }`. The thrown error has `.code === 'period_overlap'`.
7. **`createServedPlan` — items-insert failure triggers cleanup:** mock `meal_plans` insert to succeed but `meal_plan_items` insert to error. Assert that the mock received a DELETE on `meal_plans` with the just-inserted id afterward, and that the thrown error has `.code === 'items_insert_failed'`.
8. **`createServedPlan` — wildcard slot with null id:** a slot where `id` is `null` and `is_wildcard` is `true` maps to a `meal_plan_items` row with `vault_id: null` and `is_wildcard: true`. (This guards against accidentally omitting wildcards.)

Do NOT write tests that require a live database.

### 5. Update existing tests where needed

- `src/pages/__tests__/BrainstormMode.test.jsx` — if it asserts anything about the write path hitting `items`/`days`/`week_label`, update those assertions to expect the new schema. If it mocks `supabase.from('meal_plans').insert(...)`, the mock needs to accept the new `{ user_id, period_start, period_end }` shape and also handle the subsequent `meal_plan_items` insert (or allow the write helper to be mocked via `vi.mock('../../lib/mealPlanWriter.js', ...)`).
- E2E tests in `e2e/` — if any Playwright test exercises the Serve flow, run it after your changes. No assertion updates should be needed if the UI behavior is identical.

## Acceptance criteria

- `src/lib/mealPlanWriter.js` exists with `derivePlanDates` and `createServedPlan`.
- `BrainstormMode.jsx` no longer writes to `week_label`, `days`, or `items`. `buildWeekLabel` is removed.
- The happy-path user experience is unchanged — clicking Serve still saves and locks the plan, reloading restores it, the week label on screen still makes sense (derived from `period_start`/`period_end` by the read path).
- The period-overlap scenario shows a specific, helpful error message instead of the generic one.
- `npm run test:unit -- --run` passes, including the new tests.
- `npm run lint` passes.
- `npm run build` succeeds.
- `npm run test:e2e` passes if the Serve flow is covered in Playwright.

## Out of scope (explicitly)

- Cooked toggle / end-of-period review (Phase 4).
- Gap-day / new-period flow / date-range picker (Phase 5).
- Calendar view (Phase 6).
- Dropping the deprecated columns from the DB (Phase 7).
- Converting the two-step insert to a single RPC / Postgres function (see "Atomicity trade-off" below — noted as a future improvement).
- Splitting up `BrainstormMode.jsx` (audit M1).
- Removing random seeding from the recommendation engine (audit U2).

## Deliverable format

One PR against `main`:
- `src/lib/mealPlanWriter.js` (new)
- `src/lib/__tests__/mealPlanWriter.test.js` (new)
- `src/pages/BrainstormMode.jsx` (edited — remove `buildWeekLabel`, rewrite `handleServe`)
- `src/lib/mealPlanReader.js` (small comment update)
- any updated existing tests
- PR description summarizing the change, linking to ADR-001 Phase 3, and noting that legacy columns will be dropped in Phase 7 after a 1-2 week stability window.

---

## Notes for the human (you)

**Why this shape.** The write helper mirrors the read helper you landed in Phase 2, so the mental model is consistent: `mealPlanReader` = "how to load a plan", `mealPlanWriter` = "how to save a plan". When Phase 7 drops the legacy columns, you delete the fallback branch in `mealPlanReader.js` and the writer is untouched — it was already only writing the new schema.

**Atomicity trade-off.** The cleanest way to insert a plan + its items is a Postgres function (`CREATE FUNCTION create_meal_plan_with_items(...) RETURNS uuid ...`) called via `supabase.rpc(...)`. That gives real transactional atomicity. I deliberately did **not** require that for Phase 3 because:

1. It needs another migration, and your write volume is tiny (single user, a handful of serves per week).
2. The "insert → insert → cleanup on fail" pattern is good enough: if the items insert fails, the meal_plans row is deleted, so the user can just click Serve again.
3. In the *very rare* failure window (items insert succeeded but the cleanup DELETE also fails), the read path sees a plan row with zero items and zero legacy items — it returns `items: []`, which the UI would show as a blank locked plan. Irritating but not destructive.

If you ever see this in production, that's the signal to upgrade to the RPC. The write helper's contract doesn't change — you'd just swap the body.

**Timezone rule of thumb.** Read path = parse a DB `DATE` → use UTC methods (what you did in Phase 2). Write path = derive future dates from `now` → use LOCAL methods. Asymmetric but correct: "next Monday" is a local-calendar question; "what weekday is 2026-04-20" is a fixed-calendar question. The writer's tests should lock this in.

**Things to manually verify once merged:**

1. Serve a fresh plan, check Supabase: the `meal_plans` row has `period_start`/`period_end` populated and `days`/`items`/`week_label` all NULL.
2. Check `meal_plan_items`: one row per plan slot, `scheduled_date` is correct, `cooked = false`.
3. Reload the Brainstorm page: the served plan still restores and the UI still shows the right week label.
4. Try to serve a second plan whose dates overlap the first (if you can force it): you should see the friendly overlap-error copy, not a generic failure.
5. After a week of stable operation, you can schedule Phase 7 (drop the deprecated columns).
