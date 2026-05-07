-- Verification queries for 20260506000003_ai_response_caches.sql
--
-- Run AFTER the main migration. Read-only structural checks confirm the two
-- cache tables exist with the expected columns, constraints, indexes, and
-- RLS policies. Also confirms the security boundary: SELECT is open to
-- authenticated + anon, and there are NO INSERT/UPDATE/DELETE policies (so
-- writes can only come via the service-role key).
--
-- Run the full file, or sections individually, in the Supabase SQL Editor.


-- =========================================================================
-- 1. ingredient_classifications_cache — table + columns
-- =========================================================================
-- Expected: 4 rows
--   id                    | uuid        | NO  | gen_random_uuid()
--   recipe_name_norm      | text        | NO  | (no default)
--   ingredient_name_norm  | text        | NO  | (no default)
--   essentiality          | text        | NO  | (no default)
--   created_at            | timestamptz | NO  | now()

SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'ingredient_classifications_cache'
ORDER  BY ordinal_position;


-- =========================================================================
-- 2. ingredient_classifications_cache — CHECK constraint on essentiality
-- =========================================================================
-- Expected: 1 row | constraint_name = 'ingredient_classifications_cache_essentiality_valid'
-- The check_clause text contains "essential" and "omittable".

SELECT conname AS constraint_name,
       pg_get_constraintdef(oid) AS definition
FROM   pg_constraint
WHERE  conrelid = 'public.ingredient_classifications_cache'::regclass
  AND  contype  = 'c';


-- =========================================================================
-- 3. ingredient_classifications_cache — UNIQUE constraint on cache key
-- =========================================================================
-- Expected: 1 row | constraint_name = 'ingredient_classifications_cache_key_unique'
-- definition references (recipe_name_norm, ingredient_name_norm).

SELECT conname AS constraint_name,
       pg_get_constraintdef(oid) AS definition
FROM   pg_constraint
WHERE  conrelid = 'public.ingredient_classifications_cache'::regclass
  AND  contype  = 'u';


-- =========================================================================
-- 4. ingredient_classifications_cache — RLS enabled
-- =========================================================================
-- Expected: 1 row | relrowsecurity = TRUE

SELECT relname, relrowsecurity, relforcerowsecurity
FROM   pg_class
WHERE  oid = 'public.ingredient_classifications_cache'::regclass;


-- =========================================================================
-- 5. ingredient_classifications_cache — exactly one SELECT policy, NO write policies
-- =========================================================================
-- Expected: 1 row total
--   policyname = 'ingredient_classifications_cache_select_all'
--   cmd        = 'SELECT'
--   roles      = '{authenticated,anon}'
--   qual       = 'true'
--   with_check = NULL
--
-- If you see ANY policy with cmd in ('INSERT', 'UPDATE', 'DELETE'), the
-- security boundary has been compromised — the cache is meant to be
-- service-role-write-only. Investigate before merging.

SELECT policyname, cmd, roles, qual, with_check
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename  = 'ingredient_classifications_cache'
ORDER  BY policyname;


-- =========================================================================
-- 6. meal_name_normalizations_cache — table + columns
-- =========================================================================
-- Expected: 4 rows
--   id          | uuid        | NO  | gen_random_uuid()
--   input_norm  | text        | NO  | (no default)
--   corrected   | text        | NO  | (no default)
--   created_at  | timestamptz | NO  | now()

SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'meal_name_normalizations_cache'
ORDER  BY ordinal_position;


-- =========================================================================
-- 7. meal_name_normalizations_cache — UNIQUE on input_norm
-- =========================================================================
-- Expected: 1 row | UNIQUE constraint references (input_norm)

SELECT conname AS constraint_name,
       pg_get_constraintdef(oid) AS definition
FROM   pg_constraint
WHERE  conrelid = 'public.meal_name_normalizations_cache'::regclass
  AND  contype  = 'u';


-- =========================================================================
-- 8. meal_name_normalizations_cache — RLS enabled
-- =========================================================================
-- Expected: 1 row | relrowsecurity = TRUE

SELECT relname, relrowsecurity, relforcerowsecurity
FROM   pg_class
WHERE  oid = 'public.meal_name_normalizations_cache'::regclass;


-- =========================================================================
-- 9. meal_name_normalizations_cache — exactly one SELECT policy, NO write policies
-- =========================================================================
-- Expected: 1 row total
--   policyname = 'meal_name_normalizations_cache_select_all'
--   cmd        = 'SELECT'
--   roles      = '{authenticated,anon}'
--   qual       = 'true'
--   with_check = NULL

SELECT policyname, cmd, roles, qual, with_check
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename  = 'meal_name_normalizations_cache'
ORDER  BY policyname;


-- =========================================================================
-- 10. Smoke check — both cache tables empty after fresh migration
-- =========================================================================
-- Expected: both counts = 0 on a fresh install. (Will be > 0 after the
-- API server has handled at least one request post-deploy — that's fine.)

SELECT
  (SELECT COUNT(*) FROM public.ingredient_classifications_cache) AS classify_rows,
  (SELECT COUNT(*) FROM public.meal_name_normalizations_cache)   AS normalize_rows;
