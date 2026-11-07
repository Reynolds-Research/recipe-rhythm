-- verify_20261107000001 — vault.ingredients_source accepts 'page'. Read-only,
-- ONE SELECT: every row is a check with expected / actual / result. Safe on prod.
WITH def AS (
  SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
   WHERE conrelid = 'public.vault'::regclass AND conname = 'vault_ingredients_source_valid'
),
checks(ord, check_name, expected, actual) AS (
  SELECT 1, 'constraint vault_ingredients_source_valid', 'present',
         CASE WHEN EXISTS (SELECT 1 FROM def) THEN 'present' ELSE 'missing' END
  UNION ALL
  SELECT 2, 'allows screenshot / page / estimated', 'true',
         coalesce((SELECT (d LIKE '%''screenshot''%' AND d LIKE '%''page''%' AND d LIKE '%''estimated''%')::text FROM def), 'missing')
  UNION ALL
  SELECT 3, 'still refuses anything else (e.g. ''guess'')', 'true',
         coalesce((SELECT (d NOT LIKE '%''guess''%' AND d LIKE '%IS NULL%')::text FROM def), 'missing')
  UNION ALL
  SELECT 4, 'every saved value is allowed', '0',
         (SELECT count(*)::text FROM public.vault
           WHERE ingredients_source IS NOT NULL AND ingredients_source NOT IN ('screenshot', 'page', 'estimated'))
  UNION ALL
  SELECT 5, 'recipes read from their page (0 right after applying)', 'info',
         (SELECT count(*)::text FROM public.vault WHERE ingredients_source = 'page')
  UNION ALL
  SELECT 6, 'vault still has row level security on', 'true',
         (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.vault'::regclass)
)
SELECT ord, check_name, expected, actual,
       CASE WHEN expected = 'info' THEN 'info' WHEN expected = actual THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks ORDER BY ord;
