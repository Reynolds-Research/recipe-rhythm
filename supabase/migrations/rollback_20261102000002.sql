-- =========================================================================
-- Rollback: 20261102000002_week_days (PRD-008 phase 2b-1, D9)
-- Puts the database back exactly as it was before the migration.
--
-- Loses only which days each week shows and the usual days — no meals.
-- Run this BEFORE rollback_20261102000001.sql if undoing both (week_days
-- uses that migration's rr_set_updated_at).
-- =========================================================================
BEGIN;

DROP TABLE IF EXISTS public.week_days;   -- its trigger and rules go with it
ALTER TABLE public.household_preferences
  DROP CONSTRAINT IF EXISTS household_preferences_usual_days_valid,
  DROP COLUMN IF EXISTS usual_days;
DROP FUNCTION IF EXISTS public.rr_valid_week_days(smallint[], integer);

COMMIT;

-- Expect one row: all false.
SELECT to_regclass('public.week_days') IS NOT NULL AS week_days_left,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'household_preferences'
                  AND column_name = 'usual_days')  AS usual_days_left,
       EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                 AND proname = 'rr_valid_week_days') AS function_left;
