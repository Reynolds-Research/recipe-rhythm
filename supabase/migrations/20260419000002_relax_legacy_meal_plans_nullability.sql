-- Hotfix: make deprecated meal_plans columns nullable so the new write path works.
--
-- ADR-001 Phase 1 added period_start / period_end / finalized_at. Phase 3 moved
-- handleServe off the deprecated columns (days, items, week_label). But those
-- columns were NOT NULL with no default — so any INSERT through the new
-- createServedPlan helper fails with a 400 / NOT NULL constraint violation.
--
-- The clean fix would be Phase 7 (dropping the columns entirely), but that has
-- a stability-window prerequisite we haven't met yet. Making the columns
-- nullable is the minimal change that unblocks Phase 8 without altering the
-- existing historical data (rows that already had days/items populated keep
-- their values; only new rows get NULLs there).
--
-- week_label was already nullable; included for clarity.
--
-- Idempotent via IF EXISTS pattern.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meal_plans'
      AND column_name = 'days' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE meal_plans ALTER COLUMN days DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meal_plans'
      AND column_name = 'items' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE meal_plans ALTER COLUMN items DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meal_plans'
      AND column_name = 'week_label' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE meal_plans ALTER COLUMN week_label DROP NOT NULL;
  END IF;
END $$;

-- Verification (read-only): confirm all three columns are now nullable.
-- Expected: three rows with is_nullable = 'YES'.
--
--   SELECT column_name, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'meal_plans'
--     AND column_name IN ('days', 'items', 'week_label')
--   ORDER BY column_name;
