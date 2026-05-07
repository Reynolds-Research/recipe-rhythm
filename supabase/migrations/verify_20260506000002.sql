-- Verify: served_feedback column exists with correct type
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'meal_plans'
  AND  column_name  = 'served_feedback';
-- Expected: 1 row — served_feedback | text | YES

-- Verify: CHECK constraint is present
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM   pg_constraint
WHERE  conname   = 'meal_plans_served_feedback_check'
  AND  conrelid  = 'public.meal_plans'::regclass;
-- Expected: 1 row — meal_plans_served_feedback_check | CHECK (served_feedback = ANY ...)

-- Verify: column accepts allowed values and rejects others
DO $$
DECLARE
  v_id uuid;
BEGIN
  -- Insert a row with NULL feedback (should succeed)
  INSERT INTO public.meal_plans (user_id, period_start, period_end)
  VALUES ('00000000-0000-0000-0000-000000000001', '2026-01-01', '2026-01-07')
  RETURNING id INTO v_id;

  -- Update to 'positive' (should succeed)
  UPDATE public.meal_plans SET served_feedback = 'positive' WHERE id = v_id;

  -- Update to 'negative' (should succeed)
  UPDATE public.meal_plans SET served_feedback = 'negative' WHERE id = v_id;

  -- Attempt invalid value (should raise exception)
  BEGIN
    UPDATE public.meal_plans SET served_feedback = 'neutral' WHERE id = v_id;
    RAISE EXCEPTION 'CHECK constraint did not fire — migration FAILED';
  EXCEPTION WHEN check_violation THEN
    NULL; -- expected
  END;

  -- Clean up
  DELETE FROM public.meal_plans WHERE id = v_id;

  RAISE NOTICE 'verify_20260506000002: all checks passed';
END
$$;
