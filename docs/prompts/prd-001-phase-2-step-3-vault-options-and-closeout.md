# Claude Code Prompt — PRD-001 Phase 2 Step 3 + Closeout: vault_options

**For:** Claude Code (executor)
**Authored by:** Claude.ai (planning surface) on 2026-04-26
**Linked PRD:** [`docs/prds/PRD-001-recipe-vault-and-cooking-record.md`](../prds/PRD-001-recipe-vault-and-cooking-record.md), §6 P0.7 + §7 Migration D + §11 P0.7 row
**Parent prompt (Step 3 spec lives here):** [`docs/prompts/prd-001-phase-2-data-hygiene.md`](./prd-001-phase-2-data-hygiene.md), Step 3
**Depends on:** Phase 2 Step 1 (PR #30, `feat/vault-soft-delete`) AND Step 2 (PR #32, `refactor/centralize-vault-enums`) already merged to `main`. Confirm `git log origin/main` shows commits `790d41c` and `f53b135`.

---

## Goal (one sentence)

Ship the last open requirement in PRD-001 Phase 2 — move per-user custom chip-picker tags from `localStorage` keys (`vault_extra_*`) to a real `vault_options` table with owner-scoped RLS — plus close out Phase 2 by updating `docs/schema.md` and the migrations log. Final commit on the PR description: a one-line note for the human to tag PRD-001 P0.5/P0.6/P0.7 as complete in `RECIPE_TODOS.md` (which lives in the Claude.ai project, not the repo).

## Why this matters (mental model in plain English)

Today, when a user adds a custom cuisine like "Filipino" in the Vault chip-picker, the value is saved to the browser's `localStorage` under a key named `vault_extra_cuisine_type`. That works for one device, one browser, one session. The instant the user clears site data, opens incognito, or switches phones, the custom tag vanishes. This Step 3 moves that storage into a real Postgres table (`vault_options`) protected by Row-Level Security — one row per `(user_id, category, value)` — so the same user sees their custom tags on every device they sign into. We also do a one-time auto-migration on Vault mount: any pre-existing `vault_extra_*` values in localStorage get upserted into the table, then the localStorage keys are cleared so the migration can't run twice.

This is the last item in PRD-001 Phase 2 (data hygiene). Once it lands, Phase 2 is done and we can move on to Phase 3 (Spoonacular cleanup + Vault.jsx decomposition).

---

## Pre-flight: clean slate before you start

The local working tree may still be sitting on a stale branch from earlier work. Run:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git worktree prune
# Delete any merged local branches you find lying around:
git branch --merged | grep -vE '^\*|main' | xargs -r git branch -d
```

Then verify Phase 2 Steps 1 + 2 are present:

```bash
git log --oneline origin/main | grep -E "P0\.[56]" | head -3
# Expected: f53b135 refactor(constants): ... (P0.6)
#           790d41c feat(vault): soft-delete ... (P0.5)
test -f src/lib/constants.js && echo "constants OK"
test -f supabase/migrations/20260426000001_vault_soft_delete.sql && echo "soft-delete migration OK"
```

If any of those checks fail, **stop and ask the user** before proceeding.

Create a new branch for this work:

```bash
git checkout -b feat/vault-options-table
```

---

## Context to read first (before any edits)

1. **Spec for the work itself:** [`docs/prompts/prd-001-phase-2-data-hygiene.md`](./prd-001-phase-2-data-hygiene.md), Step 3 (Sections 3a–3e). That spec is the source of truth for the table shape, the helper API surface, the migration helper, and the test cases. **This prompt is a re-packaging with refreshed line numbers and a few specific clarifications below.** When the two disagree, this prompt wins.
2. **Files you'll modify on `main`:**
   - `src/pages/Vault.jsx` — the only client surface that uses `vault_extra_*` localStorage. Post-Step-2 line numbers (verify with `grep -n` before editing):
     - `loadExtras` helper at line 32
     - `saveExtras` helper at line 36
     - `ChipPicker` component at line 41 (uses `loadExtras(storageKey)` at line 44 and `saveExtras(storageKey, next)` at line 66)
     - 14 `<ChipPicker ... storageKey="...">` JSX call-sites — 7 in the add form (lines 693, 697, 701, 705, 709, 713, 717) and 7 in the edit form (lines 818, 821, 824, 827, 830, 833, 836)
   - `docs/schema.md` — append a new section for `public.vault_options` and add a row to the migrations log table at the bottom
3. **Files you'll create:**
   - `supabase/migrations/20260426000002_vault_options_table.sql`
   - `supabase/migrations/verify_20260426_vault_options.sql`
   - `src/lib/vaultOptions.js`
   - `src/lib/__tests__/vaultOptions.test.js`
4. **Files for reference (do NOT modify):**
   - `supabase/migrations/20260426000001_vault_soft_delete.sql` — the most recent Phase 2 migration; mirror its header style, idempotency, and comment patterns
   - `src/lib/constants.js` — the canonical category names (`cuisine_type`, `flavor_profile`, `proteins`, `cooking_method`, `main_carb`, `dietary_tags`, `dairy_components`, `vegetables`, `fruits`)
   - `src/lib/__tests__/recommendations.test.js` — the canonical Supabase-mock pattern for unit tests; replicate it for the new `vaultOptions.test.js`

If the file structure or line numbers differ noticeably from the above, **stop and ask the user** rather than guessing. Step 2 may have shifted things by ±1–2 lines; that's expected. ±20 lines means something is off.

---

## Step 1 — Migration + verify SQL

### 1a) Create `supabase/migrations/20260426000002_vault_options_table.sql`

Match the header / divider style of `20260426000001_vault_soft_delete.sql`. Idempotent throughout.

```sql
-- ============================================================================
-- PRD-001 Phase 2 Step 3 (P0.7): persist custom chip-picker tags
-- ============================================================================
-- Replaces the previous vault_extra_* localStorage scheme. Per-user, per-
-- category, per-value custom tags. RLS owner-scoped on user_id, mirroring
-- meals / vault / meal_plan_items. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vault_options (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category   text        NOT NULL CHECK (category IN (
    'cuisine_type', 'flavor_profile', 'proteins',
    'cooking_method', 'main_carb', 'dietary_tags',
    'dairy_components', 'vegetables', 'fruits'
  )),
  value      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category, value)
);

COMMENT ON TABLE public.vault_options IS
  'PRD-001 P0.7: user-managed custom values for vault chip-pickers. Replaces the
   pre-2026-04-26 vault_extra_* localStorage scheme. One row per (user, category,
   value). Built-in option lists live in src/lib/constants.js; this table holds
   only user additions on top of those.';

ALTER TABLE public.vault_options ENABLE ROW LEVEL SECURITY;

-- Drop-then-create so the migration is safe to re-run on a DB that already
-- has earlier versions of these policies under the same names.
DROP POLICY IF EXISTS vault_options_select_own ON public.vault_options;
DROP POLICY IF EXISTS vault_options_insert_own ON public.vault_options;
DROP POLICY IF EXISTS vault_options_update_own ON public.vault_options;
DROP POLICY IF EXISTS vault_options_delete_own ON public.vault_options;

CREATE POLICY vault_options_select_own ON public.vault_options
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY vault_options_insert_own ON public.vault_options
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY vault_options_update_own ON public.vault_options
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY vault_options_delete_own ON public.vault_options
  FOR DELETE USING (auth.uid() = user_id);
```

### 1b) Create `supabase/migrations/verify_20260426_vault_options.sql`

Read-only checks — no data mutation. Cover:

- Table `public.vault_options` exists with the four expected columns and types
- Primary key is `(user_id, category, value)`
- The CHECK constraint includes exactly the nine canonical category names listed in 1a
- All four owner-scoped RLS policies exist (`vault_options_select_own`, `_insert_own`, `_update_own`, `_delete_own`)
- RLS is enabled on the table (`pg_class.relrowsecurity = true`)
- A row count smoke check (just `SELECT count(*) FROM vault_options;` — should return 0 immediately after migration)

Mirror the query style of `verify_20260426_soft_delete.sql`.

---

## Step 2 — `src/lib/vaultOptions.js`

Implement exactly as specified in the parent Phase 2 prompt's Section 3c. Surface:

- `VAULT_OPTION_CATEGORIES` — array of the nine canonical category strings
- `fetchVaultOptions(supabase, userId)` → `Promise<{ [category]: string[] }>` — grouped by category, returns `{}` on error
- `addVaultOption(supabase, userId, category, value)` — upserts (`onConflict: 'user_id,category,value'`), trims whitespace, returns `{ error: string | null }`
- `removeVaultOption(supabase, userId, category, value)` → `{ error: string | null }`
- `migrateLocalStorageExtras(supabase, userId)` → `{ migrated: number }` — reads each `vault_extra_<category>` key, upserts via `addVaultOption`, then `localStorage.removeItem`. Idempotent (cleared keys can't be re-migrated).

### Two clarifications the parent prompt does not call out

**(i) The "dairy" → "dairy_components" rename.** Today's `Vault.jsx` passes `storageKey="dairy"` to its dairy ChipPicker, so existing localStorage values live under the key `vault_extra_dairy`. The new canonical category name is `dairy_components` (matches `constants.js` and the table CHECK constraint). `migrateLocalStorageExtras` must therefore map the legacy storage key `vault_extra_dairy` to category `dairy_components`. Implement this with a small alias map at the top of the function:

```js
// Legacy localStorage suffix → canonical vault_options category
const LEGACY_STORAGE_KEY_TO_CATEGORY = {
  cuisine_type:      'cuisine_type',
  flavor_profile:    'flavor_profile',
  proteins:          'proteins',
  cooking_method:    'cooking_method',
  main_carb:         'main_carb',
  dietary_tags:      'dietary_tags',
  dairy:             'dairy_components',  // rename for canonical naming
  vegetables:        'vegetables',
  fruits:            'fruits',
}
```

Iterate the keys of that map (not `VAULT_OPTION_CATEGORIES`) when reading localStorage. Once the migration runs, the `vault_extra_dairy` key is cleared and the values land in the `dairy_components` rows of `vault_options`.

**(ii) Tolerate duplicate inserts gracefully.** Because `addVaultOption` upserts on the composite primary key, calling it with a value that already exists is a no-op (Postgres returns success). That property is what makes `migrateLocalStorageExtras` idempotent — and is also what enables the optimistic-UI pattern in Step 3 below. Don't add bespoke "exists?" checks; let the upsert do the work.

---

## Step 3 — Wire into `Vault.jsx`

This is the bulk of the user-visible change. **Do not decompose `Vault.jsx` into a folder of components in this PR** — that work is reserved for PRD-001 P0.9 / Phase 3.

### 3a) Top of file: imports + helper deletions

- Add: `import { fetchVaultOptions, addVaultOption, migrateLocalStorageExtras } from '../lib/vaultOptions'`
- **Delete** `loadExtras` (line 32) and `saveExtras` (line 36) — the localStorage helpers are gone after this PR
- Update the file-header docstring (currently says "Custom tags per category persist via localStorage."): change to "Custom tags per category persist in the `vault_options` table; legacy localStorage values are auto-migrated on mount."

### 3b) `Vault` component-level state + mount effect

Add component-level state for the grouped extras map, e.g.:

```js
const [extrasByCategory, setExtrasByCategory] = useState({})
```

In an effect that runs once after `userId` is available (you can fold this into the existing mount effect, or add a new one — your call):

```js
useEffect(() => {
  if (!userId) return
  let cancelled = false
  ;(async () => {
    await migrateLocalStorageExtras(supabase, userId)
    const grouped = await fetchVaultOptions(supabase, userId)
    if (!cancelled) setExtrasByCategory(grouped)
  })()
  return () => { cancelled = true }
}, [userId])
```

The migration runs before the fetch so the fetch sees any newly-imported values. The migration is a no-op on subsequent loads because the localStorage keys have been cleared.

### 3c) `ChipPicker` signature change

Replace the `storageKey` prop with two new props:

```diff
- function ChipPicker({ options, value, onChange, multi = true, storageKey = null }) {
+ function ChipPicker({ options, value, onChange, multi = true, category = null, extras = [], onExtraAdded = null }) {
```

Inside `ChipPicker`:

- Replace the `useState(() => storageKey ? loadExtras(storageKey) : [])` with `useState(() => extras)`. Add an effect `useEffect(() => setExtras(extras), [extras])` so updates to the parent's grouped map propagate (extras coming in via prop is the new source of truth).
- In `commitCustom`, replace `if (storageKey) saveExtras(storageKey, next)` with:
  ```js
  if (category && onExtraAdded) {
    onExtraAdded(category, tag)  // parent updates extrasByCategory and persists
  }
  ```
- Inside `commitCustom`, after computing `next`, do an optimistic local `setExtras(next)` so the chip appears immediately even before the round-trip to Supabase completes. The parent's onExtraAdded handles persistence.

### 3d) Parent: define `handleAddExtra` + thread it through

In the `Vault` component:

```js
const handleAddExtra = async (category, value) => {
  // Optimistic update of grouped map
  setExtrasByCategory(prev => ({
    ...prev,
    [category]: [...new Set([...(prev[category] || []), value])],
  }))
  const { error } = await addVaultOption(supabase, userId, category, value)
  if (error) {
    console.error('[Vault] failed to persist custom tag:', error)
    // Rollback on failure — the chip won't reappear after the next refresh,
    // but the user already saw it added; surface a toast if you want.
  }
}
```

### 3e) Update all 14 `<ChipPicker ...>` call-sites

Convert every existing `storageKey="X"` to the new prop pair, mapping to canonical category names (this is where the dairy rename lands in JSX too):

| Existing (storageKey) | New (category)    | extras prop                                | onExtraAdded prop |
|-----------------------|-------------------|--------------------------------------------|-------------------|
| `"proteins"`          | `"proteins"`      | `extras={extrasByCategory.proteins \|\| []}`        | `onExtraAdded={handleAddExtra}` |
| `"cooking_method"`    | `"cooking_method"`| `extras={extrasByCategory.cooking_method \|\| []}`  | `onExtraAdded={handleAddExtra}` |
| `"main_carb"`         | `"main_carb"`     | `extras={extrasByCategory.main_carb \|\| []}`       | `onExtraAdded={handleAddExtra}` |
| `"dietary_tags"`      | `"dietary_tags"`  | `extras={extrasByCategory.dietary_tags \|\| []}`    | `onExtraAdded={handleAddExtra}` |
| `"dairy"`             | `"dairy_components"` | `extras={extrasByCategory.dairy_components \|\| []}` | `onExtraAdded={handleAddExtra}` |
| `"vegetables"`        | `"vegetables"`    | `extras={extrasByCategory.vegetables \|\| []}`      | `onExtraAdded={handleAddExtra}` |
| `"fruits"`            | `"fruits"`        | `extras={extrasByCategory.fruits \|\| []}`          | `onExtraAdded={handleAddExtra}` |

Apply this conversion at all 14 call-sites (7 in add form, 7 in edit form). The seven canonical category names should be the only string literals you use.

### 3f) Confirm nothing references localStorage `vault_extra_*` after this step

```bash
grep -rn "vault_extra_" src/ && echo "FAILED: still referenced" || echo "OK: clean"
```

The only remaining reference should be inside `src/lib/vaultOptions.js`'s migration helper. `Vault.jsx` should be 100% clean of `vault_extra_*` and `localStorage.getItem`/`setItem` for this purpose.

---

## Step 4 — Tests

### 4a) Create `src/lib/__tests__/vaultOptions.test.js`

Mirror the Supabase mock pattern from `src/lib/__tests__/recommendations.test.js`. Cover:

- `fetchVaultOptions` groups rows correctly by category (given a flat array of mock rows, returns `{ proteins: [...], cooking_method: [...], ... }`)
- `fetchVaultOptions` returns an empty grouping (no errors) when the mock returns `data: []`
- `addVaultOption` calls Supabase `upsert` with the expected `onConflict` argument
- `addVaultOption` trims whitespace from `value` and rejects empty strings (returns `{ error: 'empty' }`)
- `removeVaultOption` calls Supabase `match` with the right keys
- `migrateLocalStorageExtras` reads every `vault_extra_<key>` from a mocked `window.localStorage`, calls `addVaultOption` for each value, then clears the key
- `migrateLocalStorageExtras` correctly maps `vault_extra_dairy` to category `dairy_components` (the rename test — keep this one explicit and named so it doesn't get accidentally deleted)
- `migrateLocalStorageExtras` is idempotent: calling twice doesn't re-call `addVaultOption` on the second run (the keys are cleared after the first)
- Malformed JSON in a `vault_extra_*` key doesn't throw — the function logs and continues to the next category

### 4b) Extend `src/pages/__tests__/Vault.test.jsx`

Add cases:

- On mount, `migrateLocalStorageExtras` and `fetchVaultOptions` are both called (mocked)
- Rendering: custom tags from `extrasByCategory` appear alongside built-in options in the chip picker
- Adding a custom tag via the picker calls `addVaultOption` with the canonical category name (use `dairy_components`, not `dairy`, to lock the rename)
- A failed `addVaultOption` (mocked rejection) doesn't crash the UI

### 4c) CI sanity

```bash
npm run test:unit
npm run lint
```

Both should pass. If `npm run test:unit` fails on tests you didn't touch, **stop and ask** — don't expand scope to fix unrelated tests.

---

## Step 5 — Closeout: schema docs + Phase 2 wrap-up

### 5a) Update `docs/schema.md`

1. Add a new top-level section `## public.vault_options` after the `public.vault` section. Include: column reference table (4 columns + their types/constraints), primary key, RLS status (the four owner-scoped policies), and a one-paragraph "what this is for" intro that mentions PRD-001 P0.7 and links the migration file.
2. Append a row to the migrations log table at the bottom of the file:

```markdown
| [`20260426000002_vault_options_table.sql`](../supabase/migrations/20260426000002_vault_options_table.sql) | 2026-04-26 | PRD-001 Phase 2 Step 3 (P0.7): creates `public.vault_options` table with composite PK `(user_id, category, value)`, CHECK constraint on the nine canonical category names, owner-scoped RLS. Backs `src/lib/vaultOptions.js`; replaces the previous `vault_extra_*` localStorage scheme in `Vault.jsx`. |
| [`verify_20260426_vault_options.sql`](../supabase/migrations/verify_20260426_vault_options.sql) | 2026-04-26 | Read-only verification queries for the vault_options migration: column shape, primary key, CHECK contents, RLS policies, RLS-enabled bit. |
```

### 5b) PR description must include

- Bullet list of changes (migration, lib, Vault.jsx wire-up, tests, docs)
- A "Manual smoke test plan" the user (Matt) should run after merge:
  1. Apply both new migrations in the Supabase SQL Editor (paste each in order).
  2. Run the verify file — confirm every check returns the expected result.
  3. Open Vault, add a custom cuisine like "Filipino" — should appear immediately.
  4. Reload the page (full hard refresh, not just SPA route change). Custom cuisine still there → DB persistence working.
  5. Sign into a different browser / incognito with the same account — custom cuisine still there → cross-device working.
  6. Inspect Supabase: `SELECT * FROM vault_options WHERE category = 'cuisine_type';` — should show the row.
- A "After merge" footer: a one-line reminder for Matt to mark **PRD-001 P0.5, P0.6, P0.7 as complete in `RECIPE_TODOS.md`** (the file lives in his Claude.ai project knowledge folder, not this repo — Claude Code cannot edit it).

---

## Acceptance criteria (Phase 2 done means all of this true)

- [ ] Branch `feat/vault-options-table` created from a fresh `main`
- [ ] `supabase/migrations/20260426000002_vault_options_table.sql` exists, idempotent, mirrors the style of `…000001_vault_soft_delete.sql`
- [ ] `supabase/migrations/verify_20260426_vault_options.sql` exists and checks: column shape, PK, CHECK, four RLS policies, RLS-enabled bit, smoke count
- [ ] `src/lib/vaultOptions.js` exists with `fetchVaultOptions`, `addVaultOption`, `removeVaultOption`, `migrateLocalStorageExtras`, and `VAULT_OPTION_CATEGORIES`
- [ ] `src/pages/Vault.jsx` no longer contains `loadExtras`, `saveExtras`, or any `vault_extra_*` string
- [ ] `ChipPicker`'s `storageKey` prop is gone, replaced by `category` + `extras` + `onExtraAdded`
- [ ] All 14 `<ChipPicker>` call-sites pass canonical category names (note `dairy_components`, not `dairy`)
- [ ] `src/lib/__tests__/vaultOptions.test.js` covers fetch grouping, upsert, remove, the dairy rename, idempotency, malformed JSON tolerance
- [ ] `src/pages/__tests__/Vault.test.jsx` extended for migrate-on-mount + DB-persisted custom tags
- [ ] `npm run test:unit` and `npm run lint` both pass
- [ ] `docs/schema.md` has a new `## public.vault_options` section AND a new row in the migrations log table for both new files
- [ ] PR description includes the manual smoke test plan AND the RECIPE_TODOS hand-update reminder
- [ ] `grep -rn "vault_extra_" src/` returns matches ONLY inside `src/lib/vaultOptions.js`

---

## Constraints

- **Stack:** React 19.2 + Vite 8 + Tailwind 3.4 + lucide-react. No new dependencies.
- **No `Vault.jsx` decomposition.** Reserved for Phase 3 (PRD-001 P0.9).
- **Migrations are idempotent.** Use `IF NOT EXISTS`, `CREATE OR REPLACE`, drop-then-create policies. Re-running this migration must be a no-op.
- **RLS is non-negotiable.** Four owner-scoped policies + `ENABLE ROW LEVEL SECURITY` on the table. Never ship a new table without RLS.
- **Don't fix unrelated lint or test errors.** If you spot some, note them in the PR description as follow-ups; don't expand scope.
- **Cross-branch reads use `git show`.** Per `CLAUDE.md`, never poke at `.claude/worktrees/...`. If you need to compare against a different ref, use `git show <ref>:<path>` or `git diff main..<branch> -- <path>`.

---

## Out of scope (do NOT touch)

- `Vault.jsx` → `Vault/*` decomposition (PRD-001 P0.9, Phase 3)
- Spoonacular cleanup (PRD-001 P0.8, Phase 3)
- LogMode / BrainstormMode beyond observing they don't reference `vault_extra_*` (they shouldn't; this is a Vault-only concern)
- The shared analyze-recipe AI prompt (already covered by Step 2)
- Anything in PRD-002 (meal planning) or PRD-003 (grocery)

---

## Commit cadence

Two commits is fine; three is also fine. Suggested split:

1. `feat(vault): add vault_options table + lib + auto-migrate from localStorage (PRD-001 P0.7)` — migration, verify SQL, lib, tests, Vault.jsx wire-up
2. `docs(schema): document vault_options table + close out PRD-001 Phase 2` — docs/schema.md updates

If you'd rather split into three (migration / lib+wire-up / docs), that's also fine — just keep each commit logically self-contained.

---

## When you finish

1. Run the full acceptance checklist above.
2. Open the PR. Title: `PRD-001 Phase 2 Step 3 + closeout: vault_options table (P0.7)`.
3. In the PR description, list any deviations from this prompt and why.
4. Note any follow-ups for `RECIPE_TODOS.md` (Matt updates that file by hand outside the repo).
5. Wait for the user to apply the migrations manually via the Supabase SQL Editor before merging — Claude Code does not have access to live Supabase.
