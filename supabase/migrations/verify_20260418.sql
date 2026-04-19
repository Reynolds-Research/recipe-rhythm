-- Verification queries for 20260418000001_planning_periods_schema.sql
--
-- Run these AFTER the main migration. Each section is read-only (no mutations).
-- Expected results are described inline so you can eyeball correctness without setup.

-- =========================================================================
-- 1. Every pre-existing meal_plans row got period_start backfilled
-- =========================================================================
-- Expected: both counts equal, `missing` = 0. Rows with NULL served_at can't
-- be backfilled (they'd have no anchor date); investigate them separately if non-zero.

SELECT
  COUNT(*)                                             AS total_rows,
  COUNT(period_start)                                  AS backfilled_rows,
  COUNT(*) FILTER (WHERE served_at IS NOT NULL
                   AND period_start IS NULL)           AS missing
FROM meal_plans;


-- =========================================================================
-- 2. Every item in items jsonb has a corresponding meal_plan_items row
-- =========================================================================
-- Expected: `jsonb_item_count` == `mpi_row_count`. Divergence means either some
-- items had an unknown `day` string (skipped by the CASE/IN filter) or the jsonb
-- wasn't an array — inspect the third column to find offenders.

SELECT
  (SELECT COALESCE(SUM(jsonb_array_length(items)), 0)
   FROM meal_plans
   WHERE items IS NOT NULL AND jsonb_typeof(items) = 'array')  AS jsonb_item_count,
  (SELECT COUNT(*) FROM meal_plan_items)                       AS mpi_row_count,
  (SELECT COUNT(*) FROM meal_plans
   WHERE items IS NOT NULL
     AND jsonb_typeof(items) = 'array'
     AND NOT EXISTS (
       SELECT 1 FROM meal_plan_items mpi WHERE mpi.meal_plan_id = meal_plans.id
     ))                                                        AS meal_plans_with_unpopulated_items;


-- =========================================================================
-- 3. Spot-check: pick one meal_plan and compare original items to meal_plan_items
-- =========================================================================
-- Eyeball this: each jsonb entry in the first result should correspond to a row
-- in the second result, with day-of-week preserved (EXTRACT(DOW) from scheduled_date
-- should match the item's `day` weekday string).

WITH sample AS (
  SELECT id FROM meal_plans
  WHERE items IS NOT NULL AND jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0
  ORDER BY served_at DESC
  LIMIT 1
)
SELECT 'original_items' AS source, mp.id, mp.period_start, mp.period_end, mp.items::text AS detail
FROM meal_plans mp WHERE mp.id IN (SELECT id FROM sample)
UNION ALL
SELECT 'meal_plan_items' AS source,
       mpi.meal_plan_id,
       mpi.scheduled_date,
       NULL::date,
       jsonb_build_object(
         'position', mpi.position,
         'scheduled_date', mpi.scheduled_date,
         'dow', EXTRACT(DOW FROM mpi.scheduled_date),
         'name', mpi.name,
         'vault_id', mpi.vault_id,
         'is_wildcard', mpi.is_wildcard,
         'cooked', mpi.cooked
       )::text
FROM meal_plan_items mpi
WHERE mpi.meal_plan_id IN (SELECT id FROM sample)
ORDER BY source, detail;


-- =========================================================================
-- 4. RLS is enabled on meal_plan_items and policies exist
-- =========================================================================
-- Expected: relrowsecurity = true, four policies (select/insert/update/delete).

SELECT c.relname, c.relrowsecurity
FROM pg_class c
WHERE c.relname = 'meal_plan_items';

SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS check_expr
FROM pg_policy
WHERE polrelid = 'meal_plan_items'::regclass
ORDER BY polname;


-- =========================================================================
-- 5. EXCLUDE constraint exists and works
-- =========================================================================
-- Expected: one row named meal_plans_no_period_overlap with contype = 'x'.

SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname = 'meal_plans_no_period_overlap';

-- Optional: test that overlap is rejected. This SHOULD error.
-- Run manually if you want a live-fire check — don't include it in automated runs.
--
--   BEGIN;
--   INSERT INTO meal_plans (user_id, period_start, period_end)
--     VALUES (auth.uid(), '2026-05-01', '2026-05-07');
--   INSERT INTO meal_plans (user_id, period_start, period_end)
--     VALUES (auth.uid(), '2026-05-05', '2026-05-10');   -- <-- expect: ERROR, conflicting key value violates exclusion constraint
--   ROLLBACK;


-- =========================================================================
-- 6. current_leftovers view
-- =========================================================================
-- Expected on a fresh migration: 0 rows. Reasoning: backfilled items are marked
-- cooked = true, so nothing qualifies. After Phase 3 lands and real uncooked
-- items exist in finalized past periods, this will start returning rows.

SELECT COUNT(*) AS current_leftovers_count FROM current_leftovers;


-- =========================================================================
-- 7. Columns added to meal_plans
-- =========================================================================
-- Expected: three rows — period_start (date), period_end (date), finalized_at (timestamptz).

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'meal_plans'
  AND column_name IN ('period_start', 'period_end', 'finalized_at')
ORDER BY column_name;
