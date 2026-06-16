# PRD-002: Meal Planning (Brainstorm & Roll-Forward)

**Status:** Draft v0.1
**Author:** Matt
**Date:** 2026-04-25
**Sibling PRDs:** [PRD-001](./PRD-001-recipe-vault-and-cooking-record.md) — Recipe Vault & Cooking Record (this PRD's hard prerequisite); PRD-003 — Grocery Tracking (forthcoming)
**Related ADRs:** [ADR-001](../adr/ADR-001-planning-period-save-state.md) — Planning period save state schema (informs the data model used here)

---

## 1. Problem Statement

The Planner (my wife) sits down weekly to plan family meals using Recipe-Rhythm's BrainstormMode. Three things consistently make this harder than it should be:

1. **The suggestions feel weak.** They appear nearly random, don't reflect what the family has loved or recently eaten, and don't honor any household-level preferences. *(Root cause: the recommendation engine has good logic but is starved of input — see PRD-001's `meals.vault_id` defect, plus the absence of `family_rating` and a preferences layer.)*
2. **Periods that span week boundaries don't roll forward smoothly.** The mechanics exist (leftovers view, gap-day handoff, end-of-period review) but corner-case bugs and UX rough spots make multi-week planning feel fragile. *(Audit item U3 is one example: the last-week mapping ignores week boundaries.)*
3. **The whole flow feels heavier than it should.** Many small frictions compound: tap targets, regenerations that produce duplicates, no way to "set aside" a meal as "maybe."

The user-visible goal: brainstorming a week (or two) of meals should feel like browsing a curated lookbook — *family hits, family rating, prep time, fresh AI candidates, all filtered by what we actually eat* — not like rolling dice in a static cookbook.

## 2. Current State (As Built)

| Surface | Status | Notes |
|---|---|---|
| `BrainstormMode.jsx` (1,127 lines) | Shipped, in active use | Drag-and-drop reordering, "Serve" / lock flow, local-storage cache for in-progress plans. UI vocabulary: weekday strings + `selectedDates`. Uses the recommendation engine. |
| `recommendations.js` (160 lines) | Shipped, starved | Sophisticated weighted scoring (cuisine diversity, repetition penalties, frequency bonus). **Not actually working** because `meal.vault_id` is always null today. PRD-001 unlocks it. |
| `mealPlanReader.js` / `mealPlanWriter.js` | Shipped | Period CRUD, cooked-toggle, finalize flow, leftover query, `checkPeriodOverlap`. ADR-001 Phase 2 + 3 + 5. |
| `PeriodReview.jsx` | Shipped | End-of-period review UI. ADR-001 Phase 4. |
| `CalendarView.jsx`, `DateRangePicker.jsx`, `DateStripPicker.jsx` | Shipped | Date/period selection UIs. ADR-001 Phase 6 + 8. |
| `current_leftovers` view + 14-day label decay | Shipped | DB-side. Phase 1 migration. |
| AI swap-suggestions endpoint | Shipped (Haiku 4.5) | `/api/swap-suggestions` returns 3 fresh recipe-name strings given current plan + recent meals. **Currently ignored by the brainstorm** because Spoonacular dead code routing eats the wildcard slot. PRD-001 P0.8 fixes. |
| Household preferences | **Does not exist** | No table, no settings page, no UI surface, no filtering logic. New feature for this PRD. |
| `prep_time` on vault | **Does not exist** | No column. New feature for this PRD. |
| `family_rating` on vault | **Scheduled but unbuilt** | PRD-001 P1.1 — must ship before PRD-002 can rank by it. |
| "Maybe" / shortlist meal state | **Does not exist** | `meal_plan_items` only has scheduled (date+position) or cooked. New state for this PRD. |
| Per-regeneration uniqueness | **Does not exist** | `/api/swap-suggestions` is stateless; calling it twice can return the same names. |
| ADR-001 Phase 7 (cleanup of deprecated `meal_plans` columns) | Pending | Out of scope for this PRD. |
| Audit U3 (last-week mapping ignores week boundaries) | Pending | In scope: include as a P0 polish item. |
| Audit U8 (timezone-naive date handling) | Pending | In scope: low effort, fixes a class of "today shows wrong" bugs. |

## 3. Goals

1. **Make suggestions feel curated, not random.** Family hits should rise, recently-eaten should fall, prep-time should be respected, household preferences should be hard-honored.
2. **Make multi-week planning feel continuous, not stuttery.** Roll-forward / leftover handoff between periods should be invisible-easy.
3. **Match the Planner's actual interaction model:** tap-a-day → see candidates (not drag-first). Drag-and-drop remains as a power-user reorder mechanic.
4. **Introduce a "Maybe" tray** so meals can be considered for the period without being committed to a day.
5. **Introduce a household preferences layer** that strictly disqualifies recipes violating dietary or other constraints.

## 4. Non-Goals

1. **Multi-user / partner collaboration.** Same single-user model as PRD-001; partner-collab is its own ADR.
2. **Per-household-member preferences** ("kid won't eat mushrooms"). Out of scope; deferred to partner-collab work. v1 preferences are at the household level.
3. **Quantitative ingredients / pantry awareness.** Owned by PRD-003. We do *not* introduce quantity/unit data here.
4. **Calendar-app integration** (Apple/Google). Already deferred to P3 in TODOs.
5. **A redesigned Brainstorm UI from scratch.** We're polishing and extending the current `BrainstormMode.jsx`, not rewriting it (though extracting components is welcome — see audit M1).
6. **AI suggestions that learn over time.** v1 uses the existing single-shot LLM endpoints; no embedding store, no preference inference.

## 5. Target Users & User Stories

**The Planner (primary):** Plans the week solo. Wants high-signal candidates, easy roll-forward, ability to dwell on "maybe" options.

**The Cook (secondary):** Same as PRD-001 — marks meals cooked during/after the period.

### Stories (priority order)

1. *As the Planner, I want suggestions that visibly weight family-rated favorites + prep-time fit + recency, so the candidate list feels like "what we actually want to eat" rather than a random vault sample.*
2. *As the Planner, I want to set household preferences (dietary restrictions, excluded ingredients, max prep time) once, so every brainstorm respects them automatically.*
3. *As the Planner, I want to tap a day in the plan and see candidates filtered for that day, so picking is one tap not three.*
4. *As the Planner, I want a "Maybe" tray where I can set aside meals I'm considering without committing them to a day, so I can think incrementally.*
5. *As the Planner, when I tap "Suggest more," I want the new candidates to be different from the ones I just saw, so regeneration actually produces variety.*
6. *As the Planner, when one period ends and I start a new one, I want uncooked meals to roll forward seamlessly (or be explicitly dismissed), so I don't lose track of what we meant to make.*
7. *As the Planner, I want to plan across week boundaries (e.g., Thu–Wed period) without the UI silently breaking, so my schedule isn't dictated by the calendar's week starts.*
8. *As the Planner, I want fresh AI candidates badged "new" mixed in with vault hits, so trying something different is one tap and not a separate flow.*
9. *As either user, I want the brainstorm to load fast on mobile and not require me to wait on a network call to scroll the candidate list, so the experience feels responsive.*

### Edge cases

- A vault recipe that satisfies all preferences but the only protein conflicts with a hard restriction (e.g., recipe has `proteins: ['Chicken','Fish']`, user is vegetarian) — must be filtered out, not deprioritized.
- Preference change mid-period — does it retroactively invalidate already-scheduled meals? Recommendation: warn the user, do not auto-remove.
- "Maybe" tray contains 30 items — needs sort and truncation rules.
- Suggestion regeneration when the entire vault has been recently eaten — engine returns nothing; UI must show "Nothing matches; try wildcards or relax preferences."
- Roll-forward when the prior period had cooked items only (no leftovers) — UI should not show an empty leftover tray.

## 6. Requirements

### Hard prerequisite (block this PRD)

| # | Requirement | Why |
|---|---|---|
| Pre-A | PRD-001 Phase 1 (P0.1–P0.4) shipped: `meals.vault_id` populated for new logs and back-linked from "Save to Cookbook." | Without this, the recommendation engine continues to operate on near-zero signal. PRD-002's "better suggestions" goal becomes vacuous. |
| Pre-B | PRD-001 P1.1 (`family_rating` column) shipped, OR scope of P0.5 below relaxed to "ranking-by-rating is gated on the column existing." | Family rating is a top-three signal per intake. |

### P0 — Must have

| # | Requirement | Acceptance criteria |
|---|---|---|
| P0.1 | **Household preferences schema** | Migration adds `household_preferences` table keyed on `user_id` with: `dietary_restrictions text[]` (enum: vegetarian, vegan, pescatarian, gluten_free, dairy_free, nut_free, ...), `excluded_ingredients text[]` (free-text), `excluded_cuisines text[]` (matches vault cuisine enum), `max_prep_time_minutes int nullable`, `updated_at timestamptz`. Owner-scoped RLS. |
| P0.2 | **Household preferences settings page** | New route `/settings/preferences` (or accessible from a settings icon in BrainstormMode). UI: chip pickers for dietary tags + cuisines, free-text add for excluded ingredients, slider for max prep time. Saves to `household_preferences` row (upsert pattern). |
| P0.3 | **Recommendation engine hard-filters by preferences before scoring** | `getRecommendations` accepts a `preferences` argument. Filter pass removes any vault item whose `dietary_tags` don't satisfy required restrictions, whose `cuisine_type` is in `excluded_cuisines`, whose `prep_time_minutes > max_prep_time_minutes`, or whose ingredient text mentions an excluded ingredient (substring match across `proteins`, `vegetables`, `dairy_components`, `fruits`). The filter runs *before* scoring; scoring only sees survivors. **Hard filter, no soft-penalty fallback in v1** (see P2.5). |
| P0.4 | **Add `prep_time_minutes` to `vault`** | Migration adds `prep_time_minutes int nullable`. Vault entry UI gains a numeric input (or chip-picker buckets: <15, 15–30, 30–60, 60+). `analyzeRecipe` AI prompt extended to estimate prep time when available. |
| P0.5 | **Recommendation scoring honors `family_rating` + `prep_time`** | `scoreVaultItem` adds: `+10 × family_rating` (so a 5-star = +50 boost; null rating = 0); penalty `-15` when `prep_time_minutes > preferences.max_prep_time_minutes / 2` (surfaces fast options when the user has a low cap). New unit tests cover both. |
| P0.6 | **"Maybe" / shortlist state on `meal_plan_items`** | Migration: `ALTER TABLE meal_plan_items ALTER COLUMN scheduled_date DROP NOT NULL; ADD COLUMN is_shortlisted boolean NOT NULL DEFAULT false; ADD CHECK (NOT (is_shortlisted AND scheduled_date IS NOT NULL))`. UI: tap a candidate → "Add to Maybe"; Maybe tray visible alongside the day grid. Promoting a Maybe item to a day clears `is_shortlisted` and sets `scheduled_date`. |
| P0.7 | **Tap-a-day → candidates picker** | Tapping an empty (or filled) day opens a sheet showing top-N filtered, ranked candidates from vault (with family-rating, prep-time badges) plus 3 AI candidates badged "new." Tap a candidate → it's scheduled to that day. Drag-and-drop preserved as the reorder mechanic, not the primary picker. |
| P0.8 | **Uniqueness across regenerations** | "Suggest more" / refresh actions must not return any recipe already in the current plan, the Maybe tray, or the previous suggestion batch. Implementation: pass an `excludeIds[]` to `getRecommendations`; pass `excludeNames[]` to `/api/swap-suggestions` (extend prompt). Client tracks the last batch's names in component state. |
| P0.9 | **AI candidates badged and mixed in** | Vault hits + AI candidates render in one ranked list; AI ones carry an inline "new" badge (and `is_wildcard: true`). Replaces today's empty-Spoonacular wildcard slot. |
| P0.10 | **Audit U3 fix: last-week mapping respects period boundaries** | `buildLastWeekSlots` (BrainstormMode.jsx:323) becomes period-aware: only meals from the *immediately prior* period (or last 7 days if no prior period) populate the "last week" view. New unit test. |
| P0.11 | **Audit U8 fix: timezone-naive date handling** | Centralize a `formatLocalDate(date)` helper in `src/lib/dateUtils.js`. Replace every call site that uses `toISOString().split('T')[0]` for an `eaten_on` / `scheduled_date` write. New test verifies an 11pm-PT save produces today's date, not tomorrow's. |
| P0.12 | **Preference change warning** | When the user edits preferences and the change would invalidate currently-scheduled or shortlisted meals, show an inline confirmation: "X meals in your active period violate the new preferences. Keep them anyway / remove them." User chooses; we do not auto-remove. |

### P1 — Nice to have

- **P1.1 Per-day filter chips** in the candidate sheet (e.g., "Show me only quick prep" or "Only proteins we haven't had this week"). Sits on top of the global preference filter.
- **P1.2 Lock-in feedback after Serve** — a one-question prompt ("How does this plan feel? thumbs/edit") so we capture qualitative signal on plan quality.
- **P1.3 Pantry-aware nudge (lite)** — vault recipes whose `proteins` overlap with the previous-period's leftovers get a small `+10` score bump. Real pantry awareness is PRD-003.
- **P1.4 Maybe tray sort options** (recently added, family rating, alphabetical).
- **P1.5 Preference presets** — a "Vegetarian Tuesday" toggle that imposes a per-weekday override of preferences.
- **P1.6 AI suggestion novelty dial** — a "novelty slider" in settings (Conservative / Balanced / Adventurous) that adjusts the wildcard ratio and the diversity weights in scoring.

### P2 — Future considerations

- **P2.1** Per-household-member preferences (deferred to partner-collab ADR).
- **P2.2** Meal-history insights dashboard (frequency by cuisine, prep-time distribution, family-rating trends).
- **P2.3** Auto-learning preferences (infer from low-rated meals over time).
- **P2.4** Integration with quantitative ingredients (PRD-003) to enable real pantry awareness.
- **P2.5** **Soft-penalty mode toggle** in preferences settings — per-preference, the user can choose `Strict` (hard filter, default) / `Preferred` (deprioritize in scoring but still surface) / `Off`. Useful when a household wants to relax a constraint occasionally without removing it. Out of scope for v1; introduce only after the strict mode has been used long enough to know what frictions emerge.
- **P2.6** **Untangle `meal_plans.served_at` from the "isServed" UI signal.** Today the column has `DEFAULT now()` at the DB layer (`supabase/migrations/00000000000000_baseline_schema.sql`), so the new-period flow (ADR-001 Phase 5, `startNewPeriod` in `src/lib/mealPlanWriter.js`) inserts a row without explicitly passing `served_at` and ends up with a server-stamped value. The subsequent `loadData` in `useBrainstorm` classifies the plan as `'active'` and unconditionally sets `isServed = true` — even though the user never tapped "Serve This Plan". Visible symptom: a brand-new empty period renders the green "Served on …" badge with a meaningless date (the server's insertion timestamp), the Serve CTA is hidden, and Reset is offered immediately. Not a crash, but a UX paper cut and a conceptual seam — "the row exists in `meal_plans`" and "the user pressed Serve" are two different states being conflated by the `served_at IS NOT NULL` shorthand. Two viable fixes: (a) drop the `DEFAULT now()` and make `served_at` truly opt-in — `startNewPeriod` leaves it null, `createServedPlan` sets it on commit; (b) add a dedicated boolean `is_served` column (cheap, but stores a derived state). (a) is cleaner. Either way, `useBrainstorm.loadData` should compute `isServed` from a real signal rather than from the lifecycle state of the row. Owner: meal-planning surface. Effort: small (one migration + one branch in `loadData`); risk: low (no UI removal, just no-longer-firing the post-serve banner pre-serve). Pairs well with ADR-001 Phase 7 cleanup of the deprecated `meal_plans` columns.

## 7. Data Model Changes Summary

Three migrations; all small and idempotent.

```sql
-- Migration A: household preferences
CREATE TABLE IF NOT EXISTS household_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  dietary_restrictions text[] NOT NULL DEFAULT '{}',
  excluded_ingredients text[] NOT NULL DEFAULT '{}',
  excluded_cuisines    text[] NOT NULL DEFAULT '{}',
  max_prep_time_minutes int CHECK (max_prep_time_minutes IS NULL OR max_prep_time_minutes > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE household_preferences ENABLE ROW LEVEL SECURITY;
-- + standard four owner-scoped policies on user_id

-- Migration B: vault.prep_time
ALTER TABLE vault ADD COLUMN IF NOT EXISTS prep_time_minutes int
  CHECK (prep_time_minutes IS NULL OR prep_time_minutes > 0);

-- Migration C: meal_plan_items.shortlist
ALTER TABLE meal_plan_items ALTER COLUMN scheduled_date DROP NOT NULL;
ALTER TABLE meal_plan_items
  ADD COLUMN IF NOT EXISTS is_shortlisted boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT meal_plan_items_shortlist_no_date
    CHECK (NOT (is_shortlisted AND scheduled_date IS NOT NULL));
CREATE INDEX IF NOT EXISTS meal_plan_items_user_shortlist_idx
  ON meal_plan_items (user_id, meal_plan_id) WHERE is_shortlisted = true;
```

Document each in `docs/schema.md`. Add verification SQL in `supabase/migrations/`.

## 8. Algorithm Changes (recommendations.js)

**Before scoring (NEW filter pass):**
```
filteredVault = vault.filter(item =>
  satisfiesDietary(item, prefs.dietary_restrictions) &&
  !prefs.excluded_cuisines.includes(item.cuisine_type) &&
  !hasExcludedIngredient(item, prefs.excluded_ingredients) &&
  (prefs.max_prep_time_minutes == null
    || item.prep_time_minutes == null
    || item.prep_time_minutes <= prefs.max_prep_time_minutes)
)
```

**Modified scoring:**
- Existing factors retained (cuisine/flavor diversity, method/carb/protein repetition penalties, frequency bonus, jitter)
- ADD: `+10 × family_rating` (null = 0). 5-star = +50 boost.
- ADD: prep-time bias — if user has set `max_prep_time_minutes`, items at <50% of that cap get +5; items >100% are already filtered out.
- KEEP: random jitter capped at +15.

**Post-filter for uniqueness:** before returning, exclude `excludeIds[]` (current plan + Maybe tray + previous batch).

**Wildcard sourcing:** call `/api/swap-suggestions` with extended prompt that includes the `excludeNames[]` so the LLM doesn't repeat its own prior output.

## 9. Success Metrics

### Leading indicators (1–2 weeks post-launch)

- **Suggestion satisfaction proxy** — % of brainstorm sessions where the Planner *kept* at least one of the auto-generated suggestions (vs. swapping every meal manually). Target: ≥ 60%.
- **Preference adoption** — % of users with at least one preference set within the first session of the settings page existing. Target: 100% (you, the test user).
- **Maybe tray usage** — Median number of items in the Maybe tray during an active brainstorm. Target: 1+ (i.e., the feature actually gets used).
- **Regeneration uniqueness** — Zero duplicate suggestions across consecutive `/api/swap-suggestions` calls in the same session.

### Lagging indicators (1–3 months)

- **Brainstorm time-to-completion** — Median time from "open BrainstormMode" to "Serve" decreases by ≥ 30%. Instrument with simple client-side timing.
- **Plan adherence** — % of `meal_plan_items` cooked at end of period. Target: ≥ 70%.
- **Reduced "scratch" planning** — Wife reports brainstorming feels "less like starting over" in a casual post-month check-in.

## 10. Open Questions

| # | Question | Owner |
|---|---|---|
| OQ.A | "Maybe" state implementation: nullable `scheduled_date` + `is_shortlisted` flag (recommended), separate `meal_plan_shortlist` table, or status enum? | Engineering — recommended approach in P0.6; final shape during impl |
| OQ.B | What's the right `scoreVaultItem` weight for `family_rating`? `+10 × rating` (so 5-star = +50) is a starting guess. Will likely tune empirically once enough rating data exists. | Engineering — tune post-impl |
| OQ.C | Does setting `excluded_ingredients` apply to the categorical arrays only (proteins, vegetables, etc.) or also to free-text fields like recipe notes? Latter is more correct but slower. | Product — recommend categorical-only for v1 |
| OQ.D | When user changes preferences mid-period, do already-cooked meals get any treatment? Recommendation: no — the past is the past. | Product — confirm |
| OQ.E | If the AI swap-suggestions endpoint returns a recipe name that fuzzy-matches an existing vault recipe, should we treat it as a duplicate (uniqueness violation) or surface it anyway? | Product — recommend treat as duplicate, log for vault-promotion offer |

## 11. Phasing & Timeline

PRD-002 is intentionally larger than PRD-001 in user-visible scope. Phase aggressively to ship usefulness early.

- **Phase 1 (P0.10, P0.11):** Bug-fix audit items (U3 boundary mapping, U8 timezone handling). Quick wins; can ship in one sitting. **Validates the existing roll-forward mechanics before piling new features on.**
- **Phase 2 (P0.4, P0.5, P0.8, P0.9):** Suggestion-quality upgrade — add `prep_time_minutes`, wire `family_rating` + prep-time into scoring, uniqueness across regenerations, AI candidates mixed in. *Largest single quality jump for least new UI.*
- **Phase 3 (P0.1, P0.2, P0.3, P0.12):** Preferences layer — schema + settings page + hard-filter in engine + change-warning. *Introduces a new route + page; biggest UX surface.*
- **Phase 4 (P0.6, P0.7):** Maybe tray + tap-a-day picker. *New interaction model; best after the candidate quality is already good.*

**Block on PRD-001:** Phases 2–4 cannot fully deliver until PRD-001 P0.1–P0.4 (the `meals.vault_id` link) and P1.1 (`family_rating`) are shipped. Phase 1 can run in parallel with PRD-001 work since it's independent.

## 12. Testing Plan (Vitest + Playwright)

| Requirement | Test file | Test cases |
|---|---|---|
| P0.1 / P0.3 | `src/lib/__tests__/preferenceFilter.test.js` (new) | Vegetarian filter excludes meat-protein vault items; excluded cuisines filtered; max_prep_time filter respected; null prep_time treated as "unknown, allow." |
| P0.2 | `src/pages/__tests__/PreferencesSettings.test.jsx` (new) | Form renders, saves to DB (mocked), upserts existing row. |
| P0.4 / P0.5 | extend `src/lib/__tests__/recommendations.test.js` | Recipe with rating=5 outscores rating=null sibling; prep_time bonus applied below threshold; full filter+score round-trip. |
| P0.6 | `src/lib/__tests__/mealPlanWriter.shortlist.test.js` (new) | Inserting `is_shortlisted=true` with `scheduled_date=null` succeeds; with both set fails CHECK; promoting clears flag. |
| P0.7 | `src/pages/__tests__/BrainstormMode.tapDayPicker.test.jsx` (new) | Tapping empty day opens sheet with ranked candidates; tap candidate schedules to that day. |
| P0.8 | extend `recommendations.test.js` | `excludeIds` parameter excludes; second call after first never returns first batch's items. |
| P0.10 | `src/pages/__tests__/BrainstormMode.lastWeek.test.jsx` (new) | Meal eaten 6 days ago in prior period does NOT appear in last-week view if a newer period exists. |
| P0.11 | `src/lib/__tests__/dateUtils.test.js` (new) | `formatLocalDate(11pm-PT)` returns today's date in PT, not tomorrow's UTC. |
| P0.12 | extend Preferences tests | Editing prefs that conflict with active items shows confirmation dialog. |

Add Playwright e2e: "set preferences → start a brainstorm → all candidates respect the preferences; tap-a-day picker shows only filtered candidates."

---

## 13. v0.3 Addendum — Search-to-Plan (Recipe Lookup)

Added 2026-05-30 in response to user feedback that BrainstormMode is recommendation-driven only and offers no fast path when the Planner already knows what they want for a specific day. Designed in a Cowork planning session; this addendum captures the agreed-upon scope. No changes to existing P0/P1 items above.

### 13.1 Problem and goal

Today's BrainstormMode + tap-a-day picker (§P0.7) optimizes for *recommendation discovery* — useful when the Planner is uncertain, frustrating when they know "Tuesday is taco night." There is no search affordance anywhere in the planning surface. The Vault is browsable but not searchable. The new goal: support two distinct planner intents with a unified search behavior.

- **Intent A — day-first.** "Tuesday is taco night." User has the day in mind; needs to find the recipe.
- **Intent B — recipe-first.** "We have salmon, gotta use it." User has the recipe in mind; the day is flexible.

### 13.2 New user stories (continue numbering from §5)

10. *As the Planner, when I know the recipe I want for a specific day, I want to search and assign in 2–3 taps, not scroll through recommendations.*
11. *As the Planner, when I have a recipe in mind but the day is flexible, I want to search from the top of Prep Table and pick the day from the result.*
12. *As the Planner, when I'm searching while cooking or folding laundry, I want voice input so I can plan hands-free.*
13. *As the Planner, when search misses (no matching recipe in my Cookbook), I want a one-tap path to add the recipe to the Cookbook and continue planning.*
14. *As the Planner, when I assign a recipe to a day that's already filled, I want the existing meal moved to Maybe (not silently overwritten), so I never lose planning work.*

### 13.3 New P0 requirements

| # | Requirement | Acceptance criteria |
|---|---|---|
| P0.13 | **Top-of-page search bar on Prep Table (recipe-first entry)** | A persistent search input pinned at the top of `BrainstormMode/index.jsx`. Visible only when an active plan exists (hidden if no active plan, hidden if the active plan is served — see edge cases). Tapping fires a sheet with the search input focused. Picking a result reveals a mini date-strip showing only the active plan's date range, with empty days highlighted and filled days dimmed-but-tappable. Tap a day → recipe is assigned, sheet closes, haptic feedback. |
| P0.14 | **Search field inside per-day picker sheet (day-first entry)** | The existing tap-a-day → bottom-sheet picker (§P0.7) gains a search field at the top of the sheet. Behavior: type → results filter in place; tap a result → immediately assigned to the pre-selected day, sheet closes. No date-strip needed (the day is already chosen). |
| P0.15 | **Top-of-page search bar on Vault** | A persistent search input pinned at the top of `Vault/index.jsx`. Filters the recipe list in place (no day-picking — Vault search is purely a "find what I'm looking for" filter). Tapping a result opens the recipe (current Vault tap behavior — no change). The existing "Add to plan" CTA on the expanded recipe card (per user direction) handles the planning hand-off from Vault. |
| P0.16 | **Search matching: name + ingredients + chips, ranked** | Extend `vault_fuzzy_match` RPC (or add a sibling RPC if cleaner) to score across recipe name, ingredient strings, and chip values (cuisine, proteins, dietary tags). Name matches rank highest, then ingredients, then chips. Typo tolerance via pg_trgm similarity (already in extension). Return columns: `match_id`, `match_name`, `match_image_url`, `match_score`, `match_field` (which field hit). Documented in `docs/schema.md`. |
| P0.17 | **Search result row UX (content, empty-input, no-results, voice)** | Each result row renders: thumbnail + recipe name + last-cooked badge (using `formatLastCooked` from PRD-001 P1.3) + an "already on plan" pill when relevant. Empty-input state shows a mix of recently-added vault recipes + frequently-cooked vault recipes (heuristic: 5 each, interleaved). No-results state shows the search query as a clickable "Add '<query>' to Cookbook" CTA that opens the Vault add-recipe form with the name pre-filled. A mic icon in the search field invokes `useSpeech.js` (already used in LogMode) to populate the field from voice input. |
| P0.18 | **Day-collision behavior on search-assign: bump to Maybe** | When P0.13 or P0.14 assigns a recipe to a day that already has a meal, the existing `meal_plan_items` row is updated to `is_shortlisted = true` + `scheduled_date = null` (the Maybe primitive from §P0.6), and the new recipe is inserted on that date. No confirmation dialog. Silent + reversible. This rule is the canonical collision behavior for the app and is referenced by PRD-007 §P0.6 (ghost-slot collisions) for consistency. |

### 13.4 Edge cases (specific to search)

- **Active plan is served (locked).** The top-bar search on Prep Table (P0.13) is hidden entirely on served plans. The per-day picker (P0.14) is already blocked by the existing `isServed` guard. Vault search (P0.15) is unaffected (plan-independent).
- **No active plan exists.** P0.13 search bar is absent (not greyed out — absent). Tapping a day to start a plan still uses the existing flow.
- **All days in active plan are filled.** P0.13 mini date-strip shows all days dimmed but tappable; tap fires the P0.18 bump-to-Maybe behavior. A subtle caption "Tap a day to swap" appears below the date-strip.
- **Search misses on a query containing no actual recipe-name characters** (e.g., "????"). Treat as no-results; show empty-input recommendations instead of the "Add to Cookbook" CTA.
- **Voice input → text contains the user's whole sentence** (e.g., "find me a chicken recipe"). Don't try to parse intent; just use the text as the query string. Common voice noise like leading "uh" and "find me" should be handled by simple prefix-stripping client-side OR ignored (worst case: results just aren't great for a query starting with "find me").
- **Already-on-plan pill on a search result** for a recipe that's currently on a *different* day in the active plan. Render the pill as "On plan [Tue]" to give context. Tapping the result still triggers normal assignment flow (and the bump-to-Maybe collision if the user picks a different day — yes, you can assign the same recipe twice; this is intentional, since planned leftovers are now first-class per PRD-007).

### 13.5 New P1 (search-related)

- **P1.7 Search history / recents.** After typing-and-assigning a query, store the query string; surface recent queries above the recommendations in empty-input state.
- **P1.8 Multi-day assignment from search.** From the Prep Table search flow (P0.13), allow selecting multiple days for one recipe (e.g., "tacos for Tue and Thu"). Single tap-tap-confirm UI on the mini date-strip.
- **P1.9 Filter chips inside search results.** Layer the existing preference filter as a togglable chip ("show only filtered" / "show all"); useful when the user is searching for something they normally exclude.

### 13.6 Data model changes (search-related)

No new tables. Possible RPC extension only:

```sql
-- New or extended RPC for ranked multi-field search.
-- Decide during impl whether to extend vault_fuzzy_match or add a sibling.
CREATE OR REPLACE FUNCTION vault_search (
  search_user_id uuid,
  search_query text,
  result_limit int DEFAULT 20
)
RETURNS TABLE (
  match_id uuid,
  match_name text,
  match_image_url text,
  match_score real,
  match_field text  -- 'name' | 'ingredient' | 'chip'
)
LANGUAGE sql
STABLE
AS $$
  -- Score across vault.name (highest weight), vault.ingredients_classified (medium),
  -- and vault chip columns (cuisine_type, proteins[], dietary_tags[], etc.) (lowest).
  -- Filter by user_id, exclude soft-deleted (deleted_at IS NULL).
  -- Order by composite score DESC, limit result_limit.
  -- Implementation detail; verify pg_trgm % operator is enabled.
$$;
```

Add `verify_<timestamp>.sql` confirming the RPC exists, returns expected shape, respects RLS implicitly (via `search_user_id` filter), and runs within latency budget on a representative vault size.

### 13.7 Phasing (search-related)

Single-phase rollout. P0.13 + P0.14 + P0.15 + P0.16 + P0.17 + P0.18 ship together as **Phase 5** of PRD-002 — they're tightly coupled and shipping search at one entry point only would feel incomplete. Estimate one focused PR; can split into "RPC + Vault search" and "Prep Table search + collision rule" if the diff is too large.

### 13.8 Testing (search-related)

| Requirement | Test file | Test cases |
|---|---|---|
| P0.13 | `src/pages/BrainstormMode/__tests__/SearchBar.test.jsx` (new) | Search bar absent when no plan; absent when plan is served; pick result → date-strip appears; pick date → meal assigned. |
| P0.14 | extend `src/pages/BrainstormMode/__tests__/BrainstormMode.tapDayPicker.test.jsx` | Search inside sheet filters in place; pick result → meal assigned, sheet closes. |
| P0.15 | `src/pages/Vault/__tests__/SearchBar.test.jsx` (new) | Search filters vault list; tap result opens recipe (no day-picking flow). |
| P0.16 | `src/lib/__tests__/vaultSearch.test.js` (new — RPC mock pattern) | Name match outranks ingredient match outranks chip match for the same recipe; soft-deleted recipes excluded; RLS respected via user_id filter. |
| P0.17 | extend SearchBar.test.jsx + Vault SearchBar.test.jsx | Empty-input shows recents-mixed recommendations; no-results shows "Add to Cookbook" CTA; voice icon invokes useSpeech mock. |
| P0.18 | extend `src/lib/__tests__/mealPlanWriter.test.js` | Search-assign on filled day moves existing item to Maybe (`is_shortlisted = true`, `scheduled_date = null`); new item occupies the date. |

Playwright e2e: "type 'tacos' in Prep Table search → tap result → pick Tuesday → verify Tacos appear on Tuesday's slot."

### 13.9 Open questions (search-specific)

| # | Question | Owner |
|---|---|---|
| OQ.F | Should `vault_search` be a new RPC or an extension of `vault_fuzzy_match`? Trade-off: separate RPC is cleaner; extending the existing one avoids two similar functions diverging. Recommend separate RPC for clarity. | Engineering — decide during impl |
| OQ.G | Voice input on Vault search vs. Prep Table search — same component or different? Recommend extracting a shared `SearchBar` component with `enableVoice` prop. | Engineering — decide during impl |
| OQ.H | "Frequently cooked" in the empty-input state — over what window? All time? Last 90 days? Recommend last 90 days to keep it relevant. | Product — confirm |
| OQ.I | Should a search result include recipes currently in the Maybe shortlist (assigned but not scheduled)? Recommend yes, with a "Maybe" pill on the row. | Product — confirm |

---

## Revision History

| Version | Date | Notes |
|---|---|---|
| v0.1 | 2026-04-25 | Initial draft, grounded in PRD-001 findings + ADR-001 phase-1 ship + code review of `recommendations.js`, `mealPlanReader.js`, `mealPlanWriter.js`, and `BrainstormMode.jsx` structure. Three new architectural surfaces introduced: household preferences, prep_time on vault, "maybe" state on meal_plan_items. Hard prerequisite on PRD-001 P0.1–P0.4 + P1.1. Soft-penalty mode confirmed deferred to P2.5. |
| v0.2 | 2026-05-30 | Added P2.6 — `served_at` / `isServed` conflation. Surfaced during the PR #135 investigation (current_leftovers shortlist-leak crash, `fix/current-leftovers-shortlist-crash`): while tracing the gap → new-period flow, found that brand-new empty periods enter `loadData`'s `state === 'active'` branch and set `isServed = true` via the row's DB-defaulted `served_at`. Doesn't crash, but renders a meaningless "Served on …" banner. Captured here so it isn't lost to context drift. No P0/P1 changes. |
| v0.3 | 2026-05-30 | Added §13 v0.3 Addendum — Search-to-Plan. Six new P0 items (P0.13–P0.18) covering top-of-page search on Prep Table and Vault, search inside the per-day picker sheet, ranked multi-field matching (name + ingredients + chips), result-row UX (last-cooked badge + already-on-plan pill + voice + Add-to-Cookbook fallback), and the canonical day-collision rule (bump existing meal to Maybe shortlist — cross-referenced by PRD-007 §P0.6 for ghost-slot consistency). Three P1 items (P1.7–P1.9). Phasing: single Phase 5 rollout. Authored in Cowork planning session after user feature feedback on (1) search, (2) mobile drag regression, (3) mid-period leftovers; PRD-007 captures the leftover work, the drag fix is a separate bug ticket. |
