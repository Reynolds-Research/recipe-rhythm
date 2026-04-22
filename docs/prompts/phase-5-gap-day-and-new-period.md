# Claude Code prompt — ADR-001 Phase 5: gap-day view + new-period flow

_Hand the block between the two `---` markers to Claude Code._

**Dependencies:** ADR-001 Phases 2, 3, and 4 must be merged.

**Size warning:** This is the largest phase in the ADR — it's three related screens wired into one user flow. If Claude Code struggles with scope, split the prompt at the "Deliverable boundaries" note partway down.

---

## Context

You are working on **Recipe Rhythm**, a React 19 + Vite 8 + Supabase meal-tracking app.

**Required reading:**

- `docs/adr/ADR-001-planning-period-save-state.md` — full ADR. Focus on `Action Items → Phase 5` (lines 350-354), Decision 3 (leftovers = query, not a table), and the `Retention Policy` section (lines 380-388).
- `docs/schema.md` — especially the `current_leftovers` view and the EXCLUDE constraint on `meal_plans`.
- `supabase/migrations/20260418000001_planning_periods_schema.sql` — to confirm what `current_leftovers` actually returns.
- `src/lib/mealPlanReader.js`, `src/lib/mealPlanWriter.js` — helpers to extend.
- `src/pages/BrainstormMode.jsx` — the host page.
- `src/pages/PeriodReview.jsx` — the Phase 4 component. The new-period leftover picker should feel stylistically similar.

**State of the system:**

- Plans have explicit `period_start` / `period_end` dates and a `finalized_at` field.
- After the Phase 4 review, a finalized plan with uncooked items produces rows in the `current_leftovers` view (which automatically caps at 14 days of staleness per the Retention Policy).
- Today, if a user finalizes a period and later reopens the app after `period_end`, they see the "no plan yet → generate suggestions" flow — missing the leftovers and missing explicit date-range selection.

## Task

Build the **gap-day view** and the **new-period flow**. This replaces the "no plan yet" fallback that Phase 4 left in place for the `'finalized'` lifecycle state.

The user story, end-to-end:

1. User finalizes last week's plan. Some items are left uncooked.
2. User opens the app on a gap day (after `period_end` of the finalized plan, no new plan yet).
3. Instead of the old "generate suggestions" screen, they see a **gap-day view**: "Your last period ended. Here's what's leftover: [list of uncooked meals]. [Button: Start a new planning period]".
4. Clicking the button opens a **date-range picker** — calendar style, two-tap (start, end). It validates against existing periods (no overlap).
5. After dates are confirmed, if there are leftovers to roll forward, a **leftover-import screen** shows each leftover with a checkbox. User selects which to pull in.
6. On confirm, a new `meal_plans` row is created for the selected date range, the chosen leftovers are moved (UPDATE `meal_plan_id` + `scheduled_date`) into the new period, and the UI lands on the active-period display (Phase 4 behavior) so they can start editing.

## Deliverables

### 1. Extend `src/lib/mealPlanReader.js`

Add state and a new fetch:

```js
// Update classifyPlanState to add the gap state:
// 'gap' — plan.finalized_at is set AND today > plan.period_end
// (This replaces the 'finalized' state we left in Phase 4 — any finalized past-period
//  plan is now treated as a gap day.)

/**
 * Fetches the current user's "leftovers" — uncooked meal_plan_items from finalized
 * periods whose period_end is within the last 14 days. Reads from the `current_leftovers`
 * view, which handles the 14-day staleness cap.
 *
 * @param {SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<Array<{
 *   id: string,                  // meal_plan_items.id
 *   name: string,
 *   vault_id: string | null,
 *   is_wildcard: boolean,
 *   source_url: string | null,
 *   scheduled_date: string,      // 'YYYY-MM-DD' from the original period
 *   source_period_start: string,
 *   source_period_end: string,
 * }>>}
 */
export async function fetchCurrentLeftovers(supabase, userId) { /* ... */ }
```

### 2. Extend `src/lib/mealPlanWriter.js`

Add:

```js
/**
 * Client-side overlap check against the user's existing periods.
 * Used by the date-range picker to disable invalid ranges before the user confirms,
 * so the DB's EXCLUDE constraint is a last-line-of-defense, not the primary UX.
 *
 * @param {SupabaseClient} supabase
 * @param {string} userId
 * @param {string} periodStart - 'YYYY-MM-DD'
 * @param {string} periodEnd   - 'YYYY-MM-DD'
 * @returns {Promise<{ overlaps: boolean, conflictingPeriod?: { period_start: string, period_end: string } }>}
 */
export async function checkPeriodOverlap(supabase, userId, periodStart, periodEnd) { /* ... */ }

/**
 * Creates a new meal_plan for the given date range and (optionally) rolls forward
 * selected leftover items by updating their meal_plan_id and scheduled_date to the
 * new period.
 *
 * The leftover roll-forward works by UPDATE rather than INSERT/DELETE so that:
 *   (a) cooked_at / created_at history is preserved on the row
 *   (b) the original finalized meal_plans row keeps its item count for historical
 *       accuracy; the leftover just "moves forward" to the new period
 *
 * Spread rule for roll-forward: distribute selected leftovers sequentially across
 * the new period's dates, starting from period_start, one per day, up to the
 * period length. If there are more leftovers than days, ignore the overflow and
 * surface a warning in the returned object so the UI can show it.
 *
 * @param {SupabaseClient} supabase
 * @param {string} userId
 * @param {string} periodStart - 'YYYY-MM-DD'
 * @param {string} periodEnd   - 'YYYY-MM-DD'
 * @param {string[]} leftoverItemIds - meal_plan_items.id values to roll forward
 * @returns {Promise<{
 *   id: string,                 // new meal_plans.id
 *   period_start: string,
 *   period_end:   string,
 *   rolled_forward: number,     // how many were actually moved
 *   overflow: number,           // how many leftovers were excluded (more than days available)
 * }>}
 * @throws {Error} with .code = 'period_overlap' | 'plan_insert_failed' | 'rollforward_failed'
 *                 On rollforward_failed, attempts to delete the just-created plan row.
 */
export async function startNewPeriod(supabase, userId, periodStart, periodEnd, leftoverItemIds) { /* ... */ }
```

### 3. Components

Create three components under `src/components/` (or `src/pages/` — match the Phase 4 choice, don't mix):

**`GapDayView.jsx`** — read-side surface shown when `classifyPlanState === 'gap'`.

```
Props: { userId, onStartNewPeriod: () => void }
Renders:
  - Title: "Your last period ended [period_end formatted]."
  - If fetchCurrentLeftovers returned >0 items: "Leftovers from last period:" followed by a read-only list.
    If 0 items: a short line like "Nothing left over — start fresh."
  - A primary button "Start a new planning period" → calls onStartNewPeriod.
```

**`DateRangePicker.jsx`** — modal or full-screen picker.

```
Props: { userId, initialStart?, onCancel, onConfirm: ({ periodStart, periodEnd }) => void }
Renders:
  - A month grid (compact; current month + arrow to next).
  - Two taps: first tap sets start, second tap sets end. Third tap resets to start.
  - Visually highlights the selected range.
  - Live overlap validation: as the user picks, call checkPeriodOverlap (debounced, 300ms).
    If overlap detected, show inline banner "This range overlaps with your Apr 12 – 16 period" and disable the confirm button.
  - Minimum range: 1 day (start == end). Maximum: not enforced client-side; the DB won't reject reasonable lengths.
  - Cancel button, Confirm button.
Use a lightweight hand-rolled calendar. Do NOT add a new dependency (no react-datepicker, no dayjs) —
the existing app uses only date-fns-free vanilla Date math. Keep that convention.
```

**`LeftoverPicker.jsx`** — post-date-picker, pre-confirm screen.

```
Props: { leftovers, periodStart, periodEnd, onBack, onConfirm: (selectedIds) => void }
Renders:
  - Header: "Pull leftovers into [period formatted]?"
  - List of leftovers with a checkbox each (default all checked).
  - Counter: "X selected / Y days available. Z will be dropped." (shows only if selected > days)
  - Back button (returns to date picker), Confirm button.
When called with an empty leftovers array: bypass rendering and auto-confirm (the parent
flow should skip to startNewPeriod directly without mounting this component).
```

### 4. Wire into `src/pages/BrainstormMode.jsx`

Extend the state-routing switch from Phase 4:

- `'gap'` → render `<GapDayView ... onStartNewPeriod={openNewPeriodFlow} />`.
  - `openNewPeriodFlow` is a local handler that sets component state to show `<DateRangePicker>`.
  - On picker confirm, if leftovers exist and length > 0, show `<LeftoverPicker>`; otherwise call `startNewPeriod(..., [])` directly.
  - On leftover picker confirm, call `startNewPeriod(supabase, userId, periodStart, periodEnd, selectedIds)`, then `loadData(false)`.
- All other states from Phase 4 keep their current behavior.

### 5. Tests

Unit tests (Vitest) in the `__tests__/` directories next to the modules:

- `fetchCurrentLeftovers` — mocked supabase returning rows → correct shape; empty result → `[]`; error surfaces.
- `checkPeriodOverlap` — non-overlapping range → `{ overlaps: false }`; overlapping range → `{ overlaps: true, conflictingPeriod: {...} }`; handles range that contains an entire existing period; handles range contained inside an existing period.
- `startNewPeriod`:
  - happy path, 0 leftovers → inserts plan, no UPDATEs, returns `{ rolled_forward: 0, overflow: 0 }`.
  - happy path, 3 leftovers for a 5-day period → one plan insert + one update call moving all 3 into days 1–3.
  - 5 leftovers for a 3-day period → one plan insert + one update moving 3, `overflow: 2`.
  - overlap → error with `.code === 'period_overlap'`, no updates attempted.
  - rollforward failure → plan row deleted, error with `.code === 'rollforward_failed'`.
- `classifyPlanState` updated tests: `'finalized' + past period_end` → now returns `'gap'`. (Replace the old `'finalized'` test.)

Component tests (Testing Library):

- `GapDayView` — renders leftover list when non-empty; renders empty-state copy when none; button click calls prop.
- `DateRangePicker` — user can pick start then end; confirm button disabled while overlapping; cancel fires prop.
- `LeftoverPicker` — default all-checked; unchecking recomputes the dropped count; confirm returns only checked ids.

E2E (Playwright) at `e2e/new-period-flow.spec.js`:

- Seed a finalized period with 2 uncooked items via Supabase test fixtures (or mock the relevant responses — match whatever pattern the existing e2e tests use).
- User lands on gap-day view → sees 2 leftovers.
- Clicks "Start a new planning period" → date picker appears.
- Selects a non-overlapping 5-day range → confirm enables.
- Confirms → leftover picker shows both items checked.
- Unchecks one → confirms → lands on active-period view with 1 scheduled meal for day 1.
- Asserts the DB (or the reader's result) reflects: new plan row exists, 1 `meal_plan_items` row now points to the new plan with `scheduled_date = period_start`.

## Deliverable boundaries (if splitting)

If this prompt is too much for one Claude Code session, here is the clean split:

**Part A:** deliverables 1, 2 (helpers), and the first component `GapDayView.jsx` (deliverable 3a). Wire just the `'gap'` routing into `BrainstormMode.jsx` so the button opens an alert `"date picker coming soon"`. Tests for the helpers + GapDayView.

**Part B:** `DateRangePicker.jsx`, `LeftoverPicker.jsx`, full flow wiring, the E2E test. This replaces the stub from Part A.

Between parts, the app is in a working state (gap-day view visible; button non-functional). This matches the ADR's "each phase leaves the app working" principle.

## Acceptance criteria

- All three components exist and are covered by tests.
- Helpers extended and tested.
- `BrainstormMode.jsx` correctly routes the `'gap'` state end-to-end.
- `npm run test:unit -- --run` and `npm run test:e2e` both pass.
- `npm run lint` and `npm run build` succeed.
- Manual smoke test documented in the PR: create a finalized plan with uncooked items → reload → gap-day view with leftovers → start new period → pick range → import leftovers → end up in active-period view.

## Out of scope (explicitly)

- Calendar view showing period boundaries across a full month (Phase 6).
- Dropping deprecated columns (Phase 7).
- Partner collab / shared periods.
- Grocery list changes.
- Editing or deleting past finalized periods.
- Supporting multiple meals per day (`position > 0`).

## Deliverable format

One PR (or two, if you used the Part A / Part B split — clearly label):
- `src/lib/mealPlanReader.js` + `mealPlanWriter.js` extended
- `src/lib/__tests__/*` updated
- Three new components + their component tests
- `src/pages/BrainstormMode.jsx` edited for the new routing
- `e2e/new-period-flow.spec.js` new
- PR description linking ADR-001 Phase 5, summarizing the user flow, and including a smoke-test report.

---

## Notes for the human (you)

**Why roll-forward is UPDATE, not INSERT+DELETE.** When the user pulls a leftover into a new period, we move the row by changing `meal_plan_id` and `scheduled_date`. This preserves the item's `id`, its `created_at`, and any cooked history. The original finalized plan loses an item from its children, but its `period_start` / `period_end` / `finalized_at` are intact — the historical "what did I plan for that week" story gets a footnote rather than a rewrite. Downside: a meal that rolled forward three times has a creation date from three periods ago. Acceptable for now.

**Why client-side overlap check AND the DB EXCLUDE constraint.** The client-side `checkPeriodOverlap` is UX — it lets you gray out invalid ranges before the user confirms. The DB constraint (`meal_plans_no_period_overlap` from Phase 1) is the actual guarantee. Don't remove or weaken the client check thinking "the DB will catch it" — a race condition (two tabs) or a stale read will produce a confusing error otherwise.

**Why the 14-day staleness cap matters here.** The `current_leftovers` view only returns items from periods whose `period_end` is within the last 14 days (per ADR Retention Policy). So if the user disappears for a month and comes back, they won't see zombie leftovers from last month — they'll see an empty leftovers list and a clean "Start fresh" state. The underlying data is still there in the DB, just not surfaced.

**Things to verify after merge:**

1. Finalize a plan with uncooked items. Next day: gap-day view shows the leftovers.
2. Try to pick a date range that overlaps the last period → confirm button stays disabled, banner shows the conflict.
3. Pick a valid range, import leftovers → land on active-period view with leftovers scheduled on early days.
4. In Supabase, the original finalized `meal_plans` row is unchanged; the leftover `meal_plan_items` rows' `meal_plan_id` has been updated to the new plan.
5. If you can, test the 14-day cap: manually set a finalized plan's `period_end` to 20 days ago. The `current_leftovers` view should exclude it; the gap-day view should show "Nothing left over."
