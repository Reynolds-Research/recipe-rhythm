-- PRD-002 P0.1: household_preferences table
--
-- See: docs/prds/PRD-002-meal-planning.md §6 P0.1
--
-- Creates the per-user preferences row that drives the hard-filter
-- in src/lib/recommendations.js (P0.3, separate PR) and the settings
-- page in BrainstormMode (P0.2, separate PR). One row per user;
-- upserted lazily the first time the user saves a preference. NO
-- auto-create on signup — the absence of a row means "no preferences
-- set yet" and is handled by the data-layer helper in
-- src/lib/preferences.js by returning a defaults object.
--
-- Why nullable max_prep_time_minutes:
--   NULL = "use the app default", i.e. fall back to
--   recommendations.js's DEFAULT_MAX_PREP_TIME_MINUTES (90). The
--   recommender owns that fallback; this table is dumb storage.
--
-- Why text[] for dietary_restrictions / excluded_cuisines instead
-- of a DB-level CHECK enum:
--   The vocabularies live in src/lib/constants.js (DIETARY_RESTRICTIONS,
--   CUISINE_OPTIONS) and adding a new option there should not require
--   a migration. App-level validation in src/lib/preferences.js is
--   the source of truth — the DB stores whatever string ids the app
--   writes.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DO-block guard for the trigger. Safe to re-run.
--
-- Reversibility (manual rollback, if ever needed):
--   DROP TRIGGER IF EXISTS household_preferences_set_updated_at ON household_preferences;
--   DROP FUNCTION IF EXISTS household_preferences_set_updated_at();
--   DROP TABLE IF EXISTS household_preferences;

-- =========================================================================
-- 1. household_preferences table
-- =========================================================================
--
-- user_id is the primary key — one row per user, no surrogate id needed.
-- ON DELETE CASCADE so the row goes away with the auth.users record.
-- Empty arrays (NOT NULL DEFAULT '{}') keep the read path branch-free:
-- callers can always treat the column as an array, never NULL.

CREATE TABLE IF NOT EXISTS public.household_preferences (
  user_id                uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  dietary_restrictions   text[]      NOT NULL DEFAULT '{}',
  excluded_ingredients   text[]      NOT NULL DEFAULT '{}',
  excluded_cuisines      text[]      NOT NULL DEFAULT '{}',
  max_prep_time_minutes  integer,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT max_prep_time_positive
    CHECK (max_prep_time_minutes IS NULL OR max_prep_time_minutes > 0)
);

COMMENT ON TABLE public.household_preferences IS
  'PRD-002 P0.1: one row per user holding meal-planning preferences. Drives the hard-filter in src/lib/recommendations.js (P0.3). NULL max_prep_time_minutes means "use app default" — the recommender falls back to DEFAULT_MAX_PREP_TIME_MINUTES (90). No auto-create on signup; lazily upserted by src/lib/preferences.js. Vocabularies for dietary_restrictions and excluded_cuisines are validated app-side against src/lib/constants.js (DIETARY_RESTRICTIONS, CUISINE_OPTIONS) — adding a new option there does not require a migration.';

COMMENT ON COLUMN public.household_preferences.dietary_restrictions IS
  'Array of DIETARY_RESTRICTIONS ids (case-sensitive) from src/lib/constants.js, e.g. {vegetarian,gluten-free}. App-level validation in src/lib/preferences.js rejects unknown ids before write.';

COMMENT ON COLUMN public.household_preferences.excluded_ingredients IS
  'Array of free-text ingredient strings the user wants excluded (e.g. {cilantro,olives}). Normalized in src/lib/preferences.js: trim + lowercase + dedupe before write. No app-side vocabulary check.';

COMMENT ON COLUMN public.household_preferences.excluded_cuisines IS
  'Array of CUISINE_OPTIONS values (case-sensitive) from src/lib/constants.js, e.g. {Indian,Thai}. App-level validation in src/lib/preferences.js rejects unknown cuisines before write.';

COMMENT ON COLUMN public.household_preferences.max_prep_time_minutes IS
  'PRD-002 P0.1: max prep time the user wants for recommendations. NULL = use app default (recommendations.js DEFAULT_MAX_PREP_TIME_MINUTES, 90). The recommender owns that fallback; this table is dumb storage.';


-- =========================================================================
-- 2. RLS — owner-scoped per-operation policies
-- =========================================================================
--
-- Mirrors the meal_plan_items / vault_options policy style: per-operation
-- policies, role authenticated (TO authenticated), USING / WITH CHECK
-- both keyed on auth.uid() = user_id. DROP POLICY IF EXISTS keeps the
-- migration idempotent.

ALTER TABLE public.household_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS household_preferences_select_own ON public.household_preferences;
CREATE POLICY household_preferences_select_own
  ON public.household_preferences
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS household_preferences_insert_own ON public.household_preferences;
CREATE POLICY household_preferences_insert_own
  ON public.household_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS household_preferences_update_own ON public.household_preferences;
CREATE POLICY household_preferences_update_own
  ON public.household_preferences
  FOR UPDATE
  TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS household_preferences_delete_own ON public.household_preferences;
CREATE POLICY household_preferences_delete_own
  ON public.household_preferences
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- =========================================================================
-- 3. updated_at trigger
-- =========================================================================
--
-- Plain BEFORE UPDATE trigger function — the project doesn't have an
-- existing moddatetime / set_updated_at helper, and we don't want to
-- enable the moddatetime extension just for this. CREATE OR REPLACE
-- so re-running the migration replaces the function in place.
--
-- The trigger creation is wrapped in a DO block because CREATE TRIGGER
-- has no IF NOT EXISTS form; the guard checks pg_trigger and only
-- creates when missing.

CREATE OR REPLACE FUNCTION public.household_preferences_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'household_preferences_set_updated_at'
      AND tgrelid = 'public.household_preferences'::regclass
  ) THEN
    CREATE TRIGGER household_preferences_set_updated_at
      BEFORE UPDATE ON public.household_preferences
      FOR EACH ROW
      EXECUTE FUNCTION public.household_preferences_set_updated_at();
  END IF;
END $$;
