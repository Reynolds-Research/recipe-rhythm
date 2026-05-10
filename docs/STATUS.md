# Recipe-Rhythm — Project Status

> **Single source of truth for "where are we?"** This file is updated as part of every PR that completes a PRD phase or a P-numbered requirement. If you find it stale, that itself is a bug — flag it in the next session and update it before doing anything else.
>
> Planning happens in Claude Cowork (Claude Desktop). Execution happens in Claude Code. This file is the bridge between the two surfaces.

**Last verified:** 2026-05-10 against `feat/decompose-brainstorm-mode` @ `66b332d` (PRD-005 P1.1 BrainstormMode decomposition)
**Maintained by:** whoever ships a PRD phase (Claude Code) — see "How this file is maintained" at the bottom.

---

## At a glance

| PRD | Title | Overall status | Next thing to plan |
|---|---|---|---|
| PRD-001 | Recipe Vault & Cooking Record | ✅ **All P0 + P1.1 + P1.3 shipped** (v1.0) | P1.2 + P1.4–P1.6 nice-to-haves; not blocking anything |
| PRD-002 | Meal Planning | ✅ **All P0 + P1.2 shipped** | P1.1 + P1.3 nice-to-haves |
| PRD-003 | Grocery Tracking | 🟡 **Phase 1 partially shipped** (Bite C-1) | P1 polish (auto-regenerate prompt, individual-item edit, plain-text export, custom section order, source-recipe captions, staple override) |
| PRD-004 | Smarter Ingredient Filtering | ✅ **All P0 shipped** | P1 nice-to-haves (override review surface, frequency analytics, AI confidence, periodic re-classification) |
| PRD-005 | Mobile UX, Spacing & Typography | ✅ **All P0 + P1.1 shipped** (Phases 1–8 + lint guardrail + BrainstormMode decomposition) | P1.2–P1.5 nice-to-haves |
| PRD-006 | Structured Ingredients & Household Scaling | 🟡 **P0.1–P0.7 shipped; P0.8 (Bite δ) in PR #89** | P0.8 merge → v1.0; then P1 nice-to-haves |

**PRD-006 doc authored 2026-05-04** ([`docs/prds/PRD-006-structured-ingredients-and-household-scaling.md`](./prds/PRD-006-structured-ingredients-and-household-scaling.md)) — closes the documentation gap previously flagged here. Retroactively captures the problem statement, P0.1–P0.6 scope (shipped), and P0.7 / Bite γ (shipped in PR #86). P0.8 / Bite δ wires structured-ingredient quantities through to the grocery-list prompt (PR #89).

---

## Cross-cutting — Information Architecture

Nav simplification work that doesn't belong to any one PRD.

### Shipped

- [x] **Groceries → Prep Table sheet** (PR #87, commit `7da022b`): folded the Groceries tab into a bottom sheet inside Prep Table, opened from the existing post-Serve action row. Removed `handleDownloadList` (pre-PRD-003 TXT export) as dead code. Bottom nav reduced from 6 tabs to 5 (Log, Prep Table, Calendar, Cookbook, Settings).

- [x] **Settings + Sign-out → top-right menu** (PR #TBD, commit `TBD`): replaced the standalone sign-out icon with a Menu icon that opens a bottom sheet containing Settings and Sign out. Removed the Settings entry from the bottom nav. Bottom nav reduced from 5 tabs to 4 (Log, Prep Table, Calendar, Cookbook).

### Pending

- [ ] **Remove the `page === 'grocery'` branch from `App.jsx`** — follow-up after a grace period (1 release). Removes `src/pages/GroceryList/index.jsx` page-level shell entirely; `GroceryListBody` stays as the canonical surface.

---

## PRD-001 — Recipe Vault & Cooking Record

[`docs/prds/PRD-001-recipe-vault-and-cooking-record.md`](./prds/PRD-001-recipe-vault-and-cooking-record.md) · **v1.0** · ✅ Complete (P0 + P1.1)

### Shipped

- [x] **Phase 1** (PR #25, P0.1–P0.4): `meals.vault_id` link, `pg_trgm` extension, `vault_fuzzy_match` RPC, LogMode auto-link + disambiguation UI, promote-to-Cookbook back-link.
- [x] **P1.1** (PR #29): `vault.family_rating` column + tap-to-rate stars.
- [x] **Phase 2** (PRs #30, #32, #33, P0.5–P0.7): vault soft-delete via `deleted_at`, centralized enum lists in `src/lib/constants.js`, `vault_options` table replacing `vault_extra_*` localStorage.
- [x] **Phase 3** (PRs #35, #36, P0.8–P0.9): Spoonacular cleanup; wildcards now sourced from `/api/swap-suggestions`. `Vault.jsx` decomposed into `Vault/{index, RecipeForm, RecipeCard, ChipPicker}.jsx` + `useVault.js`.

### Shipped (P1.x)

- [x] **P1.3** (PR #TBD, commit `TBD`): "Last cooked" badge on Vault cards. Single batched `meals` query joined client-side to vault rows in `useVault.fetchRecipes`. New `formatLastCooked` helper in `dateUtils.js` renders the relative phrase (today / yesterday / N days / N weeks / N months / over a year ago). Recipes never cooked render no badge — silence is the right default for "no signal."

### Pending

- [ ] P1.2 — Per-meal note prompt nudge ("How was it?")
- [ ] P1.4 — Voice dictation in Vault entry
- [ ] P1.5 — Bulk-link cleanup tool (retroactive fuzzy-match for old `meals.vault_id IS NULL` rows)
- [ ] P1.6 — API rate limiting + auth on `/api/*` endpoints
- [ ] P2.1–P2.5 — Future considerations (OCR, JSON-LD scraping, per-member preferences, insights dashboard, structured ingredients — last of which is largely covered by PRD-006)

---

## PRD-002 — Meal Planning

[`docs/prds/PRD-002-meal-planning.md`](./prds/PRD-002-meal-planning.md) · **v0.1** · ✅ All P0 shipped

### Shipped

- [x] **Phase 1** (commit `e11b406`, P0.10 + P0.11): audit U3 (last-week mapping respects period boundaries) + audit U8 (timezone-naive date handling, `formatLocalDate` helper).
- [x] **Phase 2** (PRs #40–#43, P0.4 + P0.5 + P0.8 + P0.9): `vault.prep_time_minutes` column + chip-bucket form, `family_rating` boost + `prep_time` penalty in scoring, exclude-prior-batch in regenerate/swap, AI candidates mixed into score-sorted batch.
- [x] **Phase 3** (PRs #50–#53, P0.1 + P0.2 + P0.3 + P0.12): `household_preferences` table + data layer, preferences settings page, recommender hard-filters by preferences, warn-on-conflicts when prefs invalidate active-period meals.
- [x] **Phase 4** (PRs #45 + #47, P0.6 + P0.7): "Maybe" / shortlist state on `meal_plan_items`, tap-a-day → bottom-sheet picker.

### Shipped (P1)

- [x] **P1.2** (PR #95, commit `a842fe1`): Lock-in feedback after Serve. "Serve This Plan" now opens a confirmation bottom sheet showing a compact plan summary and three actions: 👍 Looks great (commits with `served_feedback='positive'`), 👎 Lock in anyway (commits with `served_feedback='negative'`), ✏️ Let me adjust (dismisses sheet, no commit). Haptic trigger moved from sheet-open to actual commit. Migration `20260506000002` adds `meal_plans.served_feedback text CHECK (IN ('positive','negative'))`.

### Pending

- [ ] P1.1 — Per-day filter chips in candidate sheet
- [ ] P1.3 — Pantry-aware nudge lite (leftover protein bonus)
- [ ] P1.4 — Maybe tray sort options
- [ ] P1.5 — Preference presets ("Vegetarian Tuesday")
- [ ] P1.6 — AI suggestion novelty dial

---

## PRD-003 — Grocery Tracking

[`docs/prds/PRD-003-grocery-tracking.md`](./prds/PRD-003-grocery-tracking.md) · **v0.1** · 🟡 Phase 1 partially shipped

### Shipped

- [x] **P0.1** (PR #72): `grocery_lists` + `grocery_list_items` schema with RLS.
- [x] **P0.3** (PR #72): `/api/grocery-list` Haiku 4.5 endpoint (+ Vercel mirror).
- [x] **P0.4** (PR — see commit `af9479d`, "Bite C-1"): `GroceryList` page + nav entry + post-Serve CTA.
- [x] **P0.5** (same Bite C-1): Generate / Regenerate action wired up.
- [x] **P0.12** (same Bite C-1): lists scoped to a `meal_plan_id`.
- [x] **Fix** (commit `1a5ab3d`): unblock pre-serve meal picks + ingredient-less vault recipes.
- [x] **P0.6** (assumed, surface in `GroceryList` page): section grouping + canonical section enum. *Confirm this is fully implemented before declaring done.*
- [x] **P0.8** (assumed, basic toggle in `GroceryList` page): mark item bought toggle. *Confirm.*
- [x] **P0.2** (PR #90, commit `b8881ec`): `household_preferences.pantry_staples text[]` column + Settings UI section + grocery-list wiring. Lists generated after a staple is added skip any line item matching by case-insensitive substring.
- [x] **P0.7** (PR #91, commit `c1b83eb`): ad-hoc grocery-item add. Text input pinned to the bottom of the grocery list inserts a row with `is_adhoc=true`, `section='Other'`, `quantity=null`. Renders alongside AI-generated items in the Other section. Frontend-only — `is_adhoc` column already in place from P0.1 migration.

- [x] **P0.11 + P0.9 + P0.10** (PR #93): added `react-router-dom` v7 with two routes — `/` (existing App, page-state routing inside it preserved) and `/share/grocery/:token` (public read-only view). Share button on the grocery list opens a bottom sheet that generates a `crypto.randomUUID()` token, stores it on `grocery_lists.share_token`, and offers copy / revoke. Public route uses the same supabase client (anon key + existing public-share RLS policies from P0.1) and persists spouse-side check-offs in localStorage keyed by token. Vercel SPA rewrite added so non-API paths fall through to `/index.html`. Bottom-nav-to-NavLink conversion deferred — out of scope for this PR.

### In progress / pending

- [ ] All P1 polish (auto-regenerate prompt, individual-item edit, plain-text export, custom section order, source-recipe captions, staple override)

> ⚠️ **Verification needed:** the "Bite C-1" naming in commit `af9479d` implies more bites are coming for Phase 1. Check whether P0.6 / P0.8 are fully shipped or partial before relying on this status.

---

## PRD-004 — Smarter Ingredient Filtering

[`docs/prds/PRD-004-smarter-ingredient-filtering.md`](./prds/PRD-004-smarter-ingredient-filtering.md) · **Draft** · ✅ All P0 shipped

### Shipped

- [x] **Phase A — Foundation** (PR #54, commit `78b2f9c`): `vault.ingredients_classified jsonb` column, `/api/classify-ingredients` Haiku 4.5 endpoint, bulk backfill script (P0.1 + P0.2 + P0.3).
- [x] **Phase B — Validation gate** (PR #56 + #59, commits `5d860a0`, `5c6c22b`, `281fdd0`): ground-truth fixture, accuracy eval script, prompt tuning loop (P0.4 + P0.5 + P0.6).
- [x] **ADR-003 — Implied-meat dish-name filter** (commit `5732c8f`): app-layer dish-name keyword check in `passesPreferences` for vegetarian / vegan / pescatarian. (Adjacent to PRD-004, not on the phase plan; doesn't block Phase C.)
- [x] **Phase C — Filter behavior change** (PR #85, commit `d43260b`, P0.7 + P0.8 + P0.9): `passesPreferences` gates excluded-ingredient matches on `essentiality === 'essential'`; `/api/analyze-recipe` auto-classifies on save so new recipes never have `NULL` `ingredients_classified`; Preferences UI explains the new behavior.

- [x] **Phase D — Override UI** (PR #92, P0.10 + P0.11 + P0.12): expanded recipe cards now render every classified ingredient as a tappable essentiality badge. Tap flips essentiality and stamps `source: 'user'`. The `useVault.reExtractIngredients` path and the bulk backfill script both merge fresh AI classifications with existing user overrides via `src/lib/classificationOverrides.js` so user overrides survive re-classification.

### Pending

- [ ] All P1 polish (override review surface, override-frequency analytics, AI confidence score, periodic re-classification cron).

---

## PRD-005 — Mobile UX, Spacing & Typography

[`docs/prds/PRD-005-mobile-ux-spacing-typography.md`](./prds/PRD-005-mobile-ux-spacing-typography.md) · **v0.1** · ✅ All P0 shipped (Phases 1–8)

### Shipped

- [x] **Phase 1** (commit `b5f877e`, P0.1–P0.3): documented spacing / typography / contrast rules in `docs/architecture.md`.
- [x] **Phase 1** (commits `3417d3b`, `8700637`, P0.4): expanded design-system primitives in `index.css`; `.btn-primary` switched to `bg-brand-600` for AA contrast.
- [x] **Phase 2** (commits `ba1e0a2`, `3b1dde7`, P0.5): app-shell refactor — `.btn-icon` for sign-out, nav contrast bump, Vault `+` button moved into header content (collision fix).
- [x] **Phase 3** (PR #65, commits `8c1982b` + `93f2d91` + `a6ff10d` + `e6154e7`, P0.6): Vault primitive adoption + banned-class sweep across `ChipPicker`, `RecipeCard`, `RecipeForm`, `index`.
- [x] **Phase 4** (PR #66, commits `71b09f0` + `42565dd`, P0.7): BrainstormMode + DayPicker primitive adoption + banned-class sweep.
- [x] **Phase 5** (PR #67, commit `42434a7`, P0.8): LogMode primitive adoption + banned-class sweep.
- [x] **Phase 6** (PR #68, commit `34b7b39`, P0.9): Calendar primitive adoption + dropped cell preview text.
- [x] **Phase 7** (commits `2ce3610` + `5ed23ba`, P0.10 + P0.11): Settings centered-header pattern; primitive adoption across remaining shared components.
- [x] **Phase 8** (PR #70, commit `7c18101`, P0.12): CI design-system lint guardrail.
- [x] **Follow-up** (PR #71, commit `4b585a8`): banned-class sweep in DateRangePicker + MealNameConfirmSheet.

### Shipped (P1)

- [x] **P1.1** (PR #97, commits `4da1b6d`–`66b332d`): Decomposed `BrainstormMode.jsx` (~1,600 lines) into `BrainstormMode/{index, LastWeekCard, MealPlanCard, SortableMealItem, MaybeShortlist, useBrainstorm}`. Test file moved and paths updated; all 31 tests pass.

### Pending

- [ ] P1.2 — `/dev/styleguide` route showing every primitive in isolation.
- [ ] P1.3 — Standardized haptic feedback across pages.
- [ ] P1.4 — Skeleton loaders replacing "Loading…" gray text.
- [ ] P1.5 — Empty-state illustrations using `ChefKnife` SVG.

---

## PRD-006 — Structured Ingredients & Household Scaling

[`docs/prds/PRD-006-structured-ingredients-and-household-scaling.md`](./prds/PRD-006-structured-ingredients-and-household-scaling.md) · **Draft v0.2** · 🟡 P0.1–P0.7 shipped, P0.8 (Bite δ) in PR #89

### Shipped

- [x] **Phase 1 — Bite α** (PR #75, commit `103eb1c`, P0.1 + P0.2 + P0.3): schema migration (`vault.ingredients_structured jsonb`, `vault.servings int`, `household_preferences.adults`, `household_preferences.children`, CHECK constraint), shared `/api/analyze-recipe` handler at `api/_lib/analyzeRecipeHandler.js`, servings fallback chain (AI → caller default → hardcoded 4) with `servings_inferred` flag.
- [x] **Bite α follow-ups** (PR #76, commit `cd25f99`): scope `cooking_method` to dish-level technique; (commit `dfc3a12`): backfill script category-array selection fix.
- [x] **Phase 2 — Bite β** (PR #77, commit `1e2c518`, P0.4 + P0.5): bulk backfill script (`scripts/backfill-structured-ingredients.mjs`) + household-size preferences UI in Settings. Backfill registered as npm script in PR #79 (commit `610bf9d`): `npm run backfill:structured-ingredients`.
- [x] **Phase 3 — Path D1** (PR #78, commit `096778d`, P0.6): chip-grounded ingredient re-extraction with explicit `userChips` parameter on `/api/analyze-recipe`. Truth-hierarchy refinement (PR #80, commit `b5af1eb`): explicit ordering in the prompt — recipe URL/name = primary source for ingredients; user chips = authoritative for categorical attributes; never fabricate ingredients to fit a chip.

- [x] **Phase 4 — Bite γ** (PR #86, commit `c688c6e`, P0.7): grocery-list endpoint accepts `householdSize` + per-recipe `servings`; prompt scales quantities by `(householdSize / servings)` per recipe-line and consolidates after scaling. Recipes with `servings IS NULL` fall back to 4. Original Bite γ also covered a re-parse-on-edit trigger; that half was descoped 2026-05-05 (see PRD-006 §6 "Scope changes after authoring") because the assumed `vault.ingredients text[]` column never existed.
- [x] **Phase 5 — Bite δ** (PR #89, commit `31c8fe8`, P0.8): grocery-list page formats each ingredient string with the AI-extracted quantity inline (`"olive oil: 2 tbsp"`) when `vault.ingredients_structured` is populated, falling through to `ingredients_classified` names and then chip arrays. Prompt updated to use provided quantities as the scaling baseline. Also fixes a latent bug where `main_carb` (a single string) was spread into characters in the chip-fallback path. No API contract change.

### Pending

- [ ] All P1 polish (per-ingredient inline editing, reparse latency UX, kid-vs-adult scaling refinement, Path D2+).

---

## How this file is maintained

1. **When you finish a PRD phase or a P-numbered requirement**, update this file in the same PR that ships the work:
   - Move the relevant line from "Pending" to "Shipped" in the right PRD section.
   - Note the PR number and the commit hash if helpful.
   - Update the "Last verified" line at the top with today's date and the latest commit hash.
2. **At the start of every Cowork planning session**, the planner reads this file first and runs `git log --oneline -20` to confirm it matches reality. If they don't match, the session starts by reconciling — not by planning new work.
3. **At the start of every Claude Code execution session**, the executor reads this file alongside `CLAUDE.md` to understand current state before touching anything.
4. **Outdated `STATUS.md` is a release blocker.** Treat it the same as outdated `docs/schema.md` — if a reviewer notices drift, the PR doesn't merge until both are reconciled.

If this file ever falls out of sync (because a PR forgot to update it), recover by:

```bash
git log --oneline --since="2 weeks ago" | head -50
# Cross-check each PRD-tagged commit against the relevant PRD section.
```

…then update this file and call out in the next PR description that you reconciled drift.
