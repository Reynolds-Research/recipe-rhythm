-- Verification queries for 20260428000001_vault_ingredients_classified.sql
--
-- Run AFTER the main migration. Each section is read-only (no mutations).
-- Expected results are described inline so you can eyeball correctness.

-- =========================================================================
-- 1. vault.ingredients_classified column exists with the right shape
-- =========================================================================
-- Expected: one row — column_name = 'ingredients_classified',
-- data_type = 'jsonb', is_nullable = 'YES'.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'vault'
  AND column_name  = 'ingredients_classified';


-- =========================================================================
-- 2. Column comment is present
-- =========================================================================
-- Expected: one row, description starts with "PRD-004 / ADR-002:".

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
  AND c.column_name  = 'ingredients_classified';


-- =========================================================================
-- 3. Smoke test: existing rows default to NULL (read-only)
-- =========================================================================
-- Expected (immediately after migration):
--   total_rows >= 0
--   unclassified == total_rows
--   classified  == 0
-- After backfill: unclassified should drop to 0 (or at most a few failures).

SELECT
  COUNT(*)                                                  AS total_rows,
  COUNT(*) FILTER (WHERE ingredients_classified IS NULL)    AS unclassified,
  COUNT(*) FILTER (WHERE ingredients_classified IS NOT NULL) AS classified
FROM vault;


-- =========================================================================
-- 4. RLS sanity check — existing vault policies still cover this table
-- =========================================================================
-- Expected: rls_enabled = true; four owner-scoped per-operation policies
-- (vault_select_own, vault_insert_own, vault_update_own, vault_delete_own).
-- No policy work needed for the new column — adding a column does not
-- change row visibility under existing USING / WITH CHECK clauses.

SELECT relname AS table_name, relrowsecurity AS rls_enabled
FROM pg_class
WHERE relname = 'vault'
  AND relnamespace = 'public'::regnamespace;

SELECT polname, polcmd
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
WHERE c.relname = 'vault'
ORDER BY polname;
