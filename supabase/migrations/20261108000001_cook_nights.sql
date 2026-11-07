-- =========================================================================
-- Migration: 20261108000001_cook_nights
-- PRD-008 phase 3a — Matt's nights (P0.5). Requires the phase 1 household
-- migrations and 20261102000001_calendar_data (reuses rr_set_updated_at).
-- Undo: rollback_20261108000001.sql
-- =========================================================================
--
-- Mental model: a "night" is a sticky note on a calendar day saying who
-- cooks it. It is separate from the meal written on that day, because she
-- usually hands Matt a night BEFORE there is any meal (decided by Matt
-- 2026-11-07: a new table, not placeholder meals).
--
--   cook_nights          one row per household + date: whose night it is
--                        (cook_id), who handed it over (user_id) and when
--                        (assigned_at). No row = an ordinary night. Taking a
--                        night back deletes the row.
--   household_members.display_name
--                        the name the other person sees ("Matt's night").
--                        Set from Settings through rr_set_my_display_name(),
--                        which can only change your own name — members still
--                        can't edit the membership table itself.
--
-- assigned_at is when the night was handed over; with the date of the first
-- meal on that day it measures "Matt's nights filled within 2 days" (North
-- Star). Handing the night to someone else restarts it.
--
-- Idempotent: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS throughout.

-- ---------------------------------------------------------------------------
-- 1. Display names on household_members (1–30 characters, or none).
-- ---------------------------------------------------------------------------
ALTER TABLE public.household_members ADD COLUMN IF NOT EXISTS display_name text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'household_members_display_name_valid'
                    AND conrelid = 'public.household_members'::regclass) THEN
    ALTER TABLE public.household_members
      ADD CONSTRAINT household_members_display_name_valid
      CHECK (display_name IS NULL
             OR (display_name = btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 30));
  END IF;
END $$;

-- Change your OWN display name (blank clears it). Runs with elevated rights so
-- members need no write access to household_members at all.
CREATE OR REPLACE FUNCTION public.rr_set_my_display_name(p_name text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_name text := nullif(btrim(coalesce(p_name, '')), '');
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF v_name IS NOT NULL AND char_length(v_name) > 30 THEN
    RAISE EXCEPTION 'A name can be at most 30 characters';
  END IF;
  UPDATE public.household_members SET display_name = v_name
   WHERE user_id = (SELECT auth.uid());
  RETURN v_name;
END $$;

REVOKE ALL ON FUNCTION public.rr_set_my_display_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rr_set_my_display_name(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. cook_nights
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cook_nights (
  household_id  uuid NOT NULL DEFAULT public.current_household_id()
                  REFERENCES public.households(id) ON DELETE CASCADE,
  cooks_on      date NOT NULL,
  cook_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- whose night
  user_id       uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL, -- who handed it over
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, cooks_on)
);

DROP TRIGGER IF EXISTS cook_nights_set_updated_at ON public.cook_nights;
CREATE TRIGGER cook_nights_set_updated_at BEFORE UPDATE ON public.cook_nights
  FOR EACH ROW EXECUTE FUNCTION public.rr_set_updated_at();

-- Handing a night to someone else restarts the clock.
CREATE OR REPLACE FUNCTION public.rr_cook_nights_reassigned()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.cook_id IS DISTINCT FROM OLD.cook_id THEN
    NEW.assigned_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cook_nights_reassigned ON public.cook_nights;
CREATE TRIGGER cook_nights_reassigned BEFORE UPDATE ON public.cook_nights
  FOR EACH ROW EXECUTE FUNCTION public.rr_cook_nights_reassigned();

-- The cook must belong to the household. A trigger (not only a security
-- rule) so even an admin insert can't hand a night to an outsider.
CREATE OR REPLACE FUNCTION public.rr_cook_is_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.household_members m
                  WHERE m.household_id = NEW.household_id AND m.user_id = NEW.cook_id) THEN
    RAISE EXCEPTION 'The cook must be in this household';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cook_nights_cook_is_member ON public.cook_nights;
CREATE TRIGGER cook_nights_cook_is_member BEFORE INSERT OR UPDATE ON public.cook_nights
  FOR EACH ROW EXECUTE FUNCTION public.rr_cook_is_member();

-- ---------------------------------------------------------------------------
-- 3. Security rules: the same four membership rules every kitchen table has.
--    Insert also requires the row to carry the hander's own user_id.
-- ---------------------------------------------------------------------------
ALTER TABLE public.cook_nights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cook_nights_select_household ON public.cook_nights;
CREATE POLICY cook_nights_select_household ON public.cook_nights FOR SELECT TO authenticated
  USING (public.is_household_member(household_id));

DROP POLICY IF EXISTS cook_nights_insert_household ON public.cook_nights;
CREATE POLICY cook_nights_insert_household ON public.cook_nights FOR INSERT TO authenticated
  WITH CHECK (public.is_household_member(household_id) AND user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS cook_nights_update_household ON public.cook_nights;
CREATE POLICY cook_nights_update_household ON public.cook_nights FOR UPDATE TO authenticated
  USING (public.is_household_member(household_id))
  WITH CHECK (public.is_household_member(household_id));

DROP POLICY IF EXISTS cook_nights_delete_household ON public.cook_nights;
CREATE POLICY cook_nights_delete_household ON public.cook_nights FOR DELETE TO authenticated
  USING (public.is_household_member(household_id));

REVOKE ALL ON public.cook_nights FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cook_nights TO authenticated;
-- (Loading a week reads one household's nights by date range: the primary
-- key (household_id, cooks_on) already serves that.)
