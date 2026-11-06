-- 06b_switchover_run.sql — PRD-008 2c, switch-over. WRITES (admin, SQL Editor).
--
-- Paste the whole file and run it once. The two statements run together as
-- one transaction (the SQL Editor sends them as one script): either both
-- happen or neither does.
--
--   1. Skip: remember the old plans 06a listed (and their DATED meals) as
--      "already copied", so the copy passes over them. Their Maybe meals still
--      copy (ideas, not nights). Nothing is deleted; the old tables are never
--      written.
--   2. Copy: the re-runnable rr_copy_legacy_plans() from 20261102000001.
--
-- The result shown is the copy's counts. Expected on prod (2026-11-06):
--   meals added 21 (18 past dinners + 3 Maybes), confirmations added 9,
--   everything else 0. Then run 06c.
--
-- Safe to run again: the skip ignores rows it already wrote, and a second
-- copy only mirrors changes made on the old screens since (all zeros once
-- the old screens are gone).
INSERT INTO public.rr_legacy_copied (kind, legacy_id)
SELECT 'plan', p.id
  FROM public.meal_plans p
 WHERE p.period_start IS NOT NULL AND p.period_end IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.week_confirmations w
                WHERE w.legacy_plan_id IS NULL AND w.household_id = p.household_id
                  AND w.starts_on <= p.period_end AND w.ends_on >= p.period_start)
UNION ALL
SELECT 'item', i.id
  FROM public.meal_plan_items i
  JOIN public.meal_plans p ON p.id = i.meal_plan_id
 WHERE i.scheduled_date IS NOT NULL
   AND p.period_start IS NOT NULL AND p.period_end IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.week_confirmations w
                WHERE w.legacy_plan_id IS NULL AND w.household_id = p.household_id
                  AND w.starts_on <= p.period_end AND w.ends_on >= p.period_start)
ON CONFLICT DO NOTHING;

SELECT public.rr_copy_legacy_plans() AS copy_result;
