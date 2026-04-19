-- AUDIT C3 — RLS Remediation Templates
--
-- ⚠️  READ CAREFULLY BEFORE RUNNING  ⚠️
-- This file contains DDL that MODIFIES your database. Do NOT paste the
-- entire file into the SQL Editor. Pick the template that matches your
-- gap, copy it into a fresh SQL Editor tab, replace every <PLACEHOLDER>
-- with a real value, and run one statement at a time.
--
-- Prerequisites before applying:
--   1. You have already run supabase/audits/c3_rls_verification.sql.
--   2. You have recorded the findings in docs/schema.md.
--   3. The target table has a `user_id uuid` column that references
--      auth.users(id). If the column name differs (e.g. `owner_id`),
--      update the templates accordingly.
--
-- Every policy below is "user can only access rows they own".

-- ===========================================================================
-- TEMPLATE A — Enable RLS + standard per-user policies on a user-owned table
-- ===========================================================================
-- Replace <TABLE_NAME> with one of: meals, vault, meal_plans, meal_plan_items
-- Run the ALTER first, then each CREATE POLICY. If a policy with the same
-- name already exists you will get an error — drop the existing one first
-- (DROP POLICY <name> ON <TABLE_NAME>;) and re-create.

ALTER TABLE public.<TABLE_NAME> ENABLE ROW LEVEL SECURITY;

CREATE POLICY <TABLE_NAME>_select_own
  ON public.<TABLE_NAME>
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY <TABLE_NAME>_insert_own
  ON public.<TABLE_NAME>
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY <TABLE_NAME>_update_own
  ON public.<TABLE_NAME>
  FOR UPDATE
  TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY <TABLE_NAME>_delete_own
  ON public.<TABLE_NAME>
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ===========================================================================
-- TEMPLATE B — Storage bucket policies for `recipe_images`
-- ===========================================================================
-- Supabase storage RLS lives on the storage.objects table. The convention
-- these policies assume is that uploads are saved under a per-user folder:
--     <user_uuid>/<filename>
-- so `(storage.foldername(name))[1]` returns the owning user's UUID.
--
-- ⚠️ The current app (src/pages/Vault.jsx:352) uploads files as
-- `recipe-<timestamp>.jpg` at the BUCKET ROOT, NOT under a user folder.
-- If you apply these policies as-is, existing uploads will become
-- inaccessible. Options:
--   1. Update Vault.jsx to upload to `${userId}/recipe-<ts>.jpg` and
--      migrate existing objects into per-user folders before enabling
--      the policies. (Preferred.)
--   2. If the app is single-user and nothing else writes to the bucket,
--      a simpler "authenticated users only" policy may be acceptable —
--      see TEMPLATE B2 below.

-- --- TEMPLATE B1 — per-user folder scoping (recommended long-term) -------
-- First, make sure the bucket is NOT marked public:
--   UPDATE storage.buckets SET public = false WHERE id = 'recipe_images';

CREATE POLICY recipe_images_select_own
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'recipe_images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY recipe_images_insert_own
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'recipe_images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY recipe_images_update_own
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'recipe_images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY recipe_images_delete_own
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'recipe_images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- --- TEMPLATE B2 — "any authenticated user" (interim / single-user only) -
-- Use this ONLY if the app is single-user and you cannot yet migrate uploads
-- into per-user folders. Revisit before onboarding a second user.

-- CREATE POLICY recipe_images_authenticated_all
--   ON storage.objects
--   FOR ALL
--   TO authenticated
--   USING      (bucket_id = 'recipe_images')
--   WITH CHECK (bucket_id = 'recipe_images');

-- ===========================================================================
-- TEMPLATE C — Dropping a policy (when replacing an existing bad one)
-- ===========================================================================
-- DROP POLICY IF EXISTS <policy_name> ON public.<TABLE_NAME>;
-- DROP POLICY IF EXISTS <policy_name> ON storage.objects;
