# Claude Code Prompt — PRD-001 Phase 2: Data Hygiene

**For:** Claude Code (executor)
**Authored by:** Claude.ai (planning surface) on 2026-04-25
**Linked PRD:** [`docs/prds/PRD-001-recipe-vault-and-cooking-record.md`](../prds/PRD-001-recipe-vault-and-cooking-record.md), §6 P0.5–P0.7 + §7 Migrations B + D + §11 Testing Plan
**Linked TODOs:** PRD-001 Phase 2 items in `RECIPE_TODOS.md`
**Depends on:** PRD-001 Phase 1 already shipped to `main` (`meals.vault_id` link, `pg_trgm` extension, `vault_fuzzy_match` RPC if used).

---

## Goal (one sentence)

Three pieces of foundational hygiene that don't change user-visible behavior much but unblock everything that comes after: (1) switch Vault deletes from hard `DELETE` to a `deleted_at` soft-delete with all SELECT queries filtering active rows; (2) move every cuisine/protein/method/etc. enum out of `Vault.jsx` and the AI prompt and into `src/lib/constants.js` as a single source of truth; (3) move per-user custom chip-picker tags from `vault_extra_*` localStorage keys to a real `vault_options` table with a one-time client-side migration.

## Why this matters (mental model)

- **Soft-delete** is the cheapest insurance against future regret. Hard deletes today silently break historical references; the `meal_plan_items.vault_id ON DELETE SET NULL` papers over this but loses information. After this change, deleted recipes survive in history (UI shows "(deleted recipe)" where appropriate) and can be restored if you ever build an "Undo delete" or "Trash" view.
- **Centralizing the enums** means adding a new cuisine like "Filipino" stops being a three-place edit (Vault.jsx + api-server.mjs + api/analyze-recipe.js). Every consumer reads from the same module; the AI prompt is built by interpolating it. Less drift, fewer bugs.
- **Custom-tags table** ends the localStorage trap. Today user-added cuisines vanish if the user clears site data, switches devices, or uses an incognito tab. A real table with RLS lets the same user see their custom tags everywhere they log in.

## Context to read first (before any edits)

1. **Spec:** `docs/prds/PRD-001-recipe-vault-and-cooking-record.md` — §6 P0.5–P0.7, §7 Migrations B + D, §11 P0.5–P0.7 rows.
2. **Files you'll modify:**
   - `src/pages/Vault.jsx` — multiple touch points (delete handler, fetch query, duplicate-check, ChipPicker)
   - `src/pages/LogMode.jsx` — one duplicate-check SELECT (line 50)
   - `src/pages/BrainstormMode.jsx` — one vault SELECT (line 368)
   - `api-server.mjs` — `/api/analyze-recipe` prompt
   - `api/analyze-recipe.js` — Vercel mirror with the same prompt
   - `docs/schema.md` — document new column + new table
3. **Files you'll create:**
   - `supabase/migrations/20260426000001_vault_soft_delete.sql` (P0.5 + P0.6 RPC update)
   - `supabase/migrations/20260426000002_vault_options_table.sql` (P0.7)
   - `supabase/migrations/verify_20260426.sql`
   - `src/lib/constants.js`
   - `src/lib/__tests__/constants.test.js`
   - `src/lib/vaultOptions.js`
   - `src/lib/__tests__/vaultOptions.test.js`
4. **Files for reference (do NOT modify):**
   - `supabase/migrations/20260418000001_planning_periods_schema.sql` — example soft-delete-style migration patterns + RLS policy form
   - `supabase/migrations/20260425000001_meals_vault_link.sql` — Phase 1's migration (and the `vault_fuzzy_match` RPC if Phase 1 went the RPC route — read this one carefully because Step 1 below has to update the function)
   - `src/pages/__tests__/Vault.test.jsx` — existing test patterns to extend

If the file structure differs from what's described above (e.g., Phase 1 went a different direction than expected), **stop and ask** before guessing.

---

## Step 1 — Vault soft-delete (P0.5)

### 1a) Schema migration

**Create** `supabase/migrations/20260426000001_vault_soft_delete.sql`:

1. Add `deleted_at timestamptz` to `vault` (nullable; NULL = active)
2. Add a partial index for active rows: `CREATE INDEX IF NOT EXISTS vault_user_active_idx ON vault (user_id) WHERE deleted_at IS NULL;`
3. Add a column comment: "Soft-delete timestamp. NULL = active; non-NULL = deleted (preserved for historical references in meals.vault_id and meal_plan_items.vault_id)."
4. **If Phase 1 created the `vault_fuzzy_match` RPC**, `CREATE OR REPLACE FUNCTION` it here with the new filter:
   ```sql
   CREATE OR REPLACE FUNCTION vault_fuzzy_match(p_user_id uuid, p_query text, p_threshold real DEFAULT 0.6)
   RETURNS TABLE (id uuid, name text, image_url text, similarity real)
   LANGUAGE sql STABLE
   AS $$
     SELECT id, name, image_url, similarity(name, p_query) AS similarity
     FROM vault
     WHERE user_id = p_user_id
       AND deleted_at IS NULL                       -- NEW: respect soft-delete
       AND similarity(name, p_query) >= p_threshold
     ORDER BY similarity DESC
     LIMIT 5;
   $$;
   ```
   If Phase 1 went the client-side similarity route instead (no RPC), skip this and the matcher's SELECT in Step 1c below picks up the filter.
5. Idempotent: every statement should be safe to re-run.

**Update** `supabase/migrations/verify_20260426.sql` (create alongside) with read-only verification queries: column exists, index exists, RPC body includes the new filter (if applicable).

### 1b) Update Vault.jsx delete handler

In `src/pages/Vault.jsx`, find the delete handler (~line 407-411):

```js
const handleDelete = async (id) => {
  trigger('error')
  await supabase.from('vault').delete().eq('id', id).eq('user_id', userId)
  setRecipes(prev => prev.filter(r => r.id !== id))
}
```

Change it to:

```js
const handleDelete = async (id) => {
  trigger('error')
  await supabase.from('vault')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
  setRecipes(prev => prev.filter(r => r.id !== id))
}
```

Add a code comment referencing PRD-001 P0.5.

### 1c) Filter every Vault SELECT to ignore deleted rows

There are exactly four SELECT sites that need `.is('deleted_at', null)` added:

| File | Approx line | What it does |
|---|---|---|
| `src/pages/Vault.jsx` | 273 (`fetchRecipes`) | Main vault list |
| `src/pages/Vault.jsx` | 313 (duplicate check before insert) | Prevents adding a recipe that's already in the vault |
| `src/pages/LogMode.jsx` | 50 (post-save vault check) | Decides whether to offer "Save to Cookbook" |
| `src/pages/BrainstormMode.jsx` | 368 (vault fetch for planning) | Source for recommendations / candidates |

For each: add `.is('deleted_at', null)` to the chained query. Examples:

```js
// Vault.jsx fetchRecipes — before:
.from('vault').select(...).eq('user_id', userId).order(...)
// After:
.from('vault').select(...).eq('user_id', userId).is('deleted_at', null).order(...)
```

If Phase 1 used a client-side similarity matcher (in `src/lib/vaultMatch.js`), add `.is('deleted_at', null)` to its SELECT too. (If Phase 1 used the RPC, the function update in Step 1a covers it.)

**Do NOT** modify INSERT or UPDATE statements — they don't need the filter.

### 1d) Historical-reference rendering

`meal_plan_items` rows have a denormalized `name` column already (see `docs/schema.md`), so most historical render paths don't need to join `vault` at all — they can just use the snapshot name. **Do not change** any code that already uses the snapshot.

For any UI surface that *does* join `vault` for historical render (e.g., to fetch an `image_url`), use a LEFT JOIN-style fetch and treat `deleted_at IS NOT NULL` rows as "(deleted recipe)" — render the snapshot name with a small muted "(deleted recipe)" caption underneath. **Investigate first** whether any such surface exists today; if none does, skip this and add a P1 follow-up to `RECIPE_TODOS.md`.

### 1e) Tests

Extend `src/pages/__tests__/Vault.test.jsx`:
- Calling delete sets `deleted_at` to a non-null timestamp instead of issuing DELETE
- After delete, `fetchRecipes` does NOT return that row
- The duplicate-check SELECT excludes soft-deleted rows (i.e., a recipe whose name matches a soft-deleted entry should be insertable)

If you created or modified `src/lib/__tests__/vaultMatch.test.js` in Phase 1, extend it to verify deleted recipes are not returned by the matcher.

**Apply the migration before continuing**, run `verify_20260426.sql` to confirm.

**Commit message:** `feat(vault): soft-delete via deleted_at + filter all vault SELECTs (PRD-001 P0.5)`

---

## Step 2 — Centralize enum lists (P0.6)

### 2a) Create the constants module

**Create** `src/lib/constants.js` exporting each enum list as a named export, *and* a helper that builds the AI-prompt block:

```js
export const CUISINE_OPTIONS = [
  'American', 'Chinese', 'French', 'Greek', 'Indian', 'Italian',
  'Japanese', 'Korean', 'Mexican', 'Middle Eastern', 'Spanish',
  'Thai', 'Vietnamese', 'Other',
]
export const FLAVOR_OPTIONS = [...]
export const PROTEIN_OPTIONS = [...]
export const COOKING_METHOD_OPTIONS = [...]
export const CARB_OPTIONS = [...]
export const DIETARY_OPTIONS = [...]
export const DAIRY_OPTIONS = [...]
export const VEGETABLE_OPTIONS = [...]
export const FRUIT_OPTIONS = [...]

/**
 * Build the JSON-shape block for the analyze-recipe AI prompt.
 * Both api-server.mjs and api/analyze-recipe.js call this so the prompt
 * always reflects the latest enum values.
 */
export function buildAnalyzeRecipePromptBlock() {
  return `{
  "cuisine_type": one of [${CUISINE_OPTIONS.join(', ')}] or null,
  "flavor_profile": one of [${FLAVOR_OPTIONS.join(', ')}] or null,
  "proteins": array from [${PROTEIN_OPTIONS.join(', ')}],
  "cooking_method": one of [${COOKING_METHOD_OPTIONS.join(', ')}] or null,
  "main_carb": one of [${CARB_OPTIONS.join(', ')}] or null,
  "dietary_tags": array from [${DIETARY_OPTIONS.join(', ')}],
  "dairy_components": array from [${DAIRY_OPTIONS.join(', ')}],
  "vegetables": array from [${VEGETABLE_OPTIONS.join(', ')}],
  "fruits": array from [${FRUIT_OPTIONS.join(', ')}]
}`
}
```

Source values exactly from the current `Vault.jsx` lines 15-62 — character-for-character, no "improvements" or reorderings. (The existing AI prompt and existing data depend on these exact strings.)

### 2b) Update Vault.jsx to import

In `src/pages/Vault.jsx`, **delete** the inline `const CUISINE_OPTIONS = [...]` block (lines 15-62) and **import** from constants instead:

```js
import {
  CUISINE_OPTIONS, FLAVOR_OPTIONS, PROTEIN_OPTIONS,
  COOKING_METHOD_OPTIONS, CARB_OPTIONS, DIETARY_OPTIONS,
  DAIRY_OPTIONS, VEGETABLE_OPTIONS, FRUIT_OPTIONS,
} from '../lib/constants'
```

The references inside the JSX (e.g., `<ChipPicker options={CUISINE_OPTIONS} ...`) shouldn't need to change — same identifier, just imported now.

### 2c) Update both AI proxy files

**Modify** `api-server.mjs` (the `/api/analyze-recipe` handler around lines 71-117):

- Add at the top: `import { buildAnalyzeRecipePromptBlock } from './src/lib/constants.js'`
- Replace the inline JSON-shape block (lines ~89-100) with: `textPrompt += '\n' + buildAnalyzeRecipePromptBlock()`

**Modify** `api/analyze-recipe.js` (Vercel mirror) the same way:

- Add at the top: `import { buildAnalyzeRecipePromptBlock } from '../src/lib/constants.js'`
- Replace the inline JSON-shape block (lines ~29-40)

Verify both proxies still respond correctly after the change. The prompt is byte-identical to before, so the AI's behavior should be unchanged — but a quick smoke test (run the dev server, click the "AI suggest" button on the Vault entry form) is worth it.

### 2d) Tests

**Create** `src/lib/__tests__/constants.test.js`:
- Each exported list is a non-empty array of unique non-empty strings
- `buildAnalyzeRecipePromptBlock()` returns a string that includes every value from every list (so removing a value from the constants module would fail this test — protects the AI prompt from drift)

**Commit message:** `refactor(constants): single source of truth for vault enum lists + AI prompt (PRD-001 P0.6)`

---

## Step 3 — Custom tags to `vault_options` table (P0.7)

### 3a) Schema migration

**Create** `supabase/migrations/20260426000002_vault_options_table.sql`:

```sql
CREATE TABLE IF NOT EXISTS vault_options (
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

ALTER TABLE vault_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY vault_options_select_own ON vault_options
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY vault_options_insert_own ON vault_options
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY vault_options_update_own ON vault_options
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY vault_options_delete_own ON vault_options
  FOR DELETE USING (auth.uid() = user_id);
```

Mirror the policy style of the existing `meal_plan_items` migration. Add to `verify_20260426.sql`: confirm table exists, all four policies exist, the CHECK constraint matches the category list.

### 3b) Document in `docs/schema.md`

Add a new section for `public.vault_options` (full column reference + the four policies). Add a row to the migrations log table. Cross-reference PRD-001 P0.7.

### 3c) Lib utility

**Create** `src/lib/vaultOptions.js`:

```js
/**
 * User-managed custom values for vault chip-pickers (cuisines they've added,
 * proteins, etc.). Backed by the vault_options table. Replaces the previous
 * vault_extra_* localStorage scheme.
 */

export const VAULT_OPTION_CATEGORIES = [
  'cuisine_type', 'flavor_profile', 'proteins',
  'cooking_method', 'main_carb', 'dietary_tags',
  'dairy_components', 'vegetables', 'fruits',
]

export async function fetchVaultOptions(supabase, userId) {
  const { data, error } = await supabase
    .from('vault_options')
    .select('category, value')
    .eq('user_id', userId)
  if (error) {
    console.error('[vaultOptions] fetch failed:', error.message)
    return {}
  }
  // Returns { cuisine_type: ['Filipino', ...], proteins: ['...'], ... }
  const grouped = Object.fromEntries(VAULT_OPTION_CATEGORIES.map(c => [c, []]))
  for (const row of data || []) {
    if (grouped[row.category]) grouped[row.category].push(row.value)
  }
  return grouped
}

export async function addVaultOption(supabase, userId, category, value) {
  const trimmed = String(value).trim()
  if (!trimmed) return { error: 'empty' }
  const { error } = await supabase
    .from('vault_options')
    .upsert({ user_id: userId, category, value: trimmed }, { onConflict: 'user_id,category,value' })
  return { error: error?.message || null }
}

export async function removeVaultOption(supabase, userId, category, value) {
  const { error } = await supabase
    .from('vault_options')
    .delete()
    .match({ user_id: userId, category, value })
  return { error: error?.message || null }
}

/**
 * One-time migration: read any vault_extra_* localStorage keys and upsert them
 * into vault_options, then clear the keys. Idempotent — safe to call on every
 * Vault mount because cleared keys can't be re-migrated.
 */
export async function migrateLocalStorageExtras(supabase, userId) {
  if (typeof window === 'undefined') return { migrated: 0 }
  let migrated = 0
  for (const category of VAULT_OPTION_CATEGORIES) {
    const key = `vault_extra_${category}`
    const raw = window.localStorage.getItem(key)
    if (!raw) continue
    try {
      const arr = JSON.parse(raw)
      if (!Array.isArray(arr)) continue
      for (const value of arr) {
        const { error } = await addVaultOption(supabase, userId, category, value)
        if (!error) migrated++
      }
      window.localStorage.removeItem(key)
    } catch {
      // malformed JSON — leave the key alone, log
      console.warn(`[vaultOptions] could not parse ${key}; left in localStorage for manual review`)
    }
  }
  return { migrated }
}
```

### 3d) Wire ChipPicker to vault_options

`Vault.jsx` currently has `loadExtras(key)` / `saveExtras(key, tags)` helpers (around lines 76-82) and a `ChipPicker` component (lines 84+) that uses them. Modify so:

1. On Vault mount: `await migrateLocalStorageExtras(supabase, userId)` then `await fetchVaultOptions(supabase, userId)`. Store the result in component state (`extrasByCategory`).
2. `ChipPicker` receives `extras` (an array for its category) as a prop instead of reading from localStorage. Pass the matching slice from `extrasByCategory`.
3. `ChipPicker`'s `commitCustom` calls `addVaultOption` instead of `saveExtras`. After success, refetch (or optimistically append).
4. **Delete** the old `loadExtras` / `saveExtras` helpers once nothing references them.

**Do NOT** decompose `Vault.jsx` into `Vault/*` modules in this prompt — that's PRD-001 P0.9 (Phase 3). Keep the changes in-place.

### 3e) Tests

**Create** `src/lib/__tests__/vaultOptions.test.js`:
- `fetchVaultOptions` groups rows correctly by category
- `addVaultOption` upserts (no duplicates; calling twice with same value succeeds without error)
- `removeVaultOption` deletes the correct row
- `migrateLocalStorageExtras` reads each `vault_extra_*` key, calls `addVaultOption`, then clears the key
- Migration is idempotent — calling twice doesn't double-insert

Extend `src/pages/__tests__/Vault.test.jsx`:
- Adding a custom tag through ChipPicker calls `addVaultOption` (mocked)
- Custom tags from the DB render alongside built-in options

**Commit message:** `feat(vault): persist custom chip-picker tags in vault_options table (PRD-001 P0.7)`

---

## Acceptance criteria (Phase 2 done means all of this true)

- [ ] Both migrations applied to live Supabase; `verify_20260426.sql` returns expected results for every check
- [ ] `vault.deleted_at` column + partial index exist
- [ ] `vault_fuzzy_match` RPC (if it was created in Phase 1) returns no soft-deleted rows
- [ ] `vault_options` table exists with the CHECK constraint and four owner-scoped RLS policies
- [ ] Every Vault SELECT identified above filters `.is('deleted_at', null)`
- [ ] `Vault.jsx` no longer contains inline enum lists OR custom-tag localStorage helpers
- [ ] `api-server.mjs` and `api/analyze-recipe.js` both build the AI prompt via `buildAnalyzeRecipePromptBlock()` — no hardcoded enum lists in either file
- [ ] `npm run test:unit` passes including the new test suites:
  - `src/lib/__tests__/constants.test.js`
  - `src/lib/__tests__/vaultOptions.test.js`
  - extended `Vault.test.jsx` covering soft-delete and custom-tag DB persistence
  - extended `vaultMatch.test.js` (if applicable) for soft-delete exclusion
- [ ] `npm run lint` passes
- [ ] `docs/schema.md` updated with `deleted_at` row, `vault_options` table reference, and migration log entries
- [ ] Manual smoke test 1: delete a vault recipe → it disappears from the list; checking Supabase confirms `deleted_at IS NOT NULL` (not deleted)
- [ ] Manual smoke test 2: add a custom cuisine on the Vault entry form → reload the page → the custom cuisine still appears (proves DB persistence over localStorage)
- [ ] Manual smoke test 3: AI suggest button on Vault entry form still returns valid categorical metadata (proves the prompt-builder refactor didn't break the prompt)

---

## Constraints

- **Stack:** React 19.2 + Vite 8 + Tailwind 3.4 + lucide-react. No new dependencies.
- **No premature decomposition.** Do NOT split `Vault.jsx` into a folder of components — that's PRD-001 P0.9, Phase 3.
- **Use the existing migration patterns.** Idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`); section dividers; column comments; verification SQL alongside.
- **Tests for libs go in `src/lib/__tests__/`**, tests for pages go in `src/pages/__tests__/`. Match the existing test framework (Vitest + RTL).
- **ESM imports across the api/ + src/ boundary** are already used (`api/analyze-recipe.js` imports from `./_lib/anthropic.js`). Importing from `../src/lib/constants.js` should work the same way; Node's experimental ESM resolution may need an explicit `.js` extension on the import path.
- **No breaking changes to existing data.** All migrations preserve existing rows; the soft-delete migration leaves `deleted_at` NULL on every existing recipe (i.e., everything stays "active" by default).

---

## Out of scope (do NOT touch)

- The Vault.jsx → Vault/* decomposition (PRD-001 P0.9, Phase 3)
- The Spoonacular cleanup (PRD-001 P0.8, Phase 3)
- LogMode auto-link logic from Phase 1 (still working as-is; just respects soft-delete via the SELECT filter)
- BrainstormMode recommendation engine (PRD-002, separate work)
- Adding `family_rating` (PRD-001 P1.1, separate prompt)
- Adding `prep_time_minutes` (PRD-002, separate work)
- The `meal_plan_items.is_shortlisted` "maybe" state (PRD-002, separate work)
- The `household_preferences` table (PRD-002, separate work)
- Anything in `BrainstormMode.jsx` beyond the single SELECT filter change in Step 1c

---

## Commit cadence

Four commits, in order:
1. `feat(vault): soft-delete via deleted_at + filter all vault SELECTs (PRD-001 P0.5)`
2. `refactor(constants): single source of truth for vault enum lists + AI prompt (PRD-001 P0.6)`
3. `feat(vault): persist custom chip-picker tags in vault_options table (PRD-001 P0.7)`
4. `docs(schema): document vault.deleted_at + vault_options table (PRD-001 Phase 2)`

(The schema doc updates can be folded into commits 1–3 if you prefer; just split logically.)

## When you finish

1. Run the full acceptance checklist above
2. In the final PR description, list any deviations from this prompt and why
3. Note any follow-ups discovered along the way that should be added to `RECIPE_TODOS.md`
4. Tag PRD-001 P0.5–P0.7 as complete in `RECIPE_TODOS.md` once merged to main
