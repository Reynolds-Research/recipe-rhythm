-- 06a_switchover_look.sql — PRD-008 2c, switch-over. READ-ONLY.
--
-- Run this first. It lists the old plans the switch-over will NOT copy: an
-- old plan whose dates overlap a week she already confirmed on the new
-- screens. She re-planned those weeks on the new Prep Table, so copying the
-- old version would put two dinners on each night (Matt decided 2026-11-06).
-- Only their dated meals are skipped; a Maybe in such a plan still copies.
--
-- Expected on prod (checked read-only 2026-11-06): exactly ONE row, the old
-- Nov 1 – 5 plan with 5 meals, overlapping the confirmed week Nov 1 – 7.
-- Anything else: stop and ask before running 06b.
SELECT p.id                                   AS old_plan,
       p.household_id,
       p.period_start, p.period_end,
       (SELECT count(*) FROM public.meal_plan_items i WHERE i.meal_plan_id = p.id) AS old_meals,
       (SELECT string_agg(coalesce(i.scheduled_date::text, 'maybe') || ' ' || i.name, '; '
                          ORDER BY i.scheduled_date NULLS LAST)
          FROM public.meal_plan_items i WHERE i.meal_plan_id = p.id)               AS meals,
       (SELECT string_agg(w.starts_on || ' .. ' || w.ends_on, ', ')
          FROM public.week_confirmations w
         WHERE w.legacy_plan_id IS NULL AND w.household_id = p.household_id
           AND w.starts_on <= p.period_end AND w.ends_on >= p.period_start)        AS confirmed_on_new_screens
  FROM public.meal_plans p
 WHERE p.period_start IS NOT NULL AND p.period_end IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.week_confirmations w
                WHERE w.legacy_plan_id IS NULL AND w.household_id = p.household_id
                  AND w.starts_on <= p.period_end AND w.ends_on >= p.period_start)
 ORDER BY p.period_start;
