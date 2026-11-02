-- =========================================================================
-- Migration: 20261101000001_households
-- PRD-008 phase 1 — Household schema + setup (P0.1). Part 1 of 2.
-- Part 2 (20261101000002) swaps the security rules. Undo: rollback_20261101000001.sql
-- (run rollback_20261101000002.sql FIRST if part 2 is applied).
-- =========================================================================
--
-- Mental model: the household owns the kitchen; `user_id` stays on every row
-- as "who added it" (PRD-008 D5). Every account gets a household (D7).
--
--   A. households + household_members, two helper functions, RLS on both.
--   B. A solo household for every existing account; ownerless legacy rows go
--      to one fixed "Unowned legacy rows" household that has no members.
--   C. household_id on every kitchen table, backfilled, NOT NULL, defaulting
--      to the caller's household (so inserts from the pre-PRD-008 app still
--      land in the right place).
--   D. Uniqueness that was per-person becomes per-household
--      (preferences, tag options, the period-overlap rule, list-per-plan).
--      plan_drafts stays one-per-person on purpose (retired in phase 4).
--   E. Sign-up trigger: every new account gets a solo household.
--   F. The shared household (Matt + his wife). EMAILS ARE NEVER COMMITTED —
--      the two placeholders below are replaced only in the copy Matt pastes.
--      With placeholders left in, step F is skipped with a NOTICE.
--
-- grocery_list_items gets no household_id: an item always belongs to a list,
-- and its security rule checks the list's household (no second copy to drift).
--
-- Idempotent: IF NOT EXISTS / ON CONFLICT / guarded DO blocks — re-running is a no-op.

-- ---------------------------------------------------------------- A. tables
CREATE TABLE IF NOT EXISTS public.households (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  -- The account this household was created for (solo households). Used by the
  -- backfill, the sign-up trigger and the rollback. NULL for the legacy household.
  created_for uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS households_created_for_key
  ON public.households (created_for) WHERE created_for IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.household_members (
  household_id uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id),
  -- One household per account: "which household am I in?" has one answer.
  CONSTRAINT household_members_one_household_per_account UNIQUE (user_id)
);

ALTER TABLE public.households        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;

-- Explicit grants (don't rely on the project's default privileges): members may
-- only read; logged-out visitors get nothing.
REVOKE ALL ON public.households, public.household_members FROM anon, authenticated;
GRANT SELECT ON public.households, public.household_members TO authenticated;
GRANT ALL    ON public.households, public.household_members TO service_role;

-- Helpers. SECURITY DEFINER = they read household_members with the owner's
-- rights, so the membership table's own rule can't block (or loop on) the check.
-- search_path is pinned so a caller can't swap in look-alike tables.
CREATE OR REPLACE FUNCTION public.is_household_member(p_household_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.household_members m
    WHERE m.household_id = p_household_id
      AND m.user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.current_household_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.household_id FROM public.household_members m
  WHERE m.user_id = (SELECT auth.uid());
$$;

REVOKE EXECUTE ON FUNCTION public.is_household_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_household_id()     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_household_member(uuid) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.current_household_id()     TO authenticated, service_role;

-- Read-only for members; nobody changes membership from the app (no invite flow, non-goal 1).
DROP POLICY IF EXISTS households_select_member ON public.households;
CREATE POLICY households_select_member ON public.households
  FOR SELECT TO authenticated USING (public.is_household_member(id));

DROP POLICY IF EXISTS household_members_select_member ON public.household_members;
CREATE POLICY household_members_select_member ON public.household_members
  FOR SELECT TO authenticated USING (public.is_household_member(household_id));

-- ------------------------------------------------------- B. solo households
INSERT INTO public.households (id, name, created_for)
VALUES ('00000000-0000-4000-8000-000000000000', 'Unowned legacy rows', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.households (name, created_for)
SELECT 'My kitchen', u.id FROM auth.users u
ON CONFLICT (created_for) WHERE created_for IS NOT NULL DO NOTHING;

INSERT INTO public.household_members (household_id, user_id)
SELECT h.id, h.created_for FROM public.households h
WHERE h.created_for IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.household_members m WHERE m.user_id = h.created_for);

-- ---------------------------------------- C. household_id on kitchen tables
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vault','vault_options','meals','meal_plans','meal_plan_items',
                           'grocery_lists','household_preferences','plan_drafts']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS household_id uuid', t);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = t || '_household_id_fkey' AND conrelid = format('public.%I', t)::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (household_id) REFERENCES public.households(id)',
                     t, t || '_household_id_fkey');
    END IF;
    -- Backfill: the owner's solo household; no owner (or an owner who no longer exists) → legacy.
    EXECUTE format($f$
      UPDATE public.%I t SET household_id = COALESCE(
        (SELECT h.id FROM public.households h WHERE h.created_for = t.user_id),
        '00000000-0000-4000-8000-000000000000')
      WHERE t.household_id IS NULL$f$, t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN household_id SET DEFAULT public.current_household_id()', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN household_id SET NOT NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (household_id)', t || '_household_idx', t);
  END LOOP;
END $$;

-- Query-shaped indexes mirroring the per-user ones the app uses today.
CREATE INDEX IF NOT EXISTS vault_household_active_idx       ON public.vault (household_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS meals_household_vault_idx        ON public.meals (household_id, vault_id);
CREATE INDEX IF NOT EXISTS meal_plan_items_household_scheduled_idx ON public.meal_plan_items (household_id, scheduled_date);
CREATE INDEX IF NOT EXISTS meal_plans_household_served      ON public.meal_plans (household_id, served_at DESC);

-- -------------------------------------- D. per-person → per-household rules
DO $$
BEGIN
  -- Preferences: one row per household.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'household_preferences_pkey'
             AND pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id)') THEN
    ALTER TABLE public.household_preferences DROP CONSTRAINT household_preferences_pkey;
    ALTER TABLE public.household_preferences ADD CONSTRAINT household_preferences_pkey PRIMARY KEY (household_id);
  END IF;
  -- Tag options: one vocabulary per household.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vault_options_pkey'
             AND pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id, category, value)') THEN
    ALTER TABLE public.vault_options DROP CONSTRAINT vault_options_pkey;
    ALTER TABLE public.vault_options ADD CONSTRAINT vault_options_pkey PRIMARY KEY (household_id, category, value);
  END IF;
  -- Period overlap: per household, so two members can't create overlapping
  -- periods (retired with periods in phase 4).
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meal_plans_no_period_overlap'
             AND pg_get_constraintdef(oid) LIKE 'EXCLUDE USING gist (user_id WITH =%') THEN
    ALTER TABLE public.meal_plans DROP CONSTRAINT meal_plans_no_period_overlap;
    ALTER TABLE public.meal_plans ADD CONSTRAINT meal_plans_no_period_overlap
      EXCLUDE USING gist (household_id WITH =, daterange(period_start, period_end, '[]') WITH &&)
      WHERE (period_start IS NOT NULL AND period_end IS NOT NULL);
  END IF;
END $$;

-- One grocery list per plan, per household.
DROP INDEX IF EXISTS public.grocery_lists_user_plan_idx;
CREATE UNIQUE INDEX IF NOT EXISTS grocery_lists_household_plan_idx
  ON public.grocery_lists (household_id, meal_plan_id) WHERE meal_plan_id IS NOT NULL;

-- ----------------------------------------------------- E. sign-up trigger
CREATE OR REPLACE FUNCTION public.handle_new_user_household()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_household uuid;
BEGIN
  INSERT INTO public.households (name, created_for) VALUES ('My kitchen', NEW.id)
  ON CONFLICT (created_for) WHERE created_for IS NOT NULL DO NOTHING
  RETURNING id INTO v_household;
  IF v_household IS NULL THEN
    SELECT h.id INTO v_household FROM public.households h WHERE h.created_for = NEW.id;
  END IF;
  INSERT INTO public.household_members (household_id, user_id) VALUES (v_household, NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_household() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_household ON auth.users;
CREATE TRIGGER on_auth_user_created_household
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_household();

-- ------------------------------------------------- F. the shared household
-- Replace BOTH placeholders in the copy you paste. Never commit real emails.
-- Effect: Matt moves into his wife's household (renamed "Our kitchen").
-- His old solo household keeps his old rows, with no members (kept, not merged).
DO $$
DECLARE
  v_her_email  text := '<HER_EMAIL>';
  v_matt_email text := '<MATT_EMAIL>';
  v_her  uuid;
  v_matt uuid;
  v_home uuid;
BEGIN
  IF v_her_email LIKE '<%' OR v_matt_email LIKE '<%' THEN
    RAISE NOTICE 'Shared household skipped: email placeholders not replaced.';
    RETURN;
  END IF;
  SELECT id INTO v_her  FROM auth.users WHERE lower(email) = lower(v_her_email);
  SELECT id INTO v_matt FROM auth.users WHERE lower(email) = lower(v_matt_email);
  IF v_her IS NULL OR v_matt IS NULL THEN
    RAISE EXCEPTION 'Shared household: an email matched no account (her found: %, Matt found: %)',
      v_her IS NOT NULL, v_matt IS NOT NULL;
  END IF;
  IF v_her = v_matt THEN
    RAISE EXCEPTION 'Shared household: both emails are the same account';
  END IF;
  SELECT id INTO v_home FROM public.households WHERE created_for = v_her;
  UPDATE public.households SET name = 'Our kitchen' WHERE id = v_home;
  UPDATE public.household_members SET household_id = v_home, joined_at = now()
  WHERE user_id = v_matt AND household_id <> v_home;
  RAISE NOTICE 'Shared household ready: 2 members.';
END $$;
