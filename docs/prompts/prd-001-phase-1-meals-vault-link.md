# Claude Code Prompt — PRD-001 Phase 1: Meals → Vault Link

**For:** Claude Code (executor)
**Authored by:** Claude.ai (planning surface) on 2026-04-25
**Linked PRD:** [`docs/prds/PRD-001-recipe-vault-and-cooking-record.md`](../prds/PRD-001-recipe-vault-and-cooking-record.md), §6 P0.1–P0.4 + §7 Migration A + §11 Testing Plan
**Linked TODOs:** PRD-001 Phase 1 items in `RECIPE_TODOS.md` (in the Claude Project knowledge folder)

---

## Goal (one sentence)

Restore the broken `meals → vault` link so cooking history can drive recommendations: add a `vault_id` column to the `meals` table, build a fuzzy-match utility, wire LogMode to auto-link or prompt for disambiguation on save, and back-link the originating meal when the user promotes it to the Cookbook via "Save to Cookbook."

## Why this matters (mental model)

Today, every meal logged via LogMode is a stranger to the rest of the app. The recommendation engine in `src/lib/recommendations.js` keys all of its scoring off `meal.vault_id` — but LogMode never writes that column, so the engine operates on near-zero signal and the brainstorm shows nearly random suggestions. Closing this single loop unlocks the entire recommendation system that already exists.

## Context to read first (before any edits)

1. **Spec:** `docs/prds/PRD-001-recipe-vault-and-cooking-record.md` — read §1 (Problem), §6 P0.1–P0.4 (the four requirements you're building), §7 Migration A, and §11 Testing Plan rows for P0.1–P0.4.
2. **Files you'll modify:**
   - `src/pages/LogMode.jsx` (the main file)
   - `docs/schema.md` (document the new column)
3. **Files you'll create:**
   - `supabase/migrations/20260425000001_meals_vault_link.sql`
   - `supabase/migrations/verify_20260425.sql`
   - `src/lib/vaultMatch.js`
   - `src/lib/__tests__/vaultMatch.test.js`
   - `src/components/VaultMatchSheet.jsx`
   - `src/pages/__tests__/LogMode.disambiguation.test.jsx`
4. **Files for reference (do NOT modify):**
   - `src/pages/Vault.jsx` — for the patterns used for vault queries; reference only
   - `src/lib/recommendations.js` — to confirm what `meal.vault_id` consumers expect (lines 21, 33-34)
   - `supabase/migrations/20260418000001_planning_periods_schema.sql` — example migration style + idempotent patterns
   - `src/lib/__tests__/recommendations.test.js` — example Vitest pattern for `lib/` tests
   - `src/pages/BrainstormMode.jsx` — for the existing usage of `react-modal-sheet` (e.g., `import Sheet from 'react-modal-sheet'`)

If anything in the existing code conflicts with what's described below, **stop and ask** rather than guessing.

---

## Step 1 — Schema migration (P0.1)

**Create** `supabase/migrations/20260425000001_meals_vault_link.sql` following the pattern of `20260418000001_planning_periods_schema.sql` (header comment, section dividers, idempotent statements). The migration should:

1. Enable the `pg_trgm` extension (used by Step 2's matcher): `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
2. Add `vault_id uuid REFERENCES vault(id) ON DELETE SET NULL` to `meals` (nullable; existing rows safely default to NULL)
3. Add an index on `(user_id, vault_id)` for the recommendation engine's queries
4. Add a column comment explaining the purpose (links a logged meal to the Vault recipe it represents; null when no match)
5. Wrap statements with `IF NOT EXISTS` / `IF NOT EXISTS` guards so the migration is safe to re-run
6. Note in the file header: "ON DELETE SET NULL" matches the existing `meal_plan_items.vault_id` pattern; soft-delete on vault is PRD-001 P0.5 (a future Phase 2 item) and won't change this contract

**Also create** `supabase/migrations/verify_20260425.sql` with read-only verification queries: confirm `pg_trgm` is installed, `meals.vault_id` exists with the expected FK + index, and the column comment is present.

**Document** the change in `docs/schema.md`: add the `vault_id` row to the `public.meals` column reference table, and a one-line note in the migrations log table at the bottom of the doc. **While you're in `schema.md`:** the doc currently lists `meals` as having `(id, user_id, name, eaten_on, created_at)` but `LogMode.jsx:37` writes a `notes` field. Verify against `information_schema.columns` whether `notes` exists; if it does, document it. If not, file this as a follow-up note in your final PR description (do not fix it as part of this work).

**Before moving on:** apply the migration to Supabase via the SQL Editor and run `verify_20260425.sql` to confirm. Only then start Step 2.

**Commit message:** `feat(db): add meals.vault_id column + pg_trgm extension (PRD-001 P0.1)`

---

## Step 2 — Fuzzy match utility (P0.2)

**Create** `src/lib/vaultMatch.js` exporting:

```js
/**
 * Find vault recipes that match the given meal name.
 *
 * Algorithm:
 *   1. Try exact case-insensitive ILIKE match → confidence: 'exact'
 *   2. Otherwise try pg_trgm similarity ≥ 0.6 → confidence: 'fuzzy'
 *   3. Otherwise empty → confidence: 'none'
 *
 * Threshold is configurable; PRD-001 OQ.A flags it for empirical tuning.
 *
 * @param {object} supabase - Supabase client
 * @param {string} userId - The user's UUID
 * @param {string} mealName - The trimmed meal name to match
 * @param {object} [opts]
 * @param {number} [opts.fuzzyThreshold=0.6] - pg_trgm similarity cutoff
 * @returns {Promise<{ matches: Array<{id, name, image_url}>, confidence: 'exact'|'fuzzy'|'none' }>}
 */
export async function matchVaultByName(supabase, userId, mealName, opts = {}) { ... }
```

Implementation notes:
- For the trigram step, use `supabase.rpc('vault_fuzzy_match', { p_user_id, p_query, p_threshold })` (preferred — see below) **OR** fall back to a `select(...).ilike(...)` followed by client-side similarity scoring. RPC is preferred because the threshold filter happens in Postgres.
- If you go the RPC route, add the function definition to the same migration file from Step 1 (or a new migration `20260425000002_vault_fuzzy_match_rpc.sql`):
  ```sql
  CREATE OR REPLACE FUNCTION vault_fuzzy_match(p_user_id uuid, p_query text, p_threshold real DEFAULT 0.6)
  RETURNS TABLE (id uuid, name text, image_url text, similarity real)
  LANGUAGE sql STABLE
  AS $$
    SELECT id, name, image_url, similarity(name, p_query) AS similarity
    FROM vault
    WHERE user_id = p_user_id
      AND similarity(name, p_query) >= p_threshold
    ORDER BY similarity DESC
    LIMIT 5;
  $$;
  ```
  RLS still applies because the function is `SECURITY INVOKER` by default. Verify with a test that RPC returns only the calling user's recipes.

**Tests** in `src/lib/__tests__/vaultMatch.test.js`. Mock supabase the same way `recommendations.test.js` does. Cover:
- Exact case-insensitive match → `confidence: 'exact'`, single result
- "Tacos" matches both "Carnitas Tacos" and "Chicken Tacos" → `confidence: 'fuzzy'`, both returned, sorted by similarity DESC
- Empty / no match → `confidence: 'none'`, empty matches array
- The RPC respects the user_id filter (returns nothing for a different user)

**Commit message:** `feat(lib): add vaultMatch utility with pg_trgm fuzzy matcher (PRD-001 P0.2)`

---

## Step 3 — LogMode integration with disambiguation UI (P0.2 + P0.3)

### 3a) Disambiguation sheet component

**Create** `src/components/VaultMatchSheet.jsx`. Use `react-modal-sheet` (already a dependency; see `BrainstormMode.jsx` for usage). Props:

```js
<VaultMatchSheet
  isOpen={boolean}
  matches={Array<{id, name, image_url}>}
  mealName={string}                   // for the header "Did you mean…"
  onSelect={(vaultId|null) => void}   // null = "None of these"
  onClose={() => void}
/>
```

Layout (mobile-first, Tailwind utility classes consistent with `LogMode.jsx`):
- Header: `Did you mean…?` + the meal name in a muted caption
- One row per match: thumbnail (use `image_url` if present, else a Phosphor-shaped placeholder), recipe name, tap-target full row
- Sticky bottom row: "None of these" — same row affordance, secondary styling
- A11y: each row a `<button>`, focus trap inside the sheet, dismiss via swipe-down or backdrop tap

Use the existing brand color tokens from `tailwind.config.js` (`brand-*`, `cream-*`).

### 3b) LogMode wiring

**Modify** `src/pages/LogMode.jsx`'s `handleSave` flow (current implementation around lines 29-69):

```
const finalName = editableText.trim()
if (!finalName) return
trigger('success')
setSaving(true)

const { matches, confidence } = await matchVaultByName(supabase, userId, finalName)

let resolvedVaultId = null
if (confidence === 'exact' && matches.length === 1) {
  resolvedVaultId = matches[0].id
} else if (confidence === 'fuzzy' && matches.length === 1) {
  resolvedVaultId = matches[0].id
  // optional toast: "Linked to {matches[0].name}"
} else if (matches.length > 1) {
  // Open VaultMatchSheet, await user choice
  const chosenId = await openMatchSheet(matches)
  resolvedVaultId = chosenId  // may be null if "None of these"
}

const { error: dbError } = await supabase.from('meals').insert({
  user_id: userId,
  name: finalName,
  notes: note.trim() || null,
  eaten_on: new Date().toISOString().split('T')[0],
  vault_id: resolvedVaultId,
})
// ... rest of the existing save flow
```

The "openMatchSheet" pattern: lift state for the sheet (`isOpen`, `pendingMatches`, `pendingMealData`). On Save with multiple matches, set state to open the sheet; the sheet's `onSelect` finishes the save with the chosen `vault_id`. Don't wrap the whole thing in a Promise hack — use idiomatic React state.

**Tests** in `src/pages/__tests__/LogMode.disambiguation.test.jsx`:
- Single fuzzy match → meal saved with that vault_id (no sheet shown)
- Two matches → sheet renders with both options + "None of these"
- Selecting one → meal saved with the selected vault_id
- "None of these" → meal saved with vault_id = null
- No matches → no sheet, meal saved with vault_id = null (regression check)
- Mock `matchVaultByName` so tests don't hit a real DB; mock supabase insert with the existing pattern

Use `@testing-library/react` + `@testing-library/user-event` consistent with the existing `Vault.test.jsx` pattern.

**Commit message:** `feat(logmode): auto-link meals to vault with disambiguation UI (PRD-001 P0.2 + P0.3)`

---

## Step 4 — Promote-to-Cookbook back-link (P0.4)

**Modify** `src/pages/LogMode.jsx`'s `handleSaveToVault` (currently lines 71-93). After the new `vault` row is inserted, update the originating `meals` row's `vault_id` to point to the new vault id.

```
const { data: newVault, error } = await supabase
  .from('vault')
  .insert({ /* existing payload */ })
  .select('id')
  .single()

if (!error && newVault?.id) {
  // Conservative back-link (PRD-001 OQ.B): only the most recent matching meal,
  // not every historical row with the same name. Aggressive backfill is a future
  // P1 item.
  await supabase.from('meals')
    .update({ vault_id: newVault.id })
    .eq('user_id', userId)
    .ilike('name', savedMealName)
    .is('vault_id', null)             // don't clobber an existing link
    .order('created_at', { ascending: false })
    .limit(1)
}
```

Add a code comment referencing PRD-001 OQ.B explaining the conservative scope choice.

**Tests** extend `src/pages/__tests__/LogMode.test.jsx` (or create one if it doesn't exist):
- After Save-to-Cookbook completes, the originating meal's `vault_id` matches the new vault row's id
- Older meals with the same name and `vault_id IS NOT NULL` are NOT modified
- A second-to-most-recent meal with the same name and `vault_id IS NULL` is also NOT modified (limit 1 means only the latest)

**Commit message:** `feat(logmode): back-link meal to vault on Save-to-Cookbook (PRD-001 P0.4)`

---

## Acceptance criteria (Phase-1 done means all of this true)

- [ ] Migration `20260425000001_meals_vault_link.sql` applied to live Supabase; `verify_20260425.sql` returns expected results
- [ ] `pg_trgm` extension enabled
- [ ] `vault_fuzzy_match` RPC exists (or alternative implementation completed) and respects RLS
- [ ] `docs/schema.md` updated with `vault_id` row + migration log entry
- [ ] `npm run test:unit` passes including the four new test suites
  - `src/lib/__tests__/vaultMatch.test.js`
  - `src/pages/__tests__/LogMode.disambiguation.test.jsx`
  - extended `src/pages/__tests__/LogMode.test.jsx` (back-link test cases)
  - any new tests added inadvertently — must all pass
- [ ] `npm run lint` passes
- [ ] Manual smoke test 1: log a new meal whose name exactly matches a vault recipe → confirm in Supabase that the new `meals` row has `vault_id` populated
- [ ] Manual smoke test 2: log a new meal whose name fuzzy-matches two vault recipes → disambiguation sheet appears; selecting one writes the chosen vault_id; "None of these" leaves it null
- [ ] Manual smoke test 3: log a new meal with a unique name, then click "Save to Cookbook" → confirm both the new vault row exists AND the originating meal row's vault_id was updated to point to it

---

## Constraints

- **Stack:** React 19.2 + Vite 8 + Tailwind CSS 3.4 + lucide-react. No new heavy dependencies — `react-modal-sheet` is already installed; use it for the sheet.
- **Tailwind only.** Do not introduce vanilla CSS files, styled-components, or CSS-in-JS for new components.
- **Mobile-first.** The disambiguation sheet must work as a bottom sheet on a 380px-wide viewport.
- **Idempotent migrations.** Use `IF NOT EXISTS` / `CREATE OR REPLACE FUNCTION`. Re-running the migration must be a no-op.
- **Follow existing test patterns.** Match the style of `recommendations.test.js` for lib tests and `Vault.test.jsx` for page tests. Do not introduce a new test framework or assertion library.
- **Owner-scoped RLS** on `meals.vault_id` is already covered by the existing `user_id` policies — do NOT add new policies. The RPC should remain `SECURITY INVOKER`.
- **Use the existing `useHaptics` hook** for any new tap interactions in the sheet, mirroring LogMode's existing usage.
- **Trim once, use everywhere.** `editableText.trim()` should happen at the top of `handleSave` and the trimmed value passed downstream — don't trim in three different places.

---

## Out of scope (do NOT touch)

- The Vault component, the chip-picker, the AI categorization endpoint
- BrainstormMode, the recommendation engine, mealPlanReader/Writer
- The `auto_completed` flag on vault items (still useful for distinguishing AI-categorized rows; leave the flag alone)
- **Soft-delete on vault recipes** — that's PRD-001 P0.5, a Phase-2 work item; do not switch the existing hard-delete in Vault.jsx
- The `vault_extra_*` localStorage migration (P0.7) — Phase 2
- Centralizing the enum lists into `src/lib/constants.js` (P0.6) — Phase 2
- The Spoonacular dead code cleanup (P0.8) — Phase 3
- The Vault.jsx decomposition (P0.9) — Phase 3
- ANY changes to BrainstormMode's recommendation flow — the goal here is just to populate `vault_id`. The recommendation engine will start working on its own once the data is there.

---

## Commit cadence (recommended)

Commit after each step (Step 1 / 2 / 3 / 4). Four small commits are easier to review and bisect than one mega-commit. Push at the end of each step or batch them as you prefer; if you batch, please still keep them as separate commits (`git rebase -i` is your friend).

## When you finish

1. Run the full acceptance checklist above
2. In the final PR description, list any deviations from this prompt and why
3. Note any follow-ups discovered along the way that should be added to `RECIPE_TODOS.md` (e.g., the `meals.notes` schema doc question from Step 1)
4. Tag PRD-001 P0.1–P0.4 as complete in `RECIPE_TODOS.md` once merged to main
