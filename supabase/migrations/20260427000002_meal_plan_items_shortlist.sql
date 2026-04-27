-- PRD-002 P0.6: "Maybe" / shortlist state on meal_plan_items
--
-- See: docs/prds/PRD-002-meal-planning.md §6 P0.6 + §7 Migration C
--
-- Adds an `is_shortlisted` flag to meal_plan_items and relaxes
-- `scheduled_date` so a row can represent either:
--   (a) a meal scheduled to a specific calendar date (the existing shape), or
--   (b) a "Maybe" / shortlist entry the user is considering for the period
--       but hasn't committed to a day yet.
--
-- A biconditional CHECK enforces the invariant that the two states are
-- mutually exclusive AND exhaustive: every row is exactly one of the two,
-- never both, never neither. (scheduled_date IS NULL) = is_shortlisted.
--
-- Truth table (X = ok, ! = rejected):
--   scheduled_date NOT NULL, is_shortlisted = FALSE   → X (scheduled — existing rows)
--   scheduled_date IS NULL,  is_shortlisted = TRUE    → X (shortlisted — new state)
--   scheduled_date NOT NULL, is_shortlisted = TRUE    → ! (would be both)
--   scheduled_date IS NULL,  is_shortlisted = FALSE   → ! (would be neither)
--
-- RLS: meal_plan_items already has owner-scoped policies on `user_id`
-- (see 20260418000001_planning_periods_schema.sql §6). Those policies cover
-- every column on the row including the new `is_shortlisted` flag — no
-- policy changes are required.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DO-block guard on the constraint,
-- CREATE INDEX IF NOT EXISTS. Safe to re-run.
--
-- Reversibility (manual rollback, if ever needed):
--   ALTER TABLE meal_plan_items DROP CONSTRAINT meal_plan_items_scheduled_xor_shortlisted;
--   ALTER TABLE meal_plan_items DROP COLUMN is_shortlisted;
--   -- Then, only if no shortlisted rows exist:
--   ALTER TABLE meal_plan_items ALTER COLUMN scheduled_date SET NOT NULL;

-- =========================================================================
-- 1. Relax NOT NULL on scheduled_date
-- =========================================================================
-- DROP NOT NULL is idempotent: re-running it on an already-nullable column
-- is a no-op (Postgres simply leaves the column as-is).

ALTER TABLE meal_plan_items
  ALTER COLUMN scheduled_date DROP NOT NULL;


-- =========================================================================
-- 2. Add is_shortlisted column with FALSE default
-- =========================================================================
-- All existing rows have a non-NULL scheduled_date, so the FALSE default
-- keeps every existing row valid under the CHECK below
-- ((scheduled_date IS NULL) = is_shortlisted → (FALSE) = (FALSE)).

ALTER TABLE meal_plan_items
  ADD COLUMN IF NOT EXISTS is_shortlisted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN meal_plan_items.is_shortlisted IS
  'PRD-002 P0.6: TRUE when the row is a "Maybe" / shortlist entry (no scheduled_date), FALSE when the row is scheduled to a specific calendar date. The two states are mutually exclusive and exhaustive — see CHECK meal_plan_items_scheduled_xor_shortlisted.';


-- =========================================================================
-- 3. Biconditional CHECK constraint
-- =========================================================================
-- (scheduled_date IS NULL) = is_shortlisted
-- Wrap in a DO block so the migration is safe to re-run after the constraint
-- already exists (ADD CONSTRAINT itself isn't IF NOT EXISTS-able).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meal_plan_items_scheduled_xor_shortlisted'
      AND conrelid = 'meal_plan_items'::regclass
  ) THEN
    ALTER TABLE meal_plan_items
      ADD CONSTRAINT meal_plan_items_scheduled_xor_shortlisted
      CHECK ((scheduled_date IS NULL) = is_shortlisted);
  END IF;
END $$;


-- =========================================================================
-- 4. Partial index for the Maybe-tray query
-- =========================================================================
-- Supports the "fetch shortlisted items for this user/plan" query path that
-- the Brainstorm "Maybe" tab issues on every load. Partial so it only indexes
-- the small subset of shortlisted rows, not the bulk of scheduled ones.

CREATE INDEX IF NOT EXISTS meal_plan_items_user_shortlist_idx
  ON meal_plan_items (user_id, meal_plan_id)
  WHERE is_shortlisted = true;
