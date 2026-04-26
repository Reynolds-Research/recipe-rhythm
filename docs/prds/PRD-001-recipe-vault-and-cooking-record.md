# PRD-001: Recipe Vault & Cooking Record

**Status:** Draft v0.2
**Author:** Matt
**Date:** 2026-04-25
**Sibling PRDs (forthcoming):** PRD-002 Meal Planning · PRD-003 Grocery Tracking
**Related ADRs:** [ADR-001](../adr/ADR-001-planning-period-save-state.md) — informs but does not constrain this PRD

---

## 1. Problem Statement

Recipe-Rhythm's three core surfaces — the **Vault** (cookbook), **LogMode** (daily journal), and **BrainstormMode** (meal planner) — were each built independently and don't fully share data. Most importantly, when a user logs an eaten meal in LogMode, the app does not record which Vault recipe it corresponds to. This single missing link silently breaks every "what does our family actually cook?" feature downstream — including the recommendation engine that should be powering the brainstorm.

The user-visible consequence: my wife sits down each week to plan meals, but the brainstorm has no signal of which recipes are family hits, family flops, or recently-eaten and overdue for variety. She is effectively planning from a static cookbook every week. The cost of not solving this: meal planning stays exhausting, AI suggestions feel generic, and the cooking history accumulating in `meals` is wasted data.

## 2. Current State (As Built)

A faithful snapshot, post code review on 2026-04-25:

| Surface | Lives at | What it does today | Key issues |
|---|---|---|---|
| Vault (cookbook) | `src/pages/Vault.jsx` (884 lines) | Manual recipe entry with chip-picker categorical tags. Optional image upload (per-user folder). AI-suggest button calls `/api/analyze-recipe` to pre-fill chips. Hard delete. | Hard delete loses history. Custom tags persist in localStorage only (`vault_extra_*`). Monolithic component. |
| LogMode (journal) | `src/pages/LogMode.jsx` (250 lines) | Voice-first "what did you eat tonight." Inserts row in `meals` table (`name`, `eaten_on`, `notes`). Offers post-save "Save to Cookbook" promotion that calls `/api/analyze-recipe` and inserts into `vault`. | **Does not write `vault_id` on the meals row, breaking the cooking-history → vault link.** Even when the user clicks "Save to Cookbook," the original meal row is not back-linked to the new vault row. |
| BrainstormMode (planner) | `src/pages/BrainstormMode.jsx` (1,127 lines) | Drag-and-drop meal planning, last-week mapping, recommendations based on recency + frequency. | Recommendation engine assumes `meals.vault_id` exists and is populated — it isn't. |
| AI proxy | `api-server.mjs` + `api/` (Vercel) | Two endpoints: `/api/analyze-recipe` (Sonnet 4.6, returns categorical metadata), `/api/swap-suggestions` (Haiku 4.5, returns 3 fresh recipe-name suggestions). | No rate limiting, no auth on endpoints — flagged in code as a pre-deploy security TODO. |
| Schema | `vault`, `meals`, `meal_plan_items` (post-ADR-001) | Owner-scoped RLS on all tables. `meal_plan_items.vault_id` has `ON DELETE SET NULL`. | Categorical-only — no quantitative ingredients exist anywhere. |
| Dead code | `recommendations.js:9`, `BrainstormMode.jsx:295` | `WILDCARD_RATIO = 0.2` references Spoonacular wildcards, never wired up; `getRecommendations(..., wildcards=[])` always called with empty array. | Decision made (this PRD): replace with `/api/swap-suggestions`, remove Spoonacular references. |

## 3. Goals

1. **Restore the cooking-history → vault link** so the recommendation engine and the brainstorm have real signal to operate on.
2. **Make recipe data durable** by switching vault deletes to soft-delete and centralizing enum sources of truth.
3. **Keep capture friction near zero** for both modes (logging an eaten meal, adding a vault recipe), preserving the voice-first LogMode UX and chip-picker Vault UX.
4. **Replace Spoonacular wildcards with the existing `/api/swap-suggestions`** so external recipe suggestions become a first-class part of the brainstorm without a third-party API dependency.
5. **Set up the data foundation that PRD-002 (Meal Planning) will consume** — particularly the family-rating signal and the cooked-frequency signal.

## 4. Non-Goals

1. **The meal-planning UI itself** (drag/drop calendar, swap-out interactions). Owned by PRD-002; this PRD only ensures the data is right.
2. **Quantitative ingredients** (`{quantity, unit, item}` lists). Owned by PRD-003 (Grocery); this PRD keeps the existing categorical model.
3. **Public sharing or social features.** Already a separate locked decision (link-based sharing, deferred).
4. **Partner collaboration / multi-user households.** Tracked separately as a P1 ADR. This PRD assumes the existing single-user `auth.uid() = user_id` model and must not preempt the partner-collab schema decisions.
5. **Photo-of-cookbook OCR or recipe-URL scraping (schema.org JSON-LD).** Both deferred — the existing AI flow handles URL and image inputs today via Anthropic's vision capability.
6. **Native (iOS/Android) wrappers.** Already deferred to P3 (Capacitor, post-PWA).

## 5. Target Users & User Stories

**Primary persona — The Planner (wife):** Sits down once a week to plan meals. Needs to see what the family has actually liked, see fresh AI candidates, and not be slowed down.

**Secondary persona — The Capturer (Matt):** Comes across recipes throughout the week. Needs to log them in under 30 seconds without breaking flow.

**Shared persona — The Cook (either of us):** Just finished cooking. Wants to mark it eaten, jot a note, and move on.

### Stories (priority order)

1. *As the Cook, when I log a meal in LogMode, I want the app to recognize whether it matches a Vault recipe, so my cooking history is automatically tied to my cookbook.*
2. *As the Cook, when LogMode is unsure which Vault recipe matches, I want a quick confirm/skip step, so I don't have to babysit the linking.*
3. *As the Capturer, when I "Save to Cookbook" from a logged meal, I want the original log entry to back-link to the new Vault recipe, so cooking history is retroactively connected.*
4. *As the Planner, I want recipes I've cooked recently to be deprioritized in the brainstorm, so we get variety without my having to remember.*
5. *As the Planner, I want to see how often each Vault recipe has actually been cooked, so "family hits" are obvious at a glance.*
6. *As the Capturer, I want to be confident that deleting a recipe doesn't silently lose its cooking history, so I can prune the Vault without anxiety.*
7. *As the Planner, I want fresh AI-generated recipe candidates surfaced alongside Vault hits in the brainstorm, so we get novelty without leaving the app.*
8. *As either user, I want the chip-picker options (cuisines, proteins, etc.) I've added once to be available everywhere, so I don't re-add "Filipino" five different times.*

### Edge cases worth calling out

- LogMode meal name doesn't match anything in Vault — graceful fallback, not an error.
- Meal name fuzzy-matches multiple Vault recipes (e.g., "tacos" matches "Carnitas Tacos" and "Chicken Tacos") — needs disambiguation UI, not silent first-match.
- User deletes a Vault recipe that has historical meals linked — soft-delete preserves the link; UI shouldn't show the deleted recipe in lists but should show "(deleted recipe)" in history views.
- AI proxy is rate-limited / down — capture must still work; AI categorization degrades gracefully.

## 6. Requirements

### P0 — Must have

| # | Requirement | Acceptance criteria |
|---|---|---|
| P0.1 | **`meals` table gets a `vault_id` column with FK + index** | Schema migration adds `vault_id uuid REFERENCES vault(id) ON DELETE SET NULL`, plus an index on `(user_id, vault_id)`. Confirmed via `information_schema.columns`. RLS already covers it via `user_id`. |
| P0.2 | **LogMode auto-links eaten meals to Vault** | Given a Vault recipe whose name fuzzy-matches the typed/spoken meal name above a confidence threshold, when the user taps Save, then the new `meals` row is inserted with `vault_id` set. Match algorithm: case-insensitive ILIKE first, then trigram similarity ≥ 0.6 if no exact-ish match. Threshold is configurable. |
| P0.3 | **Disambiguation UI when match is ambiguous** | Given two or more Vault recipes match above the threshold, when the user taps Save, then a small chooser appears (recipe name + image thumb) with a "None of these" option. Choosing one writes that `vault_id`; "None" leaves it null. |
| P0.4 | **Promote-to-Cookbook back-links the original meal** | Given the user clicks "Save to Cookbook" on a just-logged meal, when the new `vault` row is created, then the original `meals` row's `vault_id` is updated to point to the new vault id (single transaction or two-step with rollback on failure). |
| P0.5 | **Vault soft-delete** | Migration adds `deleted_at timestamptz nullable` to `vault`. `Vault.jsx` delete handler updates `deleted_at = now()` instead of issuing DELETE. All Vault SELECT queries filter `WHERE deleted_at IS NULL`. `meal_plan_items.vault_id` and `meals.vault_id` continue to point to the soft-deleted row; UI renders "(deleted recipe)" for these references. |
| P0.6 | **Centralize enum lists in `src/lib/constants.js`** | All cuisine/protein/cooking-method/etc. lists move out of `Vault.jsx` (lines 15–62) and out of the prompt in `api-server.mjs:91-99`. The AI prompt is built by interpolating the constants module, so adding a value happens in one place. The Vercel mirror at `api/` does the same. |
| P0.7 | **Custom tags persist server-side** | The localStorage `vault_extra_*` mechanism is replaced with a `vault_options` table (or JSON column on user profile) so custom cuisines/proteins/etc. survive across devices and browser clears. Migration backfills existing localStorage entries from the user's session if present. |
| P0.8 | **Spoonacular references removed; wildcards come from `/api/swap-suggestions`** | `recommendations.js:9` (`WILDCARD_RATIO`, dead Spoonacular code) deleted. `getRecommendations` accepts a `wildcards` array sourced from `/api/swap-suggestions` rather than the empty default. `BrainstormMode.jsx:295` reference removed. `.env.example` cleaned of `VITE_SPOONACULAR_KEY`. |
| P0.9 | **Vault component is decomposed during this work** | The 884-line `Vault.jsx` is split into `Vault/index.jsx`, `Vault/RecipeForm.jsx`, `Vault/RecipeCard.jsx`, `Vault/ChipPicker.jsx`, `Vault/useVault.js`. No new feature lands in the monolith. |

### P1 — Nice to have

- **P1.1 Family rating field** on `vault` (1–5 integer, nullable). UI: tap-to-rate stars on Vault recipe cards. Single shared rating until partner-collab decides otherwise.
- **P1.2 Per-meal note prompt after cooking** — extend the existing optional note field on LogMode to nudge "How was it?" so the Planner gets qualitative signal (e.g., "kid loved it"). No schema change beyond what `meals.notes` already supports.
- **P1.3 "Last cooked" badge** on Vault cards — derived from the joined `meals` table, surfaces "Last cooked: 12 days ago" so the Planner sees recency at a glance.
- **P1.4 Voice dictation in Vault entry** — extend the existing `useSpeech` hook (already used by LogMode) to the Vault recipe-name input.
- **P1.5 Bulk-link cleanup tool** — a one-time admin/settings action that walks unmatched `meals.vault_id IS NULL` rows and offers fuzzy-match suggestions for retroactive linking.
- **P1.6 API rate limiting + auth on `/api/*` endpoints** — `express-rate-limit` plus Supabase JWT verification per the security TODO in `api-server.mjs`. Mirror to Vercel functions.

### P2 — Future considerations

- **P2.1** Photo-of-cookbook OCR.
- **P2.2** Schema.org JSON-LD URL scraping (faster path before the AI fallback).
- **P2.3** Per-household-member preferences feeding meal planning ("kid won't eat mushrooms").
- **P2.4** Cooking-history insights dashboard (chart of cuisine mix, frequency, etc.).
- **P2.5** Quantitative ingredients (deferred to PRD-003 — but design the schema with the awareness that this is coming).

## 7. Data Model Changes Summary

Three migrations, all small, all idempotent:

```sql
-- Migration A: link meals to vault
ALTER TABLE meals ADD COLUMN IF NOT EXISTS vault_id uuid REFERENCES vault(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS meals_user_vault_idx ON meals (user_id, vault_id);

-- Migration B: vault soft-delete
ALTER TABLE vault ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS vault_user_active_idx ON vault (user_id) WHERE deleted_at IS NULL;

-- Migration C (optional, for P1): family rating
ALTER TABLE vault ADD COLUMN IF NOT EXISTS family_rating smallint
  CHECK (family_rating IS NULL OR (family_rating BETWEEN 1 AND 5));

-- Migration D (P0.7): custom-tags storage (sketch — choose final shape during impl)
CREATE TABLE IF NOT EXISTS vault_options (
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL,  -- 'cuisine_type', 'proteins', etc.
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category, value)
);
ALTER TABLE vault_options ENABLE ROW LEVEL SECURITY;
-- + the standard four owner-scoped policies
```

For each, document in `docs/schema.md` and add a verification SQL file in `supabase/migrations/`.

## 8. Success Metrics

### Leading indicators (1–2 weeks post-launch)

- **Vault link coverage** — % of new `meals` rows with non-null `vault_id`. Target: ≥ 70% within 2 weeks of P0 ship. (If lower, the fuzzy-match threshold is too strict or the disambiguation UI is too annoying.)
- **Capture friction** — Median LogMode "open → save" time stays under 15 seconds (no regression from baseline). Vault manual-add stays under 90 seconds.
- **Soft-delete adoption** — Zero hard-delete events on `vault` post-deploy (confirm via DB-level audit log or app instrumentation).

### Lagging indicators (1–3 months)

- **Brainstorm utility** — Wife reports the brainstorm "feels less like starting from scratch" in a casual post-month check-in.
- **Vault re-cook rate** — Of recipes in vault, ≥ 50% have been cooked at least once in the last 60 days (a healthy ratio of "shelf" to "kitchen").
- **Wildcard acceptance** — Once `/api/swap-suggestions` is wired in, ≥ 15% of suggestions get clicked or pulled into a meal plan.

## 9. Open Questions

| # | Question | Owner |
|---|---|---|
| OQ.A | What's the right fuzzy-match threshold for P0.2? Trigram similarity ≥ 0.6 is a starting guess. We'll likely want a small dev tool to tune it against real data. | Engineering — tune empirically post-impl |
| OQ.B | When promote-to-Cookbook (P0.4) creates a vault row from a meal, do we also retroactively link any *other* recent meals with the same name? Or just the originating one? Aggressive backfill = better history; conservative = less risk of false positives. | Product — recommend conservative for v1 |

## 10. Phasing & Timeline

No external deadlines.

- **Phase 1 (P0.1–P0.4):** The link fix. The single biggest unlock for PRD-002. Estimate: 1–2 sittings with Claude Code, gated by the migration and the disambiguation UI.
- **Phase 2 (P0.5–P0.7):** Soft delete, constants centralization, custom-tags table. All hygiene; can run in parallel with Phase 1 if you split prompts.
- **Phase 3 (P0.8–P0.9):** Spoonacular cleanup + Vault decomposition. Best done as a single refactor PR so reviewers see the before/after side-by-side.
- **Phase 4 (P1):** Ratings, last-cooked badge, voice in vault, bulk linker, API rate limits. Pick the ones meal planning actually demands; defer the rest.

**Block on PRD-002 until Phase 1 is shipped** — otherwise that PRD will be making assumptions about a foundation that isn't in place.

## 11. Testing Plan (Vitest + Playwright)

Tests to write alongside each P0:

| Requirement | Test file | Test cases |
|---|---|---|
| P0.1 | `src/lib/__tests__/meals.schema.test.js` (new) | Inserting a meal with valid `vault_id` succeeds; with bogus uuid fails; with null is allowed. |
| P0.2 | `src/lib/__tests__/vaultMatch.test.js` (new) | Exact-match returns single hit; trigram-fuzzy returns above-threshold hits; no-match returns empty. |
| P0.3 | `src/pages/__tests__/LogMode.disambiguation.test.jsx` (new) | Two matches → chooser renders; selecting one writes correct vault_id; "None" leaves it null. |
| P0.4 | extend `src/pages/__tests__/LogMode.test.jsx` (new) | After Save-to-Cookbook, the original meal row's `vault_id` equals the new vault row's id. |
| P0.5 | extend `src/pages/__tests__/Vault.test.jsx` | Delete sets `deleted_at`; subsequent fetch excludes the row; meal_plan_items pointing at it still resolve to a "(deleted recipe)" label. |
| P0.6 | `src/lib/__tests__/constants.test.js` (new) | All exported lists are non-empty arrays of unique strings; the AI prompt builder includes every constant. |
| P0.7 | extend Vault tests | Adding a custom tag persists across reload (mocked DB), syncs across components. |
| P0.8 | Repo-grep for `Spoonacular` returns zero matches; `recommendations.test.js` covers wildcards-from-API path. |
| P0.9 | Pure refactor — existing `Vault.test.jsx` continues to pass against the new file structure. |

Add one Playwright e2e: "log a meal that matches a vault recipe → the meal_plan brainstorm next-week shows the linked recipe in 'recently cooked.'"

---

## Revision History

| Version | Date | Notes |
|---|---|---|
| v0.1 | 2026-04-25 | Initial draft from skill intake; framed as "Recipe Logging" (capture-only). Pre-codebase review. |
| v0.2 | 2026-04-25 | Renamed to "Recipe Vault & Cooking Record" to match codebase vocabulary. Grounded in code review of `Vault.jsx`, `LogMode.jsx`, `BrainstormMode.jsx`, `analyzeRecipe.js`, `recommendations.js`, `api-server.mjs`, and the live schema. Identified the broken `meals.vault_id` link as the highest-leverage fix; promoted to P0. Decisions locked: soft-delete vault recipes; replace Spoonacular wildcards with existing `/api/swap-suggestions`; defer quantitative ingredients to PRD-003. |
