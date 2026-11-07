-- =========================================================================
-- Rollback: 20261108000001_cook_nights (PRD-008 phase 3a, D9)
-- Puts the database back exactly as it was before the migration.
--
-- Loses only whose night each date is and the display names — no meals.
-- =========================================================================
BEGIN;

DROP TABLE IF EXISTS public.cook_nights;   -- its triggers and rules go with it
DROP FUNCTION IF EXISTS public.rr_cook_nights_reassigned();
DROP FUNCTION IF EXISTS public.rr_cook_is_member();
DROP FUNCTION IF EXISTS public.rr_set_my_display_name(text);
ALTER TABLE public.household_members
  DROP CONSTRAINT IF EXISTS household_members_display_name_valid,
  DROP COLUMN IF EXISTS display_name;

COMMIT;

-- Expect one row: all false.
SELECT to_regclass('public.cook_nights') IS NOT NULL AS cook_nights_left,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'household_members'
                  AND column_name = 'display_name') AS display_name_left,
       EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                 AND proname IN ('rr_set_my_display_name', 'rr_cook_nights_reassigned', 'rr_cook_is_member')) AS functions_left;
