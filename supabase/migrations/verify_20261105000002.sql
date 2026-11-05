-- verify_20261105000002 — grocery_list_items.recipe_quantity + assumed.
-- Read-only, ONE SELECT: every row is a check with expected / actual / pass. Safe on prod.
WITH checks(ord, check_name, expected, actual) AS (
  SELECT 1, 'recipe_quantity: type / nullable / no default', 'text / YES / none',
         coalesce((SELECT data_type || ' / ' || is_nullable || ' / ' || coalesce(column_default, 'none')
                     FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'grocery_list_items'
                      AND column_name = 'recipe_quantity'), 'missing')
  UNION ALL
  SELECT 2, 'assumed: type / nullable / default', 'boolean / NO / false',
         coalesce((SELECT data_type || ' / ' || is_nullable || ' / ' || coalesce(column_default, 'none')
                     FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'grocery_list_items'
                      AND column_name = 'assumed'), 'missing')
  UNION ALL
  SELECT 3, 'existing rows untouched: none assumed (0 right after applying)', '0 just after apply',
         (SELECT count(*)::text FROM public.grocery_list_items WHERE assumed)
  UNION ALL
  SELECT 4, 'grocery_list_items still has row level security on', 'true',
         (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.grocery_list_items'::regclass)
  UNION ALL
  SELECT 5, 'grocery_list_items policies unchanged (count)', '5',
         (SELECT count(*)::text FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'grocery_list_items')
)
SELECT ord, check_name, expected, actual,
       CASE WHEN ord = 3 THEN 'info' WHEN expected = actual THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks ORDER BY ord;
