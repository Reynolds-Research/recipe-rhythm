# Recipe Rhythm — Database Schema

_This document is the in-repo reference for the Supabase database backing
Recipe Rhythm. The audit-aware sections (RLS status) are filled in by
running the queries in [`supabase/audits/`](../supabase/audits/README.md)
and transcribing the results here._

## Row Level Security Status

> **How to refresh this section:** run
> [`supabase/audits/c3_rls_verification.sql`](../supabase/audits/c3_rls_verification.sql)
> in the Supabase SQL Editor, then replace each `TBD` below with the
> observed value and update the _Last verified_ date.

_Last verified: **2026-04-19** via [`supabase/audits/c3_rls_verification.sql`](../supabase/audits/c3_rls_verification.sql). Updates since previous verification: `meal_plan_items` table added with full owner-scoped RLS via [ADR-001 Phase 1 migration](../supabase/migrations/20260418000001_planning_periods_schema.sql); `meal_plans` extended with `period_start`/`period_end`/`finalized_at` columns + an EXCLUDE constraint preventing per-user period overlap. `meals` and `vault` were remediated 2026-04-18 via [`c3_rls_remediation_meals_vault.sql`](../supabase/audits/c3_rls_remediation_meals_vault.sql)._

### Tables (`public` schema)

| Table | RLS Enabled | SELECT policy | INSERT policy | UPDATE policy | DELETE policy | Notes |
|---|---|---|---|---|---|---|
| `meals` | ✅ true | ✅ `meals_select_own` — `USING (auth.uid() = user_id)`, role `authenticated` | ✅ `meals_insert_own` — `WITH CHECK (auth.uid() = user_id)` | ✅ `meals_update_own` — USING + WITH CHECK both `(auth.uid() = user_id)` | ✅ `meals_delete_own` — `USING (auth.uid() = user_id)` | Remediated 2026-04-18 via `c3_rls_remediation_meals_vault.sql`. Confirmed via Query 2. |
| `vault` | ✅ true | ✅ `vault_select_own` — `USING (auth.uid() = user_id)`, role `authenticated` | ✅ `vault_insert_own` — `WITH CHECK (auth.uid() = user_id)` | ✅ `vault_update_own` — USING + WITH CHECK both `(auth.uid() = user_id)` | ✅ `vault_delete_own` — `USING (auth.uid() = user_id)` | Remediated 2026-04-18. Confirmed via Query 2. |
| `meal_plans` | ✅ true | ✅ `Users can manage own meal plans` (FOR ALL) — `USING (user_id = auth.uid())`, role `public` | ✅ same policy (FOR ALL) — `WITH CHECK (user_id = auth.uid())` | ✅ same policy | ✅ same policy | Pre-existing, single `FOR ALL` policy. Functionally correct — `auth.uid()` is `NULL` for the `anon` role so even with `TO public` anonymous traffic matches nothing. Minor hardening option: recreate with `TO authenticated` for consistency with the other two tables. Non-urgent. Hardening SQL prepared (not yet run): [`c3_remediation_meal_plans_role.sql`](../supabase/audits/c3_remediation_meal_plans_role.sql) replaces the single `FOR ALL / TO public` policy with four per-operation `TO authenticated` policies matching meals/vault. **Also has the `meal_plans_no_period_overlap` EXCLUDE constraint** (added 2026-04-19 via ADR-001 Phase 1) preventing per-user period overlap. |
| `meal_plan_items` | ✅ true | ✅ `meal_plan_items_select_own` — `USING (auth.uid() = user_id)` | ✅ `meal_plan_items_insert_own` — `WITH CHECK (auth.uid() = user_id)` | ✅ `meal_plan_items_update_own` — USING + WITH CHECK both `(auth.uid() = user_id)` | ✅ `meal_plan_items_delete_own` — `USING (auth.uid() = user_id)` | Added 2026-04-19 via [ADR-001 Phase 1 migration](../supabase/migrations/20260418000001_planning_periods_schema.sql). Mirrors the `meals`/`vault` policy pattern. Child of `meal_plans` (FK with `ON DELETE CASCADE`); deleting a meal_plans row automatically removes its items. |
| `household_preferences` | ✅ true | ✅ `household_preferences_select_own` — `USING (auth.uid() = user_id)`, role `authenticated` | ✅ `household_preferences_insert_own` — `WITH CHECK (auth.uid() = user_id)` | ✅ `household_preferences_update_own` — USING + WITH CHECK both `(auth.uid() = user_id)` | ✅ `household_preferences_delete_own` — `USING (auth.uid() = user_id)` | Added 2026-04-27 via [PRD-002 P0.1 migration](../supabase/migrations/20260427000003_household_preferences.sql). Mirrors the `meal_plan_items` policy pattern. RLS-enabled; per-operation policies. The Row-Level-Security Status header above was last live-verified 2026-04-19 — re-run [`supabase/audits/c3_rls_verification.sql`](../supabase/audits/c3_rls_verification.sql) when convenient to refresh. |
| `grocery_lists` | ✅ true | ✅ `grocery_lists_select_own` — `USING (auth.uid() = user_id)`, role `authenticated`; PLUS `grocery_lists_public_share` — `USING (share_token IS NOT NULL)`, role `anon` | ✅ `grocery_lists_insert_own` — `WITH CHECK (auth.uid() = user_id)` | ✅ `grocery_lists_update_own` — USING + WITH CHECK both `(auth.uid() = user_id)` | ✅ `grocery_lists_delete_own` — `USING (auth.uid() = user_id)` | Added 2026-05-02 via [PRD-003 P0.1 migration](../supabase/migrations/20260502000001_grocery_lists_schema.sql). Owner-scoped per-operation policies (role `authenticated`) + a public share SELECT policy (role `anon`, `USING (share_token IS NOT NULL)`). The anon policy is a no-op until Phase 3 populates `share_token`. |
| `grocery_list_items` | ✅ true | ✅ `grocery_list_items_select_own` — join via `list_id → grocery_lists.user_id`, role `authenticated`; PLUS `grocery_list_items_public_share` — join via `list_id → grocery_lists.share_token IS NOT NULL`, role `anon` | ✅ `grocery_list_items_insert_own` — join-based WITH CHECK | ✅ `grocery_list_items_update_own` — join-based USING + WITH CHECK | ✅ `grocery_list_items_delete_own` — join-based USING | Added 2026-05-02 via [PRD-003 P0.1 migration](../supabase/migrations/20260502000001_grocery_lists_schema.sql). No `user_id` column — ownership derived by subquery joining to `grocery_lists`. |
| `profiles` | ❌ **false — but empty (0 rows)** | N/A (RLS off) | N/A (RLS off) | N/A (RLS off) | N/A (RLS off) | Not referenced anywhere in `src/` and contains 0 rows. Confirmed as a starter-template remnant. Recommended action: drop the table — see [`supabase/audits/c3_remediation_drop_profiles.sql`](../supabase/audits/c3_remediation_drop_profiles.sql). |

Legend for each policy column: write either the policy name (if present)
or one of `❌ missing`, `⚠️ overly-permissive` (e.g. `USING (true)`), or
`✅ auth.uid() = user_id` for the standard pattern. If RLS is disabled on
the table, mark every policy column as `N/A (RLS off)` and treat the row
as a **P0 finding**.

### Storage buckets

| Bucket | Public? | SELECT policy | INSERT policy | UPDATE policy | DELETE policy | Notes |
|---|---|---|---|---|---|---|
| `recipe_images` | ✅ `public = true` | ✅ implicit via bucket-public flag (any URL is world-readable) | ⚠️ `Allow Authenticated Uploads g90qbt_0` — `WITH CHECK (bucket_id = 'recipe_images')`. Any signed-in user can upload anywhere in the bucket; no per-user folder scoping. | ❌ no policy (blocked except for service role) | ❌ no policy (blocked except for service role) | Used by `src/pages/Vault/useVault.js` (post-P0.9 decomposition; was previously `Vault.jsx`), which uploads to bucket root as `recipe-<timestamp>.jpg` and renders via `getPublicUrl`. Acceptable for the current single-user deployment. Before onboarding a second user: (a) change the upload path in `useVault.js` to `${userId}/recipe-<ts>.jpg`, (b) migrate existing objects into per-user folders, (c) apply Template B1 in `c3_rls_remediation_templates.sql`, (d) consider flipping the bucket to `public = false` + signed URLs if image URLs should not be world-guessable. |

## Tables — column reference

These column lists are reconstructed from application code and are a best
effort until the live schema is dumped. Confirm against
`information_schema.columns` when updating.

### `public.meals`
Derived from `src/pages/LogMode.jsx:30` and `src/App.jsx:30`.

| Column | Type (inferred) | Notes |
|---|---|---|
| `id` | `uuid` / `bigint` | PK (assumed). |
| `user_id` | `uuid` | References `auth.users(id)`. Used as the RLS key. |
| `name` | `text` | Meal name entered via voice/text. |
| `vault_id` | `uuid` nullable | **Added PRD-001 Phase 1 (P0.1).** References `vault(id)` `ON DELETE SET NULL`. NULL when no match was found at log time, or when the linked vault row was later deleted. Drives frequency/recency scoring in `src/lib/recommendations.js`. Indexed via `(user_id, vault_id)` (`meals_user_vault_idx`). |
| `notes` | `text` nullable | Free-text note attached to a meal log (e.g. "more lime next time"). Written by `src/pages/LogMode.jsx` and copied onto the vault row when the user promotes the meal via Save-to-Cookbook. Existence confirmed against `information_schema.columns` on 2026-04-25. |
| `eaten_on` | `date` | Written as `new Date().toISOString().split('T')[0]` — see AUDIT U8 for the timezone caveat. |
| `created_at` | `timestamptz` | Assumed default `now()`. |

### `public.vault`
Derived from `src/pages/Vault/useVault.js` (the inserts at lines ~177 and ~204; line numbers drift, prefer grep `from('vault').insert`). Enum-shaped column values come from `src/lib/constants.js` (the canonical option lists post-P0.6).

| Column | Type (inferred) | Notes |
|---|---|---|
| `id` | `uuid` / `bigint` | PK. |
| `user_id` | `uuid` | References `auth.users(id)`. |
| `name` | `text` | Recipe name. |
| `image_url` | `text` nullable | Public URL from the `recipe_images` bucket. |
| `cuisine_type` | `text` nullable | Enum-like — see `src/lib/constants.js` (`CUISINE_OPTIONS`, single source of truth post-P0.6). User-added custom values persist in `public.vault_options` (post-P0.7). |
| `flavor_profile` | `text` nullable | |
| `notes` | `text` nullable | |
| `recipe_url` | `text` nullable | |
| `is_wildcard` | `bool` | |
| `auto_completed` | `bool` | |
| `proteins` | `text[]` nullable | |
| `cooking_method` | `text` nullable | |
| `main_carb` | `text` nullable | |
| `dietary_tags` | `text[]` nullable | |
| `dairy_components` | `text[]` nullable | |
| `vegetables` | `text[]` nullable | |
| `fruits` | `text[]` nullable | |
| `family_rating` | `smallint` nullable | **Added 2026-04-26** via [PRD-001 P1.1 migration](../supabase/migrations/20260426000003_vault_family_rating.sql). 1–5 household rating; `NULL` = unrated. CHECK constraint enforces `family_rating IS NULL OR family_rating BETWEEN 1 AND 5`. Drives the "family hits" ranking signal that PRD-002 (Meal Planning) will consume. |
| `prep_time_minutes` | `int` nullable | **Added 2026-04-27** via [PRD-002 Phase 2 migration](../supabase/migrations/20260427000001_vault_prep_time.sql). Estimated minutes of active prep + cook time. `NULL` = unknown. CHECK constraint: `prep_time_minutes IS NULL OR prep_time_minutes > 0`. Written by the recipe-add form via the `PREP_TIME_BUCKETS` chip picker (storedValue per bucket: 15 / 30 / 60 / 90; round-trip via `bucketForMinutes` in [`src/lib/constants.js`](../src/lib/constants.js)) or by the `analyzeRecipe` AI when it can estimate from the source — manual chip selections always win over the AI estimate. Drives the prep-time badge in BrainstormMode and (paired with `household_preferences` in Phase 3) the prep-time scoring penalty in `src/lib/recommendations.js`. |
| `ingredients_classified` | `jsonb` nullable | **Added 2026-04-28** via [PRD-004 Phase A migration](../supabase/migrations/20260428000001_vault_ingredients_classified.sql). AI-classified essentiality of the recipe's ingredients per [ADR-002](../adr/ADR-002-ingredient-classification.md). Shape: `[{name: string, essentiality: 'essential' \| 'omittable', source: 'ai' \| 'user'}, ...]`. `NULL` = not yet classified. Populated by [`scripts/backfill-ingredients-classification.js`](../scripts/backfill-ingredients-classification.js) (one-time bulk pass calling `/api/classify-ingredients`, Haiku 4.5) for existing rows; Phase C P0.8 will wire `/api/analyze-recipe` to classify on save. Phase A is foundation only — `passesPreferences` continues using the substring-match path until Phase C P0.7 flips it. RLS: existing owner-scoped vault policies cover the column (no policy changes needed). |
| `ingredients_structured` | `jsonb` nullable | **Added 2026-05-03** via [PRD-006 P0.1 migration](../supabase/migrations/20260503000001_structured_ingredients_and_household.sql). AI-parsed ingredient list. `NULL` = not yet parsed or parse failed (backfill in Bite β; re-parse on edit in Bite γ). Shape: `[{name: string, quantity: string\|null, unit: string\|null, notes: string\|null}]`. **`ingredients_structured` is AI-populated; the human-readable `ingredients text[]` remains the source of truth** and triggers a reparse when edited (PRD-006 P0.7, Bite γ). Populated by `/api/analyze-recipe` (Sonnet 4.6) on new recipe saves. Existing vault RLS policies cover this column — no policy changes needed. |
| `servings` | `int` nullable | **Added 2026-05-03** via [PRD-006 P0.1 migration](../supabase/migrations/20260503000001_structured_ingredients_and_household.sql). AI-extracted recipe yield (number of portions). `NULL` = AI could not infer from the recipe text; callers fall back to `household_preferences.adults` (wired in PRD-006 Bite γ) or the hardcoded default of 4 (Bite α). Populated by `/api/analyze-recipe`; `servings_inferred: bool` in the response indicates whether the AI supplied the value or the endpoint fell back. Existing vault RLS policies cover this column. |
| `deleted_at` | `timestamptz` nullable | **Added 2026-04-26** via [PRD-001 Phase 2 Step 1 migration](../supabase/migrations/20260426000001_vault_soft_delete.sql). Soft-delete timestamp. `NULL` = active recipe; non-`NULL` = deleted (preserved so historical references in `meals.vault_id` and `meal_plan_items.vault_id` continue to resolve). All client-side Vault SELECTs filter `WHERE deleted_at IS NULL`; the `vault_fuzzy_match` RPC was updated in the same migration to apply the same filter server-side. Indexed via the partial index `vault_user_active_idx`. |
| `created_at` | `timestamptz` | Assumed default `now()`. |

### `public.vault_options`
**Added 2026-04-26** via [PRD-001 Phase 2 Step 3 migration](../supabase/migrations/20260426000002_vault_options_table.sql). One row per (user, category, value) custom chip-picker tag. Backs `src/lib/vaultOptions.js`; replaces the previous per-device `vault_extra_*` localStorage scheme used by `Vault.jsx`'s ChipPicker. Built-in option lists still live in [`src/lib/constants.js`](../src/lib/constants.js); this table holds only the user's custom additions on top of those.

| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` NOT NULL | References `auth.users(id)` `ON DELETE CASCADE`. RLS key. |
| `category` | `text` NOT NULL | One of the nine canonical categories enforced by a CHECK constraint: `cuisine_type`, `flavor_profile`, `proteins`, `cooking_method`, `main_carb`, `dietary_tags`, `dairy_components`, `vegetables`, `fruits`. Mirrors the export list in `src/lib/constants.js`. Note the rename: the legacy localStorage suffix was `dairy`; the canonical category here is `dairy_components`. |
| `value` | `text` NOT NULL | The user's custom tag value. Trimmed by `addVaultOption` before insert; empty strings rejected. |
| `created_at` | `timestamptz` NOT NULL | Default `now()`. |

**Primary key:** composite `(user_id, category, value)` — same value for the same user/category is a no-op upsert. `addVaultOption` uses `onConflict: 'user_id,category,value'` so the migration helper can re-import idempotently.

**RLS:** four owner-scoped policies set in the migration — `vault_options_select_own`, `vault_options_insert_own`, `vault_options_update_own`, `vault_options_delete_own` — all keyed on `auth.uid() = user_id`. Mirrors the `meals` / `vault` / `meal_plan_items` pattern. The Row-Level-Security Status table at the top of this doc was last live-verified 2026-04-19 and does not yet list this table — re-run [`supabase/audits/c3_rls_verification.sql`](../supabase/audits/c3_rls_verification.sql) when convenient to refresh.

### `public.profiles`
**Not referenced in `src/`. Confirmed 0 rows on 2026-04-18.** Starter-template
remnant. Recommended: drop it — see
[`c3_remediation_drop_profiles.sql`](../supabase/audits/c3_remediation_drop_profiles.sql).

### `public.meal_plans`
Derived from `src/pages/BrainstormMode.jsx:274,435` and the [ADR-001 Phase 1 migration](../supabase/migrations/20260418000001_planning_periods_schema.sql).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK (default `gen_random_uuid()`). |
| `user_id` | `uuid` | References `auth.users(id)`. RLS key. |
| `period_start` | `date` nullable | **Added ADR-001 Phase 1.** Inclusive start of the planning period. Nullable during soft migration; new rows must set it. |
| `period_end` | `date` nullable | **Added ADR-001 Phase 1.** Inclusive end of the planning period. Nullable during soft migration; new rows must set it. |
| `finalized_at` | `timestamptz` nullable | **Added ADR-001 Phase 1 (Q2 resolution).** When the user locked in the period via end-of-period review. NULL = active or ended-but-not-reviewed. Backfilled rows got `served_at` (treated as historical finalized). |
| `served_at` | `timestamptz` | Pre-existing. When the user clicked "Serve" — this was the implicit "this week" anchor before period_start/end were added. Still written by the current `handleServe` flow until ADR Phase 3 lands. |
| `week_label` | `text` | ⚠️ **Deprecated by ADR-001.** Display string like `"Sun–Thu"`. Will be dropped in ADR Phase 7 cleanup. |
| `days` | `text[]` / `jsonb` | ⚠️ **Deprecated by ADR-001.** Weekday strings like `['Sun','Mon','Tue','Wed','Thu']` — NOT real dates. Replaced by `meal_plan_items.scheduled_date`. Will be dropped in ADR Phase 7. |
| `items` | `jsonb` | ⚠️ **Deprecated by ADR-001.** Array of `{day, name, vault_id, is_wildcard, source_url}`. Replaced by the normalized `meal_plan_items` table. Backfill on 2026-04-19 unpacked existing rows into `meal_plan_items` and marked them `cooked = true`. Will be dropped in ADR Phase 7. |
| `created_at` | `timestamptz` | Default `now()` (assumed). |

**Constraint:** `meal_plans_no_period_overlap` — `EXCLUDE USING gist (user_id WITH =, daterange(period_start, period_end, '[]') WITH &&) WHERE (period_start IS NOT NULL AND period_end IS NOT NULL)`. Prevents two periods belonging to the same user from overlapping. Requires the `btree_gist` extension (also added by the migration).

### `public.meal_plan_items`
**Added 2026-04-19** via [ADR-001 Phase 1 migration](../supabase/migrations/20260418000001_planning_periods_schema.sql). One row per scheduled meal within a planning period. Replaces the old `meal_plans.items` jsonb. Cooked tracking, leftovers, and roll-forward all key off this table.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK (default `gen_random_uuid()`). |
| `user_id` | `uuid` | References `auth.users(id)` `ON DELETE CASCADE`. RLS key. Denormalized from `meal_plan_id → meal_plans.user_id` to keep RLS policies simple and fast. |
| `meal_plan_id` | `uuid` | References `meal_plans(id)` `ON DELETE CASCADE`. Deleting a meal_plan removes all its items. |
| `scheduled_date` | `date` nullable | The actual calendar date the meal is on. Replaces the weekday-string mapping in the legacy `items` jsonb. Indexed via `(user_id, scheduled_date)`. **Made nullable 2026-04-27** via [PRD-002 P0.6 migration](../supabase/migrations/20260427000002_meal_plan_items_shortlist.sql) — a NULL `scheduled_date` represents a "Maybe" / shortlist row. The `meal_plan_items_scheduled_xor_shortlisted` CHECK below pairs nullability with `is_shortlisted`. |
| `position` | `int` | Order within the day (default 0). For future use if multiple meals per day are supported. |
| `vault_id` | `uuid` nullable | References `vault(id)` `ON DELETE SET NULL`. If the vault recipe is deleted, the meal_plan_item keeps its `name` snapshot but loses the FK. |
| `name` | `text` | Denormalized snapshot of the recipe name at scheduling time. Survives vault recipe deletion/edit. |
| `is_wildcard` | `bool` | Default false. |
| `source_url` | `text` nullable | Recipe URL (often present for wildcards). |
| `cooked` | `bool` | Default false. Set to true when the user marks the item cooked during end-of-period review (ADR Phase 4) or mid-period via cooked-toggle. |
| `cooked_at` | `timestamptz` nullable | Set when `cooked` flips to true. Useful for stats. Backfilled rows from the historical `items` jsonb got `served_at` here. |
| `is_shortlisted` | `bool` | **Added 2026-04-27** via [PRD-002 P0.6 migration](../supabase/migrations/20260427000002_meal_plan_items_shortlist.sql). Default `false`. `TRUE` = the row is a "Maybe" / shortlist entry the user is considering for the active period but hasn't committed to a day yet (in which case `scheduled_date` is `NULL`). `FALSE` = the row is scheduled to a specific calendar date. The two states are mutually exclusive and exhaustive — see the `meal_plan_items_scheduled_xor_shortlisted` CHECK below. |
| `created_at` | `timestamptz` | Default `now()`. |

**Constraint:** `meal_plan_items_scheduled_xor_shortlisted` — `CHECK ((scheduled_date IS NULL) = is_shortlisted)`. Biconditional: a row is either scheduled (`scheduled_date` set, `is_shortlisted = false`) OR shortlisted (`scheduled_date IS NULL`, `is_shortlisted = true`), never both, never neither. Added 2026-04-27 via [PRD-002 P0.6 migration](../supabase/migrations/20260427000002_meal_plan_items_shortlist.sql).

**Indexes:**
- `meal_plan_items_user_scheduled_idx` on `(user_id, scheduled_date)` — supports calendar/timeline queries
- `meal_plan_items_meal_plan_id_idx` on `(meal_plan_id)` — supports loading all items for a plan
- `meal_plan_items_user_cooked_idx` on `(user_id, cooked)` — supports the leftover query
- `meal_plan_items_user_shortlist_idx` on `(user_id, meal_plan_id) WHERE is_shortlisted = true` — partial index supporting the Brainstorm "Maybe" tab query (added 2026-04-27)

### `public.household_preferences`
**Added 2026-04-27** via [PRD-002 P0.1 migration](../supabase/migrations/20260427000003_household_preferences.sql). One row per user holding meal-planning preferences. Drives the hard-filter in [`src/lib/recommendations.js`](../src/lib/recommendations.js) (P0.3, separate PR) and the settings page in BrainstormMode (P0.2, separate PR). NO auto-create on signup — the absence of a row means "no preferences set yet"; the data-layer helper [`src/lib/preferences.js`](../src/lib/preferences.js) returns a defaults object in that case. The row is lazily upserted by the settings UI the first time the user saves any preference.

| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` NOT NULL | PRIMARY KEY. References `auth.users(id)` `ON DELETE CASCADE`. RLS key. One row per user — no surrogate id needed. |
| `dietary_restrictions` | `text[]` NOT NULL DEFAULT `'{}'` | Array of `DIETARY_RESTRICTIONS` ids (case-sensitive) from [`src/lib/constants.js`](../src/lib/constants.js), e.g. `{vegetarian,gluten-free}`. **No DB-level CHECK enum** — vocabulary lives in `constants.js` so adding a new option does not require a migration. App-level validation in [`src/lib/preferences.js`](../src/lib/preferences.js) (`upsertPreferences`) rejects unknown ids before write. |
| `excluded_ingredients` | `text[]` NOT NULL DEFAULT `'{}'` | Array of free-text ingredient strings the user wants excluded (e.g. `{cilantro,olives}`). Normalized in `preferences.js` before write: trim + lowercase + dedupe. No app-side vocabulary check. |
| `excluded_cuisines` | `text[]` NOT NULL DEFAULT `'{}'` | Array of `CUISINE_OPTIONS` values (case-sensitive) from `constants.js`, e.g. `{Indian,Thai}`. App-level validation rejects unknown cuisines before write — same pattern as `dietary_restrictions`. |
| `max_prep_time_minutes` | `integer` nullable | Max prep time the user wants for recommendations. **`NULL` means "use the app default"** — the recommender (`src/lib/recommendations.js`) falls back to `DEFAULT_MAX_PREP_TIME_MINUTES` (90) when this is null. This table is dumb storage; the helper does NOT apply any default on read. CHECK constraint enforces `max_prep_time_minutes IS NULL OR max_prep_time_minutes > 0`. |
| `adults` | `int` NOT NULL DEFAULT `2` | **Added 2026-05-03** via [PRD-006 P0.1 migration](../supabase/migrations/20260503000001_structured_ingredients_and_household.sql). Number of adults in the household. Drives the default serving-size multiplier for grocery list scaling (PRD-006 Bite γ). CHECK constraint `household_prefs_eater_counts_chk` enforces `>= 1`. The settings UI to edit this value ships in PRD-006 Bite β. |
| `children` | `int` NOT NULL DEFAULT `0` | **Added 2026-05-03** via [PRD-006 P0.1 migration](../supabase/migrations/20260503000001_structured_ingredients_and_household.sql). Number of children in the household. Combined with `adults` to compute total household size for grocery scaling (PRD-006 Bite γ). CHECK constraint `household_prefs_eater_counts_chk` enforces `>= 0`. |
| `pantry_staples` | `text[]` NOT NULL DEFAULT `'{}'` | **Added 2026-05-06** via [PRD-003 P0.2 migration](../supabase/migrations/20260506000001_household_preferences_pantry_staples.sql). Array of free-text ingredient strings the user always has on hand. The grocery-list endpoint excludes any line item matching a staple by case-insensitive substring (so "salt" filters out "kosher salt", "sea salt", etc.). Normalized in [`src/lib/preferences.js`](../src/lib/preferences.js) before write: trim + lowercase + dedupe (same pattern as `excluded_ingredients`). No app-side vocabulary check — the substring filter is intentionally permissive. |
| `created_at` | `timestamptz` NOT NULL | Default `now()`. |
| `updated_at` | `timestamptz` NOT NULL | Default `now()`. Maintained by the `household_preferences_set_updated_at` `BEFORE UPDATE` trigger. |

**Constraints:**
- `max_prep_time_positive` — `CHECK (max_prep_time_minutes IS NULL OR max_prep_time_minutes > 0)`.
- `household_prefs_eater_counts_chk` — **Added 2026-05-03** — `CHECK (adults >= 1 AND children >= 0)`. Guards against a zero-adult household (would break serving-size division in Bite γ).

**Trigger:** `household_preferences_set_updated_at` — `BEFORE UPDATE FOR EACH ROW EXECUTE FUNCTION public.household_preferences_set_updated_at()`. Plain plpgsql function (the `moddatetime` extension is intentionally NOT enabled — a small in-repo trigger is cheaper than a new extension).

**RLS:** four owner-scoped per-operation policies set in the migration — `household_preferences_select_own`, `household_preferences_insert_own`, `household_preferences_update_own`, `household_preferences_delete_own` — all keyed on `auth.uid() = user_id`, role `authenticated`. Mirrors the `meal_plan_items` / `vault_options` pattern.

### `public.grocery_lists`
**Added 2026-05-02** via [PRD-003 P0.1 migration](../supabase/migrations/20260502000001_grocery_lists_schema.sql). One grocery list per meal-planning period (or ad-hoc, without a plan). Foundation only — no API endpoint or UI until Phase 1.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` NOT NULL | PK, `DEFAULT gen_random_uuid()`. |
| `user_id` | `uuid` NOT NULL | References `auth.users(id)` `ON DELETE CASCADE`. RLS key. |
| `meal_plan_id` | `uuid` nullable | References `meal_plans(id)` `ON DELETE SET NULL`. `NULL` = ad-hoc list (no plan). Unique partial index `grocery_lists_user_plan_idx` on `(user_id, meal_plan_id) WHERE meal_plan_id IS NOT NULL` prevents two lists for the same plan. |
| `share_token` | `text` nullable | Unique. `NULL` until the user generates a share link (Phase 3 P0.9). Set back to `NULL` on revoke (P0.10). The `anon` RLS policy (`grocery_lists_public_share`) allows SELECT when `share_token IS NOT NULL`; the application always queries `WHERE share_token = :token` for validation. |
| `created_at` | `timestamptz` NOT NULL | Default `now()`. |
| `updated_at` | `timestamptz` NOT NULL | Default `now()`. Maintained by `grocery_lists_set_updated_at` `BEFORE UPDATE` trigger (same pattern as `household_preferences`). |

**Indexes:**
- `grocery_lists_pkey` on `(id)` — primary key
- `grocery_lists_share_token_key` unique on `(share_token)` — from the `UNIQUE` column constraint
- `grocery_lists_user_idx` on `(user_id)` — fast "all lists for a user" lookup
- `grocery_lists_user_plan_idx` unique partial on `(user_id, meal_plan_id) WHERE meal_plan_id IS NOT NULL` — one plan → at most one list; ad-hoc lists (NULL plan) unconstrained

**Trigger:** `grocery_lists_set_updated_at` — `BEFORE UPDATE FOR EACH ROW EXECUTE FUNCTION public.grocery_lists_set_updated_at()`. Same in-repo plpgsql pattern as `household_preferences`; no `moddatetime` extension.

**RLS:** five policies:
- `grocery_lists_select_own` / `insert_own` / `update_own` / `delete_own` — four owner-scoped per-operation policies, role `authenticated`, keyed on `auth.uid() = user_id`
- `grocery_lists_public_share` — SELECT only, role `anon`, `USING (share_token IS NOT NULL)`. No-op until Phase 3 populates share tokens.

### `public.grocery_list_items`
**Added 2026-05-02** via [PRD-003 P0.1 migration](../supabase/migrations/20260502000001_grocery_lists_schema.sql). Individual line items within a grocery list. No `user_id` column — ownership derived by subquery join to `grocery_lists.user_id`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` NOT NULL | PK, `DEFAULT gen_random_uuid()`. |
| `list_id` | `uuid` NOT NULL | References `grocery_lists(id)` `ON DELETE CASCADE`. Indexed via `grocery_list_items_list_idx`. |
| `name` | `text` NOT NULL | Item name as returned by the AI (or typed by the user for ad-hoc items). |
| `quantity` | `text` nullable | Free-text AI output ("2 lbs", "1 bunch"). `NULL` = not specified. Structured `{value, unit}` is a P2 future (PRD OQ.A). |
| `section` | `text` NOT NULL | Default `'Other'`. One of `GROCERY_SECTIONS` from [`src/lib/constants.js`](../src/lib/constants.js). Enforced first by app-level validation; the `grocery_list_items_section_valid` CHECK constraint is a defense-in-depth backstop. Adding a new section requires both `constants.js` and a migration to relax this CHECK. |
| `is_bought` | `boolean` NOT NULL | Default `false`. Toggled when the user (or spouse via local state) checks off an item. |
| `is_adhoc` | `boolean` NOT NULL | Default `false`. `TRUE` for items added manually (not from AI generation). Default section = `'Other'` per PRD OQ.E; AI section-suggest on ad-hoc is a P1 enhancement. |
| `created_at` | `timestamptz` NOT NULL | Default `now()`. |

**Constraint:** `grocery_list_items_section_valid` — `CHECK (section IN ('Produce','Meat & Seafood','Dairy','Pantry','Frozen','Bakery','Beverages','Other'))`. Mirrors `GROCERY_SECTIONS` in `src/lib/constants.js`.

**Index:** `grocery_list_items_list_idx` on `(list_id)` — primary access pattern (load all items for a list).

**RLS:** five policies, all using a subquery join through `grocery_lists`:
- `grocery_list_items_select_own` / `insert_own` / `update_own` / `delete_own` — owner-scoped, role `authenticated`, `USING/WITH CHECK (list_id IN (SELECT id FROM grocery_lists WHERE user_id = auth.uid()))`. Uses the IN-subquery form rather than EXISTS — keeps the policy column reference (`list_id`) outside the subquery so PostgreSQL unambiguously resolves it to the policy table's column.
- `grocery_list_items_public_share` — SELECT only, role `anon`, `USING (list_id IN (SELECT id FROM grocery_lists WHERE share_token IS NOT NULL))`

## Views

### `public.current_leftovers`
**Added 2026-04-19** via [ADR-001 Phase 1 migration](../supabase/migrations/20260418000001_planning_periods_schema.sql). The SQL view that powers the gap-day "leftovers to roll forward" UI.

**Definition:** uncooked `meal_plan_items` from finalized planning periods whose `period_end` is in the past but within the last 14 days. The 14-day cap is a label-staleness rule per the ADR Retention Policy — the underlying rows are never deleted; they just stop appearing as "actionable leftovers" after two weeks.

```sql
SELECT mpi.*, mp.period_start AS source_period_start,
                mp.period_end   AS source_period_end,
                mp.finalized_at AS source_finalized_at
FROM meal_plan_items mpi
JOIN meal_plans mp ON mpi.meal_plan_id = mp.id
WHERE mpi.cooked = false
  AND mp.finalized_at IS NOT NULL
  AND mp.period_end < CURRENT_DATE
  AND mp.period_end >= (CURRENT_DATE - INTERVAL '14 days');
```

**RLS:** views inherit RLS from their underlying tables. Since both `meal_plans` and `meal_plan_items` have owner-scoped RLS on `user_id`, this view automatically returns only the calling user's leftovers. No separate policy needed.

## Storage

### `recipe_images`
- Referenced at `src/pages/Vault/useVault.js` (the upload + `getPublicUrl` calls; current line numbers ~163, ~167 — line numbers drift, prefer grep `recipe_images`).
- Upload path today: `recipe-<epoch-ms>.jpg` at bucket root.
- RLS policies: see the table at the top of this document.
- See [`supabase/audits/c3_rls_remediation_templates.sql`](../supabase/audits/c3_rls_remediation_templates.sql)
  for the recommended per-user-folder policy pattern and the caveat about
  migrating existing objects before switching scoping models.

## Migrations

The repo's source-of-truth for schema changes is [`supabase/migrations/`](../supabase/migrations/). Migrations are timestamp-prefixed and idempotent. Apply via the Supabase SQL Editor (paste into a query window and run) or the Supabase CLI if installed.

| File | Date | Purpose |
|---|---|---|
| [`00000000000000_baseline_schema.sql`](../supabase/migrations/00000000000000_baseline_schema.sql) | 2026-04-25 | Baseline schema (foundational tables created by hand pre-Phase-1; needed so Supabase Preview Branches can replay the migration tree from a blank DB). |
| [`20260418000001_planning_periods_schema.sql`](../supabase/migrations/20260418000001_planning_periods_schema.sql) | 2026-04-19 (applied) | ADR-001 Phase 1: extends `meal_plans` with period dates + `finalized_at`; creates `meal_plan_items`, `current_leftovers` view, EXCLUDE constraint, RLS policies; backfills existing rows. See [ADR-001](../adr/ADR-001-planning-period-save-state.md). |
| [`verify_20260418.sql`](../supabase/migrations/verify_20260418.sql) | 2026-04-19 | Read-only verification queries to confirm Phase 1 migration applied correctly. Run after the migration above. |
| [`20260425000001_meals_vault_link.sql`](../supabase/migrations/20260425000001_meals_vault_link.sql) | 2026-04-25 | PRD-001 Phase 1 (P0.1): enables `pg_trgm`, adds `meals.vault_id` (FK → `vault(id)` ON DELETE SET NULL) + `(user_id, vault_id)` index, defines the `vault_fuzzy_match` RPC. Restores the meals → vault link the recommendation engine relies on. |
| [`verify_20260425.sql`](../supabase/migrations/verify_20260425.sql) | 2026-04-25 | Read-only verification queries for the meals→vault link migration. Confirms `pg_trgm`, the new column + FK + index + comment, the RPC, and includes a sanity-check probe for the schema-doc gap on `meals.notes`. |
| [`20260426000003_vault_family_rating.sql`](../supabase/migrations/20260426000003_vault_family_rating.sql) | 2026-04-26 | PRD-001 P1.1: adds `vault.family_rating` (smallint, nullable, CHECK 1..5). Single shared household rating; drives the "family hits" signal that PRD-002 (Meal Planning) will consume. Filename uses `…000003` so the two reserved slots (`…000001`, `…000002`) for PRD-001 Phase 2 (vault soft-delete + vault_options) can land cleanly later. |
| [`verify_20260426_family_rating.sql`](../supabase/migrations/verify_20260426_family_rating.sql) | 2026-04-26 | Read-only verification queries for the family-rating migration: column shape, CHECK constraint, comment, and a smoke-count of unrated/rated rows. |
| [`20260426000001_vault_soft_delete.sql`](../supabase/migrations/20260426000001_vault_soft_delete.sql) | 2026-04-26 | PRD-001 Phase 2 Step 1 (P0.5): adds `vault.deleted_at` (timestamptz, nullable) + partial index `vault_user_active_idx ON vault (user_id) WHERE deleted_at IS NULL`. Updates the `vault_fuzzy_match` RPC body to filter `AND v.deleted_at IS NULL` (same signature as Phase 1 — `match_id`, `match_name`, `image_url`, `similarity`). Note: this is filename slot `…000001` even though it ships AFTER `…000003` (P1.1) — the slot was reserved for Phase 2 in advance. Both apply cleanly because the user runs migrations manually via the Supabase SQL Editor; ordering is per-application not by filename. |
| [`verify_20260426_soft_delete.sql`](../supabase/migrations/verify_20260426_soft_delete.sql) | 2026-04-26 | Read-only verification queries for the soft-delete migration: column shape, partial-index existence, comment, RPC body has the new filter, RPC output columns are still `match_id`/`match_name`/`image_url`/`similarity`, and a smoke-count of active vs. soft-deleted rows. |
| [`20260426000002_vault_options_table.sql`](../supabase/migrations/20260426000002_vault_options_table.sql) | 2026-04-26 | PRD-001 Phase 2 Step 3 (P0.7): creates `public.vault_options` table with composite PK `(user_id, category, value)`, CHECK constraint on the nine canonical category names, owner-scoped RLS. Backs `src/lib/vaultOptions.js`; replaces the previous `vault_extra_*` localStorage scheme in `Vault.jsx`. |
| [`verify_20260426_vault_options.sql`](../supabase/migrations/verify_20260426_vault_options.sql) | 2026-04-26 | Read-only verification queries for the vault_options migration: column shape, primary key, CHECK contents, RLS policies, RLS-enabled bit. |
| [`20260427000001_vault_prep_time.sql`](../supabase/migrations/20260427000001_vault_prep_time.sql) | 2026-04-27 | PRD-002 Phase 2 (P0.4): adds `vault.prep_time_minutes` (int, nullable, CHECK > 0). Populated by the `analyzeRecipe` AI prompt (extended in the same PR) or by the user via the recipe-add form. Drives the prep-time badge in BrainstormMode and (paired with the forthcoming `household_preferences` in Phase 3) the prep-time scoring penalty in `src/lib/recommendations.js`. |
| [`verify_20260427_prep_time.sql`](../supabase/migrations/verify_20260427_prep_time.sql) | 2026-04-27 | Read-only verification queries for the prep-time migration: column shape, CHECK constraint, comment, and a smoke-count of unrated/rated rows. |
| [`20260427000002_meal_plan_items_shortlist.sql`](../supabase/migrations/20260427000002_meal_plan_items_shortlist.sql) | 2026-04-27 | PRD-002 Phase 4 (P0.6): relaxes `meal_plan_items.scheduled_date` to nullable, adds `is_shortlisted` boolean (default `false`), and a biconditional CHECK `(scheduled_date IS NULL) = is_shortlisted` so every row is exactly one of "scheduled" or "shortlisted". Adds a partial index `meal_plan_items_user_shortlist_idx` for the Maybe-tab query. RLS policies on `meal_plan_items` already cover the new column (no policy changes). |
| [`verify_20260427_shortlist.sql`](../supabase/migrations/verify_20260427_shortlist.sql) | 2026-04-27 | Read-only verification queries for the shortlist migration: column shape, CHECK constraint, comment, partial index, and a smoke-count confirming every existing row is still scheduled (none shortlisted yet). |
| [`20260427000003_household_preferences.sql`](../supabase/migrations/20260427000003_household_preferences.sql) | 2026-04-27 | PRD-002 Phase 3 (P0.1): creates `public.household_preferences` (one row per user; `user_id` PK; `dietary_restrictions`/`excluded_ingredients`/`excluded_cuisines` as `text[] NOT NULL DEFAULT '{}'`; nullable `max_prep_time_minutes` with CHECK > 0 meaning "use app default"; `created_at`/`updated_at` timestamptz). Owner-scoped per-operation RLS, role `authenticated`. Adds an in-repo `BEFORE UPDATE` trigger function `household_preferences_set_updated_at` (no `moddatetime` extension). Backs `src/lib/preferences.js`; consumed by P0.2 settings UI and P0.3 recommender hard-filter (separate PRs). |
| [`verify_20260427_household_preferences.sql`](../supabase/migrations/verify_20260427_household_preferences.sql) | 2026-04-27 | Read-only verification queries for the household_preferences migration: column shape, primary key, CHECK constraint, RLS-enabled bit, four per-operation policies, `BEFORE UPDATE` trigger and its function, and a row-count smoke check (expected 0 immediately after migration). |
| [`20260428000001_vault_ingredients_classified.sql`](../supabase/migrations/20260428000001_vault_ingredients_classified.sql) | 2026-04-28 | PRD-004 Phase A (P0.1): adds `vault.ingredients_classified` (`jsonb` nullable). Shape `[{name, essentiality, source}, ...]` per ADR-002. NULL until populated by the bulk-backfill script. Existing owner-scoped vault RLS policies cover the new column — no policy work required. |
| [`verify_20260428_ingredients_classified.sql`](../supabase/migrations/verify_20260428_ingredients_classified.sql) | 2026-04-28 | Read-only verification queries for the ingredients_classified migration: column shape, comment, smoke counts of classified vs unclassified rows, and an RLS sanity check confirming the existing vault policies are intact. |
| [`20260502000001_grocery_lists_schema.sql`](../supabase/migrations/20260502000001_grocery_lists_schema.sql) | 2026-05-02 | PRD-003 Phase 1 (P0.1): creates `public.grocery_lists` and `public.grocery_list_items`. `grocery_lists` has `user_id`, `meal_plan_id` (FK `ON DELETE SET NULL`), `share_token` (unique nullable), `created_at`, `updated_at` + an `BEFORE UPDATE` trigger. `grocery_list_items` has `list_id`, `name`, `quantity` (free-text, OQ.A), `section` (CHECK against `GROCERY_SECTIONS`), `is_bought`, `is_adhoc`. Owner-scoped per-operation RLS on both tables; `anon`-role public SELECT policies for the share-link flow (no-op until Phase 3 populates tokens). Unique partial index `grocery_lists_user_plan_idx` prevents duplicate lists per plan while allowing multiple ad-hoc lists. No UI, no API endpoint — schema foundation only. |
| [`verify_20260502.sql`](../supabase/migrations/verify_20260502.sql) | 2026-05-02 | Read-only verification queries for the grocery schema migration: column shapes (both tables), RLS-enabled bits, all five owner-scoped + one anon SELECT policy on each table, all indexes, the section CHECK constraint definition, and an empty-row smoke check. Behavioral testing (CHECK rejection, unique-index blocking, RLS isolation) is covered at the application layer (Vitest + e2e). |
| [`20260503000001_structured_ingredients_and_household.sql`](../supabase/migrations/20260503000001_structured_ingredients_and_household.sql) | 2026-05-03 | PRD-006 P0.1: additive migration. Adds `vault.ingredients_structured` (`jsonb` nullable — AI-parsed ingredient list; `NULL` = not yet parsed) and `vault.servings` (`int` nullable — AI-extracted yield; `NULL` = couldn't infer). Adds `household_preferences.adults` (`int NOT NULL DEFAULT 2`) and `household_preferences.children` (`int NOT NULL DEFAULT 0`). Adds CHECK constraint `household_prefs_eater_counts_chk` (`adults >= 1 AND children >= 0`). No new tables, no new RLS policies — existing vault and household_preferences owner-scoped policies cover the new columns. Existing rows get `NULL` for vault columns (Bite β backfill) and default values `(2, 0)` for the preference columns. |
| [`verify_20260503.sql`](../supabase/migrations/verify_20260503.sql) | 2026-05-03 | Read-only verification queries for the structured-ingredients migration: column shapes for all four new columns, CHECK constraint existence, behavioral CHECK rejection test (adults = 0 → rolls back), smoke check that existing vault rows have `NULL` for the new columns, smoke check that existing preference rows have the expected defaults. |
| [`20260506000001_household_preferences_pantry_staples.sql`](../supabase/migrations/20260506000001_household_preferences_pantry_staples.sql) | 2026-05-06 | PRD-003 P0.2: adds `household_preferences.pantry_staples` (`text[]` NOT NULL DEFAULT `'{}'`). Existing owner-scoped RLS policies cover the new column. |
| [`verify_20260506_pantry_staples.sql`](../supabase/migrations/verify_20260506_pantry_staples.sql) | 2026-05-06 | Read-only verification queries: column shape, default applied to existing rows. |

## Related audit items + ADRs

- **AUDIT C3** — RLS coverage (this file's _Row Level Security Status_ section).
- **AUDIT H3** — schema documentation (this file).
- **AUDIT C2** — `.env.example` holding real credentials; only safe to ship
  as-is if every row above has `auth.uid() = user_id` RLS in place.
- **[ADR-001](../adr/ADR-001-planning-period-save-state.md)** — Planning period save state schema. Phase 1 (this migration) shipped 2026-04-19. Phases 2-7 (read path, write path, end-of-period UI, gap-day UI, calendar view, cleanup) are tracked in `RECIPE_TODOS.md`. The deprecated columns flagged on `meal_plans` above (`week_label`, `days`, `items`) will be dropped in Phase 7 after a stability window.
