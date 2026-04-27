-- PRD-002 P0.4: Prep-time field on vault
--
-- See: docs/prds/PRD-002-meal-planning.md §6 P0.4 + §7 Migration B
--
-- Adds vault.prep_time_minutes: estimated minutes of active prep + cook time
-- for a recipe. Nullable (NULL = unknown / unrated). CHECK enforces
-- positive integers. Existing rows default to NULL; the analyzeRecipe AI
-- prompt is extended in the same PR to estimate prep time when it can,
-- so newly-added recipes will populate this automatically.
--
-- Used by PRD-002 (Meal Planning) for two things:
--   1. Display in the recommendation list (badge), so the Planner can
--      see "20 min" at a glance.
--   2. A prep-time penalty in the scoring engine — only applied when
--      the (forthcoming, Phase 3) household_preferences row sets a
--      max_prep_time_minutes cap. Phase 2 ships the column + the
--      always-on family_rating boost; the prep-time penalty becomes
--      effective once Phase 3 lands.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS guards the column; the CHECK is
-- inline so the IF NOT EXISTS guards both. Re-running this migration is
-- a no-op.

-- =========================================================================
-- 1. vault.prep_time_minutes column
-- =========================================================================

ALTER TABLE vault
  ADD COLUMN IF NOT EXISTS prep_time_minutes int
    CHECK (prep_time_minutes IS NULL OR prep_time_minutes > 0);

COMMENT ON COLUMN vault.prep_time_minutes IS
  'PRD-002 P0.4: estimated minutes of active prep + cook time. NULL = unknown. Drives the prep-time badge in BrainstormMode and (paired with household_preferences in Phase 3) the prep-time scoring penalty in src/lib/recommendations.js.';
