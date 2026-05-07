-- Add served_feedback column to meal_plans
-- Captures user sentiment after committing a served plan.
-- Allowed values: 'positive', 'negative', or NULL (no feedback given).

ALTER TABLE public.meal_plans
  ADD COLUMN IF NOT EXISTS served_feedback text;

-- Idempotent CHECK constraint guard
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname   = 'meal_plans_served_feedback_check'
      AND  conrelid  = 'public.meal_plans'::regclass
  ) THEN
    ALTER TABLE public.meal_plans
      ADD CONSTRAINT meal_plans_served_feedback_check
        CHECK (served_feedback IN ('positive', 'negative'));
  END IF;
END
$$;
