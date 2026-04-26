-- Verification queries for 20260426000003_vault_family_rating.sql
--
-- Run AFTER the main migration. Each section is read-only (no mutations).
-- Expected results are described inline so you can eyeball correctness.

-- =========================================================================
-- 1. vault.family_rating column exists with the right shape
-- =========================================================================
-- Expected: one row — column_name = 'family_rating', data_type = 'smallint',
-- is_nullable = 'YES'.

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'vault'
  AND column_name  = 'family_rating';


-- =========================================================================
-- 2. CHECK constraint is present
-- =========================================================================
-- Expected: one row whose definition contains "family_rating IS NULL OR
-- (family_rating BETWEEN 1 AND 5)".

SELECT
  con.conname,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class      tbl ON tbl.oid = con.conrelid
WHERE tbl.relname = 'vault'
  AND con.contype = 'c'
  AND pg_get_constraintdef(con.oid) ILIKE '%family_rating%';


-- =========================================================================
-- 3. Column comment is present
-- =========================================================================
-- Expected: one row, description starts with "PRD-001 P1.1:".

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
  AND c.column_name  = 'family_rating';


-- =========================================================================
-- 4. Smoke test: existing rows default to NULL (read-only sanity check)
-- =========================================================================
-- Expected: a count of rows for the calling user, all with family_rating IS
-- NULL right after migration. (After the user actually rates recipes, this
-- check just shows the current distribution — useful for spot-checking
-- "are ratings persisting" later.)
--
-- Run from a session where auth.uid() returns your real user id. RLS will
-- scope it to your rows.

SELECT
  COUNT(*)                                                AS total_rows,
  COUNT(*) FILTER (WHERE family_rating IS NULL)           AS unrated,
  COUNT(*) FILTER (WHERE family_rating BETWEEN 1 AND 5)   AS rated_1_to_5,
  COUNT(*) FILTER (
    WHERE family_rating IS NOT NULL
      AND (family_rating < 1 OR family_rating > 5)
  )                                                       AS out_of_range_should_be_zero
FROM vault;
