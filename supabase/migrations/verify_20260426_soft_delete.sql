-- Verification queries for 20260426000001_vault_soft_delete.sql
--
-- Run AFTER the main migration. Each section is read-only (no mutations).
-- Expected results are described inline so you can eyeball correctness.

-- =========================================================================
-- 1. vault.deleted_at column exists with the right shape
-- =========================================================================
-- Expected: one row — column_name = 'deleted_at',
-- data_type = 'timestamp with time zone', is_nullable = 'YES'.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'vault'
  AND column_name  = 'deleted_at';


-- =========================================================================
-- 2. Partial index exists with the WHERE clause
-- =========================================================================
-- Expected: one row, indexname = 'vault_user_active_idx',
-- indexdef contains "WHERE (deleted_at IS NULL)".

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename  = 'vault'
  AND indexname  = 'vault_user_active_idx';


-- =========================================================================
-- 3. Column comment is present
-- =========================================================================
-- Expected: one row, description starts with "PRD-001 P0.5:".

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
  AND c.table_name   = 'vault'
  AND c.column_name  = 'deleted_at';


-- =========================================================================
-- 4. vault_fuzzy_match RPC body now contains the soft-delete filter
-- =========================================================================
-- Expected: one row whose definition contains "deleted_at IS NULL" inside
-- the function body.

SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid)         AS args,
  position('deleted_at IS NULL' in pg_get_functiondef(p.oid)) > 0
                                                    AS has_soft_delete_filter
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'vault_fuzzy_match';


-- =========================================================================
-- 5. RPC output column names are still match_id, match_name, image_url, similarity
-- =========================================================================
-- Expected: one row whose result_columns contains
-- "match_id uuid, match_name text, image_url text, similarity real"
-- (or equivalent — pg_get_function_result formats it as a TABLE).

SELECT
  p.proname,
  pg_get_function_result(p.oid) AS result_columns
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'vault_fuzzy_match';


-- =========================================================================
-- 6. Smoke counts: active vs. soft-deleted rows
-- =========================================================================
-- Run from a session where auth.uid() returns a real user. RLS scopes the
-- query to your rows. Right after migration, soft_deleted should be 0 (no
-- one has soft-deleted anything yet) and active should equal your full
-- vault count.

SELECT
  COUNT(*)                                      AS total_rows,
  COUNT(*) FILTER (WHERE deleted_at IS NULL)    AS active,
  COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS soft_deleted
FROM vault;


-- =========================================================================
-- 7. Smoke test the RPC excludes soft-deleted rows (read-only)
-- =========================================================================
-- Optional: after manually soft-deleting one of your vault rows in the
-- table editor (UPDATE vault SET deleted_at = now() WHERE id = '<row id>'),
-- confirm vault_fuzzy_match no longer returns it. Replace the placeholders.
--
-- SELECT * FROM vault_fuzzy_match(
--   '00000000-0000-0000-0000-000000000000'::uuid,
--   '<recipe name to fuzzy-match>',
--   0.6
-- );
