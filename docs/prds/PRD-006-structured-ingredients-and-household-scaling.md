# PRD-006: Structured Ingredients & Household Scaling

**Status:** Draft v0.1
**Author:** Matt (El Presidente)
**Date:** 2026-05-04 (retrospective authoring; the bulk of P0 shipped 2026-05-03 → 2026-05-04)
**Sibling PRDs:** [PRD-003](./PRD-003-grocery-tracking.md) — Grocery Tracking (this PRD unblocks PRD-003 P2.1); [PRD-002](./PRD-002-meal-planning.md) — Meal Planning (host of `household_preferences`); [PRD-004](./PRD-004-smarter-ingredient-filtering.md) — Smarter Ingredient Filtering (sibling consumer of `vault` extensions)
**Related ADRs:** none directly — but the chip-grounding architecture introduced here (Path D1) will likely earn an ADR if a successor path D2 ships.

---

## 1. Problem Statement

PRD-003 shipped a Hybrid AI-generated grocery list that worked from each recipe's *categorical* ingredient tags (proteins, vegetables, dairy, etc.). This was acceptable for v1 but left two known limits called out as P2 deferrals:

1. **No structured per-recipe ingredients.** Quantities were rough and not auditable per recipe. The AI generator had to guess "two pounds of chicken" from the recipe name and the categorical tag, with no recipe-specific signal. Users couldn't edit quantities meaningfully without changing the underlying recipe text. Even after `vault.ingredients_structured` was populated (Bite α, P0.1) and household scaling wired in (Bite γ, P0.7), the grocery-list page was still sending only ingredient *names* — the actual extracted quantities sat in the DB but never reached the prompt. Bite δ (P0.8) closes that loop.
2. **No household-size scaling.** Recipes default to a single yield (~4 servings); a 2-adult, 1-child household doing a 5-day meal plan got a list calibrated for nobody in particular. The categorical model had no way to scale because it had no quantity baseline to scale *from*.

PRD-006 introduces the structured-ingredients foundation that PRD-003 P2.1 deferred, plus the household-composition data model needed to scale grocery quantities sensibly.

**Core architectural decision:** the human-readable `vault.ingredients text[]` remains the source of truth; the structured form is AI-derived from it. Users continue to edit a free-text ingredient list (the way they always have), and the system gets a machine-readable view "for free" via re-parse. This keeps capture friction at zero while unlocking quantitative downstream features.

## 2. Current State (As Built — pre-PRD-006 snapshot)

> Captures the state on `main` immediately before this PRD's work began (2026-05-02). Each row was addressed by P0.1–P0.6 below.

| Surface | Lives at | What it did | Key issue this PRD addresses |
|---|---|---|---|
| `vault` schema | `supabase/migrations/` | `ingredients text[]` (free-text), categorical tag arrays (`proteins`, `vegetables`, etc.), `prep_time_minutes` (PRD-002 P0.4), `family_rating` (PRD-001 P1.1). | No structured (machine-readable) ingredient list. No recipe yield (servings). |
| `household_preferences` schema | PRD-002 P0.1 | `dietary_restrictions`, `excluded_ingredients`, `excluded_cuisines`, `max_prep_time_minutes`, `pantry_staples` (Phase 2 wiring). | No household composition (adults / children) → no scaling signal. |
| `/api/analyze-recipe` | `api-server.mjs` + `api/analyze-recipe.js` | Sonnet 4.6, returned categorical tags only. Express + Vercel routes had divergent inline implementations. | No structured-ingredient extraction. No yield extraction. Two copies of the same logic to keep in sync. |
| `/api/grocery-list` | `api-server.mjs` + `api/grocery-list.js` (PRD-003 P0.3) | Haiku 4.5, returned `[{name, quantity (free-text), section, source_recipes}]`. Quantities estimated from recipe names alone. | No per-recipe quantity baseline → can't scale by household size. |
| Recipe edit (`RecipeForm.jsx`) | `src/pages/Vault/` | Editing the `ingredients text[]` was a pure write — nothing downstream re-derived. | Once `ingredients_structured` exists, edits to the source-of-truth list must trigger re-parse to keep the structured view in sync. |

## 3. Goals

1. **Add a structured, machine-readable per-recipe ingredient representation** without changing how users edit recipes (free text stays the source of truth).
2. **Capture household composition** (adults, children) so that downstream consumers — first the grocery list, later the recommender — can scale to "what this specific family will actually eat."
3. **Keep the analyze-recipe endpoint a single source of logic** between Express and Vercel by extracting a shared handler module. This pays off any time the prompt or response shape changes.
4. **Backfill existing vault rows** so the structured representation is uniformly populated, not "only on recipes saved after the migration."
5. **Lay the chip-grounding pattern (Path D1)** so that user-confirmed chip values can serve as ground truth on re-extraction without the AI fabricating ingredients to fit them — solving the previously rough "edit chips → re-suggest ingredients" round-trip.

## 4. Non-Goals

1. **Switching the source of truth to structured ingredients.** The free-text list stays canonical; structured is derived. Reversing this would force a UX overhaul of the recipe-edit form and is explicitly out of scope.
2. **Per-ingredient inline editing of `ingredients_structured`.** Tracked as P1.1 below. v1 keeps editing on the human-readable list; structured updates via re-parse only.
3. **Real pantry tracking (with quantities, expiry, replenishment).** Out of scope; deferred to PRD-003 P2.2.
4. **Per-household-member preferences** ("kid won't eat mushrooms"). Out of scope; deferred to partner-collab ADR.
5. **Cost estimation, store-price lookups, receipt scanning.** Adjacent territory; deserves its own ADR if pursued.
6. **Multi-tenant batching considerations.** This is a personal-scale product; backfill is single-user.

## 5. Target Users & User Stories

**The Planner (primary):** Wants a grocery list whose quantities reflect the actual household, not a fictional family-of-four. Wants confidence that quantities are auditable per recipe.

**The Capturer (secondary):** Wants to keep editing recipes as plain text, without a structured-ingredients form to fill out. Should never feel the new machinery.

### Stories (priority order)

1. *As the Planner, I want my grocery list quantities scaled to my actual household (2 adults + 1 child), so I'm not buying twice the protein I need.*
2. *As the Capturer, I want to keep editing the free-text ingredient list the way I always have, with structured data populating in the background — no new form, no extra fields.*
3. *As either user, when I edit a recipe's ingredients, I want the structured representation to stay in sync automatically.*
4. *As the Planner, when I update a recipe's chips after the original AI extraction, I want re-extraction to honor my chip choices as ground truth — without fabricating ingredients to fit a wrong chip.*
5. *As either user, I want the grocery list endpoint to know how many servings each recipe yields so it doesn't double-buy when a recipe already feeds the family.*

### Edge cases worth calling out

- AI returns malformed JSON or omits ingredients during parsing — handled by belt-and-suspenders prompt instruction + parse_failed fallback (don't hide ingredients).
- Recipe has no ingredient list (stub entry) — `ingredients_structured` persists as `[]`; servings falls through to default.
- Backfill encounters API outage — three consecutive 5xx responses trigger hard stop; resumable on re-run.
- Household composition changes mid-period (e.g., guest visit) — see Open Question OQ.C.
- User edits chips after the original analysis (Path D1) — chip values pinned as ground truth for categorical attributes; URL/name still primary source for ingredient list itself.

## 6. Requirements

### Hard prerequisites

| # | Requirement | Status |
|---|---|---|
| Pre-A | PRD-002 P0.1 (`household_preferences` table exists) | Shipped |
| Pre-B | PRD-003 P0.3 (`/api/grocery-list` endpoint exists; will become the consumer of household scaling) | Shipped |
| Pre-C | PRD-001 P0.9 (Vault decomposed into `RecipeForm.jsx` etc. — Bite γ re-parse hooks live there) | Shipped |

### P0 — Must have

| # | Requirement | Acceptance criteria | Status |
|---|---|---|---|
| P0.1 | **Schema migration: structured ingredients + household composition** | Migration adds: `vault.ingredients_structured` (jsonb, nullable; `NULL` = not yet parsed), `vault.servings` (int, nullable; `NULL` = AI couldn't infer), `household_preferences.adults` (int NOT NULL DEFAULT 2), `household_preferences.children` (int NOT NULL DEFAULT 0), CHECK constraint `household_prefs_eater_counts_chk` (`adults >= 1 AND children >= 0`). No new tables, no new RLS policies — existing owner-scoped policies cover. Idempotent (`ADD COLUMN IF NOT EXISTS`, `DO`-block guard for the constraint). Documented in `docs/schema.md`. Paired verify SQL. | ✅ Shipped (PR #75, commit `103eb1c`) |
| P0.2 | **Shared `/api/analyze-recipe` handler with structured-ingredient extraction** | Both `api-server.mjs` and `api/analyze-recipe.js` delegate to `api/_lib/analyzeRecipeHandler.js` so the prompt + response shape live in one place. Prompt extended to extract `ingredients_structured` (`[{name, quantity, unit, notes}]`) and `servings`. Belt-and-suspenders instruction in the prompt: *"include every ingredient from the recipe; if it can't be cleanly parsed, populate `name` and set `quantity`/`unit`/`notes` to `null`; never omit."* Returns `502 parse_failed` on bad JSON rather than silently dropping data. | ✅ Shipped (PR #75) |
| P0.3 | **Servings fallback chain** | Resolved servings come from: AI extraction (positive integer) → caller's `default_servings` (positive integer) → hardcoded fallback of 4. Response shape includes `servings_inferred: boolean` indicating which source supplied the value (so callers can distinguish "AI-extracted" from "fallback applied"). | ✅ Shipped (PR #75) |
| P0.4 | **Bulk backfill script** | `scripts/backfill-structured-ingredients.mjs` iterates `vault` rows where `ingredients_structured IS NULL AND deleted_at IS NULL`. Calls Haiku 4.5 (cheaper than Sonnet for already-categorized rows) with a backfill-specific prompt that returns *only* `servings` + `ingredients_structured` (other fields already populated). Idempotent — re-runs retry only unfinished rows. Per-row failures log + continue; three consecutive 5xx Anthropic responses trigger hard stop (signal: API outage; re-run later). Service-role key (`SUPABASE_SERVICE_ROLE_KEY`) reads cross-user; never imported by browser code. Registered as `npm run backfill:structured-ingredients`. | ✅ Shipped (PR #77 + #79; backfill body PR #77, npm script wiring PR #79) |
| P0.5 | **Household-size preferences UI** | Settings page (`Preferences/index.jsx`) adds two numeric inputs for `adults` (default 2) and `children` (default 0). Persists to `household_preferences.adults` / `.children`. The `(adults + children)` total drives the `default_servings` parameter passed to `/api/analyze-recipe` for new recipe saves. | ✅ Shipped (PR #77) |
| P0.6 | **Chip-grounded re-extraction with truth-hierarchy prompt (Path D1)** | When `userChips` is supplied to `/api/analyze-recipe`, the prompt prepends a `USER-CONFIRMED CHIPS:` block and follows it with an explicit truth hierarchy: (1) **recipe URL/name = primary source** for what dish is being made and what its ingredients should be; (2) **user chips = authoritative for categorical attributes** (`protein`, `cooking_method`, `main_carb`, `dairy_components`, `vegetables`, `fruit`, `dietary_tags`, `prep_time`); (3) **never fabricate ingredients to fit a chip** — extract accurately from the URL/name, ignore the chip if it doesn't usefully constrain. When `userChips` is absent / empty, the prompt is byte-for-byte identical to the pre-D1 form (zero behavior change for first-time analysis). | ✅ Shipped (PR #78 for D1 mechanism, PR #80 for explicit truth-hierarchy refinement) |
| P0.7 | **Bite γ — wire household scaling into `/api/grocery-list`** | The endpoint accepts `householdSize` (computed as `adults + children` from `household_preferences`) + per-recipe `servings`. The prompt instructs the model to scale quantities by `(household_size / servings)` per recipe-line so a 5-day plan for a 3-person household produces appropriately-sized totals. Recipes with `servings IS NULL` fall back to the hardcoded 4 (same chain as P0.3). | ✅ Shipped (PR #86, commit `c688c6e`) |
| P0.8 | **Bite δ — structured-ingredient pipe-through to `/api/grocery-list`** | The grocery-list page formats each ingredient string with the AI-extracted quantity inline (e.g. `"olive oil: 2 tbsp"`) when `vault.ingredients_structured` is populated, falling through to `ingredients_classified` names and then chip arrays as before. The grocery-list prompt is updated to tell the AI to use provided quantities as the scaling baseline and to estimate only when none is given. The API contract is unchanged — `ingredients` remains `string[]`; the format of each string is the page's responsibility. | ⏳ Pending |

### Scope changes after authoring

- **2026-05-05** — P0.7's "(a) Re-parse `ingredients_structured` when `vault.ingredients text[]` is edited" was descoped after Cowork planning surfaced that `vault.ingredients text[]` does not exist as a column (PRD §1's reference to it was aspirational; no migration ever added it, and no UI field captures free-text ingredients — chip pickers + recipe URL/name are the only ingredient-related inputs). The chip-driven re-extract path that already ships via Path D1 (`reExtractIngredients` in `useVault.js`, fired from `Vault/index.jsx`'s `handleSaveEdit` whenever structural chips change) covers the practical re-sync need today. A successor edit-trigger is queued behind P1.1 (per-ingredient inline editing) and will earn its own phase or PRD if/when that ships.

### P1 — Nice to have

- **P1.1 Per-ingredient inline editing in `RecipeForm`.** Surface `ingredients_structured` as an editable list (one row per ingredient, with quantity / unit / notes columns) so users can tweak quantities directly without round-tripping through re-parse. Lower priority because re-parse handles the common case.
- **P1.2 Re-parse latency budget + UX.** Bite γ (a) does an upstream API call as part of save; if latency is felt, add a skeleton or optimistic UI so the recipe-save UX isn't blocked. Quantify the budget after Bite γ ships and instrument.
- **P1.3 Kid-vs-adult scaling refinement.** Currently `household_size = adults + children`. Investigate whether `(adults + 0.5 × children)` matches grocery norms more accurately, or whether per-meal heuristics (kids eat ~50% protein but ~100% sides) merit a richer formula. Tune empirically.
- **P1.4 Path D2+ chip-grounded extensions.** Successor paths to D1 if/when needed (e.g., chip-grounded ingredient *substitution* for dietary-restriction edits). Open-ended; door kept open.

### P2 — Future considerations

- **P2.1** Per-household-member preferences ("kid won't eat mushrooms") — depends on partner-collab ADR.
- **P2.2** Quantity-aware filtering in the recommender — use `ingredients_structured` quantities to gate "I have <X> of Y" pantry awareness once real pantry tracking lands (PRD-003 P2.2).
- **P2.3** Receipt scanning / cost estimation downstream of structured quantities. Adjacent territory.
- **P2.4** Auto-learned scaling — observe actual buy patterns over time and tune the household-size formula per family. Premature.

## 7. Data Model Changes Summary

```sql
-- PRD-006 P0.1: Single migration adds four columns + one CHECK.
-- File: supabase/migrations/20260503000001_structured_ingredients_and_household.sql

ALTER TABLE public.vault
  ADD COLUMN IF NOT EXISTS ingredients_structured jsonb,
  ADD COLUMN IF NOT EXISTS servings int;

ALTER TABLE public.household_preferences
  ADD COLUMN IF NOT EXISTS adults   int NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS children int NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'household_prefs_eater_counts_chk'
  ) THEN
    ALTER TABLE public.household_preferences
      ADD CONSTRAINT household_prefs_eater_counts_chk
      CHECK (adults >= 1 AND children >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.vault.ingredients_structured IS
  'AI-parsed ingredient list. NULL = not yet parsed / parse failed.
   Shape: [{name: text, quantity: text|null, unit: text|null, notes: text|null}].
   Source of truth = vault.ingredients text[]; this column is derived from it
   and re-parsed on ingredients edit (P0.7 Bite γ).';
```

Document each in `docs/schema.md` (already done). Pair with `verify_<timestamp>.sql` (already done).

**Shape of `ingredients_structured` entries:**

```json
[
  { "name": "olive oil",      "quantity": "2",     "unit": "tbsp",  "notes": null },
  { "name": "garlic clove",   "quantity": "3",     "unit": null,    "notes": "minced" },
  { "name": "kosher salt",    "quantity": null,    "unit": null,    "notes": "to taste" }
]
```

`quantity` and `unit` are deliberately strings (not numeric), to capture "to taste" / "a generous handful" / "1 (14 oz can)" without forcing structured parsing the AI can't reliably do. Free-text strings leave room for richer parsing later if and when the data warrants it (P2-territory).

## 8. AI Endpoint Changes Summary

**`/api/analyze-recipe`** (Sonnet 4.6) — extended to:
- Accept optional `default_servings` (caller-supplied; falls back to hardcoded 4 if absent or invalid).
- Accept optional `userChips` (Path D1) — when present, prepend a chip-block + truth-hierarchy preamble to the prompt.
- Return `components.ingredients_structured` and `components.servings` + `components.servings_inferred` alongside existing categorical fields.

**`/api/grocery-list`** (Haiku 4.5) — updated in Bite γ (P0.7):
- Accepts `householdSize` (optional; defaults to 2 = household_preferences defaults) and per-recipe `servings` (optional; null falls back to 4).
- Prompt scales quantities by `(householdSize / servings)` per recipe-line, then consolidates across recipes.

Both endpoints retain the existing pattern: Express route in `api-server.mjs` and Vercel mirror in `api/<endpoint>.js` delegate to a shared handler in `api/_lib/`.

## 9. Success Metrics

### Leading indicators (1–2 weeks post-Bite γ ship)

- **Backfill coverage** — % of `vault` rows with non-null `ingredients_structured` after the backfill script's first run. Target: ≥ 95% (allow 5% for unparseable / API-failure edge cases).
- **Re-parse latency** — p95 time from `RecipeForm` save to `ingredients_structured` updated. Target: < 4 seconds end-to-end (within the existing analyze-recipe budget).
- **Servings inference rate** — % of `/api/analyze-recipe` responses with `servings_inferred = true` (vs. fallback). Target: ≥ 70% on real recipes (the rest acceptably fall through to the household / hardcoded default).
- **Chip-grounding override rate (Path D1)** — % of re-extractions where the user-confirmed chips disagreed with the AI's first-pass categorical guess. Track informally — high override rate means the original categorical extraction needs prompt tuning, not that D1 is failing.

### Lagging indicators (1–3 months post-Bite γ)

- **Grocery-list quantity correctness (qualitative)** — Planner's read on whether weekly grocery lists actually match what the household consumes. The whole point.
- **Vault edit → re-parse correctness** — zero observed cases where `ingredients_structured` is silently stale after an edit. Audit periodically.
- **No user awareness of structured data** — the Capturer should never feel a difference. If they're asking "where's the structured ingredient form?" the UX deviated from the goal (we kept the free-text list as primary).

## 10. Open Questions

| # | Question | Recommendation |
|---|---|---|
| OQ.A | **Re-parse trigger granularity** — fire on every `RecipeForm` save, or only when the `ingredients` field actually changed? | Diff-based trigger (only when the array differs from the prior value). Prevents wasted Anthropic spend + latency on cosmetic edits. Engineering call during P0.7 Bite γ impl. |
| OQ.B | **Scaling formula** — `adults + children`, `adults + 0.5 × children`, or richer? | Start with `adults + children` (simplest, matches `household_size` semantics in the schema docs). Revisit empirically once Bite γ ships and we have real "did this list match what we ate?" feedback. Tracked as P1.3. |
| OQ.C | **Household composition changes mid-period** — auto-rescale active grocery lists? | No (recommend). Lists generated under prior household state stay as-is; only future generations use the new `household_preferences`. Avoids silently mutating a list the user is actively shopping with. |
| OQ.D | **Reparse failure UX** — silent fallback to `NULL` (relying on the next backfill run) or surface an error to the user? | Silent fallback (recommend). The save itself succeeded; the structured form is best-effort. Emitting a UI error on a derived-data failure adds friction without enabling user action. |
| OQ.E | **Dedicated re-parse endpoint vs. reuse `/api/analyze-recipe`** — slimmer endpoint that takes only ingredients + name and returns only `ingredients_structured` + `servings`? | Defer the call. Reuse `/api/analyze-recipe` for the v1 Bite γ impl (avoids a new endpoint surface to maintain). If reparse latency becomes a problem (P1.2), revisit a slim variant. |
| OQ.F | **Chip-grounding for ingredient changes (D2+)** — should chip-grounded re-extraction also influence ingredient *swaps* (e.g., user marks "vegetarian" → AI substitutes meat ingredients)? | Out of scope for D1. Tracked as P1.4. The current D1 boundary is: chips constrain *categorical attributes*; URL/name still defines *ingredients*. Preserve that boundary until there's a real demand for substitution. |

## 11. Phasing & Timeline

No external deadlines.

- **Phase 1 — Bite α (P0.1, P0.2, P0.3):** schema migration + shared analyze-recipe handler + servings fallback chain. Foundation. Shipped 2026-05-03 (PR #75) + the `cooking_method` scope tightening (PR #76, commit `cd25f99`) and backfill-script category-array selection fix (commit `dfc3a12`) that surfaced during Bite α investigation.
- **Phase 2 — Bite β (P0.4, P0.5):** backfill script + household-size preferences UI. Shipped 2026-05-04 (PR #77) + npm script wiring (PR #79).
- **Phase 3 — Path D1 (P0.6):** chip-grounded re-extraction + truth-hierarchy prompt refinement. Shipped 2026-05-04 (PR #78 mechanism, PR #80 truth-hierarchy).
- **Phase 4 — Bite γ (P0.7) — SHIPPED** (PR #86, commit `c688c6e`). Grocery-list scaling consumer. The user-visible payoff: grocery lists scaled to actual household. (The original Bite γ also included a re-parse-on-edit half; that was descoped on 2026-05-05 — see "Scope changes after authoring" in §6.)
- **Phase 5 — Bite δ (P0.8) — PENDING.** Pipe structured-ingredient quantities through to `/api/grocery-list` so the AI scales actual extracted quantities instead of name-based estimates. No DB or API contract change. Estimated 1 sitting.

After Bite δ, this PRD closes out at v1.0. Successor work (per-ingredient editing, scaling refinements, Path D2+) lives in P1 and graduates only on demand.

## 12. Testing Plan

Most of this PRD is shipped; the testing burden falls on Bite γ. For shipped phases, the existing tests cover what landed (see `api/_lib/__tests__/analyzeRecipeHandler.test.js` for the handler refactor, and the `verify_20260503.sql` queries for the schema migration).

**For Bite γ (P0.7):**

| Requirement | Test file | Test cases |
|---|---|---|
| Grocery-list scaling — handler validation | `src/lib/__tests__/groceryListHandler.test.js` — "Bite γ — household scaling (handler)" describe block | Accepts valid `householdSize`; rejects negative / non-integer; accepts missing `householdSize`; accepts `servings: null`; rejects `servings: 0`; accepts missing `servings` (passes null). |
| Grocery-list scaling — prompt interpolation | `src/lib/__tests__/groceryListHandler.test.js` — "Bite γ — buildGroceryList scaling (prompt)" describe block | `householdSize` interpolated into prompt; `servings: null` falls back to 4; `servings: 0` falls back to 4; default `householdSize = 2` when omitted; throws on `householdSize: 0`. |
| Grocery-list page wiring | `src/pages/GroceryList/__tests__/GroceryList.test.jsx` | Page passes `householdSize = adults + children` and per-recipe `servings` to `/api/grocery-list`; null `vault.servings` propagates as null (no client-side fallback). |
| End-to-end Playwright | extend `e2e/grocery-list.spec.ts` | Set household to 2 adults + 1 child → generate grocery list → quantities reflect 3-person household, not 4. |

**For Bite δ (P0.8):**

| Requirement | Test file | Test cases |
|---|---|---|
| Bite δ — structured-ingredient formatting | `src/pages/GroceryList/__tests__/GroceryListBody.test.jsx` | Recipe with structured data → POSTed strings include quantity. Empty / missing structured → fallback to classified names. Empty / missing both → fallback to chip arrays. `main_carb` single-string regression guard (must not be spread into characters). Recipe with no usable ingredient data is skipped with `console.warn`. |
| Bite δ — prompt honors provided quantities | `src/lib/__tests__/groceryListHandler.test.js` | Prompt instruction tells the AI to use provided quantities as the baseline; ingredient strings flow through to the user message verbatim. |

## 13. Revision History

| Version | Date | Notes |
|---|---|---|
| v0.1 | 2026-05-04 | **Retrospective authoring.** Phases 1–3 (P0.1–P0.6) were already shipped on `main` between 2026-05-03 and 2026-05-04 across PRs #75, #76, #77, #78, #79, #80. This document captures the original problem statement, decisions, and remaining scope (Bite γ / P0.7) so the work has a single canonical reference. The lack of an authoring-time PRD was flagged in `docs/STATUS.md` as a documentation gap; this draft closes that gap. The bulk of v0.1 reads as forward-looking (P0.1–P0.6 with Acceptance Criteria stated as if to-be-built) deliberately — that's the best record of "what we set out to do," even though the audit also notes ✅ Shipped status per row. |
| v0.2 | 2026-05-05 | **Bite δ (P0.8) added.** P0.7 (Bite γ) retroactively marked ✅ Shipped (PR #86). Added P0.8 to the requirements table, updated §1 problem statement, §8 API summary, §11 phasing (Phase 4 shipped / Phase 5 added), and §12 testing plan. PRD closes at v1.0 after Bite δ merges. |
