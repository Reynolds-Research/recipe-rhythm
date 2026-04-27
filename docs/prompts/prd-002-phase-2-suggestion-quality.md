# Claude Code Prompt — PRD-002 Phase 2: Suggestion Quality Upgrade (P0.4 + P0.5 + P0.8 + P0.9)

**For:** Claude Code (executor)
**Authored by:** Claude.ai (planning surface) on 2026-04-26
**Linked PRD:** [`docs/prds/PRD-002-meal-planning.md`](../prds/PRD-002-meal-planning.md), §6 P0.4 + P0.5 + P0.8 + P0.9 + §8 (Algorithm Changes) + §11 Phase 2 + §12 Testing Plan
**Depends on:** PRD-002 Phase 1 merged (PR #38, `fix/audit-u3-u8-dates`). That PR shipped `src/lib/dateUtils.js` + the period-aware `buildLastWeekSlots` rework — this prompt assumes both are on `main`.

---

## ⚠ Pre-flight: confirm you're in the right place

Same drill as Phase 1. The user has multiple Claude-Code worktrees on disk and prompts have been mis-routed before. **Run these checks FIRST**, before reading or editing anything else. If any check fails, stop and surface a clear error to the user — do NOT guess or pick a different path.

```bash
# 1) Canonical repo root
EXPECTED="/Users/Matt/Desktop/Current Projects/recipe-rhythm"
ACTUAL="$(git rev-parse --show-toplevel 2>/dev/null)"
echo "expected: $EXPECTED"
echo "actual:   $ACTUAL"
[ "$ACTUAL" = "$EXPECTED" ] || { echo "ABORT: not in the recipe-rhythm repo root"; exit 1; }

# 2) This prompt file must exist at the expected path within the repo
PROMPT="docs/prompts/prd-002-phase-2-suggestion-quality.md"
test -f "$PROMPT" || { echo "ABORT: $PROMPT not found in this working tree"; exit 1; }

# 3) Show all worktrees so we can spot stale ones
git worktree list

# 4) If we're inside .claude/worktrees/<something>, switch to the canonical clone
case "$ACTUAL" in
  *".claude/worktrees/"*) echo "ABORT: running inside a Claude worktree — switch to $EXPECTED first"; exit 1 ;;
esac

# 5) Confirm Phase 1 (P0.10 + P0.11) shipped — dateUtils + period-aware lastWeek must be on main
git fetch origin --quiet
test -f src/lib/dateUtils.js || { echo "ABORT: src/lib/dateUtils.js missing — Phase 1 hasn't merged yet"; exit 1; }
git log --oneline origin/main | grep -qE "P0\.10|P0\.11" || { echo "ABORT: PRD-002 Phase 1 commits not on main yet"; exit 1; }

# 6) Confirm family_rating is already on vault (PRD-001 P1.1 prerequisite)
grep -q "family_rating" docs/schema.md || { echo "ABORT: vault.family_rating not in schema.md — PRD-001 P1.1 hasn't shipped"; exit 1; }
```

If anything aborts: tell the user exactly which check failed, and ask whether they want you to `cd` to the canonical path or whether something else is going on. **Don't proceed on a guess.**

Once all six checks pass, start clean:

```bash
git checkout main
git pull --ff-only origin main
git worktree prune
git branch --merged | grep -vE '^\*|main' | xargs -r git branch -d
git checkout -b feat/prd-002-phase-2-suggestion-quality
```

---

## Goal (one sentence)

Lift the recommendation engine from "starved" to "curated" by adding `vault.prep_time_minutes`, wiring `family_rating` and (optionally) prep-time into the scoring algorithm, guaranteeing uniqueness across "suggest more" regenerations, and giving AI candidates a consistent inline badge so the brainstorm picker reads as one ranked list rather than two parallel pools.

## Why this matters (mental model in plain English)

The brainstorm surface today returns a ranked list of vault recipes plus a few AI candidates from `/api/swap-suggestions`. The ranking is sophisticated (cuisine diversity, repetition penalties, frequency bonus) but starved — it sees neither how the family rated a recipe nor how long it takes to cook. So a 5-star, 20-minute weeknight winner gets the same shot as a 1-star, 90-minute experiment. Phase 2 closes that gap.

**P0.4 — `prep_time_minutes` on vault.** A new nullable `int` column on the `vault` table, plus a small input on the recipe-add form, plus an extension to the `analyzeRecipe` AI prompt so the AI estimates prep time when it can. Mirrors the shape of how `family_rating` was added in PRD-001 P1.1 — small migration, idempotent, with a verify file.

**P0.5 — Scoring honors `family_rating` + `prep_time`.** Two changes inside `scoreVaultItem` in `src/lib/recommendations.js`:

1. `+10 × family_rating` boost. A 5-star = +50, a 3-star = +30, NULL = 0. This is unconditional — it ships fully in Phase 2.
2. `-15` penalty when `prep_time_minutes > preferences.max_prep_time_minutes / 2`. This *requires* a `preferences` argument we don't have yet (the preferences table ships in Phase 3). Solution: extend `getRecommendations` to accept a `preferences = {}` parameter NOW, and only apply the prep-time penalty when `preferences.max_prep_time_minutes` is set (else no-op). Phase 3 can then drop in real preferences without another signature change.

**P0.8 — Uniqueness across regenerations.** Today, hitting "suggest more" on a swap can return a recipe that's already in the plan or that the previous batch suggested. Two fixes:

1. `getRecommendations` accepts an `excludeIds[]` array and treats those vault ids as if they were just-eaten (hard-exclude before scoring).
2. `fetchSwapSuggestions` accepts an `excludeNames[]` array and forwards it to `/api/swap-suggestions`, which extends its prompt with "Avoid suggesting any of these names: …". The brainstorm component tracks the previous batch's vault ids + AI names in component state and passes both to subsequent calls.

**P0.9 — AI candidates badged "new" and mixed in.** The mix already happens via `getRecommendations` (vault picks + wildcards combined into one returned list). The badge today reads "Wildcard"; PRD-002 §6 P0.9 specifies an inline "new" badge. This is a one-word UI change in `BrainstormMode.jsx`. The empty-Spoonacular wildcard slot was already retired in PRD-001 P0.8, so nothing further is required there.

After this PR, the recommendation engine will be doing the work it was designed to do, and the suggestion lookbook the Planner sees will actually reflect family taste, time-of-day, and freshness across regenerations.

---

## Context to read first (before any edits)

1. **Spec:** [`docs/prds/PRD-002-meal-planning.md`](../prds/PRD-002-meal-planning.md), §6 P0.4, P0.5, P0.8, P0.9 + §8 (Algorithm Changes) + §11 Phase 2.
2. **Existing scoring engine:** [`src/lib/recommendations.js`](../../src/lib/recommendations.js) — the whole file (162 lines). Note especially `scoreVaultItem` at ~line 85 and the `getRecommendations` signature at ~line 129.
3. **Existing tests as the test pattern:** [`src/lib/__tests__/recommendations.test.js`](../../src/lib/__tests__/recommendations.test.js) — copy the shape (clean fixtures, no Supabase mock needed, vitest only).
4. **The Brainstorm load path:** [`src/pages/BrainstormMode.jsx`](../../src/pages/BrainstormMode.jsx):
   - Vault SELECT at ~line 372 — does NOT currently include `family_rating` or `prep_time_minutes`. You'll add both.
   - `fetchSwapSuggestions` at ~line 318 — call site for `/api/swap-suggestions`. You'll add an `excludeNames` parameter.
   - `getRecommendations` calls at ~line 458 and ~line 539 — both signatures need updating to pass `excludeIds`.
   - The wildcard badge at ~line 194 — copy change from "Wildcard" to "new".
5. **The vault add path:**
   - [`src/pages/Vault/RecipeForm.jsx`](../../src/pages/Vault/RecipeForm.jsx) — add the prep-time input near the other numeric/select fields. Mirror the existing field-section shape. The form currently submits via `onSubmit({ name, cuisineType, ..., imageFile })` at ~line 122; extend that payload with `prepTimeMinutes`.
   - [`src/pages/Vault/useVault.js`](../../src/pages/Vault/useVault.js) — the SELECT at ~line 39 (extend), the `addRecipe` insert at ~line 177 (extend), and the `addSuggestion` insert at ~line 204 (extend so AI-promoted meals also write the column when the analyzer returns it).
6. **The AI analyze prompt:** [`src/lib/constants.js`](../../src/lib/constants.js) `buildAnalyzeRecipePromptBlock()` at ~line 67 — extend its JSON schema with a new `prep_time_minutes` line. Both the Express proxy and the Vercel handler call this function, so updating it once propagates to both.
7. **The AI swap-suggestions prompt (BOTH copies must change):**
   - [`api-server.mjs`](../../api-server.mjs) — local-dev Express proxy
   - [`api/swap-suggestions.js`](../../api/swap-suggestions.js) — Vercel serverless mirror
   These are not unified the way `analyzeRecipe` is. Per CLAUDE.md and the comment at the top of each file: keep the two in sync.
8. **Migration template:** [`supabase/migrations/20260426000003_vault_family_rating.sql`](../../supabase/migrations/20260426000003_vault_family_rating.sql) and its companion [`supabase/migrations/verify_20260426_family_rating.sql`](../../supabase/migrations/verify_20260426_family_rating.sql). Mirror this exact shape for the prep-time migration.
9. **Schema doc:** [`docs/schema.md`](../../docs/schema.md) `vault` column reference (~line 70 onward). New `prep_time_minutes` row goes alongside `family_rating`.

If file structure or line numbers differ noticeably from the above (±20 lines), **stop and ask the user** rather than guessing.

---

## Step 1 — P0.4a: Migration for `vault.prep_time_minutes`

Create two new files in `supabase/migrations/`. Mirror the family-rating migration's shape exactly.

### 1a) `supabase/migrations/20260427000001_vault_prep_time.sql`

```sql
-- PRD-002 P0.4: Prep-time field on vault
--
-- See: docs/prds/PRD-002-meal-planning.md §6 P0.4 + §7 Migration B
--
-- Adds vault.prep_time_minutes: estimated minutes of active prep + cook time
-- for a recipe. Nullable (NULL = unknown / unrated). CHECK enforces
-- positive integers. Existing rows default to NULL; the analyzeRecipe AI
-- prompt is extended in the same PR to estimate prep time when it can,
-- so newly-added recipes will populate this automatically.
--
-- Used by PRD-002 (Meal Planning) for two things:
--   1. Display in the recommendation list (badge), so the Planner can
--      see "20 min" at a glance.
--   2. A prep-time penalty in the scoring engine — only applied when
--      the (forthcoming, Phase 3) household_preferences row sets a
--      max_prep_time_minutes cap. Phase 2 ships the column + the
--      always-on family_rating boost; the prep-time penalty becomes
--      effective once Phase 3 lands.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS guards the column; the CHECK is
-- inline so the IF NOT EXISTS guards both. Re-running this migration is
-- a no-op.

-- =========================================================================
-- 1. vault.prep_time_minutes column
-- =========================================================================

ALTER TABLE vault
  ADD COLUMN IF NOT EXISTS prep_time_minutes int
    CHECK (prep_time_minutes IS NULL OR prep_time_minutes > 0);

COMMENT ON COLUMN vault.prep_time_minutes IS
  'PRD-002 P0.4: estimated minutes of active prep + cook time. NULL = unknown. Drives the prep-time badge in BrainstormMode and (paired with household_preferences in Phase 3) the prep-time scoring penalty in src/lib/recommendations.js.';
```

### 1b) `supabase/migrations/verify_20260427_prep_time.sql`

```sql
-- Verification queries for 20260427000001_vault_prep_time.sql
--
-- Run AFTER the main migration. Each section is read-only (no mutations).
-- Expected results are described inline so you can eyeball correctness.

-- =========================================================================
-- 1. vault.prep_time_minutes column exists with the right shape
-- =========================================================================
-- Expected: one row — column_name = 'prep_time_minutes', data_type = 'integer',
-- is_nullable = 'YES'.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'vault'
  AND column_name  = 'prep_time_minutes';


-- =========================================================================
-- 2. CHECK constraint is present
-- =========================================================================
-- Expected: one row whose definition contains "prep_time_minutes IS NULL OR
-- prep_time_minutes > 0".

SELECT
  con.conname,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class      tbl ON tbl.oid = con.conrelid
WHERE tbl.relname = 'vault'
  AND con.contype = 'c'
  AND pg_get_constraintdef(con.oid) ILIKE '%prep_time_minutes%';


-- =========================================================================
-- 3. Column comment is present
-- =========================================================================
-- Expected: one row, description starts with "PRD-002 P0.4:".

SELECT
  c.column_name,
  pgd.description
FROM information_schema.columns c
JOIN pg_catalog.pg_statio_all_tables st
  ON st.schemaname = c.table_schema
 AND st.relname    = c.table_name
JOIN pg_catalog.pg_description pgd
  ON pgd.objoid    = st.relid
 AND pgd.objsubid  = c.ordinal_position
WHERE c.table_schema = 'public'
  AND c.table_name   = 'vault'
  AND c.column_name  = 'prep_time_minutes';


-- =========================================================================
-- 4. Smoke test: existing rows default to NULL (read-only)
-- =========================================================================
-- Expected: total_rows >= 0; unrated == total_rows immediately after migration;
-- out_of_range_should_be_zero is always 0 (the CHECK enforces it).

SELECT
  COUNT(*)                                              AS total_rows,
  COUNT(*) FILTER (WHERE prep_time_minutes IS NULL)     AS unrated,
  COUNT(*) FILTER (WHERE prep_time_minutes > 0)         AS rated_positive,
  COUNT(*) FILTER (
    WHERE prep_time_minutes IS NOT NULL
      AND prep_time_minutes <= 0
  )                                                     AS out_of_range_should_be_zero
FROM vault;
```

**Do NOT apply this migration yourself.** Claude Code cannot reach the live Supabase. The user applies migrations manually via the Supabase SQL Editor — that handoff is documented in the "When you finish" section.

**Commit:** `feat(db): add vault.prep_time_minutes column (PRD-002 P0.4)`

---

## Step 2 — P0.4b: Wire `prep_time_minutes` through the app

This is a touch-many-files step but each touch is small.

### 2a) Extend the AI analyze prompt — `src/lib/constants.js`

Inside `buildAnalyzeRecipePromptBlock()` at ~line 67, append a `prep_time_minutes` line to the JSON shape:

```js
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
  "fruits": array from [${FRUIT_OPTIONS.join(', ')}],
  "prep_time_minutes": positive integer estimate of total prep + cook time in minutes, or null if you cannot reasonably estimate
}`
}
```

Both `api-server.mjs` and `api/analyze-recipe.js` import this function, so the prompt update propagates to both surfaces in one place. No other file needs to change for the AI side.

### 2b) Extend the vault data layer — `src/pages/Vault/useVault.js`

Three call sites need extending. All idempotent — column is nullable so omitting it on insert is harmless, but threading it explicitly makes the wiring auditable.

- **SELECT at ~line 39:** add `prep_time_minutes` to the column list. The order doesn't matter to Postgres, but place it next to `family_rating` for grep-ability.
- **`addRecipe` insert at ~line 177:** accept `prepTimeMinutes` from the form payload and write `prep_time_minutes: prepTimeMinutes ?? null`. Convert empty-string to null (a blank input field shouldn't try to insert `''` into an int column).
- **`addSuggestion` insert at ~line 204:** add `prep_time_minutes: analysis?.prep_time_minutes ?? null` so AI-promoted meals carry over the AI's estimate.

The `updateRecipe`-style code paths (if any) that touch other columns should similarly accept the new field — check by searching `from('vault').update` and following the call sites.

### 2c) Add the prep-time input — `src/pages/Vault/RecipeForm.jsx`

Add a new state hook near the others (~line 50):

```jsx
const [prepTimeMinutes, setPrepTimeMinutes] = useState('')
```

Update `handleManualSuggest` (~line 70) to also set this from the AI response:

```jsx
if (s.prep_time_minutes != null) setPrepTimeMinutes(String(s.prep_time_minutes))
```

Update `resetForm` (~line 100) to clear it:

```jsx
setPrepTimeMinutes('')
```

Update `handleSubmit` (~line 120) to include it in the submit payload, parsing the string to int:

```jsx
const result = await onSubmit({
  ...,
  prepTimeMinutes: prepTimeMinutes.trim() ? parseInt(prepTimeMinutes, 10) : null,
})
```

Add the actual input to the JSX. A single numeric `<input type="number">` is the simplest landing — place it next to the recipe-URL input row (~line 175) or as its own thin row above the chip pickers. Keep the styling consistent with the rest of the form (`input-base` class, brand-50 background, `text-sm`):

```jsx
<input
  type="number"
  min="1"
  inputMode="numeric"
  value={prepTimeMinutes}
  onChange={e => setPrepTimeMinutes(e.target.value)}
  placeholder="Prep + cook time (minutes)"
  className="input-base"
/>
```

The PRD also mentions chip-picker buckets (<15, 15–30, 30–60, 60+) as an alternative — don't build that variant in Phase 2. The numeric input is more flexible and the column stores the exact value either way; we can add a bucket UI later if the Planner finds the input awkward.

### 2d) Display prep time in `RecipeCard.jsx`

If the field is non-null, render it as a small subtitle/badge under the recipe name. Mirror the existing `family_rating` star presentation if there is one — keep visual weight low (the chip pickers are already noisy). Example:

```jsx
{recipe.prep_time_minutes != null && (
  <span className="text-[11px] text-gray-500 font-medium">
    {recipe.prep_time_minutes} min
  </span>
)}
```

Don't over-design this; the goal is just to make the new data visible.

### 2e) Tests

Add a test to `src/pages/Vault/__tests__/RecipeForm.test.jsx` (create if absent) that:

1. Renders the form
2. Types a name + a prep time of 30
3. Submits
4. Asserts `onSubmit` was called with `prepTimeMinutes: 30`

Use the existing form-test pattern in this directory if one exists; if not, follow the broader pattern in `src/pages/__tests__/`.

**Commit:** `feat(vault): wire prep_time_minutes through form, AI prompt, and data layer (PRD-002 P0.4)`

---

## Step 3 — P0.5: Scoring honors `family_rating` + `prep_time`

Two scoring changes in `src/lib/recommendations.js`, plus a signature extension to thread `preferences` through.

### 3a) Extend `getRecommendations` signature

Today (line 129):

```js
export function getRecommendations(vaultItems, recentMeals, wildcards = [], count = 7, servedPlanItems = []) {
```

Change to:

```js
export function getRecommendations(
  vaultItems,
  recentMeals,
  wildcards = [],
  count = 7,
  servedPlanItems = [],
  options = {}
) {
  const { excludeIds = [], preferences = {} } = options
  // ...
}
```

Why an options bag rather than two more positional arguments: the call sites already have five positional args and adding more makes them brittle. Future Phase-3 preferences fields and Phase-4 maybe-tray exclusions can layer onto the same options bag. The two existing call sites (BrainstormMode.jsx:458 and :539) get updated in Step 4 to pass the bag.

### 3b) Add the family-rating boost in `scoreVaultItem`

After the existing frequency-bonus block (~line 107), before the random jitter:

```js
// Family rating boost — +10 per star, max +50. NULL rating = 0 (unrated
// recipes don't get penalized, they just don't get the boost).
if (item.family_rating != null) {
  score += 10 * item.family_rating
}
```

### 3c) Add the prep-time penalty in `scoreVaultItem`

Same block, after the family-rating boost:

```js
// Prep-time penalty — only when the user has set a max_prep_time_minutes
// cap (forthcoming via household_preferences in Phase 3). Until then this
// is a no-op, but the wiring is in place.
const maxPrep = preferences?.max_prep_time_minutes
if (
  maxPrep != null &&
  item.prep_time_minutes != null &&
  item.prep_time_minutes > maxPrep / 2
) {
  score -= 15
}
```

You'll need to thread `preferences` from `getRecommendations` into `scoreVaultItem` — pass it as another parameter, or close over it inline in the `.map(item => ({...}))`. Either is fine; the closure is simpler.

### 3d) Add `excludeIds` to the hard-exclude check

Current (line 89):

```js
if (recentVaultIds.has(item.id)) return -1
```

Change to:

```js
if (recentVaultIds.has(item.id)) return -1
if (excludeIds.includes(item.id)) return -1
```

For the small-N typical case (current plan + last batch ≈ 10 items), `Array.includes` is fine. If you want to be tidy, build a `Set` once at the top of `getRecommendations`:

```js
const excludeSet = new Set(excludeIds)
// ...then in scoreVaultItem: if (excludeSet.has(item.id)) return -1
```

### 3e) Update the BrainstormMode vault SELECT

In `src/pages/BrainstormMode.jsx` at ~line 372:

```js
.select('id, name, cuisine_type, flavor_profile, is_wildcard, proteins, cooking_method, main_carb, vegetables, dairy_components, fruits')
```

Change to:

```js
.select('id, name, cuisine_type, flavor_profile, is_wildcard, proteins, cooking_method, main_carb, vegetables, dairy_components, fruits, family_rating, prep_time_minutes')
```

Without this, the engine will see `family_rating: undefined` on every vault item and the boost won't fire.

### 3f) Tests

Extend `src/lib/__tests__/recommendations.test.js` with at least three new cases:

1. **Family rating boost.** Two vault items with identical attributes except one has `family_rating: 5` and the other `family_rating: null`. Assert the rated one ranks first.
2. **Prep-time penalty no-op without preferences.** Two vault items, one with `prep_time_minutes: 90`, one with `prep_time_minutes: 20`. Call `getRecommendations(..., {})` (empty options) — assert the long-prep one is NOT penalized (the order should be determined by the existing scoring factors, not prep time).
3. **Prep-time penalty active when `preferences.max_prep_time_minutes` is set.** Same fixture as (2). Call `getRecommendations(..., { preferences: { max_prep_time_minutes: 60 } })` — the 90-minute recipe should be penalized (-15) and rank below the 20-minute one once tie-breakers settle. (Random jitter can make this flaky — either mock `Math.random` or assert on the raw score by reaching into the implementation. The existing test file uses concrete fixtures; mirror that approach.)
4. **`excludeIds` hard-excludes.** Three vault items. Call with `{ excludeIds: ['v2'] }`. Assert v2 is absent from the result.

**Commit:** `feat(recommendations): family_rating boost, prep_time penalty, excludeIds option (PRD-002 P0.5 + P0.8)`

---

## Step 4 — P0.8 cont'd: Uniqueness across regenerations

Three pieces: client-side state, the `fetchSwapSuggestions` call, and the AI prompt.

### 4a) Track the last batch in `BrainstormMode.jsx` state

Near the other `useState` hooks (~line 295), add:

```jsx
const [lastBatchVaultIds, setLastBatchVaultIds] = useState([])
const [lastBatchAiNames, setLastBatchAiNames] = useState([])
```

After every successful `getRecommendations` call (the load path at ~line 458 and the toggle-date path at ~line 539), update these:

```jsx
setLastBatchVaultIds(suggestions.filter(s => !s.is_wildcard).map(s => s.id))
setLastBatchAiNames(suggestions.filter(s => s.is_wildcard).map(s => s.name))
```

### 4b) Pass `excludeIds` through from the brainstorm load + toggle paths

Compute the exclude set as the union of (the current plan's ids) + (the last batch's ids). This is what makes "suggest more" return *different* recipes, not just non-current-plan ones.

```jsx
const excludeIds = [
  ...plan.map(s => s.id).filter(Boolean),
  ...lastBatchVaultIds,
]
```

Then pass it via the new options bag to both `getRecommendations` call sites:

```jsx
const suggestions = getRecommendations(
  vaultItems,
  recentMeals,
  wildcardCandidates,
  sortedSeed.length,
  servedMeals,
  { excludeIds },
)
```

The toggle-date path (~line 539) currently builds a `taken` Set inline and filters via `.find`. Replace that whole pattern with the engine-side exclusion: drop the `taken` Set, pass `excludeIds: [...curr.map(s => s.id).filter(Boolean), ...lastBatchVaultIds]`, and take `[0]` of the result. Cleaner and the engine guarantees uniqueness.

### 4c) Extend `fetchSwapSuggestions` with `excludeNames`

In `src/pages/BrainstormMode.jsx` at ~line 318, change:

```jsx
const fetchSwapSuggestions = async (currentPlan, recentMeals) => {
```

to:

```jsx
const fetchSwapSuggestions = async (currentPlan, recentMeals, excludeNames = []) => {
```

Add `excludeNames` to the body posted to `/api/swap-suggestions`:

```jsx
body: JSON.stringify({
  planNames,
  recentNames,
  excludeNames: excludeNames.join(', '),
}),
```

Update both call sites of `fetchSwapSuggestions` (~line 457 and ~line 565) to pass the union of `lastBatchAiNames` plus current plan names plus current Maybe-tray names (Maybe doesn't exist yet — skip):

```jsx
const wildcardCandidates = await fetchSwapSuggestions(
  plan,
  recentMeals,
  [...lastBatchAiNames, ...plan.map(s => s.name).filter(Boolean)],
)
```

### 4d) Extend the swap-suggestions endpoint — BOTH copies

Both files must change. They're not unified; the comment at the top of each says "keep the two in sync."

**`api/swap-suggestions.js`:**

```js
const { planNames = '', recentNames = '', excludeNames = '' } = req.body || {}

const prompt = `Suggest 3 specific, well-known dinner recipes different from what's already planned. Return ONLY a JSON array of 3 recipe name strings, no markdown.

Already in plan: ${planNames || 'none'}
Recently eaten: ${recentNames || 'none'}
${excludeNames ? `Avoid suggesting any of these names (already shown or in the plan): ${excludeNames}\n` : ''}
["Recipe 1", "Recipe 2", "Recipe 3"]`
```

**`api-server.mjs`:** find the equivalent `/api/swap-suggestions` Express route handler and apply the identical change. Keep the two prompt strings byte-for-byte identical.

### 4e) Tests

The recommendations.js tests already cover `excludeIds` (Step 3 case 4). For the `excludeNames` wiring, the cleanest test is at the integration level — render BrainstormMode, mock `fetch`, assert the second `/api/swap-suggestions` call's body contains the first call's names in `excludeNames`. If the existing BrainstormMode test scaffold makes that hard, settle for a unit test that asserts `fetchSwapSuggestions` posts the right body when given `excludeNames`. (Extract `fetchSwapSuggestions` into a small helper if it's not already exportable — that's also better long-term hygiene.)

**Commit:** `feat(brainstorm): exclude prior-batch ids and names from regenerations (PRD-002 P0.8)`

---

## Step 5 — P0.9: Badge AI candidates as "new"

In `src/pages/BrainstormMode.jsx` at ~line 198, change the badge text:

```jsx
<span className="bg-brand-100 text-brand-700 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter shadow-sm flex items-center gap-0.5">
  <Sparkles size={8} />
  Wildcard
</span>
```

to:

```jsx
<span className="bg-brand-100 text-brand-700 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter shadow-sm flex items-center gap-0.5">
  <Sparkles size={8} />
  New
</span>
```

That's it. Per PRD-002 §6 P0.9: AI candidates are badged "new." Don't rename `is_wildcard` in the data — the property name is fine; just the display copy changes.

If there's a test that asserts on the badge text ("Wildcard"), update it to match. Grep:

```bash
grep -rn "Wildcard" src/
```

**Commit:** `feat(brainstorm): rebadge AI candidates as "new" (PRD-002 P0.9)`

---

## Step 6 — Documentation touch-ups

### 6a) `docs/schema.md` — vault column reference

Find the `vault` column table (~line 70). Add a new row for `prep_time_minutes` next to `family_rating`. Match the format of the family_rating row exactly (date-stamped, links to the migration file, says what consumes it):

```markdown
| `prep_time_minutes` | `int` nullable | **Added 2026-04-27** via [PRD-002 Phase 2 migration](../supabase/migrations/20260427000001_vault_prep_time.sql). Estimated minutes of active prep + cook time. `NULL` = unknown. CHECK constraint: `prep_time_minutes IS NULL OR prep_time_minutes > 0`. Populated by the `analyzeRecipe` AI (extended in the same PR) or by the user via the recipe-add form. Drives the prep-time badge in BrainstormMode and (paired with `household_preferences` in Phase 3) the prep-time scoring penalty in `src/lib/recommendations.js`. |
```

Also append a row to the migrations log table at the bottom of `schema.md` if that table exists (mirror the family_rating entry).

### 6b) No PRD edits

Don't update PRD-002 itself — its acceptance-criteria language is the standard the PR is being evaluated against. The Revision History entry is the user's call when they decide to mark the work complete.

**Commit:** `docs(schema): document vault.prep_time_minutes (PRD-002 P0.4)`

---

## Step 7 — Final sweep

```bash
npm run test:unit
npm run lint
npm run build
```

All three must pass. The build check matters because both `BrainstormMode.jsx` and `RecipeForm.jsx` are critical-path imports.

```bash
# No stray references to "Wildcard" in user-facing strings (the property
# name is fine; the display copy should be "New").
grep -rn "'Wildcard'\|\"Wildcard\"\|>Wildcard<" src/ | grep -v "test"
# Should return: nothing.

# Verify both swap-suggestions copies received the excludeNames change.
grep -n "excludeNames" api-server.mjs api/swap-suggestions.js
# Should return: at least one match in each file.
```

Manual smoke (local dev only — DB column won't exist yet because the user hasn't applied the migration; the form input + AI prompt + scoring changes will all work but the column write will fail until migration applies):

1. **Before migration applies:** smoke-test the form's prep-time input (it accepts a number, default-empty, AI-suggest writes into it). The save will fail at the DB layer, which is fine — that's the user's signal to apply the migration.
2. **After migration applies (user does this manually, see "When you finish"):** add a recipe with prep_time_minutes = 25, confirm it persists. Open BrainstormMode and confirm rated recipes float higher in the suggestion list.

---

## Acceptance criteria (Phase 2 done means all of this true)

- [ ] All six pre-flight working-tree checks pass
- [ ] Branch `feat/prd-002-phase-2-suggestion-quality` created from a fresh `main` (post-Phase-1)
- [ ] `supabase/migrations/20260427000001_vault_prep_time.sql` exists, idempotent, mirrors the family_rating migration shape
- [ ] `supabase/migrations/verify_20260427_prep_time.sql` exists with column-shape, CHECK, comment, and smoke-test queries
- [ ] `src/lib/constants.js` `buildAnalyzeRecipePromptBlock()` includes `prep_time_minutes` in its JSON schema
- [ ] `src/pages/Vault/useVault.js` SELECT, `addRecipe` insert, and `addSuggestion` insert all include `prep_time_minutes`
- [ ] `src/pages/Vault/RecipeForm.jsx` has a numeric prep-time input wired through state, AI-suggest, reset, and submit
- [ ] `src/pages/Vault/RecipeCard.jsx` displays prep time when non-null
- [ ] `src/lib/recommendations.js` `getRecommendations` accepts `options = { excludeIds, preferences }` (sixth param)
- [ ] `scoreVaultItem` adds `+10 × family_rating` (when non-null) and `-15` when `prep_time_minutes > preferences.max_prep_time_minutes / 2` (when both set)
- [ ] `excludeIds` is hard-excluded alongside `recentVaultIds`
- [ ] `src/lib/__tests__/recommendations.test.js` includes the four new test cases (family-rating boost, prep-time no-op without prefs, prep-time penalty with prefs, excludeIds exclusion)
- [ ] `src/pages/BrainstormMode.jsx` vault SELECT includes `family_rating, prep_time_minutes`
- [ ] Both `getRecommendations` call sites in BrainstormMode pass `{ excludeIds: [...currentPlan, ...lastBatch] }`
- [ ] `lastBatchVaultIds` and `lastBatchAiNames` state hooks added and updated after each suggestion fetch
- [ ] `fetchSwapSuggestions` accepts an `excludeNames` parameter and posts it
- [ ] `api/swap-suggestions.js` AND `api-server.mjs` both include the `excludeNames` line in the prompt (byte-identical)
- [ ] BrainstormMode badge text changed from "Wildcard" to "New"
- [ ] `docs/schema.md` has a `prep_time_minutes` row in the vault column reference
- [ ] `npm run test:unit`, `npm run lint`, and `npm run build` all pass
- [ ] `grep -rn "'Wildcard'\\|\"Wildcard\"\\|>Wildcard<" src/` returns nothing in production code

---

## Constraints

- **Stack:** React 19.2 + Vite 8 + Tailwind 3.4 + lucide-react. No new dependencies.
- **One migration only.** Don't bundle other schema changes into this PR.
- **No `react-router-dom`.** Routing is reserved for PRD-003.
- **No new test framework or assertion library.** Vitest + RTL only.
- **Keep `api-server.mjs` and `api/swap-suggestions.js` byte-identical for the prompt string** — the comment at the top of each says so, and CLAUDE.md repeats it.
- **Don't fix unrelated lint or test errors** while doing focused work. Note them in the PR description as follow-ups.
- **Don't expand to PRD-002 P0.1 / P0.2 / P0.3 / P0.6 / P0.7 / P0.12** — those are Phases 3 + 4. The `preferences` parameter we thread through is a stub; the real preferences table doesn't ship until Phase 3.

---

## Out of scope (do NOT touch)

- PRD-002 P0.1 (`household_preferences` table + RLS) — Phase 3
- PRD-002 P0.2 (preferences settings page + new route) — Phase 3
- PRD-002 P0.3 (recommendation engine pre-scoring filter pass) — Phase 3
- PRD-002 P0.6 (Maybe / shortlist state) — Phase 4
- PRD-002 P0.7 (tap-a-day candidate sheet) — Phase 4
- PRD-002 P0.12 (preference change warning) — Phase 3
- The chip-picker bucket UX for prep time (<15, 15–30, 30–60, 60+) — numeric input is enough for now
- The single-slot toggle-date path's wildcard policy ("100% vault, no AI") — that's Phase 4's tap-a-day picker work
- Renaming `is_wildcard` in the data layer — only the badge text changes
- The `meal_plan_items` table / `scheduled_date` nullability — Phase 4
- ADR-001 Phase 7 deprecated `meal_plans` columns cleanup — separate work

---

## Commit cadence

Six commits, one logical change per commit:

1. `feat(db): add vault.prep_time_minutes column (PRD-002 P0.4)`
2. `feat(vault): wire prep_time_minutes through form, AI prompt, and data layer (PRD-002 P0.4)`
3. `feat(recommendations): family_rating boost, prep_time penalty, excludeIds option (PRD-002 P0.5 + P0.8)`
4. `feat(brainstorm): exclude prior-batch ids and names from regenerations (PRD-002 P0.8)`
5. `feat(brainstorm): rebadge AI candidates as "new" (PRD-002 P0.9)`
6. `docs(schema): document vault.prep_time_minutes (PRD-002 P0.4)`

Each commit should leave `npm run test:unit && npm run lint` passing so a future `git bisect` is clean. Commits 1 and 6 can be reordered or folded if cleaner.

---

## When you finish

1. Run the full acceptance checklist above.
2. Open the PR. Title: `PRD-002 Phase 2: Suggestion-quality upgrade (P0.4 + P0.5 + P0.8 + P0.9)`.
3. **Migration handoff at the top of the PR description.** Per CLAUDE.md, Claude Code does NOT have access to the live Supabase. Print this verbatim so the user knows what to do:

   > **⚠ Migration to apply (do this BEFORE merging the PR):**
   >
   > 1. Open the Supabase SQL Editor for the recipe-rhythm project.
   > 2. Paste and run the contents of `supabase/migrations/20260427000001_vault_prep_time.sql`. The CREATE/ALTER is idempotent — safe to re-run.
   > 3. Paste and run `supabase/migrations/verify_20260427_prep_time.sql`. Each section should match the "Expected" comment.
   > 4. If the verify queries look right, merge the PR. The app code in this PR is forward-compatible: it reads `prep_time_minutes` (which will be `null` for existing rows) and writes it on new inserts.
   >
   > If the migration is applied AFTER merging, the app will run fine but recipe inserts will fail at the DB layer with a "column does not exist" error until the column is added.

4. In the PR description body:
   - Summarize the four P0 items shipped (one bullet each).
   - Note the `preferences` parameter is plumbing for Phase 3 — the prep-time penalty is a no-op until Phase 3 ships `household_preferences`.
   - List any deviations from this prompt and why.
   - Include the manual smoke-test plan from Step 7.
   - Add a footer: "After merge, mark **PRD-002 P0.4, P0.5, P0.8, and P0.9 as complete in `RECIPE_TODOS.md`** (lives in the user's Claude.ai project knowledge, not this repo). PRD-002 Phase 2 closes out; Phase 3 (preferences layer) is next."

5. Wait for the user to apply the migration and spot-check the manual smoke tests before merging.
