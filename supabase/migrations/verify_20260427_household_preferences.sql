-- Verification queries for 20260427000003_household_preferences.sql
--
-- Run AFTER the main migration. Each section is read-only (no mutations).
-- Expected results are described inline so you can eyeball correctness.

-- =========================================================================
-- 1. household_preferences table exists with the right columns
-- =========================================================================
-- Expected: seven rows in column order — user_id, dietary_restrictions,
-- excluded_ingredients, excluded_cuisines, max_prep_time_minutes,
-- created_at, updated_at.

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'household_preferences'
ORDER BY ordinal_position;


-- =========================================================================
-- 2. Primary key is user_id alone
-- =========================================================================
-- Expected: one row, contype = 'p', conkey resolves to {user_id}.

SELECT
  con.conname,
  con.contype,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class      tbl ON tbl.oid = con.conrelid
WHERE tbl.relname = 'household_preferences'
  AND con.contype = 'p';


-- =========================================================================
-- 3. CHECK constraint on max_prep_time_minutes
-- =========================================================================
-- Expected: one row whose definition contains "max_prep_time_minutes IS
-- NULL OR max_prep_time_minutes > 0".

SELECT
  con.conname,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class      tbl ON tbl.oid = con.conrelid
WHERE tbl.relname = 'household_preferences'
  AND con.contype = 'c';


-- =========================================================================
-- 4. RLS is enabled
-- =========================================================================
-- Expected: relrowsecurity = true.

SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'household_preferences'
  AND relnamespace = 'public'::regnamespace;


-- =========================================================================
-- 5. Four owner-scoped policies present
-- =========================================================================
-- Expected: four rows — household_preferences_select_own,
-- household_preferences_insert_own, household_preferences_update_own,
-- household_preferences_delete_own. Each USING / WITH CHECK should read
-- "(auth.uid() = user_id)".

SELECT
  polname,
  polcmd,
  pg_get_expr(polqual,      polrelid) AS using_expr,
  pg_get_expr(polwithcheck, polrelid) AS with_check_expr
FROM pg_policy
WHERE polrelid = 'public.household_preferences'::regclass
ORDER BY polname;


-- =========================================================================
-- 6. updated_at trigger present
-- =========================================================================
-- Expected: one row — household_preferences_set_updated_at, BEFORE UPDATE.

SELECT
  tgname,
  pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'public.household_preferences'::regclass
  AND NOT tgisinternal;


-- =========================================================================
-- 7. updated_at trigger function exists
-- =========================================================================
-- Expected: one row — household_preferences_set_updated_at, plpgsql,
-- returns trigger.

SELECT
  proname,
  pg_get_function_result(oid) AS returns,
  prolang::regproc            AS lang
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname = 'household_preferences_set_updated_at';


-- =========================================================================
-- 8. Smoke: row count starts at zero
-- =========================================================================
-- Expected: 0 immediately after migration (no auto-create on signup).

SELECT COUNT(*) AS row_count FROM public.household_preferences;
