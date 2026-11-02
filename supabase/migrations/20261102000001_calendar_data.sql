-- =========================================================================
-- Migration: 20261102000001_calendar_data
-- PRD-008 phase 2a — Calendar data (P0.3, D1–D4). Requires the phase 1
-- household migrations. Undo: rollback_20261102000001.sql
-- =========================================================================
--
-- Mental model: a plan stops being a locked "period" box with meals inside.
-- Instead every meal is its own row with a date (D1, D2); a week is just the
-- dates on screen. "Confirm the week" is a stamp on a date range (D4), not a
-- lock. Nothing in the app reads these tables yet: the new Prep Table (2b)
-- does, and the switch-over (2c) re-runs the copy of the old plans.
--
--   planned_meals       one row per meal. planned_on NULL = the Maybe list.
--                       user_id = who added it (same convention as every
--                       kitchen table since phase 1).
--   week_confirmations  her sign-off on a date range, linked to its grocery
--                       list. changed_at moves whenever a meal in the range is
--                       added, removed, renamed or moved, so
--                       "changed since confirmed" = changed_at > confirmed_at
--                       (deletions count too, which an updated_at alone can't show).
--   rr_copy_legacy_plans()  copies the old plans in; safe to run again (see
--                       the function's comment). Admin-only. Dropped in phase 4.
--
-- Idempotent: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS throughout.

-- ---------------------------------------------------------------------------
-- 1. planned_meals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planned_meals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     uuid NOT NULL DEFAULT public.current_household_id()
                     REFERENCES public.households(id) ON DELETE CASCADE,
  planned_on       date,                                   -- NULL = Maybe list
  position         integer NOT NULL DEFAULT 0,
  name             text NOT NULL,
  vault_id         uuid REFERENCES public.vault(id) ON DELETE SET NULL,
  is_wildcard      boolean NOT NULL DEFAULT false,
  source_url       text,
  cooked           boolean NOT NULL DEFAULT false,
  cooked_at        timestamptz,
  assigned_to      uuid REFERENCES auth.users(id) ON DELETE SET NULL,   -- "Matt's night" (phase 3)
  assigned_at      timestamptz,
  user_id          uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL, -- who added it
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  legacy_item_id   uuid UNIQUE,        -- the meal_plan_items row it was copied from
  legacy_synced_at timestamptz,        -- when the copy last wrote it
  CONSTRAINT planned_meals_name_not_blank   CHECK (btrim(name) <> ''),
  CONSTRAINT planned_meals_cooked_at_needs_cooked CHECK (cooked OR cooked_at IS NULL),
  CONSTRAINT planned_meals_maybe_not_cooked CHECK (planned_on IS NOT NULL OR NOT cooked),
  CONSTRAINT planned_meals_assigned_at_needs_assignee CHECK (assigned_to IS NOT NULL OR assigned_at IS NULL)
);

CREATE INDEX IF NOT EXISTS planned_meals_household_date_idx
  ON public.planned_meals (household_id, planned_on);
CREATE INDEX IF NOT EXISTS planned_meals_household_maybe_idx
  ON public.planned_meals (household_id) WHERE planned_on IS NULL;
CREATE INDEX IF NOT EXISTS planned_meals_vault_idx
  ON public.planned_meals (vault_id) WHERE vault_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. week_confirmations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.week_confirmations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     uuid NOT NULL DEFAULT public.current_household_id()
                     REFERENCES public.households(id) ON DELETE CASCADE,
  starts_on        date NOT NULL,
  ends_on          date NOT NULL,
  user_id          uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL, -- who confirmed
  confirmed_at     timestamptz NOT NULL DEFAULT now(),
  changed_at       timestamptz,        -- last add/remove/rename/move of a meal in the range
  grocery_list_id  uuid UNIQUE REFERENCES public.grocery_lists(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  legacy_plan_id   uuid UNIQUE,        -- the meal_plans row it was copied from
  legacy_synced_at timestamptz,
  CONSTRAINT week_confirmations_range_valid CHECK (ends_on >= starts_on),
  CONSTRAINT week_confirmations_one_per_range UNIQUE (household_id, starts_on, ends_on)
);

CREATE INDEX IF NOT EXISTS week_confirmations_household_range_idx
  ON public.week_confirmations (household_id, starts_on, ends_on);

-- ---------------------------------------------------------------------------
-- 3. updated_at triggers (same in-repo pattern as household_preferences)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rr_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS planned_meals_set_updated_at ON public.planned_meals;
CREATE TRIGGER planned_meals_set_updated_at BEFORE UPDATE ON public.planned_meals
  FOR EACH ROW EXECUTE FUNCTION public.rr_set_updated_at();

DROP TRIGGER IF EXISTS week_confirmations_set_updated_at ON public.week_confirmations;
CREATE TRIGGER week_confirmations_set_updated_at BEFORE UPDATE ON public.week_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.rr_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. "Changed since confirmed"
-- A meal added, removed, renamed, re-linked or moved to/from a confirmed
-- range stamps that confirmation's changed_at. Ticking "cooked", reordering
-- or assigning a night do not: they don't change the groceries.
-- Runs with the caller's rights (members can update their confirmations).
-- The legacy copy switches it off for its own writes.
-- ---------------------------------------------------------------------------
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

DROP TRIGGER IF EXISTS planned_meals_mark_week_changed ON public.planned_meals;
CREATE TRIGGER planned_meals_mark_week_changed
  AFTER INSERT OR UPDATE OR DELETE ON public.planned_meals
  FOR EACH ROW EXECUTE FUNCTION public.rr_mark_week_changed();

-- ---------------------------------------------------------------------------
-- 5. Security rules: the same four membership rules every kitchen table has
-- (20261101000002). New rows must be stamped with the adder's own user_id.
-- ---------------------------------------------------------------------------
ALTER TABLE public.planned_meals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.week_confirmations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['planned_meals','week_confirmations']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_household', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
                    USING (public.is_household_member(household_id))', t || '_select_household', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert_household', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
                    WITH CHECK (public.is_household_member(household_id) AND user_id = (SELECT auth.uid()))',
                   t || '_insert_household', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update_household', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
                    USING (public.is_household_member(household_id))
                    WITH CHECK (public.is_household_member(household_id))', t || '_update_household', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete_household', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
                    USING (public.is_household_member(household_id))', t || '_delete_household', t);
  END LOOP;
END $$;

REVOKE ALL ON public.planned_meals, public.week_confirmations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.planned_meals, public.week_confirmations TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. The copy of the old plans (P0.3). Admin-only: run it in the SQL Editor
--    with  SELECT public.rr_copy_legacy_plans();
--
-- Safe to run again (PRD phasing: "if the copy has to run earlier for
-- testing, it runs again at switch-over"). Each run mirrors the old tables:
--   * old meal not copied yet          → added
--   * old meal changed since last copy → updated
--   * old meal deleted since last copy → removed
-- but a copied meal that someone has since edited on the new screens
-- (updated_at moved past legacy_synced_at) is never overwritten or removed;
-- it is counted as "kept".
-- Scheduled items keep their date; Maybe items get no date. Every served old
-- plan becomes a confirmation of its date range, linked to its grocery list.
-- Returns the counts as JSON.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rr_copy_legacy_plans()
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  t           timestamptz := now();   -- = what the updated_at trigger writes in this transaction
  n_added     int; n_updated int; n_removed int; n_kept int;
  c_added     int; c_updated int; c_removed int; c_kept int; c_skipped int;
BEGIN
  PERFORM set_config('rr.legacy_copy', 'on', true);   -- this transaction only

  -- Meals -------------------------------------------------------------------
  SELECT count(*) INTO n_kept
    FROM public.planned_meals pm
   WHERE pm.legacy_item_id IS NOT NULL AND pm.updated_at > pm.legacy_synced_at;

  WITH src AS (
    SELECT i.* FROM public.meal_plan_items i
  ), upd AS (
    UPDATE public.planned_meals pm SET
      household_id = s.household_id, planned_on = s.scheduled_date, position = coalesce(s.position, 0),
      name = s.name, vault_id = s.vault_id, is_wildcard = coalesce(s.is_wildcard, false),
      source_url = s.source_url,
      cooked = coalesce(s.cooked, false) AND s.scheduled_date IS NOT NULL,
      cooked_at = CASE WHEN coalesce(s.cooked, false) AND s.scheduled_date IS NOT NULL THEN s.cooked_at END,
      user_id = s.user_id, legacy_synced_at = t, updated_at = t
    FROM src s
    WHERE pm.legacy_item_id = s.id
      AND pm.updated_at <= pm.legacy_synced_at          -- untouched on the new screens
      AND (pm.household_id, pm.planned_on, pm.position, pm.name, pm.vault_id, pm.is_wildcard,
           pm.source_url, pm.cooked, pm.cooked_at, pm.user_id)
          IS DISTINCT FROM
          (s.household_id, s.scheduled_date, coalesce(s.position, 0), s.name, s.vault_id,
           coalesce(s.is_wildcard, false), s.source_url,
           coalesce(s.cooked, false) AND s.scheduled_date IS NOT NULL,
           CASE WHEN coalesce(s.cooked, false) AND s.scheduled_date IS NOT NULL THEN s.cooked_at END,
           s.user_id)
    RETURNING 1
  )
  SELECT count(*) INTO n_updated FROM upd;

  WITH ins AS (
    INSERT INTO public.planned_meals
      (household_id, planned_on, position, name, vault_id, is_wildcard, source_url,
       cooked, cooked_at, user_id, created_at, updated_at, legacy_item_id, legacy_synced_at)
    SELECT i.household_id, i.scheduled_date, coalesce(i.position, 0), i.name, i.vault_id,
           coalesce(i.is_wildcard, false), i.source_url,
           coalesce(i.cooked, false) AND i.scheduled_date IS NOT NULL,
           CASE WHEN coalesce(i.cooked, false) AND i.scheduled_date IS NOT NULL THEN i.cooked_at END,
           i.user_id, coalesce(i.created_at, t), t, i.id, t
      FROM public.meal_plan_items i
     WHERE NOT EXISTS (SELECT 1 FROM public.planned_meals pm WHERE pm.legacy_item_id = i.id)
    RETURNING 1
  )
  SELECT count(*) INTO n_added FROM ins;

  WITH del AS (
    DELETE FROM public.planned_meals pm
     WHERE pm.legacy_item_id IS NOT NULL
       AND pm.updated_at <= pm.legacy_synced_at
       AND NOT EXISTS (SELECT 1 FROM public.meal_plan_items i WHERE i.id = pm.legacy_item_id)
    RETURNING 1
  )
  SELECT count(*) INTO n_removed FROM del;

  -- Confirmations (served old plans with a date range) -----------------------
  SELECT count(*) INTO c_kept
    FROM public.week_confirmations w
   WHERE w.legacy_plan_id IS NOT NULL AND w.updated_at > w.legacy_synced_at;

  WITH src AS (
    SELECT p.id, p.household_id, p.period_start, p.period_end, p.user_id, p.served_at,
           (SELECT g.id FROM public.grocery_lists g WHERE g.meal_plan_id = p.id
             ORDER BY g.created_at LIMIT 1) AS list_id
      FROM public.meal_plans p
     WHERE p.served_at IS NOT NULL AND p.period_start IS NOT NULL AND p.period_end IS NOT NULL
  ), upd AS (
    UPDATE public.week_confirmations w SET
      household_id = s.household_id, starts_on = s.period_start, ends_on = s.period_end,
      user_id = s.user_id, confirmed_at = s.served_at, grocery_list_id = s.list_id,
      legacy_synced_at = t, updated_at = t
    FROM src s
    WHERE w.legacy_plan_id = s.id
      AND w.updated_at <= w.legacy_synced_at
      AND (w.household_id, w.starts_on, w.ends_on, w.user_id, w.confirmed_at, w.grocery_list_id)
          IS DISTINCT FROM (s.household_id, s.period_start, s.period_end, s.user_id, s.served_at, s.list_id)
    RETURNING 1
  ), ins AS (
    INSERT INTO public.week_confirmations
      (household_id, starts_on, ends_on, user_id, confirmed_at, grocery_list_id,
       created_at, updated_at, legacy_plan_id, legacy_synced_at)
    SELECT s.household_id, s.period_start, s.period_end, s.user_id, s.served_at, s.list_id,
           t, t, s.id, t
      FROM src s
     WHERE NOT EXISTS (SELECT 1 FROM public.week_confirmations w WHERE w.legacy_plan_id = s.id)
       -- a range already confirmed on the new screens wins
       AND NOT EXISTS (SELECT 1 FROM public.week_confirmations w
                        WHERE w.household_id = s.household_id
                          AND w.starts_on = s.period_start AND w.ends_on = s.period_end)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM upd), (SELECT count(*) FROM ins) INTO c_updated, c_added;

  SELECT count(*) INTO c_skipped
    FROM public.meal_plans p
   WHERE p.served_at IS NOT NULL AND p.period_start IS NOT NULL AND p.period_end IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.week_confirmations w WHERE w.legacy_plan_id = p.id);

  WITH del AS (
    DELETE FROM public.week_confirmations w
     WHERE w.legacy_plan_id IS NOT NULL
       AND w.updated_at <= w.legacy_synced_at
       AND NOT EXISTS (SELECT 1 FROM public.meal_plans p
                        WHERE p.id = w.legacy_plan_id AND p.served_at IS NOT NULL
                          AND p.period_start IS NOT NULL AND p.period_end IS NOT NULL)
    RETURNING 1
  )
  SELECT count(*) INTO c_removed FROM del;

  PERFORM set_config('rr.legacy_copy', 'off', true);   -- later statements in the same paste stamp again

  RETURN jsonb_build_object(
    'meals',         jsonb_build_object('added', n_added, 'updated', n_updated, 'removed', n_removed, 'kept_edited', n_kept),
    'confirmations', jsonb_build_object('added', c_added, 'updated', c_updated, 'removed', c_removed,
                                        'kept_edited', c_kept, 'skipped_range_taken', c_skipped));
END $$;

REVOKE ALL ON FUNCTION public.rr_copy_legacy_plans() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rr_mark_week_changed()  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rr_set_updated_at()     FROM PUBLIC, anon;
