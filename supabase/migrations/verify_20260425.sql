-- Verification queries for 20260425000001_meals_vault_link.sql
--
-- Run these AFTER the main migration. Each section is read-only (no mutations).
-- Expected results are described inline so you can eyeball correctness without setup.

-- =========================================================================
-- 1. pg_trgm extension is installed
-- =========================================================================
-- Expected: one row with extname = 'pg_trgm'.

SELECT extname, extversion
FROM pg_extension
WHERE extname = 'pg_trgm';


-- =========================================================================
-- 2. meals.vault_id column exists with the right shape
-- =========================================================================
-- Expected: one row — column_name = 'vault_id', data_type = 'uuid', is_nullable = 'YES'.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'meals'
  AND column_name  = 'vault_id';


-- =========================================================================
-- 3. meals.vault_id has the foreign key to vault(id) with ON DELETE SET NULL
-- =========================================================================
-- Expected: one row with confdeltype = 'n' (SET NULL), referencing public.vault(id).
-- The pg_get_constraintdef() column makes the contract human-readable.

SELECT
  con.conname,
  con.confdeltype,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class      child  ON child.oid  = con.conrelid
JOIN pg_class      parent ON parent.oid = con.confrelid
WHERE child.relname  = 'meals'
  AND parent.relname = 'vault'
  AND con.contype    = 'f';


-- =========================================================================
-- 4. (user_id, vault_id) index exists
-- =========================================================================
-- Expected: one row with indexname = 'meals_user_vault_idx'.

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename  = 'meals'
  AND indexname  = 'meals_user_vault_idx';


-- =========================================================================
-- 5. Column comment is present
-- =========================================================================
-- Expected: one row with description starting "PRD-001 P0.1: links a logged meal …".

SELECT
  c.column_name,
  pgd.description
FROM information_schema.columns c
JOIN pg_catalog.pg_statio_all_tables st
  ON st.schemaname = c.table_schema
 AND st.relname    = c.table_name
JOIN pg_catalog.pg_description pgd
  ON pgd.objoid    = st.relid
 AND pgd.objsubid  = c.ordinal_position
WHERE c.table_schema = 'public'
  AND c.table_name   = 'meals'
  AND c.column_name  = 'vault_id';


-- =========================================================================
-- 6. vault_fuzzy_match RPC exists and is SECURITY INVOKER
-- =========================================================================
-- Expected: one row, prosecdef = false (SECURITY INVOKER).

SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  p.prosecdef AS is_security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'vault_fuzzy_match';


-- =========================================================================
-- 7. Smoke test the RPC (read-only)
-- =========================================================================
-- Run this from a session where auth.uid() returns a real user that has
-- vault rows. Replace the placeholder with that user's UUID. Expected: at
-- most 5 rows, ordered by similarity DESC, all >= 0.6.
--
-- SELECT * FROM vault_fuzzy_match(
--   '00000000-0000-0000-0000-000000000000'::uuid,
--   'tacos',
--   0.6
-- );


-- =========================================================================
-- 8. Sanity-check: `notes` column on meals (PRD-001 follow-up note from Step 1)
-- =========================================================================
-- The schema doc lists meals as (id, user_id, name, eaten_on, created_at) but
-- LogMode.jsx writes a `notes` field. Confirm whether notes exists; if it does,
-- docs/schema.md needs a row for it. If it doesn't, LogMode.jsx will fail
-- silently to persist notes.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'meals'
  AND column_name  = 'notes';
