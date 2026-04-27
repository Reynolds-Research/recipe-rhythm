-- Verification queries for 20260427000002_meal_plan_items_shortlist.sql
--
-- Run AFTER the main migration. Each section is read-only (no mutations
-- against application data — the CHECK probe at the end uses a transaction
-- that's rolled back).

-- =========================================================================
-- 1. scheduled_date is now nullable, is_shortlisted exists with the right shape
-- =========================================================================
-- Expected:
--   scheduled_date  | date    | YES
--   is_shortlisted  | boolean | NO   (default false)

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'meal_plan_items'
  AND column_name IN ('scheduled_date', 'is_shortlisted')
ORDER BY column_name;


-- =========================================================================
-- 2. CHECK constraint is present
-- =========================================================================
-- Expected: one row whose definition is
--   "CHECK ((scheduled_date IS NULL) = is_shortlisted)"

SELECT
  con.conname,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class      tbl ON tbl.oid = con.conrelid
WHERE tbl.relname = 'meal_plan_items'
  AND con.conname = 'meal_plan_items_scheduled_xor_shortlisted';


-- =========================================================================
-- 3. Column comment is present
-- =========================================================================
-- Expected: one row, description starts with "PRD-002 P0.6:".

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
  AND c.table_name   = 'meal_plan_items'
  AND c.column_name  = 'is_shortlisted';


-- =========================================================================
-- 4. Partial index is present
-- =========================================================================
-- Expected: one row — indexname = 'meal_plan_items_user_shortlist_idx',
-- indexdef contains "WHERE (is_shortlisted = true)".

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename  = 'meal_plan_items'
  AND indexname  = 'meal_plan_items_user_shortlist_idx';


-- =========================================================================
-- 5. Smoke: every existing row still satisfies the CHECK
-- =========================================================================
-- Expected: total_rows >= 0; scheduled (date NOT NULL, !is_shortlisted)
--   == total_rows; shortlisted == 0 (no shortlisted rows yet);
--   invalid_should_be_zero == 0 (the CHECK enforces it).

SELECT
  COUNT(*)                                                                    AS total_rows,
  COUNT(*) FILTER (
    WHERE scheduled_date IS NOT NULL AND is_shortlisted = false
  )                                                                           AS scheduled,
  COUNT(*) FILTER (
    WHERE scheduled_date IS NULL AND is_shortlisted = true
  )                                                                           AS shortlisted,
  COUNT(*) FILTER (
    WHERE (scheduled_date IS NULL) <> is_shortlisted
  )                                                                           AS invalid_should_be_zero
FROM meal_plan_items;
