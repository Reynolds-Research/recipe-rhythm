-- =========================================================================
-- Migration: 20261102000002_week_days
-- PRD-008 phase 2b-1 — which days a week shows (D8, option B). Requires the
-- phase 1 household migrations and 20261102000001_calendar_data (reuses its
-- rr_set_updated_at trigger function). Undo: rollback_20261102000002.sql
-- =========================================================================
--
-- Mental model: the week screen has a row of day buttons (Su–Sa). Tapping one
-- shows or hides that day for THAT week. Two small facts make that work:
--
--   household_preferences.usual_days   the household's "usual days" — what a
--                       week shows when nobody has changed it. Starts as
--                       Sun–Thu. The app copies a week's days here whenever
--                       she changes a week (so next week starts the same).
--   week_days          one row per week she actually changed: that week's
--                       own days. Weeks nobody touched have no row and show
--                       the usual days.
--
-- A day with a meal on it always shows — the app adds it on top of these
-- (src/lib/weekRange.js), so it's never stored here.
--
-- Days are numbers 0–6, Sunday = 0 (JavaScript's Date#getDay()). Weeks start
-- on Sunday; week_start is that Sunday's date.
--
-- Idempotent: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS throughout.

-- ---------------------------------------------------------------------------
-- 1. The rule for a list of days: each 0–6, no repeats, at least p_min.
--    IMMUTABLE so CHECK constraints can use it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rr_valid_week_days(p_days smallint[], p_min integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_days IS NOT NULL
     AND coalesce(array_ndims(p_days), 1) = 1
     AND coalesce(cardinality(p_days), 0) BETWEEN p_min AND 7
     AND NOT EXISTS (SELECT 1 FROM unnest(p_days) d WHERE d IS NULL OR d < 0 OR d > 6)
     AND (SELECT count(DISTINCT d) FROM unnest(p_days) d) = coalesce(cardinality(p_days), 0)
$$;

-- ---------------------------------------------------------------------------
-- 2. Usual days on household_preferences. At least one day: an empty
--    default week would look broken. Existing rows get Sun–Thu.
-- ---------------------------------------------------------------------------
ALTER TABLE public.household_preferences
  ADD COLUMN IF NOT EXISTS usual_days smallint[] NOT NULL DEFAULT '{0,1,2,3,4}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'household_preferences_usual_days_valid'
                    AND conrelid = 'public.household_preferences'::regclass) THEN
    ALTER TABLE public.household_preferences
      ADD CONSTRAINT household_preferences_usual_days_valid
      CHECK (public.rr_valid_week_days(usual_days, 1));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. week_days: a changed week's own days. Zero days is allowed (a vacation
--    week); the app then leaves usual_days alone.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.week_days (
  household_id  uuid NOT NULL DEFAULT public.current_household_id()
                  REFERENCES public.households(id) ON DELETE CASCADE,
  week_start    date NOT NULL,                     -- the Sunday the week starts on
  days          smallint[] NOT NULL,
  user_id       uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL, -- who changed it last
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, week_start),
  CONSTRAINT week_days_starts_sunday CHECK (extract(dow FROM week_start) = 0),
  CONSTRAINT week_days_days_valid    CHECK (public.rr_valid_week_days(days, 0))
);

DROP TRIGGER IF EXISTS week_days_set_updated_at ON public.week_days;
CREATE TRIGGER week_days_set_updated_at BEFORE UPDATE ON public.week_days
  FOR EACH ROW EXECUTE FUNCTION public.rr_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Security rules: the same four membership rules every kitchen table has.
--    Insert also requires the row to carry the adder's own user_id.
-- ---------------------------------------------------------------------------
ALTER TABLE public.week_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS week_days_select_household ON public.week_days;
CREATE POLICY week_days_select_household ON public.week_days FOR SELECT TO authenticated
  USING (public.is_household_member(household_id));

DROP POLICY IF EXISTS week_days_insert_household ON public.week_days;
CREATE POLICY week_days_insert_household ON public.week_days FOR INSERT TO authenticated
  WITH CHECK (public.is_household_member(household_id) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS week_days_update_household ON public.week_days;
CREATE POLICY week_days_update_household ON public.week_days FOR UPDATE TO authenticated
  USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

DROP POLICY IF EXISTS week_days_delete_household ON public.week_days;
CREATE POLICY week_days_delete_household ON public.week_days FOR DELETE TO authenticated
  USING (public.is_household_member(household_id));

REVOKE ALL ON public.week_days FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.week_days TO authenticated;
