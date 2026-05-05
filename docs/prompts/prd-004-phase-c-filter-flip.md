# Claude Code Prompt — PRD-004 Phase C: flip the filter to gate on essentiality

**For:** Claude Code (executor)
**Authored by:** Cowork (planning surface) on 2026-05-04
**Linked PRD:** [`docs/prds/PRD-004-smarter-ingredient-filtering.md`](../prds/PRD-004-smarter-ingredient-filtering.md) §Phase C (P0.7 + P0.8 + P0.9)
**Linked ADR:** [`docs/adr/ADR-002-ingredient-classification.md`](../adr/ADR-002-ingredient-classification.md) — decision rationale for the AI-classifier approach
**Depends on:**
- PRD-004 Phase A + Phase B shipped on `main` (PR #54 + PR #56 + PR #59 + commit `281fdd0`)
- PRD-006 P0.1–P0.6 shipped (the analyze-recipe handler chain we extend in P0.8 already exists at `api/_lib/analyzeRecipeHandler.js`)
- ADR-003 implied-meat dish-name filter shipped (PRD-004's companion in `passesPreferences`)

---

## ⚠ Pre-flight: confirm you're in the right place

The user has multiple Claude Code worktrees on disk and prompts have been mis-routed before. **Run these checks FIRST**, before reading or editing anything else. If any check fails, STOP and surface a clear error to the user — do NOT guess or pick a different path.

```bash
# 1) Canonical repo root
EXPECTED="/Users/Matt/Desktop/Current Projects/recipe-rhythm"
ACTUAL="$(git rev-parse --show-toplevel 2>/dev/null)"
echo "expected: $EXPECTED"
echo "actual:   $ACTUAL"
[ "$ACTUAL" = "$EXPECTED" ] || { echo "ABORT: not in the recipe-rhythm repo root"; exit 1; }

# 2) This prompt file must exist at the expected path within the repo
PROMPT="docs/prompts/prd-004-phase-c-filter-flip.md"
test -f "$PROMPT" || { echo "ABORT: $PROMPT not found in this working tree"; exit 1; }

# 3) Show all worktrees so we can spot stale ones
git worktree list

# 4) Confirm you're on a clean main with origin pulled
git fetch origin
git status   # working tree should be clean (or only contain unrelated user-staged work)
git log --oneline -5

# 5) Confirm Phase A + Phase B are actually on main
git log --oneline | grep -E "PRD-004 Phase A|PRD-004 Phase B|prd-004.*classification"

# 6) Confirm STATUS.md says Phase C is pending (not already shipped)
grep -A 1 "Phase C — Filter behavior change" docs/STATUS.md
```

Expected: STATUS.md should still list Phase C as pending. If it says Shipped, **STOP** — Phase C may have been done already and this prompt is stale. Surface that to the user before proceeding.

---

## What you're building

The cheeseburger-problem fix. Phase A built the `vault.ingredients_classified jsonb` column + the `/api/classify-ingredients` endpoint. Phase B tuned the classifier to ≥85% precision on the 'essential' call. Phase C is the user-visible flip:

1. **P0.7** — Update `passesPreferences` so an excluded ingredient hides a recipe only when the matched ingredient appears in `ingredients_classified` with `essentiality === 'essential'`. Mentioning the ingredient (e.g. onion in cheeseburgers) no longer triggers a hide.
2. **P0.8** — Wire `/api/analyze-recipe` to auto-classify on save so newly added recipes never have `ingredients_classified IS NULL`. This eliminates the defensive-fallback path for any recipe added post-Phase-C.
3. **P0.9** — Update the Preferences UI's "Excluded ingredients" section with a one-line disclaimer explaining the new behavior, so the user understands why mentioning ≠ hiding.

**Ship as a single PR**, branch name suggestion: `feat/prd-004-phase-c-filter-flip`.

---

## Hard prerequisites (verify before writing code)

Run these checks. If anything is unexpected, stop and surface it:

```bash
# 1. ingredients_classified column exists with expected shape
# Run via Supabase MCP against a preview branch (read-only):
#   SELECT column_name, data_type, is_nullable
#   FROM information_schema.columns
#   WHERE table_schema='public' AND table_name='vault' AND column_name='ingredients_classified';
# Expected: data_type='jsonb', is_nullable='YES'

# 2. The classify-ingredients endpoint + helper exist
ls api/_lib/classifyHandler.js api/classify-ingredients.js src/lib/classifyIngredients.js
# All three should exist.

# 3. Phase B accuracy threshold is currently met
node scripts/eval-classification-accuracy.js
# Should exit 0 (precision ≥ 0.85). If it exits 1, STOP and surface the eval
# report — Phase C should not flip the filter on a sub-threshold classifier.

# 4. Confirm the test user's vault rows have ingredients_classified populated
# (i.e., the backfill has been run). This isn't strictly required for Phase C
# code (the defensive fallback handles NULL), but it matters for smoke-testing.
# Run via Supabase MCP against the prod-mirror preview:
#   SELECT
#     COUNT(*) FILTER (WHERE ingredients_classified IS NOT NULL) AS classified,
#     COUNT(*) FILTER (WHERE ingredients_classified IS NULL)     AS unclassified
#   FROM vault WHERE deleted_at IS NULL;
# If unclassified > 0, note it but proceed — the defensive fallback covers them.
```

---

## P0.7 — Update `passesPreferences`

### File
`src/lib/preferenceFilter.js`

### What's there now (lines 211–225)

```js
// 3. excluded_ingredients (case-insensitive substring against haystack)
const excludedIngredients = Array.isArray(preferences.excluded_ingredients)
  ? preferences.excluded_ingredients
  : []
if (excludedIngredients.length > 0) {
  const haystack = collectIngredientHaystack(item)
  if (haystack) {
    for (const ing of excludedIngredients) {
      if (typeof ing !== 'string') continue
      const needle = ing.trim().toLowerCase()
      if (!needle) continue
      if (haystack.includes(needle)) return false
    }
  }
}
```

The current logic does a substring match across the full haystack (proteins, vegetables, fruits, dairy, main_carb, name, notes, ingredients). This is the cheeseburger bug: excluding "onion" hides a Cheeseburger because onion appears in `vegetables` or `ingredients`, even though onion is incidental to the dish.

### What to change

The new logic gates the substring hit on essentiality. An excluded ingredient hides the recipe only if it matches a name in `item.ingredients_classified` whose `essentiality === 'essential'`. If `ingredients_classified` is `null` or missing (a vault row the backfill didn't reach), fall back to the **old** substring behavior — defensive, shouldn't happen post-Phase-A, but we never hide in a way the user can't reason about.

### New code (replace lines 211–225)

```js
// 3. excluded_ingredients
//
// PRD-004 Phase C (P0.7): an excluded ingredient hides a recipe only when
// the matched ingredient appears in ingredients_classified with
// essentiality === 'essential'. This solves the cheeseburger problem:
// excluding 'onion' no longer hides recipes that merely mention it.
//
// Defensive fallback: if ingredients_classified is null or missing
// (a row the Phase A backfill missed; rare post-Phase-A), fall back to
// the pre-Phase-C substring behavior so we don't silently let through
// recipes that genuinely shouldn't pass.
const excludedIngredients = Array.isArray(preferences.excluded_ingredients)
  ? preferences.excluded_ingredients
  : []
if (excludedIngredients.length > 0) {
  const classified = Array.isArray(item.ingredients_classified)
    ? item.ingredients_classified
    : null

  if (classified !== null) {
    // Phase C path: gate on essentiality.
    const essentialNames = classified
      .filter(c => c && c.essentiality === 'essential' && typeof c.name === 'string')
      .map(c => c.name.toLowerCase())
    for (const ing of excludedIngredients) {
      if (typeof ing !== 'string') continue
      const needle = ing.trim().toLowerCase()
      if (!needle) continue
      // Case-insensitive substring on essential names only.
      // Substring (not exact match) so 'onion' matches 'red onion', etc.
      if (essentialNames.some(n => n.includes(needle))) return false
    }
  } else {
    // Pre-Phase-C fallback: substring on the full haystack.
    const haystack = collectIngredientHaystack(item)
    if (haystack) {
      for (const ing of excludedIngredients) {
        if (typeof ing !== 'string') continue
        const needle = ing.trim().toLowerCase()
        if (!needle) continue
        if (haystack.includes(needle)) return false
      }
    }
  }
}
```

### Acceptance criteria (P0.7)

- A recipe with `ingredients_classified` containing `{name: 'onion', essentiality: 'omittable'}` and a user preference `excluded_ingredients: ['onion']` — recipe **passes** (not hidden).
- A recipe with `ingredients_classified` containing `{name: 'onion', essentiality: 'essential'}` and the same preference — recipe **fails** (hidden).
- A recipe with `ingredients_classified === null` and the same preference, where the haystack does include 'onion' — recipe **fails** (defensive fallback to substring behavior).
- A recipe with `ingredients_classified: []` (empty array — classifier ran but found no essentials) — recipe **passes** for any excluded-ingredient preference (no essentials = nothing to gate on).
- All other preference rules (max prep time, excluded cuisines, dietary restrictions) behave identically to before.

### Tests to add (P0.7)

File: `src/lib/__tests__/preferenceFilter.test.js`

Add a new `describe('Phase C — essentiality gating', ...)` block with these cases (use the existing test fixtures' shape, just add the `ingredients_classified` field):

1. `excludes "onion" + recipe has onion as omittable → passes` (the cheeseburger case)
2. `excludes "onion" + recipe has onion as essential → fails` (the onion-rings case)
3. `excludes "onion" + recipe has ingredients_classified === null + haystack contains onion → fails` (defensive fallback)
4. `excludes "onion" + recipe has ingredients_classified === [] → passes` (no essentials)
5. `excludes "onion" + recipe has classified with no onion entry but haystack does → passes` (classifier said it's not on the menu, trust it)
6. Substring variant: `excludes "garlic" + recipe has 'roasted garlic clove' as essential → fails` (substring still works inside the essential-names list)

Keep all existing `passesPreferences` tests green — none should change behavior except the excluded-ingredients block.

---

## P0.8 — Auto-classify on `/api/analyze-recipe` save

### File
`api/_lib/analyzeRecipeHandler.js`

### Current behavior

The handler returns `{ components: { ...parsed, servings, servings_inferred, ingredients_structured } }`. The frontend (`src/lib/analyzeRecipe.js`) returns `data.components`, which gets spread into the new vault row. Today, `ingredients_classified` is **not** in the response — so newly saved recipes have `ingredients_classified: null` until the next backfill run.

### What to change

After the analyze handler successfully extracts `ingredients_structured`, call `classifyIngredients()` directly (same helper used by the classify endpoint) and add `ingredients_classified` to the response. The frontend already spreads `components` into the vault row, so adding the field flows through automatically — verify this is true (see "Frontend write path" below) before declaring done.

### Implementation sketch

```js
// At the top of the file, alongside existing imports:
import { classifyIngredients, ClassifyIngredientsError } from '../../src/lib/classifyIngredients.js'

// Inside createAnalyzeRecipeHandler, after ingredients_structured is resolved
// but before the final res.json(...) call, add:

// PRD-004 Phase C (P0.8): auto-classify ingredients on save so newly added
// recipes don't ship to the filter with ingredients_classified === null.
// Failure here degrades gracefully — we still save the recipe; the next
// backfill run will retry classification.
let ingredients_classified = null
if (Array.isArray(ingredients_structured) && ingredients_structured.length > 0) {
  const ingredientNames = ingredients_structured
    .map(i => i?.name)
    .filter(n => typeof n === 'string' && n.trim().length > 0)
    .map(n => n.trim())
  if (ingredientNames.length > 0) {
    try {
      const result = await classifyIngredients({
        ingredients: ingredientNames,
        recipeName: (parsed.name || name || '').trim() || 'Untitled recipe',
        cuisine: parsed.cuisine_type || null,
        anthropicClient: anthropic,
      })
      // classifyIngredients returns { classifications: [...] } — the array
      // is what the vault column wants.
      ingredients_classified = Array.isArray(result?.classifications)
        ? result.classifications
        : null
    } catch (err) {
      console.error(
        `[api] ${tag} auto-classify failed:`,
        err instanceof ClassifyIngredientsError ? 'parse_failed' : '',
        err?.status || '',
        err?.message || err
      )
      // Fall through with ingredients_classified = null.
    }
  }
}

// Then update the response to include the new field:
return res.json({
  components: {
    ...parsed,
    servings,
    servings_inferred,
    ingredients_structured,
    ingredients_classified,  // NEW (Phase C P0.8)
  },
})
```

### Frontend write path — verify, don't assume

Check that the new `ingredients_classified` field flows from `analyzeRecipe()` → through whatever wrapper the Vault add/edit form uses → into the vault row insert/update. The likely path:

1. `src/lib/analyzeRecipe.js` returns `data.components` (already does).
2. `src/pages/Vault/RecipeForm.jsx` (or whatever invokes analyze) takes the result and writes it to vault.
3. Search the codebase: `grep -rn 'analyzeRecipe\|analyze-recipe' src/pages/Vault/ src/pages/LogMode.jsx`.

If the call sites pass an explicit field whitelist when writing to vault, **add `ingredients_classified` to that whitelist**. If they spread `components` into the row, no change needed — but verify by reading the call site, not by assuming.

### Acceptance criteria (P0.8)

- A POST to `/api/analyze-recipe` with a recipe that produces ≥1 structured ingredient returns a `components` object containing both `ingredients_structured` and `ingredients_classified`.
- `ingredients_classified` is an array of `{name, essentiality, source: 'ai'}` objects matching ADR-002.
- If the classify call fails, the response still succeeds with `ingredients_classified: null` and a server-side error log; the recipe save is **not** blocked.
- A recipe added through the UI (Vault manual-add, Vault URL-paste, LogMode "Save to Cookbook") has `ingredients_classified` populated in the new vault row.
- A recipe with no structured ingredients (analyze returned `ingredients_structured: null` or `[]`) gets `ingredients_classified: null` — no spurious classify call, no error.

### Tests to add (P0.8)

File: `src/lib/__tests__/analyzeRecipeHandler.test.js`

Add a `describe('Phase C — auto-classify chain', ...)` block. Mock the `classifyIngredients` helper (inject via the existing dependency-injection pattern if it exists; otherwise mock the import).

1. `successful chain → response includes ingredients_classified array`
2. `classify call fails → response succeeds with ingredients_classified: null`
3. `analyze returns no structured ingredients → no classify call attempted`
4. `analyze returns structured ingredients with empty/whitespace names → filtered out before classify; if zero remain, no call attempted`

---

## P0.9 — Preferences UI disclaimer

### File
`src/components/Preferences/index.jsx`

### What to change

The "Excluded ingredients" `<Section>` (around line 368 in the current file) has no helper text below the input + chip list. Add a `helper-text italic` paragraph immediately after the chip list, mirroring the wording in PRD-004 P0.9:

> Recipes are hidden only when an excluded ingredient is **essential** to the dish — recipes that just mention it are still shown.

### Implementation

After the closing `</div>` of the `excludedIngredients.map(...)` block (currently around line 400), and before the closing `</Section>`, add:

```jsx
<p className="helper-text italic mt-2">
  Recipes are hidden only when an excluded ingredient is{' '}
  <span className="font-semibold not-italic">essential</span> to the dish —
  recipes that just mention it are still shown.
</p>
```

The `helper-text` class is the design-system primitive established by PRD-005; bolding the word "essential" inline gives the disclaimer a visual anchor.

### Acceptance criteria (P0.9)

- The disclaimer renders below the excluded-ingredients chip list when the user has zero or more ingredients excluded (visible at all times in the section).
- Bold + italic styling matches existing helper-text conventions in the file (see the dietary-restrictions `<p className="helper-text italic mt-2">` pattern in lines 345–349 as the mirror).
- Existing Preferences tests continue to pass. If `Preferences/__tests__/index.test.jsx` asserts on the section's contents, update those assertions to match the new copy.

---

## STATUS.md update (mandatory per Status etiquette)

In the same PR, update `docs/STATUS.md`:

1. **Top of file:** bump the `**Last verified:**` line to today's date and the latest commit hash.
2. **At-a-glance table** (PRD-004 row): change from
   ```
   | PRD-004 | Smarter Ingredient Filtering | 🟡 **Phase A + Phase B shipped** | Phase C (filter behavior change) — the user-visible flip |
   ```
   to
   ```
   | PRD-004 | Smarter Ingredient Filtering | 🟡 **Phase A + B + C shipped** | Phase D (override UI) |
   ```
3. **PRD-004 section:**
   - Move the Phase C bullet from "Pending" to "Shipped":
     ```
     - [x] **Phase C — Filter behavior change** (PR #<your-PR>, commit `<hash>`, P0.7 + P0.8 + P0.9): `passesPreferences` gates excluded-ingredient matches on `essentiality === 'essential'`; `/api/analyze-recipe` auto-classifies on save so new recipes never have NULL `ingredients_classified`; Preferences UI explains the new behavior.
     ```
   - Leave Phase D in Pending.

---

## Branch + commit + PR steps

```bash
# Branch from latest origin/main
git fetch origin
git checkout -b feat/prd-004-phase-c-filter-flip origin/main

# Make the edits (P0.7, P0.8, P0.9, tests, STATUS.md)
# Run tests + lint locally
npm run test:unit -- --run src/lib/__tests__/preferenceFilter.test.js
npm run test:unit -- --run src/lib/__tests__/analyzeRecipeHandler.test.js
npm run test:unit -- --run src/components/Preferences/__tests__/index.test.jsx
npm run lint
npm run lint:ds

# Stage + commit
git add src/lib/preferenceFilter.js \
        src/lib/__tests__/preferenceFilter.test.js \
        api/_lib/analyzeRecipeHandler.js \
        src/lib/__tests__/analyzeRecipeHandler.test.js \
        src/components/Preferences/index.jsx \
        src/components/Preferences/__tests__/index.test.jsx \
        docs/STATUS.md
git commit  # use the suggested message below

# Push and open a PR
git push -u origin feat/prd-004-phase-c-filter-flip
```

### Suggested commit message

```
feat(prd-004): Phase C — flip the filter to gate on essentiality (P0.7+P0.8+P0.9)

The cheeseburger problem fix. Excluded ingredients now hide a recipe
only when the matched ingredient is classified as essential to the dish,
not when the recipe merely mentions it.

- src/lib/preferenceFilter.js: passesPreferences() consults
  ingredients_classified for essential-only matching. Defensive fallback
  to the pre-Phase-C substring behavior when the field is null (a row
  the Phase A backfill missed; rare post-Phase-A).
- api/_lib/analyzeRecipeHandler.js: chains to classifyIngredients()
  after structured-ingredient extraction so newly saved recipes never
  ship with ingredients_classified === null. Classify failures degrade
  to null without blocking the recipe save.
- src/components/Preferences/index.jsx: adds a one-line helper-text
  disclaimer under "Excluded ingredients" explaining the new behavior:
  hidden iff essential.

Closes the user-visible work for PRD-004 Phase C. Phase D (override UI)
remains queued — relief valve for false hides if the 85% precision
floor produces noticeable problems in real use.
```

### Suggested PR description

```markdown
## Why

The "cheeseburger problem": with the existing `passesPreferences`, excluding "onion" hides recipes that merely mention onion (cheeseburgers) along with recipes where onion is structural (onion rings). PRD-004 Phases A and B built the AI ingredient classifier to distinguish *essential* from *omittable* ingredients. Phase C flips the filter to use it.

## What

- **P0.7** — `passesPreferences` now gates excluded-ingredient matches on `ingredients_classified[].essentiality === 'essential'`. Defensive fallback to the pre-Phase-C substring path when the field is null (rare post-Phase-A backfill).
- **P0.8** — `/api/analyze-recipe` auto-classifies ingredients server-side after structured extraction. New recipes never have `ingredients_classified === null`; classify failures degrade gracefully to null without blocking the save.
- **P0.9** — Preferences UI adds a one-line disclaimer explaining the new behavior under "Excluded ingredients."

## What's NOT in this PR

Phase D (per-recipe override UI). Phase D is the proper escape hatch if the 85% precision floor produces wrongful hides. Queued as the next item.

## Verification

- `npm run test:unit` — green; new test cases for the cheeseburger / onion-rings / null-fallback / empty-classified scenarios.
- `npm run lint:ds` — zero violations.
- Smoke test on the test user (see PR description below): excluded "onion" with a known cheeseburger recipe present → recipe stays visible. Same preference with a known "Onion Rings" recipe → recipe hidden.
- Preview deploy via Vercel MCP — pull runtime logs after a real recipe save and confirm the auto-classify chain executed (look for `[api] analyze-recipe` log entries).

## Out of scope

Backfill re-run for any rows where `ingredients_classified IS NULL` — already handled by `npm run backfill:structured-ingredients` (PRD-006) and the per-row backfill from Phase A.
```

---

## Smoke test (do this AFTER the preview deploy is up; report findings in the PR description)

You'll need the test user's credentials from `.claude/test-credentials.md` and the Vercel preview URL (fetch via Vercel MCP, don't guess).

1. **Cheeseburger case (the bug fix):**
   - Sign in as the test user.
   - Add (or confirm exists) a vault recipe whose ingredients_classified marks onion as omittable. Cheeseburger is the canonical example. If the test user doesn't have one, add it via "Add recipe" → URL paste of any cheeseburger recipe; the auto-classify chain (P0.8) will populate `ingredients_classified`.
   - Go to Settings → add "onion" to Excluded ingredients.
   - Open Brainstorm → tap a day → confirm the cheeseburger recipe **appears** in the candidate list (the bug pre-Phase-C: it was hidden).

2. **Onion-rings case (the negative test):**
   - Same vault, but find or add a recipe whose ingredients_classified marks onion as essential. "Onion Rings" or "French Onion Soup" are canonical.
   - Same exclusion in Preferences ("onion").
   - In Brainstorm → confirm that recipe is **hidden** from the candidate list.

3. **Disclaimer rendering:**
   - In Settings → Excluded ingredients section → the new disclaimer reads "Recipes are hidden only when an excluded ingredient is **essential** to the dish — recipes that just mention it are still shown." with `essential` bolded.

4. **Preview-deploy log spot-check:**
   - Pull runtime logs from the Vercel preview deployment (via MCP). Look for `[api] analyze-recipe` entries. If any show "auto-classify failed", the chain has a real bug — investigate before merging.

Report the smoke-test results in the PR description before requesting review.

---

## Known gotchas

1. **85% accuracy floor.** Phase B's threshold is precision on 'essential' ≥ 0.85. That means ~15% of recipes can have wrong essential calls; some will be false essentials (recipes wrongly hidden when an ingredient is excluded). Phase D (override UI) is the relief valve. If wrongful hides become annoying in real use, escalate Phase D's priority.

2. **Latency budget.** PRD-004 §Success Metrics states recipe-add latency should stay <3s end-to-end. The auto-classify chain adds a Haiku 4.5 call (~1s) on top of the Sonnet 4.6 analyze call (~2-3s). If you observe >4s on real recipes, consider:
   - Moving the classify call to fire-and-forget (return analyze immediately; classify writes to vault async). Bigger architectural change; defer to P1.2 in PRD-006 (reparse latency UX).

3. **The defensive fallback path is reachable in production only for rows the backfill missed.** Phase A's backfill (`npm run backfill:structured-ingredients`) populates the column for existing rows; P0.8 populates it for new rows. The fallback exists for safety, not because we expect to hit it. If the smoke test catches a recipe with `ingredients_classified === null`, run the backfill before declaring Phase C smoke-test complete.

4. **`classifyIngredients` is a direct import, not an HTTP call.** Don't add a `fetch('/api/classify-ingredients')` call inside the analyze handler — both endpoints already share the helper. The handler chains the helper directly. Keeps latency tight and avoids a self-fetch loop on Vercel.

5. **Preview Branch SQL needed?** No new schema in this phase. The `ingredients_classified` column already exists from Phase A. No migration, no verify SQL, no Supabase MCP work beyond the read-only checks above.

6. **STATUS.md is a release blocker.** Per `CLAUDE.md` Status etiquette: this PR must update `docs/STATUS.md`. If you forget, the PR doesn't merge.

---

## When done

Report back with:
- The PR URL.
- Vercel preview deploy URL + status (passing).
- Smoke-test findings (cheeseburger case + onion-rings case + disclaimer + log spot-check).
- Any latency observations from the preview deploy.

If anything in the prompt doesn't match the codebase (a renamed file, a different existing pattern, etc.), **stop and ask** rather than guessing. The CLAUDE.md "When in doubt" rule applies.
