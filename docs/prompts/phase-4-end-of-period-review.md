# Claude Code prompt — ADR-001 Phase 4: end-of-period review UI

_Hand the block between the two `---` markers to Claude Code._

**Dependencies:** ADR-001 Phases 2 and 3 must be merged. This phase assumes `src/lib/mealPlanReader.js` and `src/lib/mealPlanWriter.js` exist.

---

## Context

You are working on **Recipe Rhythm**, a React 19 + Vite 8 + Supabase meal-tracking app.

**Required reading:**

- `docs/adr/ADR-001-planning-period-save-state.md` — full ADR. Focus on `Action Items → Phase 4` (lines 347-348), `Open Questions — Resolved on 2026-04-18` block (Q1 lines 367-369, Q2 lines 371-373), and the `Retention Policy` (lines 380-388).
- `docs/schema.md` — especially the `meal_plans` (note `finalized_at` semantics) and `meal_plan_items` (note `cooked` / `cooked_at`) sections.
- `src/pages/BrainstormMode.jsx` — the host page for this feature.
- `src/lib/mealPlanReader.js`, `src/lib/mealPlanWriter.js` — Phase 2/3 helpers you should extend rather than bypass.

**State of the system:**

- The new-schema write path is live: all new plans populate `period_start` / `period_end` and insert per-item `meal_plan_items` rows with `cooked = false` by default. `finalized_at` stays NULL for active or ended-but-not-reviewed plans.
- There is no UI yet for marking items cooked, and no UI for finalizing a period.
- The only existing Brainstorm-page states are "no plan yet → generate suggestions" and "served plan → locked display." Per ADR Q2, the active-period lock comes off in this phase (mid-period edits are allowed).

## Task

Build the **end-of-period review** UI and the **cooked-toggle** mechanic that powers it. Two user-visible outcomes:

1. **During an active period** (`today BETWEEN period_start AND period_end`): the user can mark individual items cooked or uncooked at any time. No "finalize" CTA is shown — the period is still active. The plan is editable (meals can be added/removed/swapped/reordered).
2. **After the period ends** (`today > period_end` AND `finalized_at IS NULL`): when the user opens the Brainstorm page, they see an end-of-period review prompt with two actions:
   - **"Edit what you actually ate"** — opens the item list with cooked checkboxes so they can correct missed logging.
   - **"Lock in and finalize"** — sets `meal_plans.finalized_at = now()`. Uncooked items become leftovers (they show up in the gap-day view in Phase 5).

Per ADR Q2, the same review UI is used mid-period and post-period; only the "Finalize" button is conditional.

## Deliverables

### 1. Extend `src/lib/mealPlanReader.js`

Add one exported helper:

```js
/**
 * Classifies a plan (as returned by fetchMostRecentPlan) into one of the
 * lifecycle states used by the UI.
 *
 * @param {object|null} plan - the shape returned by fetchMostRecentPlan
 * @param {Date} [now] - injectable "today" for tests; defaults to new Date()
 * @returns {'no_plan' | 'active' | 'ended_unfinalized' | 'finalized'}
 *
 *   'no_plan'            — plan is null
 *   'active'             — today is BETWEEN period_start AND period_end (inclusive)
 *   'ended_unfinalized'  — today > period_end AND finalized_at IS NULL
 *   'finalized'          — finalized_at IS NOT NULL (regardless of dates)
 */
export function classifyPlanState(plan, now = new Date()) { /* ... */ }
```

Use local-date math (`now.getFullYear()`, `.getMonth()`, `.getDate()`) and compare against `plan.period_start` / `plan.period_end` parsed the same safe way as in `fetchMostRecentPlan`. Do not use `new Date(period_start)` without UTC handling (AUDIT U8).

### 2. Extend `src/lib/mealPlanWriter.js`

Add two exported helpers:

```js
/**
 * Toggles the cooked status of a single meal_plan_item.
 * Sets cooked_at = now() when flipping to true; sets cooked_at = null when flipping to false.
 *
 * @param {SupabaseClient} supabase
 * @param {string} itemId - meal_plan_items.id
 * @param {boolean} cooked
 * @returns {Promise<void>}
 * @throws {Error} with .code = 'toggle_failed' on DB error
 */
export async function setItemCooked(supabase, itemId, cooked) { /* ... */ }

/**
 * Marks a meal_plan row as finalized (sets finalized_at = now()).
 * Idempotent: no-ops if already finalized.
 *
 * @param {SupabaseClient} supabase
 * @param {string} mealPlanId
 * @returns {Promise<{ finalized_at: string }>}
 * @throws {Error} with .code = 'finalize_failed' on DB error
 */
export async function finalizePlan(supabase, mealPlanId) { /* ... */ }
```

### 3. Create `src/pages/PeriodReview.jsx` (or `src/components/PeriodReview.jsx` if you prefer component-over-page)

A new component that renders the review UI. Props:

```
{
  plan,                     // the shape returned by fetchMostRecentPlan
  userId,                   // current user's id
  onFinalized: () => void,  // called after successful finalize
  onClose:     () => void,  // called to dismiss the review without finalizing
  showFinalizeButton: bool, // true only when state === 'ended_unfinalized'
}
```

Rendering rules:

- Header: show the period bounds in human-readable form (e.g., "Apr 19 – 23, 2026"). Derive from `plan.period_start` / `plan.period_end`.
- Body: list of items, one row per `meal_plan_item`:
  - A checkbox bound to `cooked`.
  - The meal name.
  - A subtle secondary line showing the day-of-week (e.g., "Mon") for orientation.
  - Optimistic UI: clicking the checkbox updates local state immediately and calls `setItemCooked` in the background. Roll back on error and show a toast/banner.
  - Visual state for `cooked = true`: strike-through the name or a subdued style (pick the Tailwind treatment that matches the rest of the app).
- Footer:
  - If `showFinalizeButton` is true: a primary button "Lock in and finalize." Clicking calls `finalizePlan`, on success calls `onFinalized()`.
  - Always: a "Close" / back button calling `onClose()`.
- Mobile-first layout consistent with the rest of the app (`max-w-sm`, existing Tailwind conventions — peek at `LogMode.jsx` or `Vault.jsx` for style).
- Accessibility: checkboxes have proper `<label>` association; buttons have accessible text. Don't regress the AUDIT L1 a11y work already landed.

### 4. Wire into `src/pages/BrainstormMode.jsx`

In `BrainstormMode`, after `loadData` resolves:

1. Compute `state = classifyPlanState(plan, new Date())`.
2. Based on state:
   - `'no_plan'` → current "generate suggestions" flow. Unchanged.
   - `'active'` → current served-plan display, but WITH cooked checkboxes next to each item now that mid-period edits are allowed. Tapping an item's checkbox fires `setItemCooked`. No finalize CTA.
   - `'ended_unfinalized'` → render a modal or top banner with copy like: "Your week has ended. Mark what you actually cooked, then lock it in." Two buttons: "Edit what you actually ate" (opens `<PeriodReview ... showFinalizeButton />`) and "Lock in as-is" (calls `finalizePlan` directly without opening the review). Dismissing without acting leaves the prompt visible next time.
   - `'finalized'` → treat the plan as historical. The current week may be a gap day (handled in Phase 5). For Phase 4, it's fine to show the existing "generate a new plan" flow here. Phase 5 will replace it with the gap-day view.
3. On successful finalize, refresh by calling `loadData(false)` so the page re-classifies.

Keep `BrainstormMode.jsx` changes as small as possible. The review UI itself lives in the new component.

### 5. Tests

Add `src/lib/__tests__/mealPlanReader.classify.test.js` (or append to the existing `mealPlanReader.test.js`):

1. `classifyPlanState(null)` → `'no_plan'`.
2. Plan with `period_start = today`, `period_end = today + 4` → `'active'`.
3. Plan with `period_end = yesterday`, `finalized_at = null` → `'ended_unfinalized'`.
4. Plan with `period_end = 30 days ago`, `finalized_at = 28 days ago` → `'finalized'`.
5. Boundary: plan with `period_end = today` → `'active'` (inclusive).
6. Boundary: plan with `period_start = tomorrow` → since we said "today BETWEEN period_start AND period_end", `today < period_start` → decide: should this be `'active'` or a new state? For Phase 4, treat it as `'active'` (a plan the user scheduled in advance but hasn't entered yet). Future-looking plans showing cooked checkboxes is harmless.

Add `src/lib/__tests__/mealPlanWriter.cooked.test.js` (or extend existing):

1. `setItemCooked(..., true)` sends an update with `cooked: true` and a non-null `cooked_at`.
2. `setItemCooked(..., false)` sends an update with `cooked: false` and `cooked_at: null`.
3. `finalizePlan` sends an update with `finalized_at: <some iso string>`.
4. Already-finalized plan: calling `finalizePlan` again is a no-op (does not overwrite the existing `finalized_at`). (Use `.is('finalized_at', null)` in the query to enforce this, or check in JS first.)
5. All three helpers surface DB errors with the documented `.code` fields.

Add a component test at `src/pages/__tests__/PeriodReview.test.jsx` using Testing Library:

1. Renders the item list with correct cooked states.
2. Clicking a checkbox optimistically toggles the visual state and calls `setItemCooked` (mocked).
3. Clicking "Lock in and finalize" calls `finalizePlan` (mocked) then calls the `onFinalized` prop.
4. The finalize button is absent when `showFinalizeButton` is false.
5. If `setItemCooked` rejects, the visual state rolls back.

## Acceptance criteria

- `classifyPlanState`, `setItemCooked`, `finalizePlan` all exist and have tests passing.
- `PeriodReview` component exists, is covered by component tests, and integrates into `BrainstormMode.jsx` according to the state-routing rules above.
- `npm run test:unit -- --run` passes.
- `npm run lint` passes.
- `npm run build` succeeds.
- Manual smoke test in the PR description: during an active period, cooked checkboxes appear and persist across reload; after `period_end` passes, the end-of-period prompt appears; finalizing flips `finalized_at` in the DB and the prompt goes away.

## Out of scope (explicitly)

- Gap-day view and leftovers UI (Phase 5).
- Calendar view (Phase 6).
- Dropping the deprecated `items` / `days` / `week_label` columns (Phase 7).
- Per-item edit (changing a meal's name after it's scheduled). For now, cooked-toggle is the only item mutation.
- Partner collab or shared households.

## Deliverable format

One PR:
- `src/pages/PeriodReview.jsx` (new — or `src/components/`, pick one and be consistent)
- `src/pages/__tests__/PeriodReview.test.jsx` (new)
- `src/lib/mealPlanReader.js` (extended with `classifyPlanState`)
- `src/lib/mealPlanWriter.js` (extended with `setItemCooked`, `finalizePlan`)
- `src/lib/__tests__/*` updated with the new test cases
- `src/pages/BrainstormMode.jsx` (edited — state routing + cooked checkboxes on active period)
- PR description linking ADR-001 Phase 4, summarizing the state machine, and including a manual smoke-test report.

---

## Notes for the human (you)

**Why the state machine lives in `mealPlanReader.js`.** Classifying "what lifecycle state is this plan in" is a read-side concern — it depends only on the plan's data and the current date. Colocating it with the reader keeps the "how to interpret a plan" logic in one place. Phase 5 will add a fifth state (`'gap'`) to the same function; the structure is already set up for it.

**Q2 decision (mid-period editing) is doing real work here.** Because the plan is editable during the active period, the cooked checkbox is NOT gated by state — it appears as soon as the plan is served. The ONLY state-gated UI is the finalize prompt. That keeps the component simple: `<PeriodReview>` just renders items and checkboxes; whether to show the finalize button is a prop, not a branch inside the component.

**Things to verify after merge:**

1. Serve a plan where today falls inside `period_start..period_end`. Check each item → cooked column updates in the DB.
2. Manually update a plan's `period_end` in Supabase to yesterday's date. Reload the app → end-of-period prompt should appear.
3. Click "Lock in and finalize." In the DB, `finalized_at` should go from NULL to a timestamp.
4. Reload. The prompt should not re-appear for that plan.
5. Uncheck all items before finalizing. After finalize, query `current_leftovers` → those items should appear (this is what Phase 5 will surface in the UI).
