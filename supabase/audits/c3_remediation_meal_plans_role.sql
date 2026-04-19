-- AUDIT C3 — RLS Hardening: public.meal_plans role tightening
--
-- ⚠️  NOT A P0 FIX — consistency hardening only  ⚠️
-- The existing `Users can manage own meal plans` policy on public.meal_plans
-- is functionally correct: it is `FOR ALL` with
--   USING      (user_id = auth.uid())
--   WITH CHECK (user_id = auth.uid())
-- and is granted `TO public`. Because `auth.uid()` returns NULL for the
-- `anon` role, the USING clause matches zero rows for unauthenticated
-- traffic, so anonymous callers cannot read or write meal_plans today.
--
-- Why run this anyway: `public.meals` and `public.vault` were remediated on
-- 2026-04-18 with four per-operation policies scoped `TO authenticated`
-- (see c3_rls_remediation_meals_vault.sql). meal_plans is the odd one out.
-- Tightening it to the same style means:
--   * a uniform pattern across every user-owned table in the schema,
--   * the role restriction is explicit at the policy level rather than
--     implicit in the behavior of auth.uid(), which is easier to audit,
--   * per-operation policies make it trivial to later loosen a single
--     operation (e.g. allow a read-only shared-plan feature) without
--     touching the others.
--
-- Style choice: four per-operation policies (meal_plans_{select,insert,
-- update,delete}_own) rather than a single FOR ALL policy, to match
-- meals/vault exactly. Slightly more verbose, but one consistent pattern
-- across the schema is worth the extra lines.
--
-- How to run:
--   - Supabase Dashboard → SQL Editor → New query.
--   - Paste this entire file and click Run. Wrapped in a single
--     transaction so a failure leaves the old policy intact.
--   - Re-run c3_rls_verification.sql to confirm:
--       * meal_plans still has rls_enabled = true,
--       * meal_plans coverage-check row has missing_operations = NULL,
--       * Query 2 now shows four meal_plans_* policies with roles = {authenticated}.
--   - Load the app, sign in, and exercise BrainstormMode: generate a
--     plan, save it, reload, delete it. If anything 403s, roll back.

BEGIN;

DROP POLICY IF EXISTS "Users can manage own meal plans" ON public.meal_plans;

CREATE POLICY meal_plans_select_own
  ON public.meal_plans
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY meal_plans_insert_own
  ON public.meal_plans
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY meal_plans_update_own
  ON public.meal_plans
  FOR UPDATE
  TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY meal_plans_delete_own
  ON public.meal_plans
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

COMMIT;

-- Rollback (only if the re-verification or smoke test shows a problem —
-- restores the original single FOR ALL / TO public policy exactly as
-- captured from pg_policies on 2026-04-18):
--
-- BEGIN;
--   DROP POLICY IF EXISTS meal_plans_select_own ON public.meal_plans;
--   DROP POLICY IF EXISTS meal_plans_insert_own ON public.meal_plans;
--   DROP POLICY IF EXISTS meal_plans_update_own ON public.meal_plans;
--   DROP POLICY IF EXISTS meal_plans_delete_own ON public.meal_plans;
--
--   CREATE POLICY "Users can manage own meal plans"
--     ON public.meal_plans
--     FOR ALL
--     TO public
--     USING      (user_id = auth.uid())
--     WITH CHECK (user_id = auth.uid());
-- COMMIT;
