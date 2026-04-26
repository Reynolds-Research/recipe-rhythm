-- Verification queries for 20260426000002_vault_options_table.sql
--
-- Run AFTER the main migration. Each section is read-only (no mutations).
-- Expected results are described inline so you can eyeball correctness.

-- =========================================================================
-- 1. vault_options table exists with the right column shape
-- =========================================================================
-- Expected: four rows in this order (or any order — we just need all four).
--   user_id    | uuid                        | NO
--   category   | text                        | NO
--   value      | text                        | NO
--   created_at | timestamp with time zone    | NO

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'vault_options'
ORDER BY ordinal_position;


-- =========================================================================
-- 2. Primary key is the composite (user_id, category, value)
-- =========================================================================
-- Expected: one row, contype = 'p', pg_get_constraintdef contains
-- "PRIMARY KEY (user_id, category, value)".

SELECT
  conname,
  contype,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname = 'vault_options'
  AND c.contype = 'p';


-- =========================================================================
-- 3. CHECK constraint includes exactly the nine canonical category names
-- =========================================================================
-- Expected: one row whose definition lists all nine categories from
-- src/lib/constants.js: cuisine_type, flavor_profile, proteins,
-- cooking_method, main_carb, dietary_tags, dairy_components, vegetables, fruits.

SELECT
  conname,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname = 'vault_options'
  AND c.contype = 'c';


-- =========================================================================
-- 4. All four owner-scoped RLS policies exist
-- =========================================================================
-- Expected: four rows — vault_options_select_own, _insert_own,
-- _update_own, _delete_own — each scoped to auth.uid() = user_id.

SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'vault_options'
ORDER BY policyname;


-- =========================================================================
-- 5. RLS is enabled on the table
-- =========================================================================
-- Expected: one row, relrowsecurity = true.

SELECT
  c.relname,
  c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'vault_options';


-- =========================================================================
-- 6. Smoke count: should be 0 immediately after migration
-- =========================================================================
-- Expected: count = 0 right after the migration applies. Will grow as users
-- add custom chip-picker tags and the migrateLocalStorageExtras helper
-- imports any pre-existing vault_extra_* localStorage values.

SELECT count(*) AS row_count FROM public.vault_options;


-- =========================================================================
-- 7. Table comment documents the PRD reference
-- =========================================================================
-- Expected: one row whose obj_description starts with "PRD-001 P0.7:".

SELECT obj_description('public.vault_options'::regclass, 'pg_class') AS table_comment;
