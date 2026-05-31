-- =========================================================================
-- Verify: 20260530000002_current_leftovers_exclude_shortlist
-- =========================================================================
-- Read-only checks. Run after applying the migration.

-- 1. The view definition now includes the is_shortlisted filter.
--    Expected: 'PASS — current_leftovers excludes is_shortlisted rows'.
SELECT
  CASE WHEN pg_get_viewdef('current_leftovers'::regclass, true) ILIKE '%is_shortlisted = false%'
    THEN 'PASS — current_leftovers excludes is_shortlisted rows'
    ELSE 'FAIL — view definition does not filter is_shortlisted'
  END AS check_1_view_filter;

-- 2. No row currently returned by the view has scheduled_date IS NULL.
--    Expected: 'PASS — current_leftovers has no null scheduled_date rows'.
SELECT
  CASE WHEN COUNT(*) = 0
    THEN 'PASS — current_leftovers has no null scheduled_date rows'
    ELSE 'FAIL — ' || COUNT(*)::text || ' rows still have null scheduled_date'
  END AS check_2_no_null_dates
FROM current_leftovers
WHERE scheduled_date IS NULL;

-- 3. No row currently returned by the view is shortlisted.
--    Joins back to meal_plan_items because the view doesn't expose is_shortlisted.
SELECT
  CASE WHEN COUNT(*) = 0
    THEN 'PASS — current_leftovers has no shortlisted rows'
    ELSE 'FAIL — ' || COUNT(*)::text || ' shortlisted rows still leaking through'
  END AS check_3_no_shortlisted
FROM current_leftovers cl
JOIN meal_plan_items mpi ON mpi.id = cl.id
WHERE mpi.is_shortlisted = true;

-- 4. Sanity: row counts of the view match the expected filter shape.
--    expected_visible_leftover_count and actual_view_count should be equal.
SELECT
  COUNT(*) AS expected_visible_leftover_count
FROM meal_plan_items mpi
JOIN meal_plans mp ON mpi.meal_plan_id = mp.id
WHERE mpi.cooked = false
  AND mpi.is_shortlisted = false
  AND mp.finalized_at IS NOT NULL
  AND mp.period_end < CURRENT_DATE
  AND mp.period_end >= (CURRENT_DATE - INTERVAL '14 days');

SELECT COUNT(*) AS actual_view_count FROM current_leftovers;
