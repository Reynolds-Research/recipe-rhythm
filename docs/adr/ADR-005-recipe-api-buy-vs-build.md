# ADR-005: Recipe API (recipe-api.com) — buy-vs-build for structured recipe data

**Status:** Rejected for now (revisit if/when a nutrition or external-catalog feature is scoped)
**Date:** 2026-06-16
**Deciders:** Matt (El Presidente)
**Related:** PRD-006 (`vault.ingredients_structured`, household scaling); PRD-004 (`vault.ingredients_classified`, essentiality filter); `/api/analyze-recipe`

---

## Context

We received cold-outreach from Paul Crossland (an indie developer; `paul@recipe-api.com`), pitching [recipe-api.com](https://recipe-api.com) as a "reliable recipe-data layer" for Recipe-Rhythm. The product is legitimate — a real REST API + hosted Claude MCP connector serving 25,000+ recipes in one schema, plus an AI generation endpoint. This ADR records whether we should adopt it, so the reasoning isn't re-litigated next time the question (or another vendor) comes up.

The pitch's core claim is that it would "keep the parsing / grocery-list side consistent as you add more recipe sources or generated meals." That claim targets exactly the area PRD-006 (`ingredients_structured`) and PRD-004 (`ingredients_classified`) already own.

### The key framing

The two schemas exist for **different jobs**:

- **Ours** is *derived from recipes the household hand-enters.* `/api/analyze-recipe` parses our own free-text `vault.ingredients` into `ingredients_structured` (`[{name, quantity, unit, notes?}]`) and classifies each item as essential/omittable (`ingredients_classified`). Purpose: drive our preference filter and grocery scaling. It structures *content we already have.*
- **Theirs** is a *content product* — 25k generic recipes + on-demand generation, each with USDA nutrition. Purpose: supply recipes and nutrition *we don't have.*

### Side-by-side

| Field area | Recipe-Rhythm vault today | Recipe API |
|---|---|---|
| Ingredient parse | `ingredients_structured`: `{name, quantity, unit, notes}` | grouped, each item + UUID, qty, metric unit, prep, substitutions, USDA source |
| Essential vs. optional | `ingredients_classified`: `{name, essentiality, source}` (PRD-004) | not present |
| Categorical tags | chip-picker: `main_carb`, `dietary_tags`, `dairy_components`, `vegetables`, `fruits` | `tags`, `dietary.flags` + `not_suitable_for` |
| Nutrition | **none** | 32 USDA nutrients / serving |
| Instructions | free text | structured: action verb, temp °C/°F, ISO 8601 timing, doneness cues |
| Servings / household | `vault.servings`, `household.adults` / `.children` | `meta.yields`, `serving_size_g` (no household model) |
| Storage / equipment / troubleshooting | none | all present |
| Recipe generation | our own Anthropic calls (`/api/analyze-recipe` etc.) | `POST /api/v1/generate`, same schema |

---

## Decision

**Do not adopt Recipe API at this time.**

The pitch's headline benefit — consistent ingredient structuring — is the one area we have already solved, and solved with logic tailored to our own filtering (their schema has no essential/omittable concept at all). Swapping in their structured ingredients would mean re-mapping their fields onto our chip taxonomy and re-deriving essentiality anyway. No net win, and it adds an external dependency on a solo-operator service to a path that is currently fully in-house.

---

## Options considered

### Option A: Adopt Recipe API as the ingredient-structuring / recipe-data layer (rejected)

Rejected. Overlaps with PRD-006 + PRD-004, which already ship. Adds a third-party runtime dependency (single-operator vendor; consider longevity/SLA) to replace something we own outright. The free tier (25 unique recipes/month) is also too small to evaluate at production scale without paying.

### Option B: Build nutrition / external catalog ourselves if/when needed (default)

Keep the in-house path. If a future PRD adds per-serving nutrition or an external recipe catalog, weigh build-vs-buy at that point with concrete requirements.

### Option C: Status quo — do nothing now (chosen)

Nothing in PRD-001…PRD-006 requires external recipe data or nutrition. The vault is intentionally a single-household, user-entered library, not a discovery catalog. No action needed today.

---

## Consequences

- **No new dependency, no spend.** The AI/parsing path stays fully in-house and under our control.
- **Captured for reuse.** If another recipe-data vendor pitches, this ADR is the baseline comparison.

### Revisit triggers (when this becomes a real "maybe")

This decision should be reopened if we scope either:

1. **Per-serving nutrition** (calories/macros per meal). We have *zero* nutrition fields today, and USDA FoodData matching is the genuinely hard part to build. Their 32-nutrient, USDA-backed panel is the single piece most worth paying for — far more than their ingredient structure.
2. **An external recipe catalog or generation source** — i.e. letting the household browse/import recipes they didn't type in, beyond what our own generation covers.

Cheapest first probe when that day comes: `curl https://recipe-api.com/api/v1/dinner` (no key required) and inspect one real nutrition object to judge whether the depth matches what we'd want to display.

---

## References

- Vendor: [recipe-api.com](https://recipe-api.com) · [docs](https://recipe-api.com/docs) · founder portfolio: [paulcrossland.com](https://www.paulcrossland.com)
- Our schema: `supabase/migrations/20260503000001_structured_ingredients_and_household.sql` (PRD-006 P0.1); `supabase/migrations/20260428000001_vault_ingredients_classified.sql` (PRD-004 Phase A)
- PRDs: [`docs/prds/PRD-006-structured-ingredients-and-household-scaling.md`](../prds/PRD-006-structured-ingredients-and-household-scaling.md), [`docs/prds/PRD-004-smarter-ingredient-filtering.md`](../prds/PRD-004-smarter-ingredient-filtering.md)
