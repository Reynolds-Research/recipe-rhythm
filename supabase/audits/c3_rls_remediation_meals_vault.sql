-- AUDIT C3 — RLS Remediation: public.meals and public.vault
--
-- ⚠️  READ BEFORE RUNNING  ⚠️
-- This file turns RLS ON for two tables that currently have it OFF, and
-- creates per-user policies. After it runs, any query against `meals` or
-- `vault` will only return rows where auth.uid() = user_id.
--
-- Preconditions (confirm each one):
--   1. `meals.user_id` and `vault.user_id` are both uuid columns that
--      store the owning user's auth.users.id. Both write paths
--      (src/pages/LogMode.jsx, src/pages/Vault.jsx) already set user_id
--      on INSERT, so existing rows should be attributable.
--   2. No background job, edge function, or analytics script reads
--      these tables using the anon key without a user JWT. If one does,
--      it will start returning zero rows the moment RLS is enabled.
--   3. You ran supabase/audits/c3_rls_verification.sql today and
--      confirmed `meals` and `vault` have `rls_enabled = false`.
--
-- How to run:
--   - Supabase Dashboard → SQL Editor → New query.
--   - Paste this entire file and click Run. It's wrapped in a single
--     transaction so if anything fails, nothing is left half-applied.
--   - Immediately re-run c3_rls_verification.sql to confirm:
--       * meals.rls_enabled  = true
--       * vault.rls_enabled  = true
--       * meals coverage-check row has missing_operations = NULL
--       * vault coverage-check row has missing_operations = NULL
--   - Then load the app, sign in, and sanity-check: logging a meal,
--     viewing the vault, saving a recipe. If anything 403s or returns
--     empty, the user_id on existing rows may not match your auth.uid().

BEGIN;

-- ============================================================
-- public.meals
-- ============================================================
ALTER TABLE public.meals ENABLE ROW LEVEL SECURITY;

CREATE POLICY meals_select_own
  ON public.meals
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY meals_insert_own
  ON public.meals
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY meals_update_own
  ON public.meals
  FOR UPDATE
  TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY meals_delete_own
  ON public.meals
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- public.vault
-- ============================================================
ALTER TABLE public.vault ENABLE ROW LEVEL SECURITY;

CREATE POLICY vault_select_own
  ON public.vault
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY vault_insert_own
  ON public.vault
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY vault_update_own
  ON public.vault
  FOR UPDATE
  TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY vault_delete_own
  ON public.vault
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

COMMIT;

-- Rollback (only if the re-verification or smoke test shows a problem):
--
-- BEGIN;
--   DROP POLICY IF EXISTS meals_select_own ON public.meals;
--   DROP POLICY IF EXISTS meals_insert_own ON public.meals;
--   DROP POLICY IF EXISTS meals_update_own ON public.meals;
--   DROP POLICY IF EXISTS meals_delete_own ON public.meals;
--   ALTER TABLE public.meals DISABLE ROW LEVEL SECURITY;
--
--   DROP POLICY IF EXISTS vault_select_own ON public.vault;
--   DROP POLICY IF EXISTS vault_insert_own ON public.vault;
--   DROP POLICY IF EXISTS vault_update_own ON public.vault;
--   DROP POLICY IF EXISTS vault_delete_own ON public.vault;
--   ALTER TABLE public.vault DISABLE ROW LEVEL SECURITY;
-- COMMIT;
