# Claude Code Prompt — PRD-001 Phase 3 Step 2: Vault.jsx Decomposition (P0.9)

**For:** Claude Code (executor)
**Authored by:** Claude.ai (planning surface) on 2026-04-26
**Linked PRD:** [`docs/prds/PRD-001-recipe-vault-and-cooking-record.md`](../prds/PRD-001-recipe-vault-and-cooking-record.md), §6 P0.9 + §11 P0.9 row
**Depends on:** PRD-001 Phase 3 Step 1 (Spoonacular cleanup, P0.8) merged to `main`. The cleanup is a tiny PR that should land first so this large refactor diff doesn't carry unrelated changes.

---

## ⚠ Pre-flight: confirm you're in the right place

The user has multiple Claude-Code worktrees on disk and prompts have been mis-routed before. **Run these checks FIRST**, before reading or editing anything else. If any check fails, stop and surface a clear error to the user — do NOT guess or pick a different path.

```bash
# 1) Canonical repo root
EXPECTED="/Users/Matt/Desktop/Current Projects/recipe-rhythm"
ACTUAL="$(git rev-parse --show-toplevel 2>/dev/null)"
echo "expected: $EXPECTED"
echo "actual:   $ACTUAL"
[ "$ACTUAL" = "$EXPECTED" ] || { echo "ABORT: not in the recipe-rhythm repo root"; exit 1; }

# 2) This prompt file must exist at the expected path within the repo
PROMPT="docs/prompts/prd-001-phase-3-step-2-vault-decomposition.md"
test -f "$PROMPT" || { echo "ABORT: $PROMPT not found in this working tree"; exit 1; }

# 3) Show all worktrees so we can spot stale ones
git worktree list

# 4) If we're inside .claude/worktrees/<something>, switch to the canonical clone
case "$ACTUAL" in
  *".claude/worktrees/"*) echo "ABORT: running inside a Claude worktree — switch to $EXPECTED first"; exit 1 ;;
esac

# 5) Confirm Phase 3 Step 1 (P0.8) has shipped
git fetch origin --quiet
git log --oneline origin/main | grep -qE "P0\.8|spoonacular" || { echo "ABORT: P0.8 not on main yet — merge Step 1 first"; exit 1; }
```

If anything aborts: tell the user exactly which check failed, and ask whether they want you to `cd` to the canonical path or whether something else is going on. **Don't proceed on a guess.**

Once all five checks pass, start clean:

```bash
git checkout main
git pull --ff-only origin main
git worktree prune
git branch --merged | grep -vE '^\*|main' | xargs -r git branch -d
git checkout -b refactor/vault-decomposition
```

---

## Goal (one sentence)

Split the 999-line `src/pages/Vault.jsx` into five focused modules — `Vault/index.jsx`, `Vault/RecipeForm.jsx`, `Vault/RecipeCard.jsx`, `Vault/ChipPicker.jsx`, `Vault/useVault.js` — preserving exact runtime behavior so this PR is a pure refactor: existing tests pass, manual smoke tests behave identically, no new features.

## Why this matters (mental model in plain English)

`Vault.jsx` started small and accreted: chip-picker tagging, AI suggest, image upload, soft-delete, family rating, vault_options. Today it's a single ~1,000-line file mixing UI, state management, data fetching, and four inline sub-components. Every PRD-002 and PRD-003 feature on the roadmap will touch it. Splitting now, before more code lands, makes future changes safer and easier to review. The split also satisfies PRD-001 P0.9, which has been the last open requirement for Phase 3.

This is a **pure refactor**. Behavior must be bit-identical to before. If you find yourself thinking "while I'm in here I should also fix X" — don't. Note X in the PR description as a follow-up.

---

## Context to read first (before any edits)

1. **Spec:** [`docs/prds/PRD-001-recipe-vault-and-cooking-record.md`](../prds/PRD-001-recipe-vault-and-cooking-record.md), §6 P0.9 + §11 P0.9 row.
2. **The file you're decomposing:** `src/pages/Vault.jsx` (999 lines on `main` after Phase 2). Skim the whole thing before splitting. Approximate structure:
   - Lines 1–32: imports + the 9 `_OPTIONS` re-imports from `constants.js` + `STARTER_SUGGESTIONS`
   - Lines 33–129: `ChipPicker` component (~96 lines)
   - Lines 131–138: `FieldSection` component (~7 lines, presentational)
   - Lines 140–167: `ComponentRow` component (~27 lines, presentational)
   - Lines 169–205: `StarRating` component (~36 lines, presentational)
   - Lines 207–end: `Vault` default-export component (~793 lines: hooks/state/effects, then a long JSX return for header + add form + recipe list + edit modal)
3. **Tests that must continue passing without modification:**
   - `src/pages/__tests__/Vault.test.jsx` — every existing case
   - `src/pages/__tests__/Vault.softDelete.test.jsx` (if present)
   - Any `vaultOptions` tests that rely on the migrate-on-mount behavior
4. **Files for reference (do NOT modify):**
   - `src/pages/LogMode.jsx` — already a single-file page; don't decompose it now
   - `src/lib/vaultOptions.js` and `src/lib/constants.js` — these are the existing libs the new components import from
5. **CLAUDE.md** at the repo root — the section on test conventions and the `react-modal-sheet` named-import gotcha.

If file structure or line counts differ noticeably from the above (±50 lines), **stop and ask the user** rather than guessing.

---

## Step 1 — Plan the split (no edits yet)

Before touching any file, **map every responsibility in the current `Vault.jsx`** to one of the five target modules. Write this map out (in your head, in scratch notes, or in a `# PLAN` comment at the top of `Vault/index.jsx`). The map below is the recommended starting point — adjust if you find something that obviously belongs elsewhere.

| Target file | Owns | Imports from |
|---|---|---|
| `src/pages/Vault/index.jsx` | The page-level component (header + tabs + glue), composes `<RecipeForm/>` and `<RecipeCard/>`, mounts `useVault`, owns top-level UI state (which recipe is being edited, modal open/close, etc.) | `useVault`, `RecipeForm`, `RecipeCard`, `lucide-react`, `Logo` |
| `src/pages/Vault/RecipeForm.jsx` | The add-form **and** the edit-form. They share enough JSX that one component with `mode="add" \| "edit"` and an `initialValues` prop is the right call. Owns local form state for the recipe being entered/edited. | `ChipPicker`, `FieldSection` (presentational helpers can move into this file as private exports), `analyzeRecipe`, `lucide-react` |
| `src/pages/Vault/RecipeCard.jsx` | The per-recipe row in the list — image, title, component metadata via `ComponentRow`, family-rating stars via `StarRating`, edit/delete buttons. `ComponentRow` and `StarRating` move into this file as private (non-exported) helpers. | `lucide-react`, `useHaptics` |
| `src/pages/Vault/ChipPicker.jsx` | The chip picker — built-in options + custom extras + add-custom UI. Pure presentational + a callback to commit a new tag. | `lucide-react`, `useHaptics` |
| `src/pages/Vault/useVault.js` | A custom hook that owns all data fetching + mutation: initial `fetchRecipes`, the `vault_options` migrate + fetch, `handleAdd`, `handleDelete` (soft-delete), `handleUpdate`, `handleToggleFamilyRating`. Returns `{ recipes, extrasByCategory, loading, error, actions: { add, delete, update, ... } }` so `Vault/index.jsx` is mostly composition + state lifting. | `supabase`, `vaultOptions`, `analyzeRecipe` |

**Imports the rest of the codebase makes from Vault today** — confirm no public surface changes:

```bash
grep -rn "from '.*pages/Vault'" src/ --include='*.js' --include='*.jsx'
grep -rn "import .* from '../pages/Vault'" src/ --include='*.js' --include='*.jsx'
```

If anything imports anything from `Vault.jsx` other than the **default export** (the `Vault` component), call it out — the split has to preserve those public imports. Today's `App.jsx` imports the default export only, so a `Vault/index.jsx` with a default export keeps the import path `../pages/Vault` working unchanged.

---

## Step 2 — Create the new directory + skeleton files

```bash
mkdir -p src/pages/Vault
```

Create the five files as empty skeletons first, with explicit module-level JSDoc headers explaining what each owns. This makes the subsequent move-and-split commits diffable in small chunks.

Example skeleton for `src/pages/Vault/ChipPicker.jsx`:

```js
/**
 * ChipPicker — multi/single chip selector with built-in options + per-user
 * custom extras. Custom extras are persisted by the caller via the
 * `vault_options` table; this component only emits an `onExtraAdded(category,
 * value)` callback when the user commits a new tag.
 *
 * Extracted from Vault.jsx in PRD-001 P0.9 (Phase 3 Step 2). Behavior is
 * bit-identical to the pre-split version.
 */

// implementation moves in next commit
```

Do this for all five files. Commit: `refactor(vault): scaffold Vault/ directory with skeleton modules (PRD-001 P0.9)`.

---

## Step 3 — Move `ChipPicker` first (smallest, most self-contained)

`ChipPicker` is the cleanest piece to move because it has no Supabase dependency and a small, well-defined interface. Move the full component body (lines 33–129 of today's `Vault.jsx`) into `src/pages/Vault/ChipPicker.jsx` as a default export. In `Vault.jsx`, replace the inline definition with `import ChipPicker from './Vault/ChipPicker'`.

Run the test suite after this single move:

```bash
npm run test:unit
npm run lint
```

If anything breaks, fix it before moving on. Tests should pass without modification because the component's interface hasn't changed.

Commit: `refactor(vault): extract ChipPicker into Vault/ChipPicker.jsx (PRD-001 P0.9)`.

---

## Step 4 — Move `useVault` (the data hook)

This is the biggest behavioral piece — touch it carefully.

In `Vault/useVault.js`, define a hook that takes `userId` and returns:

```js
// Sketch only — adapt to actual call sites in Vault.jsx
{
  recipes,            // active vault rows (deleted_at IS NULL)
  extrasByCategory,   // grouped vault_options
  loading,
  error,              // surfaced error state, if any
  refresh,            // re-fetch recipes (used after add/edit)
  addRecipe,          // (input) => Promise<{ data, error }>
  updateRecipe,       // (id, patch) => Promise
  deleteRecipe,       // (id) => Promise         (soft-delete)
  setFamilyRating,    // (id, value) => Promise
  addExtraOption,     // (category, value) => Promise — calls addVaultOption
}
```

The current `Vault.jsx` mixes hook logic with UI state — for this refactor, keep UI state (which recipe is being edited, modal flags, the in-progress form draft) in `Vault/index.jsx`, and move only the data + Supabase concerns into the hook. The line between "UI state" and "data state" is sometimes fuzzy; when in doubt, keep state in the page component and let the hook expose pure async actions.

In `Vault/index.jsx`, call `useVault(userId)` and destructure what's needed.

Run tests after this move. The existing `Vault.test.jsx` mocks Supabase at the module level, so it should still work — but watch for any test that asserts on internal state shape (those will need to follow the move).

Commit: `refactor(vault): extract data layer into Vault/useVault.js (PRD-001 P0.9)`.

---

## Step 5 — Extract `RecipeForm`

Both the add-form and the edit-form become a single `<RecipeForm mode="add"|"edit" initialValues={...} onSubmit={...} onCancel={...}/>`. Inside, the form owns its own draft state (so canceling an edit doesn't need to reset state in the parent). On submit, it calls back into the parent, which dispatches to `addRecipe` or `updateRecipe` from `useVault`.

`FieldSection` (lines 131–138) is only used inside the form's JSX — move it into `RecipeForm.jsx` as a private (non-exported) helper. No need for its own file.

Run tests. The form's behavior must be unchanged — same field labels, same chip-picker interactions, same AI-suggest button, same submit behavior.

Commit: `refactor(vault): extract RecipeForm into Vault/RecipeForm.jsx (PRD-001 P0.9)`.

---

## Step 6 — Extract `RecipeCard`

Move the per-recipe-row JSX (the bit inside the recipes `.map(...)` rendering each card) into `Vault/RecipeCard.jsx`. Move `ComponentRow` (lines 140–167) and `StarRating` (lines 169–205) into this file as private helpers — both are only used by the card.

Run tests.

Commit: `refactor(vault): extract RecipeCard into Vault/RecipeCard.jsx (PRD-001 P0.9)`.

---

## Step 7 — Final cleanup of the original `Vault.jsx`

After Steps 3–6, the original `src/pages/Vault.jsx` should be a thin re-export shim — or you can replace it entirely. Two options:

**Option A (recommended for clean diff):** Delete `src/pages/Vault.jsx` and rely on `src/pages/Vault/index.jsx` being the new module. React/Vite resolves `'../pages/Vault'` to `Vault/index.jsx` automatically. Verify by grepping importers:

```bash
grep -rn "from '\.\./pages/Vault'" src/
grep -rn "from '\./pages/Vault'" src/
```

Both patterns resolve to `Vault/index.jsx` after the file is removed; existing imports keep working unchanged. Delete `Vault.jsx` and run tests.

**Option B (safer if Option A turns up surprises):** Keep `Vault.jsx` as a one-line shim: `export { default } from './Vault/index.jsx'`. This is uglier but guaranteed not to break any unusual import resolution. Use this only if Option A surfaces a problem you can't quickly resolve.

Commit: `refactor(vault): remove monolithic Vault.jsx; Vault/index.jsx is the entry point (PRD-001 P0.9)`.

---

## Step 8 — Tests + manual smoke

```bash
npm run test:unit
npm run lint
npm run build      # confirm Vite builds the new file structure cleanly
```

All three must pass. The build check matters — Vite import-resolution edge cases are real (especially around `react-modal-sheet`'s named-export quirk noted in `CLAUDE.md`).

**Manual smoke test** the user (Matt) should run after the PR is up:

1. `npm run dev` + `npm run dev:api` — open the app
2. Vault page loads, all existing recipes are visible
3. Click "+" to open the add form — chip pickers render, AI suggest works, submit creates a recipe and it appears in the list
4. Tap an existing recipe to edit — fields pre-populate, can change them, save, list updates
5. Soft-delete a recipe — disappears from list (verify in Supabase that `deleted_at` is non-null, recipe row is preserved)
6. Add a custom cuisine "FilipinoTest" via the chip picker — it persists; reload the page, still there
7. Tap a family-rating star — stars update; reload, still there
8. LogMode → Save to Cookbook flow — promote-to-cookbook still creates a vault row and back-links the meal (Phase 1 behavior preserved)

Document this in the PR description so the user knows what to spot-check.

---

## Acceptance criteria (Step 2 done means all of this true)

- [ ] Branch `refactor/vault-decomposition` created from a fresh `main` (post-P0.8)
- [ ] All five pre-flight working-tree checks pass
- [ ] `src/pages/Vault/` directory exists with five files: `index.jsx`, `RecipeForm.jsx`, `RecipeCard.jsx`, `ChipPicker.jsx`, `useVault.js`
- [ ] No file in `src/pages/Vault/` exceeds ~400 lines (the original was 999; if any module is still >400, the split isn't done)
- [ ] `src/pages/Vault.jsx` is either deleted (Option A) or a one-line re-export shim (Option B)
- [ ] No public-import surface change: `import Vault from '../pages/Vault'` still works for `App.jsx` and any other importer
- [ ] All existing tests in `src/pages/__tests__/Vault*.test.jsx` pass without modification — if any test was modified, the modification was forced by the test reaching into private internals (note this in PR description)
- [ ] `npm run test:unit` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` passes (Vite production bundle)
- [ ] Manual smoke test plan in the PR description covers all 8 steps above

---

## Constraints

- **PURE REFACTOR.** No behavior changes. No new features. No "while I'm here" fixes — note them as follow-ups in the PR description.
- **Stack:** React 19.2 + Vite 8 + Tailwind 3.4 + lucide-react. No new dependencies.
- **No new test frameworks.** Vitest + RTL only.
- **`react-modal-sheet` named-import gotcha** (per CLAUDE.md): if `RecipeForm` or `RecipeCard` use the bottom sheet, they MUST do `import { Sheet } from 'react-modal-sheet'`, not `import Sheet from 'react-modal-sheet'`. The default-import form fails in production builds and tests.
- **Tests live next to what they test.** If you add new component-specific tests during the refactor (totally optional, only if they help you verify a move), put them in `src/pages/Vault/__tests__/`. Don't move existing `Vault.test.jsx` cases unless they're broken by the refactor.
- **No commits skipping CI.** Each step's commit should leave the tree in a state where `npm run test:unit && npm run lint && npm run build` all pass. This way the user can bisect if something subtle breaks downstream.

---

## Out of scope (do NOT touch)

- LogMode.jsx (single-file page; OK as-is)
- BrainstormMode.jsx (P0.8 already touched it; leave it alone now)
- Spoonacular cleanup (already shipped in Step 1)
- API rate limiting / auth (PRD-001 P1.6, separate work)
- Anything in PRD-002 (meal planning) or PRD-003 (grocery)
- Any `supabase/migrations/` changes — no schema changes in this PR

---

## Commit cadence

Six commits, one per step (3–8 above). The granular commit history is intentional: the user is a beginner and the refactor is large; small commits make `git bisect` viable if a subtle regression appears later.

1. `refactor(vault): scaffold Vault/ directory with skeleton modules (PRD-001 P0.9)`
2. `refactor(vault): extract ChipPicker into Vault/ChipPicker.jsx (PRD-001 P0.9)`
3. `refactor(vault): extract data layer into Vault/useVault.js (PRD-001 P0.9)`
4. `refactor(vault): extract RecipeForm into Vault/RecipeForm.jsx (PRD-001 P0.9)`
5. `refactor(vault): extract RecipeCard into Vault/RecipeCard.jsx (PRD-001 P0.9)`
6. `refactor(vault): remove monolithic Vault.jsx; Vault/index.jsx is the entry point (PRD-001 P0.9)`

If a step turns out to be much bigger than expected, split it further. If two steps are trivially small, you may collapse them — but err on the side of more commits, not fewer.

---

## When you finish

1. Run the full acceptance checklist above.
2. Open the PR. Title: `PRD-001 P0.9: decompose Vault.jsx into Vault/* modules (Phase 3 Step 2 + Phase 3 closeout)`.
3. In the PR description:
   - List the new file structure
   - Note any deviations from this prompt (especially in the responsibility-mapping table) and why
   - Include the 8-step manual smoke test plan
   - Add a footer: "After merge, mark **PRD-001 P0.8 and P0.9 as complete in `RECIPE_TODOS.md`** (lives in the user's Claude.ai project knowledge, not this repo)."
   - Note any follow-ups discovered along the way (refactor opportunities you spotted but didn't act on)
4. Wait for the user to run the manual smoke test before merging.
