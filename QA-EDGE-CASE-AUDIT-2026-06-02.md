# Exploratory Edge-Case Audit — Recipe Rhythm

**Date:** 2026-06-02
**Auditor:** Automated QA pass (Senior QA Engineer role), scheduled task `edge-case-audit`
**Target:** Production deployment — https://recipe-rhythm.vercel.app
**Account used:** Dedicated test user `claudepreview@test.com` (UID `fc0d9d39…`)
**Browser session timezone:** `America/Los_Angeles`, local clock ≈ 06:02 AM at time of test (this matters — see VP-1)

> **Method note.** Auth, Vault/Cookbook, and LogMode were exercised **live** in the
> browser. BrainstormMode/Serve, Grocery generation, and the 401/500 error-handling
> paths were assessed **from source** — partly because the test account's meal-plan
> period has expired (so there were no live draggable items, see ENV-2) and partly
> because the browser automation channel disconnected mid-run before the live 401
> injection could complete. Supabase 401/500s surface as returned error *objects*,
> not thrown exceptions, so the failure behavior is fully determined by each hook's
> error handling and the source reads below are authoritative. Findings marked
> *(live)* were reproduced in the running app; *(source)* were determined by code review.

---

## Summary

No **P0** (crash / data-loss / security) issues were found. Notably:

- **No XSS.** An `<img onerror=…>` payload in a recipe name rendered as escaped text; the JS marker never fired. *(live)*
- **No SQL injection.** A `'; DROP TABLE vault;--` payload was stored and displayed as literal text (Supabase/PostgREST is parameterized). *(live)*
- **No save/serve race conditions.** Auth, Vault save, and Serve all gate on an in-flight `loading`/`saving`/`servingPlan` flag, so rapid clicking cannot double-submit. *(live + source)*

The meaningful findings are **1 confirmed data-integrity bug (P1)**, **1 failure-feedback gap (P1)**, and several **P2** hygiene/edge items.

| ID | Pri | Area | Component file | One-line |
|----|-----|------|----------------|----------|
| **VP-1** | **P1** | LogMode | `src/pages/LogMode.jsx` | Morning "last night" prompt writes **today's** date → cooking record off-by-one |
| **VP-2** | **P1** | Data load / save failure UX | `src/pages/Vault/useVault.js`, `src/App.jsx`, `src/pages/LogMode.jsx` | 401/500 on core fetch & save fails **silently** — no user feedback, looks like empty/no-op |
| **VP-3** | P2 | Vault | `src/pages/Vault/RecipeForm.jsx` | No max length on recipe name; 2 100-char string accepted & sent to AI normalize endpoint |
| **VP-4** | P2 | Vault | `src/lib/mealNameNormalize.js` (+ RecipeForm) | AI normalizer "title-cases" garbage/HTML and returns nonsense suggestions |
| **VP-5** | P2 | Vault | `src/pages/Vault/RecipeCard.jsx` | "Remove" hard-triggers a (soft) delete with **no confirmation** |
| **VP-6** | P2 | BrainstormMode | `src/pages/BrainstormMode/SortableMealItem.jsx` + `useBrainstorm.js` | Drag id = `scheduled_date`; a day can hold multiple meals → duplicate dnd-kit ids |
| **VP-7** | P2 | Grocery | `src/pages/GroceryList/GroceryListBody.jsx` | Regenerate `DELETE`s existing items before insert — non-atomic, partial failure loses the list |
| **VP-8** | P2 | App shell | `src/App.jsx` + `src/components/ErrorBoundary.jsx` | ErrorBoundary wraps `<main>` only — Auth screen, menu button & AppMenuSheet are unprotected |
| **VP-9** | P2 | Auth | `src/components/Auth.jsx` | `successMsg` not cleared on sign-up→sign-in toggle / subsequent errors |

Plus environment/spec drift (ENV-1…3) and two housekeeping items (HK-1, HK-2) at the bottom — **please read those**.

---

## P1 findings

### VP-1 — LogMode "last night" prompt mis-dates the meal *(live, confirmed)*

- **Component:** `src/pages/LogMode.jsx` (lines ~204–207 build the prompt; line **58** writes the date)
- **User action:** Open Log before 11am local, type a meal, tap **Save to log**.
- **Expected:** A meal logged under "What did you eat **last night**?" is stored on **last night's** calendar date.
- **Actual:** It is stored on **today's** date.

**Evidence (captured request body):**
```json
{"user_id":"fc0d9d39…","name":"Audit Offbyone Probe","notes":null,"eaten_on":"2026-06-02","vault_id":null}
```
At capture time the local clock was 06:02 AM, the header read *"What did you eat last night?"* (i.e. **2026-06-01**), yet `eaten_on` was written as **2026-06-02**.

**Root cause:** The header is time-aware:
```js
const timeAwareString = todayHour < 11
  ? 'What did you eat last night?'   // implies YESTERDAY
  : 'What did you eat tonight?'
```
…but the insert is unconditional: `eaten_on: formatLocalDate()` (always *today*). `formatLocalDate()` itself is **correct** (it returned the right local date, not a UTC-shifted one — the PRD-002 P0.11 / AUDIT U8 fix is intact). The bug is purely semantic: nothing subtracts a day for the "last night" case.

**Impact:** Every morning log lands on the wrong day. This corrupts the cooking record that feeds the "last cooked" badge, recommendation scoring, and the Calendar. It is deterministic, not edge-case, and was never caught because P0.11 shipped without an end-to-end smoke test (as the task itself flagged).

**Suggested direction (for a Claude Code prompt):** When `todayHour < 11`, write `formatLocalDate(addDays(new Date(), -1))`; OR replace the implicit assumption with an explicit, editable date control on the Log screen. Acceptance: a Vitest test asserting that with a mocked 06:00 local clock, the inserted `eaten_on` equals yesterday's local date.

---

### VP-2 — Core data load/save failures are silent (no user feedback) *(source; live confirmation blocked)*

- **Components:**
  - `src/pages/Vault/useVault.js` `fetchRecipes` (lines **59–63**): on a vault error → `console.error('[Vault] fetchRecipes failed: …')`, `setLoading(false)`, `return`. No error state, no message.
  - `src/App.jsx` `fetchRecentMeals` (line **44**): `if (!error && data) setRecentMeals(data)` — error path is a no-op.
  - `src/pages/LogMode.jsx` `finalizeSave` (lines **64–67**): on insert error → `console.error('Save failed: …')`, `return`. The "Logged!" confirmation never appears and **no error is shown**.
- **User action:** Any authenticated fetch/save while the JWT is expired/revoked, or during a transient Supabase 500.
- **Expected:** A visible "couldn't load / couldn't save, try again" state.
- **Actual:** A failed Cookbook load is **indistinguishable from an empty cookbook** ("0 recipes"); a failed log save looks like the button simply did nothing.

**Why ErrorBoundary doesn't help here:** Supabase returns 401/500 as `{ error }` objects, not thrown exceptions, so `ErrorBoundary` (which only catches render-time throws) never engages. On a true 401 where token refresh also fails, `supabase-js` emits `SIGNED_OUT` and `App`'s `onAuthStateChange` drops the user to the Auth screen — acceptable, but abrupt, and any unsaved Log/Vault input is lost without warning.

**Contrast (these paths *do* handle errors well):** `GroceryListBody` surfaces specific messages for every failure; `commitServe` surfaces `period_overlap`/generic errors; Auth shows "Invalid login credentials." The gap is specifically the Vault/recent-meals **reads** and the LogMode **save**.

**Suggested direction:** Add lightweight error state + retry affordance to `useVault.fetchRecipes` and `LogMode.finalizeSave` (and ideally a shared toast). This is the M7-class work; note that `ErrorBoundary` *does already exist* (see ENV-1) — what's missing is async-error surfacing, which an error boundary cannot provide.

---

## P2 findings

### VP-3 — No length cap on recipe name *(live)*
`RecipeForm` accepts a 2 100-character name (a 2 183-char value saved successfully) and forwards the whole string to `/api/normalize-meal-name`. Risks: wasted Haiku tokens/cost, possible token-limit errors on pathological input, oversized DB rows. The card display itself is safe (CSS-truncated with ellipsis, no layout break). Add a sane `maxLength` (e.g. 120) on the name input.

### VP-4 — AI normalizer dignifies garbage *(live)*
Saving the 2 100-char XSS/SQLi blob triggered the "Did you mean…?" sheet, which "suggested" a Title-Cased version of the entire junk string (including the `<img …>` markup). Harmless but nonsensical and wasteful. Consider skipping normalization when the input fails a basic plausibility check (length, ratio of non-alpha characters).

### VP-5 — "Remove" has no confirmation *(live)*
Expanding a Cookbook card and tapping **Remove** soft-deletes immediately, no "are you sure?". It's recoverable in the DB (`deleted_at`), but there is no in-app undo, so an accidental tap silently loses a recipe from the user's view. Add a confirm step or an undo toast.

### VP-6 — Drag id collides when a day holds multiple meals *(source)*
`SortableMealItem` uses `useSortable({ id: slot.scheduled_date })`, and `handleDragEnd` locates rows via `findIndex(item => item.scheduled_date === active.id)`. But `useBrainstorm` explicitly supports a date holding more than one meal ("a date can hold multiple after the picker inserts a second meal"). Two rows sharing a `scheduled_date` would have **duplicate dnd-kit ids**, which breaks drag identity and makes `findIndex` match only the first. Could not be reproduced live (no active period — see ENV-2). Use the stable `item_id` (or a composite key) as the sortable id.

### VP-7 — Grocery regenerate is non-atomic *(source)*
`GroceryListBody.handleGenerate` runs `await supabase.from('grocery_list_items').delete().eq('list_id', listId)` (line ~221) **before** inserting the new items (line ~224). If the insert fails, the previous list is already gone. Wrap in an RPC/transaction, or insert-then-delete-old.

### VP-8 — ErrorBoundary scope is too narrow *(source)*
In `App.jsx`, `<ErrorBoundary>` wraps only `<main>`. The Auth screen (rendered earlier when `!session`), the top-right menu button, and `<AppMenuSheet>` render **outside** it. A render exception in any of those would white-screen with no "Try again / Reload" recovery UI. Hoist the boundary to wrap the whole app (or add a second one around the Auth screen).

### VP-9 — Auth success message lingers *(source)*
`Auth.jsx` sets `successMsg` after sign-up but never clears it when toggling back to sign-in or on a later error, so "Success! You may now sign in." can persist alongside a subsequent error. Cosmetic. Clear `successMsg` in the toggle handler and at the top of `handleAuth`.

---

## Auth flow — verified healthy *(live)*

- Empty fields → **Sign In disabled** (`disabled={loading || !email || !password}`). No submit.
- Malformed email (`notanemail`) → native HTML5 validation blocks submit (red field, no request).
- Wrong password → clean inline "Invalid login credentials" banner, no crash.
- Rapid triple-click on Sign In with valid creds → single sign-in; the `loading` flag disables the button on first click (no double-submit).

## Vault save/serve races — verified guarded *(live + source)*

- Vault save button: `disabled={!name.trim() || saving || normalizing}`, plus an explicit duplicate-name check in `useVault.addRecipe` (returns `{ ok:false, reason:'duplicate' }`). Rapid clicks cannot create dupes.
- Serve: `handleServe` bails on `isServed || servingPlan || !canServe`; `commitServe` sets `servingPlan` immediately and handles `period_overlap`. No double-serve.

---

## Environment / specification drift (not bugs, but worth correcting)

- **ENV-1 — The task's premises are stale.** (a) The task says "error boundaries are not yet in place (RECIPE_TODOS M7)" — an `ErrorBoundary` component **now exists** and wraps `<main>` (the real gap is async-error surfacing, VP-2, not the boundary). (b) The task/`.claude/test-credentials.md` describe a 3-tab nav "Vault / Brainstorm / Log"; the live nav is **4 tabs: Log / Prep Table / Calendar / Cookbook** ("Vault"→"Cookbook", "Brainstorm"→"Prep Table", Groceries folded into a sheet). (c) `RECIPE_TODOS.md` is retired per `CLAUDE.md` (superseded by `docs/STATUS.md`).
- **ENV-2 — Test-account baseline has expired.** The baseline meal plan (`210c7b22…`, 2026-04-27 → 2026-05-03) is now a month in the past, so Prep Table shows the *"your period has ended"* review state, not an active week. The credentials' smoke-test step "active meal plan loads; all 5 items visible" and any **live** drag-and-drop / Serve test can't run without creating a new plan (which would mutate state). Recommend refreshing the baseline plan to a rolling/current window.
- **ENV-3 — Leftover test data.** The Cookbook already held a `Chiken Parmesean` recipe and a custom `wagyu` protein chip from earlier runs (baseline says 0 recipes / 0 vault_options). Left untouched.

---

## Housekeeping — action needed by Matt

- **HK-1 — Your real account was signed out.** The browser was logged into `mreynolds08@gmail.com` (your real data). To run the audit safely against the **test** account (as the task requires), I signed that session out and signed in as `claudepreview@test.com`. **No garbage data was ever written to your real account.** You'll need to sign back into your real account in the browser.
- **HK-2 — One test row left behind.** A test meal **"Audit Offbyone Probe"** (`eaten_on` = 2026-06-02) remains in the **test** account — the browser automation channel disconnected before I could delete it. The oversized test recipe (VP-3) *was* removed successfully. Please delete the probe meal on your next pass, or it's harmless to leave in the test account.
