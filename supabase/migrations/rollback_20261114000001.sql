-- =========================================================================
-- Rollback: 20261114000001_planned_meals_add_on
-- Puts the database back exactly as it was before the migration.
-- Loses only the add-on text; every planned meal, its name and its recipe
-- link stay. The trigger function goes back to its 20261102000001 body
-- (restored first, so it never refers to a column that is gone).
-- =========================================================================
BEGIN;

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

ALTER TABLE public.planned_meals
  DROP CONSTRAINT IF EXISTS planned_meals_add_on_valid;
ALTER TABLE public.planned_meals
  DROP COLUMN IF EXISTS add_on;

COMMIT;

-- Expect one row: false, false.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'planned_meals' AND column_name = 'add_on') AS column_left,
  (SELECT prosrc LIKE '%add_on%' FROM pg_proc WHERE oid = 'public.rr_mark_week_changed()'::regprocedure) AS trigger_mentions_add_on;
