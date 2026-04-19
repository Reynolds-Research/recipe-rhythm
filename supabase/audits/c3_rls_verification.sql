-- AUDIT C3 — RLS Verification Queries
-- Read-only. Safe to paste into the Supabase SQL Editor as-is.
--
-- Purpose: confirm which tables in the public schema have RLS enabled,
-- list every policy currently attached to them, and inspect storage-bucket
-- configuration for the `recipe_images` bucket.
--
-- Tables expected in this codebase (from grep of src/):
--   - public.meals
--   - public.vault
--   - public.meal_plans
-- Buckets expected:
--   - storage.buckets: recipe_images
--
-- After running these, record the findings in docs/schema.md (the
-- "Row Level Security Status" section) and report anything where
-- rls_enabled = false or where required policies are missing.

-- ---------------------------------------------------------------------------
-- 1. Which tables in the public schema have RLS enabled?
-- ---------------------------------------------------------------------------
SELECT
  n.nspname                AS schema,
  c.relname                AS table_name,
  c.relrowsecurity         AS rls_enabled,
  c.relforcerowsecurity    AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

-- ---------------------------------------------------------------------------
-- 2. List every RLS policy on the public schema.
--    `cmd` values: SELECT, INSERT, UPDATE, DELETE, ALL.
-- ---------------------------------------------------------------------------
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd           AS operation,
  qual          AS using_clause,
  with_check    AS with_check_clause
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- ---------------------------------------------------------------------------
-- 3. Coverage check: does every expected table have at least one policy
--    for each of SELECT / INSERT / UPDATE / DELETE?
--    A row with `missing_operations` non-empty is a gap.
-- ---------------------------------------------------------------------------
WITH expected_tables AS (
  SELECT unnest(ARRAY['meals', 'vault', 'meal_plans']) AS tablename
),
required_ops AS (
  SELECT unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS op
),
expected AS (
  SELECT t.tablename, r.op
  FROM expected_tables t
  CROSS JOIN required_ops r
),
existing AS (
  SELECT tablename, upper(cmd) AS op
  FROM pg_policies
  WHERE schemaname = 'public'
)
SELECT
  e.tablename,
  array_agg(e.op ORDER BY e.op) FILTER (WHERE x.op IS NULL) AS missing_operations
FROM expected e
LEFT JOIN existing x
  ON x.tablename = e.tablename
 AND (x.op = e.op OR x.op = 'ALL')
GROUP BY e.tablename
ORDER BY e.tablename;

-- ---------------------------------------------------------------------------
-- 4. Storage buckets — is `recipe_images` public, and what policies exist?
-- ---------------------------------------------------------------------------
SELECT id, name, owner, public, created_at, updated_at
FROM storage.buckets
ORDER BY name;

-- Policies on storage.objects (where Supabase storage RLS lives).
-- Filter to rows that mention recipe_images in the policy definition.
SELECT
  schemaname,
  tablename,
  policyname,
  cmd        AS operation,
  qual       AS using_clause,
  with_check AS with_check_clause
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename  = 'objects'
ORDER BY policyname;
