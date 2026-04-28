# ADR-002: Ingredient Classification for Smarter Preference Filtering

**Status:** Proposed
**Date:** 2026-04-27
**Deciders:** Matt (El Presidente)
**Related:** PRD-002 P0.3 (current strict filter); PRD-004 (implementation plan)

---

## Context

PRD-002 P0.3 shipped on 2026-04-27 with a strict substring-match implementation of `excluded_ingredients`: any recipe whose ingredient list contains an excluded term (case-insensitive substring) is hidden from recommendations. The PRD explicitly accepted this limitation ("hard filter, no soft fallback in v1") with the assumption that real use would surface frustration if any.

The frustration surfaced immediately, before deploy: excluding "onion" correctly hides onion rings (where onion is structural), but also hides cheeseburgers (where onion is incidental and easily omitted). The same problem extends to most non-defining ingredients across the vault — the filter punishes recipes for *mentioning* an ingredient rather than *requiring* it.

The root cause: the vault has no representation of which ingredients are essential to a dish vs. which are easily omittable. Substring matching is the wrong tool for the job; we need data the substring matcher doesn't have.

### Forces at play

- **Mobile-first personal app, single household.** Scale is small (likely <500 vault items ever); cost ceilings on AI calls are not meaningful constraints.
- **AI is already in the stack.** `/api/analyze-recipe` (Sonnet 4.6) and `/api/swap-suggestions` (Haiku 4.5) are wired and trusted. Adding a third LLM endpoint is well-trodden ground.
- **Novice solo developer.** Solutions that require multi-week schema migrations or third-party services would stall.
- **PRD-002 P0.3 just shipped its filter.** Whatever we do, we need a path that doesn't break the current behavior until we're confident in the replacement.

---

## Decision

Adopt **AI-driven binary ingredient classification** with the following shape:

1. Each vault recipe gains an `ingredients_classified jsonb` column. Shape: `[{name: string, essentiality: 'essential' | 'omittable', source: 'ai' | 'user'}, ...]`.
2. A new `/api/classify-ingredients` endpoint (Haiku 4.5) takes a recipe's ingredient list and returns the classifications.
3. Existing vault rows get a one-time bulk backfill pass at deploy.
4. New recipes (added via `/api/analyze-recipe` or manually) auto-classify on save.
5. The preference filter (`passesPreferences`) is updated to consult `ingredients_classified` — an excluded ingredient hides the recipe **only if** it appears as `essential` in that recipe.
6. The recipe detail page exposes an override UI per ingredient. User overrides persist with `source: 'user'` and survive future AI re-classifications.
7. Before the filter behavior change ships, we validate AI accuracy against a 20–30 recipe ground-truth set assembled by the user. Threshold: ≥85% precision on the "essential" call. ("Essential" precision matters most because false-essentials cause wrongful hiding — the exact failure mode we're solving.)

This is overrode of the PRD-002 P0.3 decision *"hard filter, no soft fallback in v1"* — captured in PRD-004.

---

## Options Considered

### Option A: Soft penalty for excluded ingredients

Convert `excluded_ingredients` from a hard filter into a score deduction (e.g., `-25 × matchCount`). Recipes with the ingredient sink in ranking but stay visible.

| Dimension          | Assessment                                  |
|--------------------|---------------------------------------------|
| Complexity         | Low — one weight constant + one filter swap |
| Cost               | Zero ongoing                                |
| Scalability        | Fine                                        |
| Team familiarity   | High — matches P0.5 scoring pattern         |
| Time to ship       | ~1 day                                      |

**Pros:**
- Cheapest fix; no schema change, no AI dependency.
- Reversible.

**Cons:**
- Treats the symptom (recipes ranked too high) rather than the cause (we don't know if the ingredient is essential).
- Onion rings and cheeseburgers both get penalized; tuning the penalty to handle both gracefully is fundamentally impossible.
- Users still see "wrong" recipes near the top of the list when penalties are mild, or lose recipes entirely when penalties are severe.

### Option B: AI classification (selected)

Classify each ingredient as essential/omittable via LLM. Filter only on essential matches. See "Decision" above.

| Dimension          | Assessment                                                    |
|--------------------|---------------------------------------------------------------|
| Complexity         | Medium — schema, endpoint, backfill, filter, override UI      |
| Cost               | One-time backfill ~$0.50–$2; ongoing ~negligible per recipe   |
| Scalability        | Fine for personal app                                         |
| Team familiarity   | Medium — third LLM endpoint, but follows existing patterns    |
| Time to ship       | ~4 prompts (≈ 1–2 weeks of evening work)                      |

**Pros:**
- Addresses root cause; filter actually understands the data.
- Single source of truth (JSONB column) enables future extensions (substitutability, AI confidence, dietary tags).
- Override UI provides trust and accuracy via human-in-the-loop.
- Validation gate prevents shipping a bad model.

**Cons:**
- Depends on AI consistency; subjective judgments ("is celery essential to mirepoix?") will sometimes feel wrong.
- New schema, new endpoint, new code path to maintain.
- Adds an AI call to every recipe-add flow.
- Ongoing cost per recipe add (small but non-zero).

### Option C: Quantity-aware filter

Use ingredient quantities (when present) to gate the filter — e.g., recipes where the excluded ingredient is <1 tsp pass; ≥1 cup fail. Requires structured `[{name, quantity, unit}]` ingredient data, which is deferred to PRD-003 P2.1.

| Dimension          | Assessment                                  |
|--------------------|---------------------------------------------|
| Complexity         | High — depends on PRD-003 P2.1 first        |
| Cost               | Modest — unit-math is fiddly but bounded    |
| Scalability        | Fine                                        |
| Team familiarity   | Low — unit conversion is its own rabbit hole|
| Time to ship       | Blocked on PRD-003 P2.1                     |

**Pros:**
- Principled and quantitative; no AI subjectivity.
- Falls naturally out of structured ingredient data the app would have anyway.

**Cons:**
- Hard prerequisite on PRD-003 P2.1 (deferred); blocks any improvement until that lands.
- Quantity isn't a perfect proxy for essentiality — a recipe could have "2 tbsp soy sauce" as a defining ingredient.
- Doesn't help ingredients without quantities (free-text fallbacks).

### Option D: Manual user tagging

User explicitly marks each ingredient essential/omittable when adding a recipe.

| Dimension          | Assessment                                  |
|--------------------|---------------------------------------------|
| Complexity         | Low engineering, high UX burden             |
| Cost               | Zero                                        |
| Scalability        | Fine technically                            |
| Team familiarity   | High                                        |
| Time to ship       | ~1 prompt for UI                            |

**Pros:**
- 100% accuracy by definition.
- No AI cost or accuracy concerns.

**Cons:**
- High data-entry friction — adding a recipe currently takes <1 min; this would double or triple that.
- Backfill is impossible without manually re-tagging every existing recipe.
- Users will skip it inconsistently, leaving filter behavior unpredictable.

---

## Trade-off Analysis

The core trade-off is **simplicity now (Option A) vs. correctness over time (Option B)**.

Option A is a tactical patch — it makes the symptom less acute without giving the system the data it needs to actually be smart. Tuning a single penalty constant to handle "onion rings" and "cheeseburgers + a sprinkle of onion" gracefully is impossible because they're the same recipe to the substring matcher.

Option B is a structural fix that moves the system forward. It pays a real cost (schema change, new endpoint, validation work, AI accuracy risk) in exchange for a filter that genuinely understands the data. The override UI and validation gate manage the AI risk without overengineering.

Option C is the most principled long-term answer but is gated on infrastructure that doesn't exist yet (PRD-003 P2.1, currently deferred). Returning to this if AI classification proves unreliable is a reasonable retreat path.

Option D is rejected because it shifts the burden to the user in a way that the entire app's design avoids — recipe entry is supposed to be fast, including via `/api/analyze-recipe` URL parsing.

The decision to go with Option B is grounded in: (a) the personal-scale of the app makes AI cost trivial; (b) the existing AI infrastructure makes adding a third endpoint cheap; (c) the validation gate de-risks the accuracy concern; and (d) the override UI provides a fallback when the AI is wrong.

---

## Consequences

**What becomes easier:**
- The filter can finally distinguish essential from incidental ingredients. The cheeseburger problem disappears.
- Future preference improvements can layer on the same JSONB shape — substitutability, dietary tags, allergen flags — without further schema migration.
- User overrides give a concrete affordance for the inevitable AI mistakes.

**What becomes harder:**
- Maintenance surface increases: a new endpoint, a new schema column, a backfill script, a validation methodology, classification override UI.
- Recipe-add latency increases by one AI call (Haiku is fast — likely <1s — but it's a new failure mode to handle).
- "Why isn't this recipe showing up?" debugging now needs to consider the classification, not just the ingredient list.

**What we'll need to revisit:**
- If AI accuracy fails the 85% precision threshold, fall back to a graded taxonomy (signature/standard/omittable) or wait for PRD-003 P2.1 + Option C.
- If users override the AI heavily on a particular ingredient (signal: "onion" overridden as omittable in 80%+ of recipes), the AI prompt should be tuned accordingly.
- The `source: 'ai' | 'user'` provenance flag will eventually need a `last_classified_at` timestamp if/when we re-classify periodically as the AI improves.
- Multi-user-per-household (per partner-collab ADR) will introduce conflicting overrides — defer that decision until the partner-collab work is real.

---

## Action Items

1. [ ] Approve this ADR (status → Accepted).
2. [ ] Update `RECIPE_TODOS.md`: convert the existing P0.13 line item to a pointer at PRD-004.
3. [ ] Write PRD-004 (parallel to this ADR).
4. [ ] Phase A: ship schema migration + `/api/classify-ingredients` + bulk backfill (no behavior change).
5. [ ] Phase B: assemble ground-truth set; run accuracy eval; tune AI prompt until ≥85% precision.
6. [ ] Phase C: flip `passesPreferences` to consult classifications; wire `/api/analyze-recipe` to auto-classify new recipes; update Preferences disclaimer.
7. [ ] Phase D: ship override UI on recipe detail page.
8. [ ] Re-evaluate after 30 days of real use — measure override frequency to detect prompt-tuning candidates.
