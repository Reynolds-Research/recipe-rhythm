# Claude Code Prompt — PRD-001 P1.3: "Last cooked" badge on Vault cards

**For:** Claude Code (executor)
**Authored by:** Cowork (planning surface) on 2026-05-05
**Linked PRD:** [`docs/prds/PRD-001-recipe-vault-and-cooking-record.md`](../prds/PRD-001-recipe-vault-and-cooking-record.md) §P1.3
**Depends on:**
- PRD-001 Phase 1 shipped — `meals.vault_id uuid REFERENCES vault(id) ON DELETE SET NULL` exists, indexed via `meals_user_vault_idx` on `(user_id, vault_id)`. **No migration in this PR.**
- PRD-002 P0.11 shipped — `formatLocalDate` helper exists in `src/lib/dateUtils.js`. We're adding a sibling helper there.

---

## Why this exists

Today the Cookbook (Vault page) shows recipe cards with name, cuisine, prep time, family rating — but no recency information. When you're picking what to make this week, you have no signal for "we had this on Tuesday" vs. "we haven't made this in three months." That recency signal is exactly what makes a cookbook useful for planning instead of a static archive.

The data already exists. Every meal you log writes a row in `meals` with `vault_id` (when you matched it to the cookbook) and `eaten_on` (the local-calendar date). PRD-001 Phase 1 added the FK + the supporting `(user_id, vault_id)` index specifically so this kind of query is cheap.

This PR adds a single query to the cookbook fetch and renders a small "Last cooked X days ago" badge under the star rating on each card. Recipes you've never cooked don't get a badge — silence is the right default for "no signal," not "never cooked" noise.

Branch suggestion: `feat/prd-001-last-cooked-badge`.

---

## ⚠ Pre-flight: confirm you're in the right place

```bash
EXPECTED="/Users/Matt/Desktop/Current Projects/recipe-rhythm"
ACTUAL="$(git rev-parse --show-toplevel 2>/dev/null)"
echo "expected: $EXPECTED"
echo "actual:   $ACTUAL"
[ "$ACTUAL" = "$EXPECTED" ] || { echo "ABORT: not in the recipe-rhythm repo root"; exit 1; }

PROMPT="docs/prompts/prd-001-p1-3-last-cooked-badge.md"
test -f "$PROMPT" || { echo "ABORT: $PROMPT not found in this working tree"; exit 1; }

git fetch origin
git status   # working tree should be clean
git log --oneline -5

# Confirm STATUS.md still lists P1.3 as pending.
grep -A 1 "P1\.3" docs/STATUS.md | grep -i "Last cooked" || \
  echo "(Look at the PRD-001 'Pending' block in docs/STATUS.md by hand if grep is too narrow.)"
```

If working tree isn't clean or P1.3 is already shipped, stop and surface to the user.

---

## Hard prerequisites — verify before writing any code

```bash
# 1. meals.vault_id exists and is indexed.
#    Run via Supabase MCP (read-only):
#      SELECT column_name, data_type, is_nullable
#      FROM information_schema.columns
#      WHERE table_schema='public' AND table_name='meals'
#        AND column_name IN ('vault_id', 'eaten_on');
#    Expected: 2 rows. vault_id is uuid YES, eaten_on is date NO.
#
#      SELECT indexname FROM pg_indexes
#      WHERE schemaname='public' AND tablename='meals'
#        AND indexname='meals_user_vault_idx';
#    Expected: 1 row.

# 2. dateUtils.js exists and exports formatLocalDate.
grep -n "export function formatLocalDate" src/lib/dateUtils.js
# Expected: 1 match around line 16.

# 3. useVault.fetchRecipes does NOT already fetch last-cooked data.
grep -n "last_cooked\|MAX(eaten_on)" src/pages/Vault/useVault.js
# Expected: zero matches. If you find a match, someone has done part of this
# work — STOP and ask the user.

# 4. RecipeCard does NOT already render a last-cooked badge.
grep -n "last_cooked\|Last cooked" src/pages/Vault/RecipeCard.jsx
# Expected: zero matches.
```

If any of these fail, **stop and ask the user**.

---

## Architectural decisions to lock in upfront

1. **One batched query, not N per-recipe sub-selects.** A single `SELECT vault_id, MAX(eaten_on) AS last_cooked_on FROM meals WHERE user_id = :user_id AND vault_id IS NOT NULL GROUP BY vault_id` returns the entire map in one round-trip. Don't be tempted to sub-select inside the vault SELECT — that turns a 50-recipe cookbook load into 51 round-trips.

2. **Merge client-side, not via SQL join.** The vault query and the last-cooked query stay separate; `useVault` merges them into recipe objects in JS. Reasons: (a) simpler RLS reasoning — each query is owner-scoped on its own table, (b) the vault SELECT is already long and adding a join adds another column to the parsing surface, (c) the last-cooked map is small (one row per cooked-at-least-once recipe) so the client merge is cheap.

3. **Display under the star rating.** The existing chip row is already busy (cuisine, method, proteins, AI badges, prep time). Putting last-cooked there would over-pack it. A small line beneath the rating gives it a stable home that scans cleanly.

4. **Silence for never-cooked recipes.** Don't render "Never cooked" — it's noise, and many users will have legitimately just-added recipes they haven't cooked yet. The absence of the badge IS the "haven't cooked yet" signal.

5. **Format with a calibrated scale.** "today" / "yesterday" / "N days ago" / "N weeks ago" / "N months ago" / "over a year ago." The breakpoints are 1 day, 14 days, 60 days, 365 days. Smaller breakpoints (e.g. weeks at 7) feel pedantic — "8 days ago" is still days-of-the-week-relevant cognition.

6. **Don't touch the recommender.** `src/lib/recommendations.js` already consumes `meals` for frequency/recency scoring internally. This badge is a UI surface only; the recommender's existing logic is unrelated and stays untouched.

---

## Implementation plan

Three files change (plus two test files): the date helper, the data layer, and the card UI.

### Step 1 — Add `formatLastCooked` to `dateUtils.js`

#### File: `src/lib/dateUtils.js`

Append to the existing file (don't replace; `formatLocalDate` stays):

```js
/**
 * Format a `meals.eaten_on` date (YYYY-MM-DD, local calendar) as a
 * human-readable "last cooked" phrase relative to a reference day.
 *
 * Returns null when the input is missing or in the future (defensive
 * against data errors / clock skew). Callers should treat null as
 * "no badge" — never as "never cooked" (the absence of input IS the
 * never-cooked signal).
 *
 * Breakpoints (calibrated for cookbook-planning cognition):
 *   - 0 days     → "today"
 *   - 1 day      → "yesterday"
 *   - 2–13 days  → "N days ago"
 *   - 14–59 days → "N weeks ago" (rounded)
 *   - 60–364 days → "N months ago" (rounded)
 *   - 365+ days  → "over a year ago"
 *
 * @param {string|null|undefined} eatenOn  YYYY-MM-DD local-calendar date
 * @param {string} [today]                 reference day; defaults to today
 * @returns {string|null}                  the phrase, or null
 */
export function formatLastCooked(eatenOn, today = formatLocalDate()) {
  if (!eatenOn || typeof eatenOn !== 'string') return null

  // Parse both inputs as local-calendar dates by appending T00:00:00 so the
  // Date constructor reads them as local midnight, not UTC. Without the
  // suffix, 'YYYY-MM-DD' is parsed as UTC and the day-difference math drifts
  // off by one west of UTC.
  const eaten = new Date(eatenOn + 'T00:00:00')
  const ref   = new Date(today   + 'T00:00:00')
  if (Number.isNaN(eaten.getTime()) || Number.isNaN(ref.getTime())) return null

  const msPerDay = 1000 * 60 * 60 * 24
  const days = Math.floor((ref - eaten) / msPerDay)

  if (days < 0)   return null            // future date — data error, ignore
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14)  return `${days} days ago`
  if (days < 60)  return `${Math.round(days / 7)} weeks ago`
  if (days < 365) return `${Math.round(days / 30)} months ago`
  return 'over a year ago'
}
```

#### File: `src/lib/__tests__/dateUtils.test.js`

Extend the existing test file with a new `describe` block. Read the existing file first to match its testing style — Vitest, expect-based, function call → string comparison.

```js
import { describe, it, expect } from 'vitest'
import { formatLocalDate, formatLastCooked } from '../dateUtils'

// (existing formatLocalDate tests stay)

describe('formatLastCooked', () => {
  it('returns "today" when eaten_on equals the reference day', () => {
    expect(formatLastCooked('2026-05-05', '2026-05-05')).toBe('today')
  })

  it('returns "yesterday" for a one-day gap', () => {
    expect(formatLastCooked('2026-05-04', '2026-05-05')).toBe('yesterday')
  })

  it('returns "N days ago" for 2–13 days', () => {
    expect(formatLastCooked('2026-05-03', '2026-05-05')).toBe('2 days ago')
    expect(formatLastCooked('2026-04-23', '2026-05-05')).toBe('12 days ago')
    expect(formatLastCooked('2026-04-22', '2026-05-05')).toBe('13 days ago')
  })

  it('returns "N weeks ago" for 14–59 days (rounded)', () => {
    expect(formatLastCooked('2026-04-21', '2026-05-05')).toBe('2 weeks ago')   // 14 days
    expect(formatLastCooked('2026-04-07', '2026-05-05')).toBe('4 weeks ago')   // 28 days
    expect(formatLastCooked('2026-03-08', '2026-05-05')).toBe('8 weeks ago')   // 58 days
  })

  it('returns "N months ago" for 60–364 days (rounded)', () => {
    expect(formatLastCooked('2026-03-06', '2026-05-05')).toBe('2 months ago')  // 60 days
    expect(formatLastCooked('2025-11-05', '2026-05-05')).toBe('6 months ago')  // 181 days
    expect(formatLastCooked('2025-05-15', '2026-05-05')).toBe('12 months ago') // 355 days
  })

  it('returns "over a year ago" for 365+ days', () => {
    expect(formatLastCooked('2025-05-05', '2026-05-05')).toBe('over a year ago')
    expect(formatLastCooked('2020-01-01', '2026-05-05')).toBe('over a year ago')
  })

  it('returns null for null / undefined / non-string input', () => {
    expect(formatLastCooked(null,        '2026-05-05')).toBeNull()
    expect(formatLastCooked(undefined,   '2026-05-05')).toBeNull()
    expect(formatLastCooked(12345,       '2026-05-05')).toBeNull()
  })

  it('returns null for future eatenOn (data error / clock skew)', () => {
    expect(formatLastCooked('2026-05-06', '2026-05-05')).toBeNull()
  })

  it('returns null for malformed dates', () => {
    expect(formatLastCooked('not-a-date',  '2026-05-05')).toBeNull()
    expect(formatLastCooked('2026-05-05',  'also-not-a-date')).toBeNull()
  })

  it('uses today as the default reference (smoke test)', () => {
    // Whatever today is, calling with today's date yields "today".
    const today = formatLocalDate()
    expect(formatLastCooked(today)).toBe('today')
  })
})
```

### Step 2 — Wire the data layer

#### File: `src/pages/Vault/useVault.js`

Two edits to `fetchRecipes` (around lines 31–47):

#### 2a. Run both queries in parallel and merge

Replace the existing `fetchRecipes`:

```js
const fetchRecipes = async () => {
  setLoading(true)

  // Two independent queries, run in parallel:
  //   1. The vault rows (existing).
  //   2. The most-recent eaten_on per vault_id (PRD-001 P1.3).
  // The merge happens client-side after both resolve. Each query is
  // independently RLS-scoped to the authenticated user.
  const [vaultRes, lastCookedRes] = await Promise.all([
    supabase
      .from('vault')
      .select('id, name, cuisine_type, flavor_profile, notes, recipe_url, image_url, created_at, proteins, cooking_method, main_carb, dietary_tags, dairy_components, vegetables, fruits, auto_completed, family_rating, prep_time_minutes')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),

    // PRD-001 P1.3: max(eaten_on) per vault_id. The (user_id, vault_id)
    // index covers this query. NULL vault_ids are skipped — they're meal
    // logs that never matched a cookbook recipe.
    supabase
      .from('meals')
      .select('vault_id, eaten_on')
      .eq('user_id', userId)
      .not('vault_id', 'is', null)
      .order('eaten_on', { ascending: false }),
  ])

  if (vaultRes.error) {
    console.error('[Vault] fetchRecipes failed:', vaultRes.error.message)
    setLoading(false)
    return
  }
  if (lastCookedRes.error) {
    // Non-fatal — the page still renders without last-cooked badges.
    console.error('[Vault] last-cooked fetch failed:', lastCookedRes.error.message)
  }

  // Build a Map<vault_id, latest eaten_on string>. The query is already
  // ordered DESC by eaten_on, so the FIRST row for each vault_id is the
  // most recent — using Map.set keeps the first value seen.
  const lastCookedByVaultId = new Map()
  for (const row of lastCookedRes.data ?? []) {
    if (!row.vault_id) continue
    if (lastCookedByVaultId.has(row.vault_id)) continue
    lastCookedByVaultId.set(row.vault_id, row.eaten_on)
  }

  const merged = (vaultRes.data ?? []).map(r => ({
    ...r,
    last_cooked_on: lastCookedByVaultId.get(r.id) ?? null,
  }))

  setRecipes(merged)
  setLoading(false)
}
```

> **Why the order-DESC + first-wins pattern instead of a real GROUP BY?** Supabase's PostgREST layer doesn't expose `GROUP BY` directly without a view or RPC. We could create a view, but the meals table is small (a few rows per day per user) — fetching all meal-vault pairs and reducing client-side is fine for personal-scale and avoids the schema migration. If the meals table ever exceeds tens of thousands of rows for one user, revisit this with an RPC.

> **Don't filter the meals query by `eaten_on >= some-cutoff`.** A recipe last cooked 18 months ago should still show "over a year ago" — that's useful information. Filtering would silently lose that signal.

#### 2b. The other useVault writers don't need changes

`addRecipe` and `addSuggestion` insert with no meal log, so their returned recipes correctly have `last_cooked_on: null` from the merge. `updateRecipe` runs `fetchRecipes()` after the update, which picks up any meals logged in the meantime. `setRating` updates local state by mapping over recipes — be careful that the optimistic update preserves `last_cooked_on`:

Look at `setRating` (around line 317). It does `prev.map(r => r.id === recipeId ? { ...r, family_rating: newRating } : r)` which already spreads the existing recipe object — so `last_cooked_on` is preserved automatically. **No change needed**, but verify by reading the function and confirming the spread is in place.

### Step 3 — Render the badge in `RecipeCard`

#### File: `src/pages/Vault/RecipeCard.jsx`

Add the import at the top:

```jsx
import { formatLastCooked } from '../../lib/dateUtils'
```

In the collapsed-card JSX (around line 173, just below the family-rating `<StarRating>`), add a small line that renders only when there's data:

```jsx
{/* PRD-001 P1.1 — family rating, always visible at a glance */}
<div className="mt-1.5">
  <StarRating
    value={recipe.family_rating ?? null}
    onChange={(newRating) => onRatingChange(recipe.id, newRating)}
    size={14}
  />
</div>

{/* PRD-001 P1.3 — last-cooked recency. Renders only when there's a
    matched meal log; absence = "never cooked" by design. */}
{(() => {
  const phrase = formatLastCooked(recipe.last_cooked_on)
  if (!phrase) return null
  return (
    <p className="helper-text mt-1">
      Last cooked {phrase}
    </p>
  )
})()}
```

> **The IIFE wrapper isn't strictly necessary** — you could compute `phrase` higher in the component and use it inline. But the IIFE keeps the local variable scoped to where it's used and matches the "render only when data exists" pattern that's easy to read and grep. Either form is fine; pick consistency with the file.

> **Don't add the badge to the expanded view.** It would be redundant — the user can already see it in the collapsed view that's still visible above the expansion. The expansion is for editing/details, not for restating quick-glance info.

---

## Step 4 — Tests

### `src/lib/__tests__/dateUtils.test.js`

Already covered in Step 1.

### `src/pages/Vault/__tests__/RecipeCard.test.jsx`

Add a new `describe` block at the bottom. Reuse the existing `baseRecipe` and `baseProps` fixtures.

```jsx
describe('RecipeCard — last-cooked badge (PRD-001 P1.3)', () => {
  it('renders "Last cooked X days ago" when last_cooked_on is set', () => {
    // Use a fixed reference: 5 days before "today" relative to the
    // formatLastCooked helper. Hard-coding a recent date keeps the test
    // deterministic; the formatLastCooked unit tests already cover the
    // exact phrase logic, so here we just confirm the component renders
    // the helper's output.
    const today = new Date()
    const fiveDaysAgo = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000)
    const y = fiveDaysAgo.getFullYear()
    const m = String(fiveDaysAgo.getMonth() + 1).padStart(2, '0')
    const d = String(fiveDaysAgo.getDate()).padStart(2, '0')
    const eatenOn = `${y}-${m}-${d}`

    render(
      <RecipeCard
        recipe={{ ...baseRecipe, last_cooked_on: eatenOn }}
        {...baseProps}
      />
    )
    expect(screen.getByText(/Last cooked 5 days ago/i)).toBeInTheDocument()
  })

  it('renders nothing when last_cooked_on is null', () => {
    render(
      <RecipeCard
        recipe={{ ...baseRecipe, last_cooked_on: null }}
        {...baseProps}
      />
    )
    expect(screen.queryByText(/Last cooked/i)).not.toBeInTheDocument()
  })

  it('renders nothing when last_cooked_on is missing entirely', () => {
    render(<RecipeCard recipe={baseRecipe} {...baseProps} />)
    expect(screen.queryByText(/Last cooked/i)).not.toBeInTheDocument()
  })

  it('renders nothing when last_cooked_on is a future date (defensive)', () => {
    const today = new Date()
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)
    const y = tomorrow.getFullYear()
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0')
    const d = String(tomorrow.getDate()).padStart(2, '0')
    const eatenOn = `${y}-${m}-${d}`

    render(
      <RecipeCard
        recipe={{ ...baseRecipe, last_cooked_on: eatenOn }}
        {...baseProps}
      />
    )
    expect(screen.queryByText(/Last cooked/i)).not.toBeInTheDocument()
  })

  it('shows the badge in the collapsed card (always visible at a glance)', () => {
    const today = new Date()
    const yesterday = new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000)
    const y = yesterday.getFullYear()
    const m = String(yesterday.getMonth() + 1).padStart(2, '0')
    const d = String(yesterday.getDate()).padStart(2, '0')
    const eatenOn = `${y}-${m}-${d}`

    render(
      <RecipeCard
        recipe={{ ...baseRecipe, last_cooked_on: eatenOn }}
        expanded={false}
        {...baseProps}
      />
    )
    expect(screen.getByText(/Last cooked yesterday/i)).toBeInTheDocument()
  })
})
```

> **Don't write a unit test for `useVault.fetchRecipes` itself** — there's no test file for it today, and scaffolding one for this PR is scope creep. The merge logic is exercised end-to-end through the existing recipe flow + the `RecipeCard` tests above. If a future PR adds `useVault.test.js`, it can backfill coverage there.

---

## Step 5 — STATUS.md update

In the same PR, update `docs/STATUS.md`:

1. **Top of file:** bump the `**Last verified:**` line to today's date and the latest commit hash on `main` (post-merge — set this just before pushing the final commit).
2. **At-a-glance table** (PRD-001 row): the "Next thing to plan" cell currently lists `P1.2–P1.6 nice-to-haves; not blocking anything`. Update to drop P1.3: `P1.2 + P1.4–P1.6 nice-to-haves; not blocking anything`.
3. **PRD-001 section:** move P1.3 from "Pending" to "Shipped":
   ```
   - [x] **P1.3** (PR #<your-PR>, commit `<hash>`): "Last cooked" badge on Vault cards. Single batched `meals` query joined client-side to vault rows in `useVault.fetchRecipes`. New `formatLastCooked` helper in `dateUtils.js` renders the relative phrase (today / yesterday / N days / N weeks / N months / over a year ago). Recipes never cooked render no badge — silence is the right default for "no signal."
   ```

---

## Step 6 — Branch + commit + PR

```bash
git fetch origin
git checkout -b feat/prd-001-last-cooked-badge origin/main

# Make the edits in Steps 1–5.

npm run test:unit
npm run lint
npm run lint:ds

git add src/lib/dateUtils.js \
        src/lib/__tests__/dateUtils.test.js \
        src/pages/Vault/useVault.js \
        src/pages/Vault/RecipeCard.jsx \
        src/pages/Vault/__tests__/RecipeCard.test.jsx \
        docs/STATUS.md

git commit
git push -u origin feat/prd-001-last-cooked-badge
```

### Suggested commit message

```
feat(prd-001): "Last cooked" badge on Vault cards (P1.3)

Adds recency information to the cookbook so the planner can see at a
glance which recipes are due for rotation. Pure UI addition — the data
(meals.vault_id + meals.eaten_on) shipped in PRD-001 Phase 1 with the
supporting (user_id, vault_id) index.

- src/lib/dateUtils.js: new formatLastCooked(eatenOn, today=) helper.
  Returns "today" / "yesterday" / "N days ago" / "N weeks ago" /
  "N months ago" / "over a year ago", or null for missing/future
  inputs. Sibling to formatLocalDate.

- src/pages/Vault/useVault.js: fetchRecipes now runs the vault query
  AND a meals(vault_id, eaten_on) query in parallel, merges the
  most-recent eaten_on per vault_id into each recipe as
  last_cooked_on. Both queries are independently RLS-scoped to the
  user; the meals query is non-fatal on error (page still renders
  without badges).

- src/pages/Vault/RecipeCard.jsx: renders "Last cooked X days ago"
  beneath the family-rating stars when last_cooked_on is set.
  Recipes never cooked render no badge.

No migration. No new dependency. The (user_id, vault_id) index added
in PRD-001 Phase 1 covers the new query.
```

### Suggested PR description

```markdown
## Why

The Cookbook (Vault page) shows recipes with name, cuisine, prep time, family rating — but no recency. When deciding what to cook this week, "we had this on Tuesday" vs. "we haven't made this in three months" is exactly the signal you want at a glance. The data has been there since PRD-001 Phase 1 (`meals.vault_id` + `meals.eaten_on` + the `(user_id, vault_id)` index); this PR surfaces it.

## What

- **`src/lib/dateUtils.js`:** new `formatLastCooked(eatenOn, today=)` helper. Calibrated breakpoints: today / yesterday / N days / N weeks / N months / over a year ago. Returns null for missing or future input.
- **`src/pages/Vault/useVault.js`:** `fetchRecipes` now runs the vault query + a `meals(vault_id, eaten_on)` query in parallel via `Promise.all`. Builds a `Map<vault_id, latest eaten_on>` from the meals query (which is order-DESC, first-wins). Merges into each recipe as `last_cooked_on`. Last-cooked fetch failures are non-fatal — the page still renders without badges.
- **`src/pages/Vault/RecipeCard.jsx`:** renders "Last cooked X days ago" beneath the family-rating stars in the collapsed view. Hidden when `last_cooked_on` is null.

## What's NOT in this PR

- **A SQL view or RPC for the GROUP BY.** The current "fetch all + reduce client-side" pattern is fine for personal-scale (a few meals per day). Revisit if the meals table grows past tens of thousands of rows for one user.
- **Last-cooked badge in the expanded recipe view.** Redundant — the collapsed badge is still visible above the expansion.
- **Filtering the badge to "recent enough" recipes only.** A recipe last cooked 18 months ago still shows "over a year ago" intentionally — that's useful info for "should we ever cook this again?"
- **Cooked-count badge** ("cooked 12 times"). Different signal; would need a different aggregate. Not in P1.3 scope.

## Schema

No schema change. The `meals.vault_id` FK and the `meals_user_vault_idx` on `(user_id, vault_id)` shipped in PRD-001 Phase 1 (PR #25). No `docs/schema.md` update needed.

## MCP verification

- **Supabase MCP (read-only):**
  - Confirmed `meals.vault_id` is `uuid YES` and `meals.eaten_on` is `date NO`. ✅
  - Confirmed `meals_user_vault_idx` exists in `pg_indexes`. ✅
  - Spot-check: `EXPLAIN ANALYZE SELECT vault_id, MAX(eaten_on) FROM meals WHERE user_id = :test_user AND vault_id IS NOT NULL GROUP BY vault_id` — confirms an Index Scan, not a Seq Scan.
- **Vercel MCP:** preview deploy URL `<paste here>`. Smoke test below.

## Smoke test

1. Sign in as the test user.
2. Open Cookbook. For any recipe you've cooked recently (LogMode → save → match to vault), confirm "Last cooked X days ago" appears beneath the rating stars.
3. For a recipe you've never cooked (a brand-new add), confirm no badge appears.
4. Log a meal that matches an existing vault recipe (today's date). Reload the Cookbook. The badge should now read "Last cooked today" on that recipe.
5. Open the recipe card (expand it). The badge should still be visible in the always-visible collapsed area at the top of the card; nothing extra in the expanded section.
6. Pull runtime logs from the preview deploy via MCP — confirm no `[Vault] last-cooked fetch failed:` errors.
```

---

## Smoke test (post preview deploy)

The 6-step list above. The two things to verify visually:

1. **The badge renders for recipes with meal logs and is silent for ones without.** This is the load-bearing UX expectation.
2. **A freshly-logged meal makes the badge update on the next Cookbook visit.** Proves the data path is end-to-end.

Report findings in the PR description before requesting review.

---

## Known gotchas

1. **Date parsing without the `T00:00:00` suffix is a trap.** `new Date('2026-05-05')` parses as UTC midnight, which is yesterday in any timezone west of UTC. The helper appends `T00:00:00` so both inputs are local midnight and the day-difference math is correct. Don't "simplify" by removing the suffix.

2. **The meals query orders DESC and first-wins instead of doing a real GROUP BY.** PostgREST doesn't expose `GROUP BY` without a view or RPC; the order-DESC + Map.set-only-on-first-seen pattern is equivalent and has the same per-vault_id cardinality in the response. The order-DESC is load-bearing — without it, the wrong (older) date wins.

3. **The merge happens AFTER `Promise.all` resolves, not after each individually.** That's why both queries are wrapped together. Don't refactor to await them sequentially — that doubles the wall-clock latency for every Cookbook load.

4. **Last-cooked fetch failure is non-fatal.** If the meals query errors (e.g. RLS regression, network hiccup), the page still renders the cookbook — recipes just won't show the badge. This is intentional. Don't surface it as a top-level error or block the page render; a `console.error` is enough.

5. **Soft-deleted vault recipes don't show in the Cookbook anyway.** The `is('deleted_at', null)` filter on the vault SELECT keeps them out; the meals merge silently ignores their `vault_id` because no merged row needs the lookup. No special-case needed.

6. **The recommender doesn't change.** `src/lib/recommendations.js` already uses `meals` data internally for frequency/recency scoring; this PR adds a separate, UI-only consumer of the same table. Don't be tempted to "DRY" the two together — the recommender's needs (last 30 days, with frequency counts, joined on plan items) are different shape from this badge's needs (latest date per vault_id, no time bound).

7. **Don't fix unrelated lint or test errors while doing this work.** Note them as follow-ups in the PR description.

---

## When done

Report back with:

- The PR URL.
- Confirmation that the prerequisite Supabase queries returned the expected columns + index.
- Vercel preview deploy URL + status.
- Smoke-test findings (the 6-step list above — pay particular attention to step 4, the just-logged-a-meal end-to-end check).
- Confirmation that STATUS.md got updated in the same PR.
- The `EXPLAIN ANALYZE` plan for the new meals query (verifies the index is being used, not a Seq Scan).

If anything in the prompt doesn't match the codebase (a renamed file, a different existing pattern, the column or index missing), stop and ask the user. The CLAUDE.md "When in doubt" rule applies.
