-- =========================================================================
-- Fingerprint of the whole public schema + every kitchen row. Read-only.
-- Run before a migration and after its rollback: the two rows must match
-- (D9 "verify the old state"). Covers every table, column, constraint, index,
-- security rule, function body, trigger, view and grant in `public`, plus a
-- hash of the rows of the tables that existed before PRD-008 phase 2.
-- =========================================================================
WITH s AS (
  SELECT 'tbl ' || c.relname || ' ' || c.relkind::text || ' rls=' || c.relrowsecurity AS x
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','v','m','p')
  UNION ALL SELECT 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
    FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL SELECT 'con ' || conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace
  UNION ALL SELECT 'idx ' || indexname || ' ' || indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL SELECT 'pol ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || array_to_string(roles, ',') || ' '
                   || coalesce(qual, '') || ' | ' || coalesce(with_check, '')
    FROM pg_policies WHERE schemaname = 'public'
  UNION ALL SELECT 'fn ' || p.proname || ' ' || md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(array_to_string(p.proacl, ','), '')
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
  UNION ALL SELECT 'trg ' || tgrelid::regclass || ' ' || tgname || ' ' || md5(pg_get_triggerdef(oid))
    FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)
  UNION ALL SELECT 'view ' || viewname || ' ' || md5(definition) FROM pg_views WHERE schemaname = 'public'
  UNION ALL SELECT 'acl ' || table_name || ' ' || grantee || ' ' || privilege_type
    FROM information_schema.role_table_grants WHERE table_schema = 'public'
), d AS (
  SELECT 'vault ' || md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) AS x FROM public.vault t
  UNION ALL SELECT 'meals ' || md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.meals t
  UNION ALL SELECT 'meal_plans ' || md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.meal_plans t
  UNION ALL SELECT 'meal_plan_items ' || md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.meal_plan_items t
  UNION ALL SELECT 'grocery_lists ' || md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.grocery_lists t
  UNION ALL SELECT 'grocery_list_items ' || md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.grocery_list_items t
  UNION ALL SELECT 'households ' || md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.households t
  UNION ALL SELECT 'household_members ' || md5(coalesce(string_agg(t::text, '|' ORDER BY t.user_id), '')) FROM public.household_members t
  UNION ALL SELECT 'plan_drafts ' || md5(coalesce(string_agg(t::text, '|' ORDER BY t.user_id), '')) FROM public.plan_drafts t
)
SELECT md5(string_agg(x, E'\n' ORDER BY x)) AS schema_fp, count(*) AS schema_n,
       (SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM d) AS data_fp
FROM s;
