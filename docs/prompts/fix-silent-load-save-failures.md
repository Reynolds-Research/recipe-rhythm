# Claude Code Prompt — Surface silent load/save failures (no PRD)

**For:** Claude Code (executor)
**Authored by:** Cowork (planning surface) on 2026-06-16
**Type:** Bug fix / UX hardening, not a PRD phase. Will NOT update `docs/STATUS.md`.
**Roadmap item:** Sprint 1, item 1.5 (`docs/ROADMAP.md`).
**Source:** QA audit finding **VP-2** (`QA-EDGE-CASE-AUDIT-2026-06-02.md`) — priority P1, determined from source (live confirmation was blocked).

---

## ⚠ Pre-flight

```bash
EXPECTED="/Users/Matt/projects/recipe-rhythm"
ACTUAL="$(git rev-parse --show-toplevel 2>/dev/null)"
[ "$ACTUAL" = "$EXPECTED" ] || { echo "ABORT: not in recipe-rhythm repo root"; exit 1; }
git fetch origin
git switch -c fix/surface-load-save-errors origin/main
git status   # clean working tree expected
```

---

## The problem (from source; confirm against current files)

Three core data paths swallow Supabase errors silently — no error state, no user feedback. Supabase returns 401/500 as `{ error }` **objects**, not thrown exceptions, so `ErrorBoundary` (render-time throws only) never engages.

| Path | File | Current behavior |
|---|---|---|
| Cookbook load | `src/pages/Vault/useVault.js` → `fetchRecipes` (~L59–63) | On error: `console.error(...)`, `setLoading(false)`, `return`. No error state. **A failed load is indistinguishable from "0 recipes."** |
| Recent meals load | `src/App.jsx` → `fetchRecentMeals` (~L44) | `if (!error && data) setRecentMeals(data)` — error path is a silent no-op. |
| Log save | `src/pages/LogMode.jsx` → `finalizeSave` (~L64–67) | On insert error: `console.error(...)`, `return`. The "Logged!" confirmation never appears and **no error is shown** — looks like a dead button. |

**Good patterns already in the codebase to mirror** (do not reinvent): `GroceryList/GroceryListBody.jsx` surfaces a specific message per failure; `commitServe` surfaces `period_overlap`/generic errors; `Auth.jsx` shows "Invalid login credentials." Match the existing visual style of these.

> Confirm line numbers and current code before editing — the audit was 2026-06-02 and code may have shifted.

---

## Scope & approach

Add **visible error state + a retry affordance** to the three paths above. Keep it minimal and consistent with existing error UI.

1. **Decide the surface first (one quick check).** Look for any existing toast/snackbar/banner primitive in `src/components/`. 
   - If one exists, reuse it for all three paths.
   - If none exists, add a **small shared error affordance** (e.g. `src/components/InlineError.jsx`: a message + a "Try again" button that calls a passed `onRetry`). Keep it tiny; follow PRD-005 design-system primitives (spacing/typography/contrast, 44px touch target on the retry button). Do **not** pull in a toast library.

2. **`useVault.fetchRecipes`** — add an `error` value to the hook's returned state; set it on failure, clear it on a successful refetch. Expose a `retry` (re-invoke `fetchRecipes`). In `Vault/index.jsx`, when `error` is set, render the error affordance **instead of** the empty-state "0 recipes" so the two are distinguishable.

3. **`App.jsx` fetchRecentMeals** — capture the error into state and surface it where recent meals render (or pass down so the consuming surface can show it). At minimum, do not silently no-op.

4. **`LogMode.finalizeSave`** — on insert error, show an inline error ("Couldn't save — try again") and keep the entered text intact (do not clear the input on failure). Only show "Logged!" on actual success.

Keep diffs minimal and focused on error surfacing. Do **not** refactor the happy paths or restructure the hooks beyond adding error state.

---

## Out of scope (note, don't do)

- The narrow ErrorBoundary scope (VP-8) is a **separate** Sprint 2 item — leave it alone here.
- Token-refresh/`SIGNED_OUT` behavior (dropping to Auth screen) is acceptable as-is; this prompt is only about surfacing async read/save errors.

---

## Tests (Vitest)

Using the existing Supabase mock pattern (`src/lib/__tests__/recommendations.test.js`), add:

- `useVault` / `Vault` test: mock `fetchRecipes` to return an error → assert the error affordance renders and the "0 recipes" empty state does **not**; assert tapping "Try again" re-invokes the fetch.
- `LogMode` test: mock the insert to return an error → assert an error message renders, "Logged!" does **not** appear, and the typed meal text is still present.
- (If feasible) `App` test: mock `fetchRecentMeals` error → assert it's surfaced, not silently dropped.

Run the full suite; confirm green.

---

## Acceptance criteria

- [ ] A failed Cookbook load shows a distinct error + retry, not an empty "0 recipes" state.
- [ ] A failed Log save shows an error, preserves the typed input, and does not show "Logged!".
- [ ] Recent-meals load errors are no longer a silent no-op.
- [ ] Error UI matches existing patterns (GroceryListBody / commitServe / Auth) and PRD-005 primitives.
- [ ] Tests cover all three failure paths. No unrelated refactors. No `docs/STATUS.md` change.
- [ ] Push branch; verify Vercel preview build via MCP; report in PR description.

Branch: `fix/surface-load-save-errors`. PR title: `fix(data): surface silent load/save failures with retry (VP-2)`.

## If something doesn't match

Stop and ask. Especially if a shared toast/error primitive already exists that changes the approach, or if any of the three paths already handles errors (fixed in an unmerged branch).
