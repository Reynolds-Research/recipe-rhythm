# PRD-004: Smarter Ingredient Filtering

**Status:** Draft
**Date:** 2026-04-27
**Author:** Matt (El Presidente)
**Related:** ADR-002 (decision rationale); ADR-003 (paired dish-name layer for vegetarian / vegan / pescatarian); supersedes the proposed PRD-002 P0.13 line item; depends on PRD-002 P0.3 (current filter)

---

## Problem

The preference filter shipped in PRD-002 P0.3 hides any recipe whose ingredient list contains an excluded ingredient as a substring. This is too strict in the most common case: excluding "onion" hides cheeseburgers (where onion is incidental and easily omitted) along with onion rings (where it's structural). Users either (a) live with wrongful hiding, (b) skip excluded-ingredient prefs entirely, or (c) lose trust in the filter.

The fix needs to distinguish **essential** ingredients (defining the dish) from **omittable** ones (incidental). The vault doesn't capture this distinction today.

## Decision

Use AI to classify each vault recipe's ingredients as essential or omittable. Store as `ingredients_classified jsonb`. Update the filter to gate only on essential matches. Provide user override. Validate accuracy before flipping the filter behavior.

Full design rationale and alternatives in **ADR-002**.

## Hard Prerequisites

- **PRD-002 P0.3** (preference filter using `passesPreferences`) — shipped 2026-04-27. PRD-004 modifies that function; it must exist first.
- **PRD-001 P0.6** (centralized constants) — shipped. AI prompt interpolates from constants.
- **`/api/analyze-recipe` and `/api/swap-suggestions` patterns** — these are the reference implementations the new endpoint follows.

## Phases

### Phase A — Foundation (ships safely; no user-visible behavior change)

- **P0.1: Schema migration.** New column `vault.ingredients_classified jsonb` (nullable). Existing rows are NULL until backfill runs.
- **P0.2: `/api/classify-ingredients` endpoint (Haiku 4.5).** Accepts an array of ingredient names; returns `[{name, essentiality, source: 'ai'}, ...]`. Vercel mirror at `api/classify-ingredients.js`. Prompt asks the model to mark essential = "removing it would make the dish a different dish" and omittable = "the dish would still be recognizable without it."
- **P0.3: Bulk backfill script.** A standalone Node script (or admin button) that iterates every vault row with `ingredients_classified IS NULL`, calls the new endpoint, and writes the result. Idempotent. Resumable on failure.

**Definition of done for Phase A:** every vault row has a non-null `ingredients_classified` value; the filter still uses the old logic.

### Phase B — Validation gate (no code change after the prompt is tuned)

- **P0.4: Ground-truth assembly.** User picks 20–30 representative recipes from the vault and manually classifies each ingredient. Stored as a fixture file (`tests/fixtures/ingredient-classification-truth.json`).
- **P0.5: Accuracy eval script.** Runs `/api/classify-ingredients` against the ground-truth set; computes precision/recall on the "essential" call. Reports per-ingredient accuracy.
- **P0.6: Prompt tuning loop.** Iterate the system prompt in the endpoint until precision on "essential" is ≥85%. (False essentials are the failure mode that causes wrongful hiding — the exact problem we're solving.)

**Definition of done for Phase B:** accuracy threshold met; tuned prompt committed; eval script runnable on demand.

### Phase C — Filter behavior change (this is when users see something different)

- **P0.7: Update `passesPreferences`.** Replace the substring match against the raw ingredients list with a check against `ingredients_classified`: an excluded ingredient hides the recipe only if it matches an entry where `essentiality === 'essential'`. Recipes with `ingredients_classified === null` (shouldn't exist post-Phase A but defensive) fall back to the old substring behavior.
- **P0.8: Wire `/api/analyze-recipe` to auto-classify on save.** When a new recipe is added (via URL parse or manual entry), the analyze endpoint also calls `/api/classify-ingredients` and writes both fields together.
- **P0.9: Update the Preferences UI disclaimer.** The "strict match" note added in P0.3 changes to: "Recipes are hidden only when an excluded ingredient is essential to the dish — recipes that just mention it are still shown."

**Definition of done for Phase C:** the cheeseburger problem is gone in real use.

### Phase D — Override UI (trust + accuracy via human-in-the-loop)

- **P0.10: Recipe detail classification display.** Each ingredient on the recipe detail page shows its current essentiality (small icon or label).
- **P0.11: Override toggle.** Tapping the indicator flips essentiality and writes the ingredient back to JSONB with `source: 'user'`.
- **P0.12: Re-classification respects user overrides.** When the bulk backfill or auto-classify runs over a recipe that has user-overridden ingredients, those entries are preserved unchanged.

**Definition of done for Phase D:** PRD-004 is fully shipped.

## P1 Polish (defer until each is actually demanded)

- **P1.1: Per-recipe override review.** Surface "this recipe has user overrides" indicator in the vault list.
- **P1.2: Override frequency analytics.** Internal-only — log which ingredients get overridden most often as a signal for prompt tuning.
- **P1.3: AI confidence score.** Extend the endpoint to return a confidence (0–1); UI shows low-confidence classifications in muted styling, prompting user review.
- **P1.4: Periodic re-classification.** Quarterly cron that re-runs classification on `source: 'ai'` ingredients (skips user overrides). Captures AI improvements over time.

## Adjacent Work — ADR-003 (Implied-Meat Dish-Name Filter)

The PRD-004 essentiality classifier marks individual ingredients as `essential` or `omittable`. For substitutable-category dishes (meatballs, burgers, meatloaf), the prompt deliberately marks the meat ingredient as omittable — "any meat for meatballs/burgers" — because the dish form is what defines the recipe, not the specific protein.

This is correct for excluded-ingredient filtering (a beef-excluder shouldn't hide turkey meatballs). It is **not** sufficient for dietary-restriction filtering: a vegetarian filter consulting only essentiality would let "Smash burger" through. **ADR-003** addresses this gap with a dish-name keyword layer that runs alongside the existing protein-category check in `passesPreferences`. App-layer only; no schema change. See [ADR-003](../adr/ADR-003-implied-meat-dish-name-filter.md) for the full rationale and trade-offs (notably the rejected per-recipe AI dietary classifier).

ADR-003 is independent of PRD-004's phase plan — it can ship before, during, or after Phase C without coupling. Reflected here so future work on dietary tags or essentiality stays aware of the two-signal split.

## Out of Scope (v1)

- Graded taxonomy (signature / standard / omittable) — binary chosen for AI consistency. Revisit if accuracy hits a ceiling.
- Substitutability metadata ("nuts can be replaced with seeds"). UI affordance only; doesn't help the filter. Premature.
- Quantity-aware filtering. Belongs to PRD-003 P2.1 (structured ingredients). If/when that lands, this PRD's classifications can layer on top.
- Multi-user / partner override conflicts. Wait for partner-collab ADR.
- Allergen-specific tagging (gluten-free, nut-free, etc.) — would benefit from this infrastructure but is its own product surface.

## Open Questions

- **OQ.A: When a recipe is added with no ingredient list (e.g., a stub entry), does classification skip or persist `ingredients_classified = []`?** Recommendation: persist `[]` so the filter has a definitive answer (no essential ingredients = no hide).
- **OQ.B: What's the right response when the eval set fails the 85% threshold?** Options: tune the prompt further, lower the threshold (with documentation), retreat to Option A (soft penalty), or pause for PRD-003 P2.1. Recommendation: tune for at most 2–3 iterations; if still failing, escalate decision before lowering threshold.
- **OQ.C: Should `/api/swap-suggestions` AI candidates also receive classifications?** They don't yet (they're transient suggestions, not vault items). If a user accepts a swap suggestion into the vault, the auto-classify in Phase C P0.8 catches it. No special handling needed.
- **OQ.D: Backfill cost for very large vaults — bound the per-run batch?** For personal-scale, irrelevant. If we ever multi-tenant, batching becomes important.

## Success Metrics (informal)

- The cheeseburger problem disappears in real use (qualitative — your kitchen, your call).
- User overrides are infrequent — say <10% of classified ingredients ever get overridden. High override rates indicate prompt-tuning needed.
- Recipe-add latency stays acceptable (<3s end-to-end, including the new classification call).
