-- =========================================================================
-- Migration: 20261114000001_planned_meals_add_on
-- A small extra on a planned meal ("Penne alla Vodka" + "shrimp").
-- Undo: rollback_20261114000001.sql. Verify: verify_20261114000001.sql.
-- =========================================================================
--
-- Mental model (decided 2026-11-14, TASKS.md "Meal shapes"): a planned meal
-- stays a name plus an optional link to ONE cookbook recipe. An add-on is a
-- short piece of plain text on that one planned meal. It is never a cookbook
-- recipe, and nothing else stores it. The grocery list sends it to the AI to
-- estimate an amount for, alongside the recipe it goes with.
--
--   add_on  text, NULL = no add-on. Trimmed, 1–80 characters when present.
--
-- "Changed since confirmed": adding, changing or removing an add-on changes
-- the groceries, so it now stamps the week the same way a rename does. The
-- trigger function is replaced with the same body plus one line (add_on).
--
-- Security rules are unchanged: planned_meals' four household rules cover
-- every column. No row changes.
--
-- Apply BEFORE deploying the app that reads add_on (the Prep Table selects it,
-- so the app's week load fails without it — this includes preview deploys,
-- which use the production database). Idempotent.

ALTER TABLE public.planned_meals
  ADD COLUMN IF NOT EXISTS add_on text;

ALTER TABLE public.planned_meals
  DROP CONSTRAINT IF EXISTS planned_meals_add_on_valid;
ALTER TABLE public.planned_meals
  ADD CONSTRAINT planned_meals_add_on_valid
  CHECK (add_on IS NULL OR (add_on = btrim(add_on) AND char_length(add_on) BETWEEN 1 AND 80));

COMMENT ON COLUMN public.planned_meals.add_on IS
  'A small extra on this one meal, e.g. "shrimp" on Penne alla Vodka. Plain text, never a cookbook recipe. NULL = none. Sent to the grocery list for an estimated amount.';

CREATE OR REPLACE FUNCTION public.rr_mark_week_changed()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  hh    uuid;
  d_old date;
  d_new date;
BEGIN
  IF current_setting('rr.legacy_copy', true) = 'on' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.planned_on IS NOT DISTINCT FROM NEW.planned_on
     AND OLD.name       IS NOT DISTINCT FROM NEW.name
     AND OLD.vault_id   IS NOT DISTINCT FROM NEW.vault_id
     AND OLD.add_on     IS NOT DISTINCT FROM NEW.add_on
     AND OLD.household_id = NEW.household_id THEN
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    hh := OLD.household_id; d_old := OLD.planned_on;
    IF d_old IS NOT NULL THEN
      UPDATE public.week_confirmations SET changed_at = now()
       WHERE household_id = hh AND d_old BETWEEN starts_on AND ends_on;
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    hh := NEW.household_id; d_new := NEW.planned_on;
    IF d_new IS NOT NULL AND d_new IS DISTINCT FROM d_old THEN
      UPDATE public.week_confirmations SET changed_at = now()
       WHERE household_id = hh AND d_new BETWEEN starts_on AND ends_on;
    END IF;
  END IF;

  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.rr_mark_week_changed() FROM PUBLIC, anon;
