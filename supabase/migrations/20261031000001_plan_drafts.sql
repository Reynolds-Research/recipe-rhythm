-- =========================================================================
-- Migration: 20261031000001_plan_drafts
-- =========================================================================
--
-- TASKS.md P2-6: the pre-serve plan lived only in localStorage, so a plan
-- built on one device never appeared on another until it was served — even
-- though the sign-in screen promises "sync your meal plan safely."
--
-- North Star criterion served: "She plans in the app" (and it is step one
-- toward "The plan doesn't stall on Matt" — the household spec will move
-- ownership of this table from a person to a household).
--
-- Design: one row per user holding the draft exactly as the client keeps
-- it (the same shape as the `brainstorm_plan` / `brainstorm_plan_dates`
-- localStorage keys). Deliberately a SEPARATE table, not an unserved row in
-- `meal_plans`: every reader of `meal_plans` (calendar, leftovers view,
-- period-overlap constraint, end-of-period review) assumes a row there is a
-- served plan. Drafts here touch none of them. The row is deleted when the
-- plan is served or reset.
--
-- Idempotent: IF NOT EXISTS + DROP POLICY IF EXISTS — safe to re-run.

CREATE TABLE IF NOT EXISTS plan_drafts (
  user_id        uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  selected_dates jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_drafts_plan_is_array           CHECK (jsonb_typeof(plan) = 'array'),
  CONSTRAINT plan_drafts_selected_dates_is_array CHECK (jsonb_typeof(selected_dates) = 'array')
);

ALTER TABLE plan_drafts ENABLE ROW LEVEL SECURITY;

-- Owner-scoped, per-operation, role `authenticated` — mirrors meals / vault /
-- meal_plan_items / household_preferences.
DROP POLICY IF EXISTS plan_drafts_select_own ON plan_drafts;
CREATE POLICY plan_drafts_select_own ON plan_drafts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS plan_drafts_insert_own ON plan_drafts;
CREATE POLICY plan_drafts_insert_own ON plan_drafts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS plan_drafts_update_own ON plan_drafts;
CREATE POLICY plan_drafts_update_own ON plan_drafts
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS plan_drafts_delete_own ON plan_drafts;
CREATE POLICY plan_drafts_delete_own ON plan_drafts
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
