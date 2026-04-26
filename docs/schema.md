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
| `profiles` | ❌ **false — but empty (0 rows)** | N/A (RLS off) | N/A (RLS off) | N/A (RLS off) | N/A (RLS off) | Not referenced anywhere in `src/` and contains 0 rows. Confirmed as a starter-template remnant. Recommended action: drop the table — see [`supabase/audits/c3_remediation_drop_profiles.sql`](../supabase/audits/c3_remediation_drop_profiles.sql). |

Legend for each policy column: write either the policy name (if present)
or one of `❌ missing`, `⚠️ overly-permissive` (e.g. `USING (true)`), or
`✅ auth.uid() = user_id` for the standard pattern. If RLS is disabled on
the table, mark every policy column as `N/A (RLS off)` and treat the row
as a **P0 finding**.

### Storage buckets

| Bucket | Public? | SELECT policy | INSERT policy | UPDATE policy | DELETE policy | Notes |
|---|---|---|---|---|---|---|
| `recipe_images` | ✅ `public = true` | ✅ implicit via bucket-public flag (any URL is world-readable) | ⚠️ `Allow Authenticated Uploads g90qbt_0` — `WITH CHECK (bucket_id = 'recipe_images')`. Any signed-in user can upload anywhere in the bucket; no per-user folder scoping. | ❌ no policy (blocked except for service role) | ❌ no policy (blocked except for service role) | Used by `src/pages/Vault.jsx`, which uploads to bucket root as `recipe-<timestamp>.jpg` and renders via `getPublicUrl`. Acceptable for the current single-user deployment. Before onboarding a second user: (a) change the upload path in `Vault.jsx` to `${userId}/recipe-<ts>.jpg`, (b) migrate existing objects into per-user folders, (c) apply Template B1 in `c3_rls_remediation_templates.sql`, (d) consider flipping the bucket to `public = false` + signed URLs if image URLs should not be world-guessable. |

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
Derived from `src/pages/Vault.jsx:370-387`.

| Column | Type (inferred) | Notes |
|---|---|---|
| `id` | `uuid` / `bigint` | PK. |
| `user_id` | `uuid` | References `auth.users(id)`. |
| `name` | `text` | Recipe name. |
| `image_url` | `text` nullable | Public URL from the `recipe_images` bucket. |
| `cuisine_type` | `text` nullable | Enum-like — see `src/pages/Vault.jsx`. |
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
| `created_at` | `timestamptz` | Assumed default `now()`. |

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
| `scheduled_date` | `date` | The actual calendar date the meal is on. Replaces the weekday-string mapping in the legacy `items` jsonb. Indexed via `(user_id, scheduled_date)`. |
| `position` | `int` | Order within the day (default 0). For future use if multiple meals per day are supported. |
| `vault_id` | `uuid` nullable | References `vault(id)` `ON DELETE SET NULL`. If the vault recipe is deleted, the meal_plan_item keeps its `name` snapshot but loses the FK. |
| `name` | `text` | Denormalized snapshot of the recipe name at scheduling time. Survives vault recipe deletion/edit. |
| `is_wildcard` | `bool` | Default false. |
| `source_url` | `text` nullable | Recipe URL (often present for wildcards). |
| `cooked` | `bool` | Default false. Set to true when the user marks the item cooked during end-of-period review (ADR Phase 4) or mid-period via cooked-toggle. |
| `cooked_at` | `timestamptz` nullable | Set when `cooked` flips to true. Useful for stats. Backfilled rows from the historical `items` jsonb got `served_at` here. |
| `created_at` | `timestamptz` | Default `now()`. |

**Indexes:**
- `meal_plan_items_user_scheduled_idx` on `(user_id, scheduled_date)` — supports calendar/timeline queries
- `meal_plan_items_meal_plan_id_idx` on `(meal_plan_id)` — supports loading all items for a plan
- `meal_plan_items_user_cooked_idx` on `(user_id, cooked)` — supports the leftover query

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
- Referenced at `src/pages/Vault.jsx:355`, `:359`.
- Upload path today: `recipe-<epoch-ms>.jpg` at bucket root.
- RLS policies: see the table at the top of this document.
- See [`supabase/audits/c3_rls_remediation_templates.sql`](../supabase/audits/c3_rls_remediation_templates.sql)
  for the recommended per-user-folder policy pattern and the caveat about
  migrating existing objects before switching scoping models.

## Migrations

The repo's source-of-truth for schema changes is [`supabase/migrations/`](../supabase/migrations/). Migrations are timestamp-prefixed and idempotent. Apply via the Supabase SQL Editor (paste into a query window and run) or the Supabase CLI if installed.

| File | Date | Purpose |
|---|---|---|
| [`20260418000001_planning_periods_schema.sql`](../supabase/migrations/20260418000001_planning_periods_schema.sql) | 2026-04-19 (applied) | ADR-001 Phase 1: extends `meal_plans` with period dates + `finalized_at`; creates `meal_plan_items`, `current_leftovers` view, EXCLUDE constraint, RLS policies; backfills existing rows. See [ADR-001](../adr/ADR-001-planning-period-save-state.md). |
| [`verify_20260418.sql`](../supabase/migrations/verify_20260418.sql) | 2026-04-19 | Read-only verification queries to confirm Phase 1 migration applied correctly. Run after the migration above. |
| [`20260425000001_meals_vault_link.sql`](../supabase/migrations/20260425000001_meals_vault_link.sql) | 2026-04-25 | PRD-001 Phase 1 (P0.1): enables `pg_trgm`, adds `meals.vault_id` (FK → `vault(id)` ON DELETE SET NULL) + `(user_id, vault_id)` index, defines the `vault_fuzzy_match` RPC. Restores the meals → vault link the recommendation engine relies on. |
| [`verify_20260425.sql`](../supabase/migrations/verify_20260425.sql) | 2026-04-25 | Read-only verification queries for the meals→vault link migration. Confirms `pg_trgm`, the new column + FK + index + comment, the RPC, and includes a sanity-check probe for the schema-doc gap on `meals.notes`. |

## Related audit items + ADRs

- **AUDIT C3** — RLS coverage (this file's _Row Level Security Status_ section).
- **AUDIT H3** — schema documentation (this file).
- **AUDIT C2** — `.env.example` holding real credentials; only safe to ship
  as-is if every row above has `auth.uid() = user_id` RLS in place.
- **[ADR-001](../adr/ADR-001-planning-period-save-state.md)** — Planning period save state schema. Phase 1 (this migration) shipped 2026-04-19. Phases 2-7 (read path, write path, end-of-period UI, gap-day UI, calendar view, cleanup) are tracked in `RECIPE_TODOS.md`. The deprecated columns flagged on `meal_plans` above (`week_label`, `days`, `items`) will be dropped in Phase 7 after a stability window.
