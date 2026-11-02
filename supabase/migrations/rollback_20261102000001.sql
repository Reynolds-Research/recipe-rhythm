-- =========================================================================
-- Rollback: 20261102000001_calendar_data (PRD-008 phase 2a, D9)
-- Puts the database back exactly as it was before the migration.
--
-- Safe BEFORE the switch-over (2c): the new tables only hold copies of the
-- old plans, and the old tables are untouched, so nothing is lost.
-- AFTER the switch-over this would delete every meal planned on the new
-- screens — don't run it then without exporting planned_meals first.
-- =========================================================================
BEGIN;

DROP TABLE IF EXISTS public.planned_meals CASCADE;        -- its triggers and rules go with it
DROP TABLE IF EXISTS public.week_confirmations CASCADE;

DROP FUNCTION IF EXISTS public.rr_copy_legacy_plans();
DROP FUNCTION IF EXISTS public.rr_mark_week_changed();
DROP FUNCTION IF EXISTS public.rr_set_updated_at();

COMMIT;

-- Expect one row: all false.
SELECT to_regclass('public.planned_meals') IS NOT NULL      AS planned_meals_left,
       to_regclass('public.week_confirmations') IS NOT NULL AS week_confirmations_left,
       EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                 AND proname IN ('rr_copy_legacy_plans','rr_mark_week_changed','rr_set_updated_at')) AS functions_left;
