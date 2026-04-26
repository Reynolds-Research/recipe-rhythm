-- Baseline schema migration
--
-- Reconstructs the foundational tables (`meals`, `vault`, `meal_plans`),
-- their RLS policies, and the `recipe_images` storage bucket as they
-- existed before any in-repo migration ran. These objects were created
-- by hand in the Supabase dashboard during early development and were
-- never captured as a migration, which broke Supabase Preview Branches —
-- Preview replays `supabase/migrations/` against an empty database, so
-- later migrations like `20260418000001_planning_periods_schema.sql`
-- failed at `ALTER TABLE meal_plans ADD COLUMN ...` because the table
-- didn't exist.
--
-- Schema source-of-truth used to reconstruct this:
--   - docs/schema.md (column lists)
--   - src/pages/Vault.jsx:380-397 (vault insert payload)
--   - src/pages/LogMode.jsx:34-39 (meals insert payload)
--   - supabase/audits/c3_rls_remediation_meals_vault.sql (RLS policies)
--   - supabase/migrations/20260419000002_relax_legacy_meal_plans_nullability.sql
--     (which establishes that meal_plans.days, items, week_label were
--     originally NOT NULL — i.e. the pre-ADR-001 shape)
--
-- Idempotent: every statement uses IF NOT EXISTS / DROP IF EXISTS /
-- ON CONFLICT DO NOTHING so it's safe to re-run and safe to apply on
-- top of the existing production database (where these objects already
-- exist).
--
-- Filename prefix `00000000000000` ensures this sorts first among
-- migrations.

-- =========================================================================
-- 1. public.meals
-- =========================================================================
--
-- Pre-PRD-001 shape. The `vault_id` column is intentionally NOT created
-- here — it's added by a later migration (meals_vault_link).

CREATE TABLE IF NOT EXISTS public.meals (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  notes       text,
  eaten_on    date,
  created_at  timestamptz NOT NULL DEFAULT now()
);


-- =========================================================================
-- 2. public.vault
-- =========================================================================
--
-- Column types reconstructed from src/pages/Vault.jsx:380-397. Array
-- columns (proteins, dietary_tags, dairy_components, vegetables, fruits)
-- are nullable — the insert payload writes NULL when the form list is
-- empty.

CREATE TABLE IF NOT EXISTS public.vault (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              text        NOT NULL,
  image_url         text,
  cuisine_type      text,
  flavor_profile    text,
  notes             text,
  recipe_url        text,
  is_wildcard       boolean     NOT NULL DEFAULT false,
  auto_completed    boolean     NOT NULL DEFAULT false,
  proteins          text[],
  cooking_method    text,
  main_carb         text,
  dietary_tags      text[],
  dairy_components  text[],
  vegetables        text[],
  fruits            text[],
  created_at        timestamptz NOT NULL DEFAULT now()
);


-- =========================================================================
-- 3. public.meal_plans
-- =========================================================================
--
-- Pre-ADR-001 shape. The `period_start`, `period_end`, and `finalized_at`
-- columns + the `meal_plan_items` table + the EXCLUDE constraint are all
-- added by `20260418000001_planning_periods_schema.sql` and intentionally
-- NOT created here.
--
-- `days`, `items`, and `week_label` are NOT NULL here to match the
-- original prod shape; `20260419000002_relax_legacy_meal_plans_nullability.sql`
-- relaxes them once the new write path stops populating them.

CREATE TABLE IF NOT EXISTS public.meal_plans (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  served_at   timestamptz,
  week_label  text        NOT NULL,
  days        text[]      NOT NULL,
  items       jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);


-- =========================================================================
-- 4. RLS — public.meals
-- =========================================================================
--
-- Mirrors supabase/audits/c3_rls_remediation_meals_vault.sql.

ALTER TABLE public.meals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meals_select_own ON public.meals;
CREATE POLICY meals_select_own
  ON public.meals
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS meals_insert_own ON public.meals;
CREATE POLICY meals_insert_own
  ON public.meals
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS meals_update_own ON public.meals;
CREATE POLICY meals_update_own
  ON public.meals
  FOR UPDATE
  TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS meals_delete_own ON public.meals;
CREATE POLICY meals_delete_own
  ON public.meals
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- =========================================================================
-- 5. RLS — public.vault
-- =========================================================================

ALTER TABLE public.vault ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vault_select_own ON public.vault;
CREATE POLICY vault_select_own
  ON public.vault
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS vault_insert_own ON public.vault;
CREATE POLICY vault_insert_own
  ON public.vault
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS vault_update_own ON public.vault;
CREATE POLICY vault_update_own
  ON public.vault
  FOR UPDATE
  TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS vault_delete_own ON public.vault;
CREATE POLICY vault_delete_own
  ON public.vault
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- =========================================================================
-- 6. RLS — public.meal_plans
-- =========================================================================
--
-- Pre-existing policy as documented in docs/schema.md: a single FOR ALL
-- policy named "Users can manage own meal plans", role public. Hardening
-- to per-operation TO authenticated policies is tracked separately in
-- supabase/audits/c3_remediation_meal_plans_role.sql and intentionally
-- NOT applied here — the baseline reproduces the existing prod shape.

ALTER TABLE public.meal_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own meal plans" ON public.meal_plans;
CREATE POLICY "Users can manage own meal plans"
  ON public.meal_plans
  FOR ALL
  TO public
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- =========================================================================
-- 7. Storage — recipe_images bucket + upload policy
-- =========================================================================
--
-- The bucket is public-read (any URL is world-readable). Uploads require
-- authentication but no per-user folder scoping; that's an acceptable
-- compromise for the current single-user deployment per docs/schema.md.

INSERT INTO storage.buckets (id, name, public)
VALUES ('recipe_images', 'recipe_images', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname LIKE 'Allow Authenticated Uploads%'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY "Allow Authenticated Uploads"
        ON storage.objects
        FOR INSERT
        TO authenticated
        WITH CHECK (bucket_id = 'recipe_images')
    $sql$;
  END IF;
END $$;
