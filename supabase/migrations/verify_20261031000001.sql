-- =========================================================================
-- Verify: 20261031000001_plan_drafts
-- =========================================================================
-- Read-only checks. Run after applying the migration. Every row should say PASS.

-- 1. Table exists with the four expected columns.
SELECT
  CASE WHEN COUNT(*) = 4
    THEN 'PASS — plan_drafts has user_id, plan, selected_dates, updated_at'
    ELSE 'FAIL — expected 4 columns, found ' || COUNT(*)::text
  END AS check_1_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'plan_drafts'
  AND column_name IN ('user_id', 'plan', 'selected_dates', 'updated_at');

-- 2. RLS is enabled.
SELECT
  CASE WHEN relrowsecurity
    THEN 'PASS — RLS enabled on plan_drafts'
    ELSE 'FAIL — RLS is OFF on plan_drafts'
  END AS check_2_rls
FROM pg_class
WHERE oid = 'public.plan_drafts'::regclass;

-- 3. Exactly the four owner-scoped policies, all for role authenticated.
SELECT
  CASE WHEN COUNT(*) = 4
         AND bool_and(roles = '{authenticated}')
         AND bool_and(coalesce(qual, '') || coalesce(with_check, '') ILIKE '%auth.uid() = user_id%')
    THEN 'PASS — 4 owner-scoped policies (select/insert/update/delete) for authenticated'
    ELSE 'FAIL — policies are missing or not owner-scoped (found ' || COUNT(*)::text || ')'
  END AS check_3_policies
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'plan_drafts';

-- 4. user_id is the primary key (one draft per user).
SELECT
  CASE WHEN COUNT(*) = 1
    THEN 'PASS — user_id is the primary key'
    ELSE 'FAIL — user_id is not the primary key'
  END AS check_4_pk
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
WHERE tc.table_schema = 'public'
  AND tc.table_name = 'plan_drafts'
  AND tc.constraint_type = 'PRIMARY KEY'
  AND kcu.column_name = 'user_id';
