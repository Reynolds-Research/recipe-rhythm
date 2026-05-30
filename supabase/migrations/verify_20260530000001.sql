-- Verify migration 20260530000001_api_rate_limits.sql
-- Run this after applying the migration to confirm it applied correctly.
-- All queries are read-only and idempotent.

-- 1. Table exists with correct columns.
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'api_rate_limits'
ORDER BY ordinal_position;
-- Expected columns: user_id (uuid, NO), endpoint (text, NO),
--   window_start (timestamptz, NO), count (integer, NO)

-- 2. RLS is enabled.
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'api_rate_limits';
-- Expected: relrowsecurity = true

-- 3. No anon or authenticated policies exist (should return 0 rows).
SELECT policyname, roles
FROM pg_policies
WHERE tablename = 'api_rate_limits'
  AND (roles @> ARRAY['anon'::name] OR roles @> ARRAY['authenticated'::name]);
-- Expected: 0 rows

-- 4. Window index exists.
SELECT indexname
FROM pg_indexes
WHERE tablename = 'api_rate_limits'
  AND indexname  = 'api_rate_limits_window_idx';
-- Expected: 1 row

-- 5. RPC function exists with correct signature.
SELECT proname, prokind
FROM pg_proc
WHERE proname = 'increment_api_rate_limit';
-- Expected: 1 row, prokind = 'f'
