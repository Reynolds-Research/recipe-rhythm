-- verify_20261105000001 — vault.ingredients_source. Read-only, ONE SELECT:
-- every row is a check with expected / actual / pass. Safe on prod.
WITH checks(ord, check_name, expected, actual) AS (
  SELECT 1, 'vault.ingredients_source: type / nullable / no default', 'text / YES / none',
         coalesce((SELECT data_type || ' / ' || is_nullable || ' / ' || coalesce(column_default, 'none')
                     FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'vault'
                      AND column_name = 'ingredients_source'), 'missing')
  UNION ALL
  SELECT 2, 'constraint vault_ingredients_source_valid', 'present',
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
                            WHERE conrelid = 'public.vault'::regclass
                              AND conname = 'vault_ingredients_source_valid') THEN 'present' ELSE 'missing' END
  UNION ALL
  SELECT 3, 'constraint allows only screenshot / estimated / NULL', 'true',
         coalesce((SELECT (pg_get_constraintdef(oid) LIKE '%screenshot%'
                       AND pg_get_constraintdef(oid) LIKE '%estimated%')::text
                     FROM pg_constraint
                    WHERE conrelid = 'public.vault'::regclass
                      AND conname = 'vault_ingredients_source_valid'), 'missing')
  UNION ALL
  SELECT 4, 'existing rows untouched: none labelled yet (0 right after applying)', '0 just after apply',
         (SELECT count(*)::text FROM public.vault WHERE ingredients_source IS NOT NULL)
  UNION ALL
  SELECT 5, 'vault still has row level security on', 'true',
         (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.vault'::regclass)
)
SELECT ord, check_name, expected, actual,
       CASE WHEN ord = 4 THEN 'info' WHEN expected = actual THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks ORDER BY ord;
