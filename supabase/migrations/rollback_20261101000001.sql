-- =========================================================================
-- Rollback: 20261101000001_households
-- Restores the pre-PRD-008 schema: no households tables or helpers, no
-- household_id columns, no sign-up trigger, and the per-person uniqueness
-- rules exactly as they were on prod 2026-11-01.
-- Run rollback_20261101000002.sql FIRST (this file refuses otherwise).
-- Safe to re-run.
--
-- Data: nothing is deleted except the household tables themselves. Rows keep
-- their user_id. Preferences and tag options go back to the account their
-- household was created for, so each person's per-person row comes back.
-- If someone added overlapping periods while sharing, the overlap rule can't
-- be restored and the whole rollback stops with no changes.
-- =========================================================================
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE '%\_household' ESCAPE '\'
             AND tablename <> 'households' AND tablename <> 'household_members') THEN
    RAISE EXCEPTION 'Run rollback_20261101000002.sql first: household security rules are still in place.';
  END IF;
END $$;

-- E. sign-up trigger
DROP TRIGGER IF EXISTS on_auth_user_created_household ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user_household();

-- D. per-household → per-person rules
DO $$
BEGIN
  IF to_regclass('public.households') IS NOT NULL THEN
    -- Shared preferences / tag options go back to the household's original account.
    UPDATE public.household_preferences p SET user_id = h.created_for
      FROM public.households h WHERE h.id = p.household_id AND h.created_for IS NOT NULL AND p.user_id <> h.created_for;
    UPDATE public.vault_options o SET user_id = h.created_for
      FROM public.households h WHERE h.id = o.household_id AND h.created_for IS NOT NULL AND o.user_id <> h.created_for;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'household_preferences_pkey'
             AND pg_get_constraintdef(oid) = 'PRIMARY KEY (household_id)') THEN
    ALTER TABLE public.household_preferences DROP CONSTRAINT household_preferences_pkey;
    ALTER TABLE public.household_preferences ADD CONSTRAINT household_preferences_pkey PRIMARY KEY (user_id);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vault_options_pkey'
             AND pg_get_constraintdef(oid) = 'PRIMARY KEY (household_id, category, value)') THEN
    ALTER TABLE public.vault_options DROP CONSTRAINT vault_options_pkey;
    ALTER TABLE public.vault_options ADD CONSTRAINT vault_options_pkey PRIMARY KEY (user_id, category, value);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meal_plans_no_period_overlap'
             AND pg_get_constraintdef(oid) LIKE 'EXCLUDE USING gist (household_id WITH =%') THEN
    ALTER TABLE public.meal_plans DROP CONSTRAINT meal_plans_no_period_overlap;
    ALTER TABLE public.meal_plans ADD CONSTRAINT meal_plans_no_period_overlap
      EXCLUDE USING gist (user_id WITH =, daterange(period_start, period_end, '[]') WITH &&)
      WHERE (period_start IS NOT NULL AND period_end IS NOT NULL);
  END IF;
END $$;

DROP INDEX IF EXISTS public.grocery_lists_household_plan_idx;
CREATE UNIQUE INDEX IF NOT EXISTS grocery_lists_user_plan_idx
  ON public.grocery_lists USING btree (user_id, meal_plan_id) WHERE (meal_plan_id IS NOT NULL);

-- C. household_id columns (their foreign keys, defaults and indexes go with them)
ALTER TABLE public.vault                 DROP COLUMN IF EXISTS household_id;
ALTER TABLE public.vault_options         DROP COLUMN IF EXISTS household_id;
ALTER TABLE public.meals                 DROP COLUMN IF EXISTS household_id;
ALTER TABLE public.meal_plans            DROP COLUMN IF EXISTS household_id;
ALTER TABLE public.meal_plan_items       DROP COLUMN IF EXISTS household_id;
ALTER TABLE public.grocery_lists         DROP COLUMN IF EXISTS household_id;
ALTER TABLE public.household_preferences DROP COLUMN IF EXISTS household_id;
ALTER TABLE public.plan_drafts           DROP COLUMN IF EXISTS household_id;

-- A. tables (their rules use the helper, so they go first), then helpers
DROP TABLE IF EXISTS public.household_members;
DROP TABLE IF EXISTS public.households;
DROP FUNCTION IF EXISTS public.current_household_id();
DROP FUNCTION IF EXISTS public.is_household_member(uuid);

COMMIT;
