-- Verification queries for 20260427000001_vault_prep_time.sql
--
-- Run AFTER the main migration. Each section is read-only (no mutations).
-- Expected results are described inline so you can eyeball correctness.

-- =========================================================================
-- 1. vault.prep_time_minutes column exists with the right shape
-- =========================================================================
-- Expected: one row — column_name = 'prep_time_minutes', data_type = 'integer',
-- is_nullable = 'YES'.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'vault'
  AND column_name  = 'prep_time_minutes';


-- =========================================================================
-- 2. CHECK constraint is present
-- =========================================================================
-- Expected: one row whose definition contains "prep_time_minutes IS NULL OR
-- prep_time_minutes > 0".

SELECT
  con.conname,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class      tbl ON tbl.oid = con.conrelid
WHERE tbl.relname = 'vault'
  AND con.contype = 'c'
  AND pg_get_constraintdef(con.oid) ILIKE '%prep_time_minutes%';


-- =========================================================================
-- 3. Column comment is present
-- =========================================================================
-- Expected: one row, description starts with "PRD-002 P0.4:".

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
  AND c.column_name  = 'prep_time_minutes';


-- =========================================================================
-- 4. Smoke test: existing rows default to NULL (read-only)
-- =========================================================================
-- Expected: total_rows >= 0; unrated == total_rows immediately after migration;
-- out_of_range_should_be_zero is always 0 (the CHECK enforces it).

SELECT
  COUNT(*)                                              AS total_rows,
  COUNT(*) FILTER (WHERE prep_time_minutes IS NULL)     AS unrated,
  COUNT(*) FILTER (WHERE prep_time_minutes > 0)         AS rated_positive,
  COUNT(*) FILTER (
    WHERE prep_time_minutes IS NOT NULL
      AND prep_time_minutes <= 0
  )                                                     AS out_of_range_should_be_zero
FROM vault;
