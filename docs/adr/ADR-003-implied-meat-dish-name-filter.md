# ADR-003: Implied-Meat Dish-Name Filter (Vegetarian / Vegan / Pescatarian)

**Status:** Accepted
**Date:** 2026-04-28
**Deciders:** Matt (El Presidente)
**Related:** PRD-002 P0.3 (`passesPreferences`); ADR-002 / PRD-004 (ingredient essentiality classifier)

---

## Context

PRD-004 adds a per-ingredient essentiality classifier (`vault.ingredients_classified`) so that excluded-ingredient preferences only hide a recipe when the excluded ingredient is *essential* to the dish. The classifier prompt explicitly treats certain dish-form categories as substitutable — e.g. for a meatballs-style dish "any meat is fine, the dish is the meatball form, not the specific meat," so the classifier marks the meat ingredient as **omittable**.

That is the right call for the excluded-ingredient filter (a beef-excluder shouldn't hide turkey meatballs simply because the household's saved version uses beef). But it creates a new failure mode for dietary restrictions:

- A "Smash burger" or "Meatloaf meatballs" recipe has its meat ingredient marked omittable.
- A naive future implementation that says "vegetarian fails when an essential meat is present" lets it through.
- The dish is structurally a meat dish; no household-preference layer should treat it as vegetarian-eligible.

The two signals are different questions:

1. **"Is this specific ingredient essential to this dish?"** — answered by `ingredients_classified` (PRD-004).
2. **"Is this dish vegetarian-compatible?"** — answered by the dish's *category*, which is upstream of the ingredient list. Burgers, meatballs, meatloaf, BLTs, carnitas, etc. are non-vegetarian by name regardless of which protein the household swaps in.

The current filter (`passesPreferences` in [src/lib/preferenceFilter.js](../../src/lib/preferenceFilter.js)) only consults `proteins` mapped through `PROTEIN_CATEGORIES`. That works when the vault row has accurate protein tagging, but:

- Manually-added recipes can be under-tagged (proteins=[] or missing).
- Future filter evolution that consults `ingredients_classified` (under any well-meaning rewrite) would inherit the substitutable-protein blind spot.

We need a second signal that catches dish-form-implies-meat at the recipe level, layered onto the existing protein check.

---

## Decision

Add a **name-keyword layer** to `passesPreferences` that runs alongside the existing protein-category check for the vegetarian / vegan / pescatarian dietary restrictions. Implement as a deterministic substring scan against `item.name`, with two override sources for false-positive guard:

1. **Positive `dietary_tags` override.** If the recipe's `dietary_tags` already includes `'Vegetarian'` (for vegetarian/vegan checks) or `'Vegan'` (for vegan checks), skip the keyword scan. The AI tagging in `/api/analyze-recipe` and any user-set tag are both load-bearing — when the recipe has been audited as vegetarian, "burger" in the name (Beyond burger, black-bean burger) should not block.
2. **Positive name-token override.** If the recipe's name contains an explicit vegetarian-positive marker (`veggie`, `vegan`, `vegetarian`, `plant-based`, `meatless`, `tofu`, `tempeh`, `seitan`, `beyond`, `impossible`), skip the keyword scan. Catches the under-tagged case where the user named the recipe descriptively but didn't tick the dietary tag.

Two keyword categories, mirroring the existing `PROTEIN_CATEGORIES` split:

- `meat`-implying tokens (meatball, meatloaf, burger, bacon, BLT, carnitas, sausage, brisket, gyro, etc.) — fail vegetarian, vegan, AND pescatarian.
- `seafood`-implying tokens (scampi, sushi, sashimi, poke, ceviche, lobster roll, etc.) — fail vegetarian and vegan only; pescatarian still passes.

Vocabulary lives in `src/lib/constants.js` so adding a token is a code change with no migration. App-level only; no DB schema work.

This is purely additive: existing protein-based pass/fail remains; the name layer is a second gate, not a replacement.

---

## Options Considered

### Option 1: Recipe-level AI dietary classification

Extend `/api/analyze-recipe` (or add a new endpoint) to emit a structured `dietary_compatibility: {vegetarian: 'yes' | 'no' | 'unknown', vegan: ...}` field per recipe. Filter consults this directly.

**Pros:**
- Captures nuance the keyword list can't (e.g. fish-sauce in a Thai vegetable curry).
- Single source of truth at the recipe level.

**Cons:**
- New AI call on every recipe-add (analyze-recipe is already one; this would extend the prompt or add a second call).
- Backfill required for existing rows.
- AI subjectivity on edge cases ("is shrimp paste in pad thai a hard veg disqualifier?") may produce inconsistent results.
- Re-introduces the same "trust the AI" coupling the PRD-004 override UI is built to manage. Doing the same dance twice for adjacent signals is fragile.
- Solves a problem we don't have today: the keyword list catches the salient failure cases (burgers, meatballs, BLTs, carnitas) deterministically. AI nuance is over-engineering for a personal-scale app.

### Option 2: Keyword list of meat-implying dish-name tokens (selected)

Substring match against `item.name`, with positive overrides via `dietary_tags` and name tokens. See "Decision" above.

**Pros:**
- Deterministic. No AI dependency, no per-recipe cost, no backfill.
- Fast to ship (~1 prompt). Easy to extend (add a token, ship a release).
- The override list elegantly handles the false-positive cases ("Veggie burger", "Beyond burger", "Black-bean burger") without adding ranking nuance.
- Layers cleanly on top of the existing protein check — purely additive, no refactor of the current filter.

**Cons:**
- Dictionary maintenance: new dish names not in the list slip through. Acceptable for a personal vault — drift will surface as misses, fixable in a one-line PR.
- Substring matching has the standard pitfalls (`bass` in `pasta basics`?). Mitigated by curating tokens carefully (whole words, distinctive forms — "meatball" not "meat") and the override path.
- Doesn't catch dishes where the meat is *implied* but the name doesn't say so (e.g. "Sunday gravy" = Italian-American meat sauce). Same as today; no regression.

### Option 3: Combine both signals in filter logic

Same as the existing protein check + an AI signal + a keyword list, all consulted together. This isn't a separate option so much as an architectural framing for Options 1 + 2 — and given Option 2 alone fixes the failure mode at near-zero cost, layering Option 1 on top is premature.

**Verdict:** Option 1 may revisit later if Option 2's drift becomes painful (signal: heavy override-correction frequency on dish-name decisions, or many manually-tagged false negatives). For now, Option 2 alone.

---

## Trade-off Analysis

The core trade-off is **maintenance burden of a curated keyword list (Option 2)** vs **AI cost + accuracy risk + backfill (Option 1)**.

For a single-household vault (likely <500 recipes ever), the keyword list will catch ~95% of the relevant failure cases with a 30-line constant. New tokens get added when new dishes surface — no migration, no eval set, no prompt-tuning loop. The override-list mechanism (`dietary_tags` + positive name tokens) handles the false positives that worried us most ("Beyond burger" type recipes) without algorithmic complexity.

Option 1's appeal is precision: an AI can read "the recipe contains 2 tbsp anchovy paste" and correctly call out a Caesar salad as non-vegetarian. But:
- Most of the household's vegetarian-relevant blocking is dish-form ("we don't eat burgers Tuesday → don't show me cheeseburgers"), not trace-ingredient analysis.
- The cheeseburger-style failure mode is *exactly* what dish-name catches.
- We already have AI calls in the recipe-add flow (analyze-recipe + classify-ingredients in PRD-004 Phase C). A third call would push recipe-add latency past the <3s target in PRD-004's success metrics.

Option 2 is a strict win on cost-per-correctness for the first cohort of failures. If Option 1 ever becomes warranted, the keyword list and AI signal can coexist (the keyword list as a hard fail, the AI signal as an additional fail or as input to the override list).

---

## Consequences

**What becomes easier:**
- The vegetarian / vegan / pescatarian filters correctly block dish-form-implies-meat recipes regardless of how the protein tagging or future ingredient essentiality is set.
- The PRD-004 Phase C flip (filter consults `ingredients_classified`) becomes safe to ship without re-introducing the meatballs-as-vegetarian leak.
- Anyone reading the filter can see the full vegetarian decision tree in one file: protein category → name keyword → pass.

**What becomes harder:**
- Dictionary drift: when a new dish enters the household vocabulary, the keyword list may need updating. This is a known cost; the alternative is paying an AI call per recipe.
- A user creating a recipe named "Steak House Salad" (where "steak" is a dressing-style descriptor rather than the meat) would be wrongly blocked. Mitigation: the override list catches the worst false positives; for ambiguous cases, the user can tag it `Vegetarian` in `dietary_tags` and the keyword check is bypassed.

**What we'll need to revisit:**
- If override-tag usage frequency spikes (signal: user constantly setting `dietary_tags = ['Vegetarian']` to bypass the keyword block), revisit Option 1.
- If new vegetarian-positive dish forms not on the override list become common ("seitan steak", "jackfruit pulled-pork"), extend the override-token list.
- The keyword list should be reviewed alongside any future expansion of `PROTEIN_CATEGORIES` (they're conceptually paired).

---

## Action Items

1. [x] Write this ADR (status: Accepted).
2. [ ] Add `MEAT_IMPLIED_NAME_KEYWORDS` (split by `meat`/`seafood`) and `VEGETARIAN_NAME_OVERRIDES` to `src/lib/constants.js`.
3. [ ] Extend `violatesDietary` in `src/lib/preferenceFilter.js` with the name-keyword layer + override checks for vegetarian / vegan / pescatarian.
4. [ ] Add unit tests in `src/lib/__tests__/preferenceFilter.test.js` covering: positive cases (Smash burger fails vegetarian), override via `dietary_tags`, override via positive name token, pescatarian-allows-seafood-keywords, no-regression on existing protein-based behavior.
5. [ ] Update PRD-004 with a pointer to this ADR in the "Out of Scope (v1)" / addendum section, so the dietary-tag-vs-essentiality distinction is captured alongside the ingredient classifier work.
6. [ ] Update `docs/schema.md` only if a schema change becomes necessary (it does not — this is app-layer only).
