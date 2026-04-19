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

_Last verified: **2026-04-18** via [`supabase/audits/c3_rls_verification.sql`](../supabase/audits/c3_rls_verification.sql). `meals` and `vault` were remediated the same day via [`c3_rls_remediation_meals_vault.sql`](../supabase/audits/c3_rls_remediation_meals_vault.sql)._

### Tables (`public` schema)

| Table | RLS Enabled | SELECT policy | INSERT policy | UPDATE policy | DELETE policy | Notes |
|---|---|---|---|---|---|---|
| `meals` | ✅ true | ✅ `meals_select_own` — `USING (auth.uid() = user_id)`, role `authenticated` | ✅ `meals_insert_own` — `WITH CHECK (auth.uid() = user_id)` | ✅ `meals_update_own` — USING + WITH CHECK both `(auth.uid() = user_id)` | ✅ `meals_delete_own` — `USING (auth.uid() = user_id)` | Remediated 2026-04-18 via `c3_rls_remediation_meals_vault.sql`. Confirmed via Query 2. |
| `vault` | ✅ true | ✅ `vault_select_own` — `USING (auth.uid() = user_id)`, role `authenticated` | ✅ `vault_insert_own` — `WITH CHECK (auth.uid() = user_id)` | ✅ `vault_update_own` — USING + WITH CHECK both `(auth.uid() = user_id)` | ✅ `vault_delete_own` — `USING (auth.uid() = user_id)` | Remediated 2026-04-18. Confirmed via Query 2. |
| `meal_plans` | ✅ true | ✅ `Users can manage own meal plans` (FOR ALL) — `USING (user_id = auth.uid())`, role `public` | ✅ same policy (FOR ALL) — `WITH CHECK (user_id = auth.uid())` | ✅ same policy | ✅ same policy | Pre-existing, single `FOR ALL` policy. Functionally correct — `auth.uid()` is `NULL` for the `anon` role so even with `TO public` anonymous traffic matches nothing. Minor hardening option: recreate with `TO authenticated` for consistency with the other two tables. Non-urgent. |
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
Derived from `src/pages/BrainstormMode.jsx:274,435`.

| Column | Type (inferred) | Notes |
|---|---|---|
| `id` | `uuid` / `bigint` | PK. |
| `user_id` | `uuid` | References `auth.users(id)`. |
| `plan` / `items` | `jsonb` | The serialized plan payload (exact column name TBD from live schema). |
| `created_at` | `timestamptz` | Assumed default `now()`. |

## Storage

### `recipe_images`
- Referenced at `src/pages/Vault.jsx:355`, `:359`.
- Upload path today: `recipe-<epoch-ms>.jpg` at bucket root.
- RLS policies: see the table at the top of this document.
- See [`supabase/audits/c3_rls_remediation_templates.sql`](../supabase/audits/c3_rls_remediation_templates.sql)
  for the recommended per-user-folder policy pattern and the caveat about
  migrating existing objects before switching scoping models.

## Related audit items

- **AUDIT C3** — RLS coverage (this file's _Row Level Security Status_ section).
- **AUDIT H3** — schema documentation (this file).
- **AUDIT C2** — `.env.example` holding real credentials; only safe to ship
  as-is if every row above has `auth.uid() = user_id` RLS in place.
