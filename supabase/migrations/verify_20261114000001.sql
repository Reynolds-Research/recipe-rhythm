-- verify_20261114000001 — planned_meals.add_on and the week-changed stamp.
-- Read-only, ONE SELECT: every row is a check with expected / actual / result.
-- Safe on prod.
WITH col AS (
  SELECT data_type, is_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'planned_meals' AND column_name = 'add_on'
),
con AS (
  SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
   WHERE conrelid = 'public.planned_meals'::regclass AND conname = 'planned_meals_add_on_valid'
),
fn AS (
  SELECT prosrc FROM pg_proc WHERE oid = 'public.rr_mark_week_changed()'::regprocedure
),
checks(ord, check_name, expected, actual) AS (
  SELECT 1, 'column planned_meals.add_on is text, optional', 'text / YES',
         coalesce((SELECT data_type || ' / ' || is_nullable FROM col), 'missing')
  UNION ALL
  SELECT 2, 'rule planned_meals_add_on_valid (trimmed, 1–80 chars)', 'true',
         coalesce((SELECT (d LIKE '%btrim(add_on)%' AND d LIKE '%80%' AND d LIKE '%IS NULL%')::text FROM con), 'missing')
  UNION ALL
  SELECT 3, 'every saved add-on follows the rule', '0',
         (SELECT count(*)::text FROM public.planned_meals
           WHERE add_on IS NOT NULL AND (add_on <> btrim(add_on) OR char_length(add_on) NOT BETWEEN 1 AND 80))
  UNION ALL
  SELECT 4, 'week-changed stamp watches add_on', 'true',
         coalesce((SELECT (prosrc LIKE '%OLD.add_on%IS NOT DISTINCT FROM NEW.add_on%')::text FROM fn), 'missing')
  UNION ALL
  SELECT 5, 'week-changed stamp still watches date, name, recipe link', 'true',
         coalesce((SELECT (prosrc LIKE '%OLD.planned_on%' AND prosrc LIKE '%OLD.name%' AND prosrc LIKE '%OLD.vault_id%')::text FROM fn), 'missing')
  UNION ALL
  SELECT 6, 'trigger planned_meals_mark_week_changed still attached', 'true',
         (EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.planned_meals'::regclass
                   AND tgname = 'planned_meals_mark_week_changed' AND NOT tgisinternal))::text
  UNION ALL
  SELECT 7, 'logged-out users cannot run the stamp function', 'false',
         has_function_privilege('anon', 'public.rr_mark_week_changed()', 'EXECUTE')::text
  UNION ALL
  SELECT 8, 'planned_meals still has row level security on', 'true',
         (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.planned_meals'::regclass)
  UNION ALL
  SELECT 9, 'planned_meals still has its 4 household rules', '4',
         (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'planned_meals')
  UNION ALL
  SELECT 10, 'meals with an add-on (0 right after applying)', 'info',
         (SELECT count(*)::text FROM public.planned_meals WHERE add_on IS NOT NULL)
)
SELECT ord, check_name, expected, actual,
       CASE WHEN expected = 'info' THEN 'info' WHEN expected = actual THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks ORDER BY ord;
