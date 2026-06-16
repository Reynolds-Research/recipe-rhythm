# Claude Code Prompt — PRD-004 Phase D: ingredient essentiality override UI

**For:** Claude Code (executor)
**Authored by:** Cowork (planning surface) on 2026-05-05
**Linked PRD:** [`docs/prds/PRD-004-smarter-ingredient-filtering.md`](../prds/PRD-004-smarter-ingredient-filtering.md) §Phase D (P0.10 + P0.11 + P0.12)
**Linked ADR:** [`docs/adr/ADR-002-ingredient-classification.md`](../adr/ADR-002-ingredient-classification.md) — defines the JSONB shape `[{name, essentiality, source}, ...]` and the `source: 'user'` provenance flag.
**Depends on:**
- PRD-004 Phase A shipped — `vault.ingredients_classified jsonb` column exists.
- PRD-004 Phase B shipped — prompt is tuned + accuracy validated.
- PRD-004 Phase C shipped — `passesPreferences` consults `ingredients_classified`; `/api/analyze-recipe` auto-classifies on save; the Preferences UI explains the new behavior.

---

## Why this exists

Phase C made the filter consult `ingredients_classified` instead of brute-force substring matching. That fixed the cheeseburger problem in the typical case. But the AI is sometimes wrong: maybe it marked the cheese in your "Cheeseburger Salad" as essential when you actually want to exclude cheese-heavy recipes, or marked the chicken in some dish as essential when you'd rather treat it as substitutable. Today there's no way to correct it — you're stuck with whatever the AI decided.

Phase D adds the human-in-the-loop. Each ingredient on the expanded recipe card shows its current essentiality as a tappable badge. Tap it → flip → it saves with `source: 'user'` so the next AI re-classification doesn't overwrite your call. The recipe card becomes the single place to inspect and correct the filter's behavior on a per-recipe basis.

**Three pieces:**
1. **Display** (P0.10): show every classified ingredient with its essentiality.
2. **Toggle** (P0.11): tap to flip, persists immediately, marked `source: 'user'`.
3. **Override preservation** (P0.12): re-classification paths (re-extract on chip edit, bulk backfill) merge new AI classifications with existing user overrides — your overrides survive.

There's no separate "recipe detail page" in this codebase despite the PRD using that phrase. Recipes live in the Vault as cards that expand inline (`src/pages/Vault/RecipeCard.jsx`). The Phase D UI lives in the expanded view, not a new route.

Branch suggestion: `feat/prd-004-phase-d-override-ui`.

---

## ⚠ Pre-flight: confirm you're in the right place

```bash
EXPECTED="/Users/Matt/Desktop/Current Projects/recipe-rhythm"
ACTUAL="$(git rev-parse --show-toplevel 2>/dev/null)"
echo "expected: $EXPECTED"
echo "actual:   $ACTUAL"
[ "$ACTUAL" = "$EXPECTED" ] || { echo "ABORT: not in the recipe-rhythm repo root"; exit 1; }

PROMPT="docs/prompts/prd-004-phase-d-override-ui.md"
test -f "$PROMPT" || { echo "ABORT: $PROMPT not found in this working tree"; exit 1; }

git fetch origin
git status   # working tree should be clean
git log --oneline -5

# Confirm STATUS.md still lists Phase D as pending.
grep -A 2 "PRD-004" docs/STATUS.md | head -20
```

If working tree isn't clean or Phase D is already shipped, stop and surface to the user.

---

## Hard prerequisites — verify before writing any code

```bash
# 1. The column exists and is jsonb.
#    Run via Supabase MCP (read-only):
#      SELECT column_name, data_type, is_nullable
#      FROM information_schema.columns
#      WHERE table_schema='public'
#        AND table_name='vault'
#        AND column_name='ingredients_classified';
#    Expected: 1 row | data_type='jsonb' | is_nullable='YES'

# 2. Phase C wiring exists in the filter.
grep -n "essentiality === 'essential'" src/lib/preferenceFilter.js
# Expected: ~1 match around line 233.

# 3. Auto-classify wiring exists in the analyze handler.
grep -n "classifyIngredients" api/_lib/analyzeRecipeHandler.js
# Expected: ~2 matches (import + call).

# 4. The vault SELECT does NOT currently fetch ingredients_classified.
grep -n "ingredients_classified" src/pages/Vault/useVault.js
# Expected: a few matches in addRecipe / addSuggestion / reExtractIngredients
# write paths, but NOT in the fetchRecipes SELECT (line ~39).
# That's the core Step 1 fix below.

# 5. Backfill script exists and the merge helper does NOT exist yet.
test -f scripts/backfill-ingredients-classification.js && echo "backfill: ok"
test ! -f src/lib/classificationOverrides.js && echo "merge helper: not yet, ok"
```

If any of these fail (especially #4 — if `ingredients_classified` IS already in the SELECT, someone has done part of this work and the prompt's plan needs adjusting), **stop and ask the user**.

---

## Implementation plan

Six files change (plus three test files): a new merge helper + tests, the data layer, the bulk script, the card UI, and STATUS.md.

### Step 1 — Add `ingredients_classified` to the vault SELECT

#### File: `src/pages/Vault/useVault.js`

In `fetchRecipes` (line ~37), add `ingredients_classified` to the `.select(...)` column list:

```js
const { data, error } = await supabase
  .from('vault')
  .select('id, name, cuisine_type, flavor_profile, notes, recipe_url, image_url, created_at, proteins, cooking_method, main_carb, dietary_tags, dairy_components, vegetables, fruits, auto_completed, family_rating, prep_time_minutes, ingredients_classified')
  .eq('user_id', userId)
  .is('deleted_at', null)
  .order('created_at', { ascending: false })
```

That single column addition enables every other display step. Don't drop any existing columns — the order of column names is cosmetic but additions are not.

### Step 2 — Create the override merge helper

#### File: `src/lib/classificationOverrides.js` (new)

```js
/**
 * PRD-004 Phase D (P0.12): merge fresh AI classifications with existing
 * user overrides.
 *
 * Phase D introduces user-tappable essentiality overrides on each vault
 * recipe. Each user override is persisted with `source: 'user'` so future
 * AI re-classifications can detect and preserve them.
 *
 * `mergeWithUserOverrides(newAi, existing)`:
 *   - Returns `newAi` unchanged when `existing` has no user-source entries
 *     (or isn't an array).
 *   - Otherwise, indexes user overrides by lowercased `name` and replaces
 *     any matching entry in `newAi` with the user's version.
 *   - Keeps `newAi`'s order so the UI render order stays stable.
 *   - Names that exist only in `existing` (because the AI no longer
 *     classifies them — e.g. an ingredient was removed via chip edit) are
 *     dropped. We don't resurrect orphan user overrides; the new AI run is
 *     authoritative about WHICH ingredients exist.
 *
 * No Supabase, no fetch, no React. Pure transform — testable in isolation.
 */

/**
 * @typedef {Object} Classification
 * @property {string} name
 * @property {'essential' | 'omittable'} essentiality
 * @property {'ai' | 'user'} source
 */

/**
 * @param {Classification[]} newAi       New classifications (typically from
 *                                       /api/classify-ingredients via the
 *                                       analyze handler).
 * @param {Classification[]|null|undefined} existing
 *                                       Currently-stored classifications
 *                                       for the same recipe.
 * @returns {Classification[]}           The merged array.
 */
export function mergeWithUserOverrides(newAi, existing) {
  if (!Array.isArray(newAi)) return []
  if (!Array.isArray(existing)) return newAi

  const userOverrides = new Map()
  for (const c of existing) {
    if (
      c &&
      c.source === 'user' &&
      typeof c.name === 'string' &&
      (c.essentiality === 'essential' || c.essentiality === 'omittable')
    ) {
      userOverrides.set(c.name.trim().toLowerCase(), c)
    }
  }
  if (userOverrides.size === 0) return newAi

  return newAi.map(c => {
    if (!c || typeof c.name !== 'string') return c
    const override = userOverrides.get(c.name.trim().toLowerCase())
    return override || c
  })
}

/**
 * Apply a single override to a classifications array.
 *
 * Used by the UI tap handler — it doesn't have to know how the JSONB is
 * shaped, just "flip ingredient X to essentiality Y." Returns a new array
 * (no in-place mutation).
 *
 * If the named ingredient isn't in the array, returns the input unchanged
 * (defensive — a tap can't materialize a new ingredient out of nowhere).
 */
export function applyOverride(classifications, name, essentiality) {
  if (!Array.isArray(classifications)) return classifications
  if (typeof name !== 'string' || !name.trim()) return classifications
  if (essentiality !== 'essential' && essentiality !== 'omittable') {
    return classifications
  }
  const target = name.trim().toLowerCase()
  let touched = false
  const next = classifications.map(c => {
    if (
      c &&
      typeof c.name === 'string' &&
      c.name.trim().toLowerCase() === target
    ) {
      touched = true
      return { ...c, essentiality, source: 'user' }
    }
    return c
  })
  return touched ? next : classifications
}
```

#### File: `src/lib/__tests__/classificationOverrides.test.js` (new)

```js
import { describe, it, expect } from 'vitest'
import { mergeWithUserOverrides, applyOverride } from '../classificationOverrides'

describe('mergeWithUserOverrides', () => {
  it('returns newAi unchanged when existing is null', () => {
    const newAi = [{ name: 'onion', essentiality: 'omittable', source: 'ai' }]
    expect(mergeWithUserOverrides(newAi, null)).toBe(newAi)
  })

  it('returns newAi unchanged when existing has no user-source entries', () => {
    const newAi = [{ name: 'onion', essentiality: 'omittable', source: 'ai' }]
    const existing = [{ name: 'onion', essentiality: 'essential', source: 'ai' }]
    expect(mergeWithUserOverrides(newAi, existing)).toBe(newAi)
  })

  it('preserves a user override on a matched name (case-insensitive)', () => {
    const newAi = [
      { name: 'Onion',  essentiality: 'omittable', source: 'ai' },
      { name: 'garlic', essentiality: 'essential', source: 'ai' },
    ]
    const existing = [
      { name: 'onion', essentiality: 'essential', source: 'user' },
    ]
    const merged = mergeWithUserOverrides(newAi, existing)

    expect(merged).toEqual([
      { name: 'onion',  essentiality: 'essential', source: 'user' },
      { name: 'garlic', essentiality: 'essential', source: 'ai' },
    ])
  })

  it('keeps newAi order stable when overrides apply', () => {
    const newAi = [
      { name: 'a', essentiality: 'essential', source: 'ai' },
      { name: 'b', essentiality: 'omittable', source: 'ai' },
      { name: 'c', essentiality: 'essential', source: 'ai' },
    ]
    const existing = [
      { name: 'b', essentiality: 'essential', source: 'user' },
      { name: 'c', essentiality: 'omittable', source: 'user' },
    ]
    const merged = mergeWithUserOverrides(newAi, existing)
    expect(merged.map(c => c.name)).toEqual(['a', 'b', 'c'])
  })

  it('drops orphan user overrides (existing names that newAi removed)', () => {
    const newAi = [{ name: 'onion', essentiality: 'omittable', source: 'ai' }]
    const existing = [
      { name: 'onion',          essentiality: 'essential', source: 'user' },
      { name: 'removed-thing',  essentiality: 'essential', source: 'user' },
    ]
    const merged = mergeWithUserOverrides(newAi, existing)
    expect(merged.map(c => c.name)).toEqual(['onion'])
  })

  it('returns [] when newAi is not an array', () => {
    expect(mergeWithUserOverrides(null, [])).toEqual([])
    expect(mergeWithUserOverrides(undefined, [])).toEqual([])
  })

  it('ignores malformed user overrides (missing essentiality, etc.)', () => {
    const newAi = [{ name: 'onion', essentiality: 'omittable', source: 'ai' }]
    const existing = [
      { name: 'onion', essentiality: 'mystery', source: 'user' },
      null,
      { source: 'user' },
    ]
    expect(mergeWithUserOverrides(newAi, existing)).toEqual([
      { name: 'onion', essentiality: 'omittable', source: 'ai' },
    ])
  })
})

describe('applyOverride', () => {
  it('flips essentiality and stamps source=user on a matched name', () => {
    const before = [
      { name: 'onion',  essentiality: 'omittable', source: 'ai' },
      { name: 'garlic', essentiality: 'essential', source: 'ai' },
    ]
    const after = applyOverride(before, 'onion', 'essential')
    expect(after).toEqual([
      { name: 'onion',  essentiality: 'essential', source: 'user' },
      { name: 'garlic', essentiality: 'essential', source: 'ai' },
    ])
    // Caller can rely on identity change — useful for triggering re-renders.
    expect(after).not.toBe(before)
  })

  it('returns input unchanged when name does not match any entry', () => {
    const before = [{ name: 'onion', essentiality: 'omittable', source: 'ai' }]
    const after = applyOverride(before, 'cilantro', 'essential')
    expect(after).toBe(before)
  })

  it('matches case-insensitively', () => {
    const before = [{ name: 'Garlic', essentiality: 'essential', source: 'ai' }]
    const after = applyOverride(before, 'GARLIC', 'omittable')
    expect(after[0]).toEqual({ name: 'Garlic', essentiality: 'omittable', source: 'user' })
  })

  it('rejects unknown essentiality values', () => {
    const before = [{ name: 'onion', essentiality: 'omittable', source: 'ai' }]
    expect(applyOverride(before, 'onion', 'mystery')).toBe(before)
  })

  it('handles non-array input defensively', () => {
    expect(applyOverride(null, 'onion', 'essential')).toBe(null)
    expect(applyOverride(undefined, 'onion', 'essential')).toBe(undefined)
  })
})
```

### Step 3 — Add `setIngredientEssentiality` to `useVault`

#### File: `src/pages/Vault/useVault.js`

Add an import at the top:

```js
import { applyOverride } from '../../lib/classificationOverrides'
```

Add a new function just before the `setRating` function (which is the closest prior-art for "tap an indicator on the card to update one field"):

```js
/**
 * PRD-004 Phase D (P0.11) — Toggle a single ingredient's essentiality.
 *
 * Reads the current `ingredients_classified` array from local cache, flips
 * the named ingredient via applyOverride (which stamps source='user'), then
 * writes the whole array back to Supabase.
 *
 * Optimistic: local state updates immediately so the badge color flips
 * before the network round-trip. On error, refetch authoritative state to
 * roll back.
 */
const setIngredientEssentiality = async (recipeId, ingredientName, newEssentiality) => {
  const recipe = recipes.find(r => r.id === recipeId)
  if (!recipe) return
  const current = Array.isArray(recipe.ingredients_classified)
    ? recipe.ingredients_classified
    : null
  if (!current) return

  const next = applyOverride(current, ingredientName, newEssentiality)
  // applyOverride returns the same reference when nothing changed (e.g. the
  // named ingredient isn't in the array). Skip the write in that case.
  if (next === current) return

  setRecipes(prev =>
    prev.map(r => r.id === recipeId ? { ...r, ingredients_classified: next } : r)
  )

  const { error } = await supabase
    .from('vault')
    .update({ ingredients_classified: next })
    .eq('id', recipeId)
    .eq('user_id', userId)

  if (error) {
    console.error('[Vault] setIngredientEssentiality failed:', error.message)
    await fetchRecipes()
  }
}
```

Add `setIngredientEssentiality` to the returned object at the bottom:

```js
return {
  recipes,
  loading,
  vaultError,
  setVaultError,
  extrasByCategory,
  addExtra,
  addRecipe,
  addSuggestion,
  deleteRecipe,
  updateRecipe,
  setRating,
  setIngredientEssentiality,    // ← new
  reExtractIngredients,
}
```

### Step 4 — Wire the merge helper into `useVault.reExtractIngredients`

The re-extract path runs every time the user edits chips on a recipe. It currently calls `analyzeRecipe` (which auto-classifies via the handler) and writes the fresh classifications wholesale. After Phase D, it must merge in any existing user overrides first.

In `reExtractIngredients` (lines ~270–310), find the existing block:

```js
if (components.ingredients_classified !== undefined) update.ingredients_classified = components.ingredients_classified ?? null
```

Replace with:

```js
// PRD-004 Phase D (P0.12): preserve user overrides across re-classification.
// The fresh AI run is authoritative about WHICH ingredients exist; user
// overrides override the essentiality call for matching names only.
if (components.ingredients_classified !== undefined) {
  const merged = mergeWithUserOverrides(
    components.ingredients_classified ?? [],
    recipe.ingredients_classified,
  )
  update.ingredients_classified = merged.length > 0 ? merged : null
}
```

Add the import at the top of the file:

```js
import { mergeWithUserOverrides, applyOverride } from '../../lib/classificationOverrides'
```

(Both helpers — Step 3 needs `applyOverride`, Step 4 needs `mergeWithUserOverrides`. One import line, both names.)

### Step 5 — Wire the merge helper into the bulk backfill script

The current backfill WHERE clause (in `scripts/backfill-ingredients-classification.js`) excludes rows that already have a non-null `ingredients_classified`, so it never overwrites existing data today. **Add the merge anyway** as defense-in-depth: the moment someone adds a `--force` flag or a periodic re-classification cron (PRD-004 P1.4), the merge becomes load-bearing rather than theoretical.

#### File: `scripts/backfill-ingredients-classification.js`

Find `processRow` (around line 69). Just before the Supabase `.update({ ingredients_classified: ... })` call, fetch the existing classifications and merge:

```js
// (existing classification call returns `classifications` array)

// PRD-004 Phase D (P0.12): defensive merge with user overrides. Today the
// outer query excludes rows where ingredients_classified IS NOT NULL, so
// `existing` will be null in normal runs and the merge is a no-op. The merge
// becomes load-bearing if/when this script gains a --force flag (P1.4
// periodic re-classification).
const { data: existingRow } = await supabase
  .from('vault')
  .select('ingredients_classified')
  .eq('id', row.id)
  .single()

const merged = mergeWithUserOverrides(
  classifications,
  existingRow?.ingredients_classified ?? null,
)
```

Then the existing update call uses `merged` instead of the raw classifications:

```js
const { error: writeErr } = await supabase
  .from('vault')
  .update({ ingredients_classified: merged })
  .eq('id', row.id)
```

Add the import at the top of the file:

```js
import { mergeWithUserOverrides } from '../src/lib/classificationOverrides.js'
```

(Use `.js` extension — this is a Node script, not a Vite module, and the import resolver in Node ESM requires the explicit extension.)

> **Read the existing script first.** The variable names above (`classifications`, `existingRow`) are illustrative — match the actual variable names in the file. The pattern is what matters: read the existing classifications for the row → call `mergeWithUserOverrides` → write the merged array.

### Step 6 — Add the IngredientList component to RecipeCard

#### File: `src/pages/Vault/RecipeCard.jsx`

This is the bulk of the user-visible work. Add a new section to the *non-editing* expanded view (after the `<ComponentRow>` rows, before the notes/url/image block) showing each classified ingredient with its essentiality as a tappable badge.

#### 6a. New props on `RecipeCard`

Add `onIngredientEssentialityChange` to the props (around line 109–125):

```jsx
export default function RecipeCard({
  recipe,
  expanded,
  editing,
  editFields,
  setEditFields,
  savingEdit,
  extrasByCategory,
  onAddExtra,
  onToggleExpand,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onRatingChange,
  onIngredientEssentialityChange,   // ← new
  source,
}) {
```

#### 6b. The new sub-component

Add this private helper between `StarRating` and the default export (around line 108):

```jsx
/**
 * PRD-004 Phase D (P0.10 + P0.11) — per-recipe essentiality badges.
 *
 * Renders each ingredient classified by the AI as a tappable pill. Tap to
 * flip essentiality. Pills are color-coded:
 *   - essential = solid brand color (matches the existing chip-selected style)
 *   - omittable = light/outlined (matches the unselected chip style)
 *
 * The `source` is shown as a small dot — solid if AI, hollow if user-overridden.
 * That dot is the visual signal that "you've changed this one." Doesn't need
 * a tooltip — the rule is consistent enough that the dot trains itself.
 *
 * Empty state: when the recipe has no ingredients_classified (legacy rows
 * the Phase A backfill missed; should be rare), the section doesn't render
 * at all.
 */
function IngredientClassificationList({ classifications, onChange, recipeName }) {
  if (!Array.isArray(classifications) || classifications.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="section-heading">Ingredients (tap to override)</p>
      <div className="flex flex-wrap gap-2" role="list">
        {classifications.map(c => {
          if (!c || typeof c.name !== 'string') return null
          const isEssential = c.essentiality === 'essential'
          const isUserOverride = c.source === 'user'
          const next = isEssential ? 'omittable' : 'essential'

          return (
            <button
              key={c.name}
              type="button"
              role="listitem"
              onClick={(e) => {
                e.stopPropagation()
                onChange?.(c.name, next)
              }}
              aria-label={`${c.name}: ${c.essentiality}${isUserOverride ? ' (you set this)' : ''}. Tap to mark ${next}.`}
              aria-pressed={isEssential}
              className={`chip ${isEssential ? 'chip-selected' : ''}`}
            >
              <span
                aria-hidden="true"
                className={`inline-block w-2 h-2 rounded-full ${
                  isUserOverride
                    ? (isEssential ? 'border border-white' : 'border border-gray-400')
                    : (isEssential ? 'bg-white' : 'bg-gray-400')
                }`}
              />
              <span>{c.name}</span>
              <span className="text-[10px] uppercase tracking-wide opacity-80">
                {isEssential ? 'essential' : 'optional'}
              </span>
            </button>
          )
        })}
      </div>
      <p className="helper-text italic">
        "Essential" means excluding this ingredient hides {recipeName}. "Optional" means it doesn't.
      </p>
    </div>
  )
}
```

#### 6c. Render it inside the non-editing expanded view

In the `editing ? (...) : (...)` branch (line ~277), add the new component just **before** the existing `<ComponentRow>` rows so it's the first thing visible in the expanded view (or just **after** them — your call; first-thing is recommended because it's the new thing the user came to interact with):

```jsx
) : (
  <>
    {/* PRD-004 Phase D (P0.10 + P0.11) */}
    <IngredientClassificationList
      classifications={recipe.ingredients_classified}
      onChange={(name, next) => onIngredientEssentialityChange?.(recipe.id, name, next)}
      recipeName={recipe.name}
    />

    <ComponentRow label="Protein"  values={recipe.proteins} />
    <ComponentRow label="Carb"     values={recipe.main_carb ? [recipe.main_carb] : []} />
    {/* ... unchanged ComponentRow lines ... */}
```

#### 6d. Pass the prop through from the page

Find where `<RecipeCard ... />` is rendered in `src/pages/Vault/index.jsx`. The Vault page currently destructures handlers from `useVault`. Add `setIngredientEssentiality` to the destructure, then pass it as `onIngredientEssentialityChange`.

Use `grep -n "<RecipeCard" src/pages/Vault/index.jsx` to find the exact JSX location. The new prop:

```jsx
<RecipeCard
  // ...existing props...
  onIngredientEssentialityChange={setIngredientEssentiality}
/>
```

> **Don't add the override UI to the editing branch (lines 193–275).** Editing chips already has its own save flow that re-extracts ingredients and would clobber any in-flight overrides. Phase D's UX is "expand the card, tap a badge, done" — no edit mode involvement. If a user wants to edit chips AND override essentiality, they can do them in either order — saving the chip edit re-extracts and the merge helper preserves their overrides anyway.

---

## Step 7 — Tests

Three test files change.

### `src/lib/__tests__/classificationOverrides.test.js` (new)

Already written in Step 2.

### `src/pages/Vault/__tests__/RecipeCard.test.jsx`

Add a new `describe` block at the bottom for Phase D. Read the existing file first — it uses `vitest`, `@testing-library/react`, and a `baseRecipe` + `baseProps` fixture pattern. Reuse them.

```jsx
describe('RecipeCard — ingredient essentiality (PRD-004 Phase D)', () => {
  const baseClassified = [
    { name: 'onion',  essentiality: 'omittable', source: 'ai'   },
    { name: 'garlic', essentiality: 'essential', source: 'user' },
  ]

  function renderExpanded(overrides = {}) {
    const onChange = vi.fn()
    render(
      <RecipeCard
        recipe={{ ...baseRecipe, ingredients_classified: baseClassified, ...overrides }}
        expanded
        {...baseProps}
        onIngredientEssentialityChange={onChange}
      />
    )
    return { onChange }
  }

  it('renders a badge for every classified ingredient when expanded', () => {
    renderExpanded()
    expect(screen.getByRole('listitem', { name: /onion/i })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: /garlic/i })).toBeInTheDocument()
  })

  it('does NOT render the section when ingredients_classified is null/missing', () => {
    render(
      <RecipeCard
        recipe={{ ...baseRecipe, ingredients_classified: null }}
        expanded
        {...baseProps}
      />
    )
    expect(screen.queryByText(/Ingredients \(tap to override\)/i)).not.toBeInTheDocument()
  })

  it('does NOT render the section when ingredients_classified is empty array', () => {
    render(
      <RecipeCard
        recipe={{ ...baseRecipe, ingredients_classified: [] }}
        expanded
        {...baseProps}
      />
    )
    expect(screen.queryByText(/Ingredients \(tap to override\)/i)).not.toBeInTheDocument()
  })

  it('does NOT render the section when the card is collapsed', () => {
    render(
      <RecipeCard
        recipe={{ ...baseRecipe, ingredients_classified: baseClassified }}
        expanded={false}
        {...baseProps}
      />
    )
    expect(screen.queryByText(/Ingredients \(tap to override\)/i)).not.toBeInTheDocument()
  })

  it('clicking an essential badge calls onChange with the omittable target', async () => {
    const { onChange } = renderExpanded()
    const garlic = screen.getByRole('listitem', { name: /garlic/i })
    await userEvent.setup().click(garlic)
    expect(onChange).toHaveBeenCalledWith('r-1', 'garlic', 'omittable')
  })

  it('clicking an omittable badge calls onChange with the essential target', async () => {
    const { onChange } = renderExpanded()
    const onion = screen.getByRole('listitem', { name: /onion/i })
    await userEvent.setup().click(onion)
    expect(onChange).toHaveBeenCalledWith('r-1', 'onion', 'essential')
  })

  it('exposes user-override provenance in the accessible label', () => {
    renderExpanded()
    // garlic in baseClassified has source: 'user'
    const garlic = screen.getByRole('listitem', { name: /garlic.*you set this/i })
    expect(garlic).toBeInTheDocument()
  })

  it('omits the user-override marker for ai-source entries in the accessible label', () => {
    renderExpanded()
    // onion in baseClassified has source: 'ai'
    const onion = screen.getByLabelText(/onion: omittable\. Tap/i)
    expect(onion).toBeInTheDocument()
    expect(onion.getAttribute('aria-label')).not.toMatch(/you set this/i)
  })

  it('clicking a badge does NOT toggle the expand handler (stopPropagation)', async () => {
    const onToggleExpand = vi.fn()
    render(
      <RecipeCard
        recipe={{ ...baseRecipe, ingredients_classified: baseClassified }}
        expanded
        {...baseProps}
        onToggleExpand={onToggleExpand}
        onIngredientEssentialityChange={vi.fn()}
      />
    )
    const onion = screen.getByRole('listitem', { name: /onion/i })
    await userEvent.setup().click(onion)
    expect(onToggleExpand).not.toHaveBeenCalled()
  })
})
```

Make sure `userEvent` is imported at the top of the file (`import userEvent from '@testing-library/user-event'`) and `vi` is imported from `vitest` if it isn't already.

### `src/pages/Vault/__tests__/useVault.test.js` (may not exist — check first)

```bash
test -f src/pages/Vault/__tests__/useVault.test.js
```

If the file doesn't exist, **don't scaffold a new test harness in this PR** — note in the PR description that `useVault` has no direct test coverage today and Phase D doesn't add it. The `setIngredientEssentiality` mutation is exercised indirectly through the `RecipeCard` tests (which mock the callback) and the merge helper tests (which exercise the data transform). That's adequate for v1.

If the file does exist, add cases following its existing pattern:

- `setIngredientEssentiality` no-ops when the recipe isn't in the local cache.
- `setIngredientEssentiality` writes the merged array to Supabase and updates local state.
- `setIngredientEssentiality` rolls back via `fetchRecipes` on Supabase error.
- `reExtractIngredients` calls `mergeWithUserOverrides` against the recipe's existing `ingredients_classified` before writing.

---

## Step 8 — STATUS.md update

In the same PR, update `docs/STATUS.md`:

1. **Top of file:** bump the `**Last verified:**` line to today's date and the latest commit hash on `main` (post-merge of this PR — set this just before pushing the final commit, or update in a follow-up if needed).
2. **At-a-glance table** (PRD-004 row): change "Overall status" from `🟡 **Phase A + B + C shipped**` to `✅ **All P0 shipped**`. Change "Next thing to plan" from `Phase D (override UI)` to `P1 nice-to-haves (override review surface, frequency analytics, AI confidence, periodic re-classification)`.
3. **PRD-004 section:** move Phase D from "Pending" to "Shipped":
   ```
   - [x] **Phase D — Override UI** (PR #<your-PR>, commit `<hash>`, P0.10 + P0.11 + P0.12): expanded recipe cards now render every classified ingredient as a tappable essentiality badge. Tap flips essentiality and stamps `source: 'user'`. The `useVault.reExtractIngredients` path and the bulk backfill script both merge fresh AI classifications with existing user overrides via `src/lib/classificationOverrides.js` so user overrides survive re-classification.
   ```

---

## Step 9 — Branch + commit + PR

```bash
git fetch origin
git checkout -b feat/prd-004-phase-d-override-ui origin/main

# Make the edits in Steps 1–8.

npm run test:unit
npm run lint
npm run lint:ds

git add src/lib/classificationOverrides.js \
        src/lib/__tests__/classificationOverrides.test.js \
        src/pages/Vault/useVault.js \
        src/pages/Vault/RecipeCard.jsx \
        src/pages/Vault/__tests__/RecipeCard.test.jsx \
        src/pages/Vault/index.jsx \
        scripts/backfill-ingredients-classification.js \
        docs/STATUS.md

git commit
git push -u origin feat/prd-004-phase-d-override-ui
```

### Suggested commit message

```
feat(prd-004): Phase D override UI (P0.10 + P0.11 + P0.12)

Adds the human-in-the-loop closer to PRD-004's filter rework. Each
classified ingredient on a vault recipe card is now a tappable badge
that displays + flips its essentiality. User overrides persist with
source='user' so the next AI re-classification doesn't clobber them.

- src/lib/classificationOverrides.js (new):
  - mergeWithUserOverrides(newAi, existing): preserves user-source
    entries by name when re-classification runs.
  - applyOverride(classifications, name, essentiality): pure transform
    used by the UI tap handler. Stamps source='user'.

- src/pages/Vault/useVault.js:
  - fetchRecipes SELECT now includes ingredients_classified.
  - new setIngredientEssentiality(recipeId, name, essentiality)
    mutation: optimistic local update + Supabase write, refetches on
    error.
  - reExtractIngredients now merges fresh AI classifications with the
    recipe's existing ingredients_classified before writing — user
    overrides survive a chip edit.

- src/pages/Vault/RecipeCard.jsx:
  - new IngredientClassificationList sub-component renders each
    classified ingredient as a chip-style badge in the expanded view.
    Solid = essential, outlined = optional. A small dot signals
    user-overridden vs. AI.
  - new prop onIngredientEssentialityChange wired to the toggle.
  - Section hidden when ingredients_classified is null/empty.

- src/pages/Vault/index.jsx:
  - destructures setIngredientEssentiality from useVault and forwards
    as onIngredientEssentialityChange to <RecipeCard>.

- scripts/backfill-ingredients-classification.js:
  - reads existing ingredients_classified per row and pipes through
    mergeWithUserOverrides before writing. Defensive — today's WHERE
    clause skips already-classified rows, so the merge is a no-op
    until/unless P1.4 periodic re-classification ships.

- docs/STATUS.md: PRD-004 marked complete.
```

### Suggested PR description

```markdown
## Why

Phase C made the filter consult `ingredients_classified` instead of brute-force substring matching, which fixed the cheeseburger problem in the typical case. But the AI is sometimes wrong — and there was no way to correct it on a per-recipe basis. Phase D closes that gap: each classified ingredient is now a tappable badge on the vault recipe card. Tap to flip; your override sticks across re-classifications.

## What

- **`src/lib/classificationOverrides.js` (new):** `mergeWithUserOverrides` (used by re-classification paths) and `applyOverride` (used by the UI tap handler). Both pure transforms.
- **`src/pages/Vault/useVault.js`:** `ingredients_classified` added to the SELECT, new `setIngredientEssentiality` mutation, `reExtractIngredients` now merges via the helper.
- **`src/pages/Vault/RecipeCard.jsx`:** new `IngredientClassificationList` sub-component renders inside the expanded (non-editing) view. Tappable chip-style badges, solid for essential, outlined for optional. A small dot signals user-overridden vs. AI-classified.
- **`scripts/backfill-ingredients-classification.js`:** defense-in-depth merge call before write. No-op today (WHERE clause skips already-classified rows), load-bearing if P1.4 periodic re-classification ever ships.

## What's NOT in this PR

- **Per-recipe override review surface (P1.1).** "Show me all my overrides in one place." Not built; the vault list shows no override indicator.
- **Override frequency analytics (P1.2).** No logging of which ingredients get overridden.
- **AI confidence display (P1.3).** Endpoint doesn't return confidence; UI doesn't surface low-confidence classifications.
- **Periodic re-classification cron (P1.4).** Manual re-extract via chip edit is the only path that re-classifies for now.
- **Override UI in the EDITING branch of the card.** Editing chips already has its own save flow that re-extracts; Phase D UX is "expand → tap a badge → done." No edit mode involvement.

## Schema

No schema change. The `ingredients_classified jsonb` column has held a `source` field since Phase A. This PR is the first writer that sets it to `'user'`.

## MCP verification

- **Supabase MCP:** confirmed pre-condition with `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='vault' AND column_name='ingredients_classified'` → `jsonb`, `YES`. ✅. After deploy, ran a spot-check `SELECT id, name, ingredients_classified FROM vault WHERE user_id = :test_user LIMIT 5` to confirm the data shape renders correctly in the UI.
- **Vercel MCP:** preview deploy URL `<paste here>`. Smoke test below.

## Smoke test

1. Sign in as the test user (creds in `.claude/test-credentials.md`).
2. Open the Cookbook → expand any recipe with classified ingredients.
3. Confirm the new "Ingredients (tap to override)" section renders with one badge per ingredient, color-coded essential/optional.
4. Tap an essential badge → it flips to optional. The dot inside the badge changes from solid to outlined (user-override marker). Reload the page → the change persisted.
5. Tap the same badge again → flips back to essential, still user-marked.
6. Edit the recipe's chips (e.g. add or remove a vegetable) → save. Re-expand. The override on the previously-flipped ingredient is preserved (or, if you removed that ingredient, it's gone — `mergeWithUserOverrides` drops orphans, that's expected).
7. Open Brainstorm → preferences → exclude an ingredient that you marked optional on a particular recipe. That recipe should still appear in recommendations (because excluding an optional ingredient doesn't filter it out, per Phase C's filter logic).
8. Pull runtime logs from the preview deploy via MCP — confirm no `[Vault] setIngredientEssentiality failed:` errors.
```

---

## Smoke test (post preview deploy)

The 8-step list above. The two critical things to verify visually:

1. The badges render with clear visual differentiation: solid (essential) vs. outlined (optional), and a small dot or marker that distinguishes user-overridden from AI-classified.
2. After overriding an ingredient and editing chips on the same recipe, the override survives the re-extract (this is the Step 6 check — proves `mergeWithUserOverrides` is wired correctly through `reExtractIngredients`).

Report findings in the PR description before requesting review.

---

## Known gotchas

1. **The vault SELECT change in Step 1 is the load-bearing prerequisite.** If you skip it, every Phase D feature silently no-ops because `recipe.ingredients_classified` is `undefined` everywhere. Run the existing Vault tests after the SELECT change to confirm no test mock relies on the column being absent — they shouldn't, but verify.

2. **Don't reach for a "recipe detail page" — there isn't one.** Despite the PRD's wording, recipes display inline in expandable cards (`RecipeCard.jsx`). The Phase D UI lives in the expanded view. If you find yourself adding a route or a new page component, stop — that's scope creep into PRD-003 P0.11's routing work and isn't needed here.

3. **`mergeWithUserOverrides` drops orphan user overrides.** If a user overrode "ginger" as essential, and then chip-edits remove ginger from the recipe so the AI no longer classifies it, the user's "ginger essential" entry is dropped. **This is the right behavior** — the new AI run is authoritative about which ingredients exist. If you reverse this and resurrect orphans, you'll end up with classifications for ingredients that the recipe no longer contains. The merge helper's docstring explains this.

4. **`source: 'user'` is the contract with Phase A's data shape.** ADR-002 defines the shape as `[{name, essentiality, source}]`. The classifier (Step 5 in `classifyIngredients.js`) stamps `source: 'ai'` on every entry it returns. Phase D introduces `source: 'user'`. Don't invent new source values — `'ai'` and `'user'` are the only two.

5. **Don't add the override UI to the EDITING branch.** Lines 193–275 of `RecipeCard.jsx` render the chip-edit form. Adding the override UI there creates two competing save flows (chip edit's `onSaveEdit` vs. the override's optimistic write). Keep Phase D in the non-editing branch only — the merge helper handles the case where the user edits chips after overriding.

6. **`stopPropagation` on the badge click** is required because the entire collapsed card is wrapped in a click handler that toggles expand/collapse. Without it, every override tap collapses the card. The existing `StarRating` component already has the same defense — copy that pattern.

7. **Tests for the test user setup may rely on `vi.mock` for supabase.** If the existing `useVault` tests mock `supabase.from(...)` with chain assertions, your new `setIngredientEssentiality` test will need to extend the mock chain. If the test file doesn't exist yet, the merge helper tests + RecipeCard tests are sufficient — see Step 7 third bullet.

8. **Don't fix unrelated lint or test errors while doing this work.** Note them as follow-ups in the PR description.

---

## When done

Report back with:

- The PR URL.
- Confirmation that the prerequisite `SELECT` against `vault.ingredients_classified` shows `jsonb`, `YES`.
- Vercel preview deploy URL + status.
- Smoke-test findings (the 8-step list above — pay particular attention to step 6, the override-survives-re-extract case).
- Confirmation that STATUS.md got updated in the same PR.
- The override count from a spot-check `SELECT`: `SELECT id, name, jsonb_array_length(ingredients_classified) AS total, (SELECT COUNT(*) FROM jsonb_array_elements(ingredients_classified) e WHERE e->>'source' = 'user') AS user_overrides FROM vault WHERE user_id = :test_user AND ingredients_classified IS NOT NULL` — useful baseline for monitoring override frequency over time (informs PRD-004's success metric: <10% override rate signals the AI is doing well).

If anything in the prompt doesn't match the codebase (a renamed file, a different existing pattern, the column already in the SELECT, the merge helper already exists), stop and ask the user. The CLAUDE.md "When in doubt" rule applies.
