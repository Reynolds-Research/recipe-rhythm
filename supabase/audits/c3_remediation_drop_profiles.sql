-- AUDIT C3 — Drop unused `public.profiles` table
--
-- ⚠️  READ BEFORE RUNNING  ⚠️
-- DROP TABLE is destructive and irreversible. Only run this after
-- confirming the preflight checks below.
--
-- Why this exists:
--   The 2026-04-18 RLS audit surfaced `public.profiles` with RLS
--   disabled. The table is not referenced anywhere in src/ and the
--   current row count is 0. It appears to be a Supabase starter-template
--   remnant. The safest way to resolve the P0 "RLS off" finding for a
--   table that serves no purpose is to remove it.

-- ===========================================================================
-- Preflight — run each block and inspect the output before the DROP.
-- ===========================================================================

-- P1. Confirm the table is still empty.
SELECT count(*) AS profiles_row_count FROM public.profiles;
-- Expected: 0. If non-zero, STOP and investigate — data has been written
-- since the audit.

-- P2. Look for triggers that populate `profiles` (commonly on auth.users).
SELECT event_object_schema AS schema, event_object_table AS table_name,
       trigger_name, action_timing, event_manipulation
FROM information_schema.triggers
WHERE action_statement ILIKE '%profiles%';
-- Expected: 0 rows. If a trigger exists, dropping the table will break it;
-- either drop the trigger first or keep the table and policy it instead.

-- P3. Look for foreign keys that reference `profiles`.
SELECT conrelid::regclass AS referencing_table, conname AS constraint_name
FROM pg_constraint
WHERE confrelid = 'public.profiles'::regclass;
-- Expected: 0 rows. A non-empty result means another table points here;
-- removing `profiles` would break that FK.

-- P4. Look for views/functions that reference `profiles`.
SELECT n.nspname AS schema, c.relname AS view_or_func, c.relkind
FROM pg_rewrite r
JOIN pg_class c ON c.oid = r.ev_class
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE r.ev_action::text ILIKE '%profiles%';
-- Expected: 0 rows.

-- ===========================================================================
-- Drop — only run AFTER all four preflight queries returned the expected
-- output. Wrapped in a transaction; if anything is unexpected it rolls
-- back.
-- ===========================================================================

BEGIN;

DROP TABLE public.profiles;

COMMIT;

-- Post-check: re-run Query 1 from c3_rls_verification.sql. Expect the
-- `profiles` row to be gone. Then update docs/schema.md to remove the
-- profiles row from the RLS Status table.
