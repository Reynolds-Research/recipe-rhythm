# Claude Code prompt — fix pre-existing E2E failures

_Hand the block between the two `---` markers to Claude Code._

**Scope:** Standalone bug-fix on the Playwright E2E suite. Not blocked by and does not block any ADR-001 phase.

---

## Context

You are working on **Recipe Rhythm**, a React 19 + Vite 8 + Supabase meal-tracking app. The Playwright E2E suite has failing tests that are **not** caused by any recent PR — they're stale leftovers from before ADR-001 was implemented. Someone tried to run `npm run test:e2e` and it failed; on main, the same tests fail. Fix them.

**Key files:**

- `e2e/brainstorm.spec.js` — navigates to the "Prep Table" (Brainstorm) tab, mocks `/rest/v1/vault` and `/rest/v1/meals` only, asserts old UI strings like `"THIS WEEK'S MEAL PLAN"`.
- `e2e/vault.spec.js` — navigates to "Cookbook" (Vault), mocks `/rest/v1/vault`, adds a recipe.
- `e2e/new-period-flow.spec.js` — added during Phase 5; may or may not be passing already.
- `playwright.config.js` — configured with dummy Supabase env vars (`http://localhost:9999`, `mock-key`). All Supabase calls go through mocked `page.route` handlers.
- `src/pages/BrainstormMode.jsx` — the actual page the Brainstorm test exercises. After ADR-001 Phases 2-8 merged, it now calls (via `src/lib/mealPlanReader.js` and `src/lib/mealPlanWriter.js`):
  - `supabase.from('meal_plans').select(...)` — fetch most recent plan
  - `supabase.from('meal_plan_items').select(...).eq('meal_plan_id', ...)` — fetch items for that plan
  - `supabase.from('meal_plans').select('period_start, period_end').eq('user_id', ...)` — list user periods (for the date-strip picker's disabled-date set)
  - possibly `supabase.from('current_leftovers').select(...)` via `fetchCurrentLeftovers` in gap-day flow
- `src/App.jsx` — the bottom-nav renders four buttons with visible labels: "Log", "Prep Table", "Calendar", "Cookbook". Playwright tests use `getByRole('button', { name: 'Prep Table' })` style selectors.

## Task

Diagnose the failures, then fix them with the minimum necessary change. Two buckets to address:

### Bucket A — missing mocks cause the page to fail to render

The existing tests only mock `vault` and `meals`. After Phases 2-8 merged, `BrainstormMode` also queries `meal_plans`, `meal_plan_items`, and potentially `current_leftovers`. Without mocks, those calls hit the unresolvable dummy Supabase URL from `playwright.config.js` and either hang or error, which likely prevents the Brainstorm page from rendering into a queryable state.

Add `page.route` handlers in `beforeEach` for the missing endpoints. The shapes to return:

- `**/rest/v1/meal_plans*` → `[]` (empty — represents "no plans yet" for a fresh test user). The page should render the no-plan / first-time-brainstorm flow.
- `**/rest/v1/meal_plan_items*` → `[]`.
- `**/rest/v1/current_leftovers*` → `[]`.

Mock these in `brainstorm.spec.js`'s `beforeEach`, and audit `vault.spec.js` and `new-period-flow.spec.js` — add whichever are needed there too.

### Bucket B — stale UI text assertions

After Phase 8, the Brainstorm page no longer uses the weekday-chip UI or a "THIS WEEK'S MEAL PLAN" heading. The test assertion `await expect(page.getByText('THIS WEEK\'S MEAL PLAN')).toBeVisible()` will fail because that literal string isn't rendered anymore.

Open `src/pages/BrainstormMode.jsx` and find the closest equivalent current heading / landmark (could be "MEAL PLAN", "Your plan", a date range label, or similar). Update the test assertion to match the real rendered text. If the old text is genuinely gone with no replacement, pick a different stable landmark that proves the Brainstorm page rendered — the DateStripPicker cells are a good candidate (e.g., `getByTestId('date-strip-cell-<today-ymd>')` — the Phase 8 component adds data-testid attributes).

For the "Regenerate" button: confirm whether Phase 8 kept it. If yes, the existing selector is fine. If the button was renamed or removed, update or drop that assertion.

### Bucket C — Vault test sanity check

`vault.spec.js` looks for a button named "Cookbook" (the Vault tab) and "Save to vault" (the save button). Verify these labels still match what the current Vault page renders. If anything drifted, fix.

### Bucket D — new-period flow

If `e2e/new-period-flow.spec.js` passes already (Phase 5 was explicit about adding it), leave it alone. If it fails, diagnose like the others — most likely also a missing mock or stale selector.

## Deliverables

- Updated mocks in `e2e/brainstorm.spec.js` and wherever else needed.
- Updated selectors/assertions in the same files.
- `npm run test:e2e` passes fully on `main`.
- A short NOTE in the PR description documenting:
  - Which mocks were added (by endpoint).
  - Which selector or assertion changes were made, and why (tie each back to a phase of ADR-001 that caused the drift if possible — e.g., "Phase 2 added `meal_plans` reads; test was written pre-Phase-2").
  - Any tests that were deleted or marked `.skip()` (prefer fixing over deleting; only skip if a test's premise is genuinely invalid under the current app).

## Acceptance criteria

- `npm run test:e2e` passes on your branch AND passes against a fresh checkout of `main` after this PR merges.
- `npm run test:unit -- --run` still passes (should not be affected — but run it to rule out accidental side effects).
- `npm run lint` clean on touched files.
- No production code changes (`src/`) — this is purely a test-suite fix. If you find yourself wanting to change `src/`, stop and ask: the "fix" is probably a test update, not a code change.

## Out of scope

- Adding NEW E2E coverage. Keep the test count identical (modulo any genuinely-invalid tests you skip with an explanation).
- Changing the testing framework or config structure.
- Touching unit / component tests.
- Anything to do with ADR-001 phase work.

## Deliverable format

One small PR against `main`:
- `e2e/*.spec.js` edited as needed
- No changes to `src/`, `playwright.config.js`, `package.json`, or migrations
- PR title format: `test(e2e): update mocks and selectors for post-ADR-001 app state`

---

## Notes for the human (you)

**Why this drifted.** The E2E suite was written when the app talked to fewer tables and had different UI copy. Each of Phases 2-8 added new Supabase queries or changed rendered text. Nobody updated the E2E mocks as they went. That's normal — E2E hygiene often lags feature work. A single-shot cleanup catches up.

**What Claude Code should NOT do.** If it proposes changing product code to fix a test, push back. A test that fails because the product changed is a test update, not a product rollback. The one exception: if Claude Code finds that a nav button has NO accessible name (icon-only with no aria-label), that's a legitimate a11y regression worth fixing in product code — but that's a separate PR, not bundled here.

**After this merges**, running `npm run test:e2e` becomes a reliable signal again, which is what you want before handing off future phases.
