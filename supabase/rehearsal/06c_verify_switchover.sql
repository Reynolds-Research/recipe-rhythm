-- 06c_verify_switchover.sql — PRD-008 2c, after 06b. READ-ONLY, ONE SELECT.
-- Every row: check / expected / actual / pass. All `pass` should be true.
--
-- "Skipped" = an old plan whose dates overlap a week confirmed on the new
-- screens (same rule as 06a / 06b); only its DATED meals are skipped.
WITH skipped AS (
  SELECT p.id FROM public.meal_plans p
   WHERE p.period_start IS NOT NULL AND p.period_end IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.week_confirmations w
                  WHERE w.legacy_plan_id IS NULL AND w.household_id = p.household_id
                    AND w.starts_on <= p.period_end AND w.ends_on >= p.period_start)
),
skipped_items AS (
  SELECT i.* FROM public.meal_plan_items i
   WHERE i.meal_plan_id IN (SELECT id FROM skipped) AND i.scheduled_date IS NOT NULL
),
other_items AS (
  SELECT i.* FROM public.meal_plan_items i WHERE i.id NOT IN (SELECT id FROM skipped_items)
),
copied AS (
  SELECT pm.* FROM public.planned_meals pm WHERE pm.legacy_item_id IS NOT NULL
),
checks AS (
  SELECT 1 AS n, 'skipped old plans are remembered (never copied)' AS "check", 0::bigint AS expected,
         (SELECT count(*) FROM skipped s
           WHERE NOT EXISTS (SELECT 1 FROM public.rr_legacy_copied c WHERE c.kind = 'plan' AND c.legacy_id = s.id)) AS actual
  UNION ALL
  SELECT 2, 'no dated meal from a skipped plan was copied', 0,
         (SELECT count(*) FROM copied c WHERE c.legacy_item_id IN (SELECT id FROM skipped_items))
  UNION ALL
  SELECT 3, 'every other old meal exists as a planned meal', 0,
         (SELECT count(*) FROM other_items i WHERE NOT EXISTS (SELECT 1 FROM copied c WHERE c.legacy_item_id = i.id))
  UNION ALL
  SELECT 4, 'copied meals keep their date (Maybe = no date)', 0,
         (SELECT count(*) FROM copied c JOIN public.meal_plan_items i ON i.id = c.legacy_item_id
           WHERE c.planned_on IS DISTINCT FROM i.scheduled_date)
  UNION ALL
  SELECT 5, 'old Maybe meals are on the Maybe list',
         (SELECT count(*) FROM other_items i WHERE i.scheduled_date IS NULL),
         (SELECT count(*) FROM copied c WHERE c.planned_on IS NULL)
  UNION ALL
  SELECT 6, 'every other served old plan is a confirmed range', 0,
         (SELECT count(*) FROM public.meal_plans p
           WHERE p.served_at IS NOT NULL AND p.period_start IS NOT NULL AND p.period_end IS NOT NULL
             AND p.id NOT IN (SELECT id FROM skipped)
             AND NOT EXISTS (SELECT 1 FROM public.week_confirmations w WHERE w.legacy_plan_id = p.id))
  UNION ALL
  SELECT 7, 'no night has both a copied meal and a new-screen meal', 0,
         (SELECT count(*) FROM (
            SELECT household_id, planned_on FROM public.planned_meals
             WHERE planned_on IS NOT NULL
             GROUP BY household_id, planned_on
            HAVING bool_or(legacy_item_id IS NULL) AND bool_or(legacy_item_id IS NOT NULL)) d)
  UNION ALL
  SELECT 8, 'no two confirmed ranges of a household overlap', 0,
         (SELECT count(*) FROM public.week_confirmations a JOIN public.week_confirmations b
             ON a.household_id = b.household_id AND a.id < b.id
            AND a.starts_on <= b.ends_on AND b.starts_on <= a.ends_on)
  UNION ALL
  SELECT 9, 'skipped meals are remembered, and still in the old tables',
         (SELECT count(*) FROM skipped_items),
         (SELECT count(*) FROM public.rr_legacy_copied c WHERE c.kind = 'item'
             AND c.legacy_id IN (SELECT id FROM skipped_items))
)
SELECT n, "check", expected, actual, expected = actual AS pass FROM checks ORDER BY n;
