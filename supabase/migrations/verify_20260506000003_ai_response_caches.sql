-- verify_20260506000003 — the AI response caches (ADR-004).
-- Read-only. ONE SELECT: every row is a check with expected / actual / pass.
-- Safe on prod. (Rewritten 2026-11-07 as one SELECT, so the SQL Editor shows
-- every result at once; the migration had never been applied to prod.)
--
-- The security boundary these checks guard: anyone may READ the caches
-- (non-sensitive: "salt is essential"), but only the API server's
-- service-role key may WRITE, so nobody can poison them.
WITH checks(ord, check_name, expected, actual) AS (
  -- 1. ingredient_classifications_cache
  SELECT 10, 'classify cache: exists / security on', 'true / true',
         (to_regclass('public.ingredient_classifications_cache') IS NOT NULL)::text || ' / ' ||
         coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.ingredient_classifications_cache')), false)::text
  UNION ALL SELECT 11, 'classify cache columns', 'id, recipe_name_norm, ingredient_name_norm, essentiality, created_at',
         coalesce((SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'ingredient_classifications_cache'), 'missing')
  UNION ALL SELECT 12, 'classify cache rules: essentiality check / one answer per recipe + ingredient', '1 / 1',
         (SELECT count(*) FROM pg_constraint WHERE conname = 'ingredient_classifications_cache_essentiality_valid')::text || ' / ' ||
         (SELECT count(*) FROM pg_constraint WHERE conname = 'ingredient_classifications_cache_key_unique')::text
  UNION ALL SELECT 13, 'classify cache: one read rule (everyone), no write rules', '1 SELECT / 0 writes',
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ingredient_classifications_cache'
            AND cmd = 'SELECT' AND qual = 'true')::text || ' SELECT / ' ||
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ingredient_classifications_cache'
            AND cmd <> 'SELECT')::text || ' writes'

  -- 2. meal_name_normalizations_cache
  UNION ALL SELECT 20, 'normalize cache: exists / security on', 'true / true',
         (to_regclass('public.meal_name_normalizations_cache') IS NOT NULL)::text || ' / ' ||
         coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.meal_name_normalizations_cache')), false)::text
  UNION ALL SELECT 21, 'normalize cache columns', 'id, input_norm, corrected, created_at',
         coalesce((SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'meal_name_normalizations_cache'), 'missing')
  UNION ALL SELECT 22, 'normalize cache: one answer per input', '1',
         (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('public.meal_name_normalizations_cache') AND contype = 'u')::text
  UNION ALL SELECT 23, 'normalize cache: one read rule (everyone), no write rules', '1 SELECT / 0 writes',
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'meal_name_normalizations_cache'
            AND cmd = 'SELECT' AND qual = 'true')::text || ' SELECT / ' ||
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'meal_name_normalizations_cache'
            AND cmd <> 'SELECT')::text || ' writes'
)
SELECT check_name, expected, actual, (expected = actual) AS pass
FROM checks ORDER BY ord;
