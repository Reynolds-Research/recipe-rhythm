-- verify_20261102000002 — PRD-008 phase 2b-1, which days a week shows (D8).
-- Read-only (the one CREATE is a throwaway helper in pg_temp, gone when the
-- session ends). Then ONE SELECT: every row is a check with expected / actual / pass.
-- Safe on prod. The write checks (who can save a week, what the rules reject)
-- are in supabase/rehearsal/05_week_days_checks.sql (preview only).
--
-- The helper counts what a table shows when you are logged in as someone
-- (same helper as verify_20261102000001): the checks run through the real
-- security rules, not as the admin who bypasses them.
CREATE OR REPLACE FUNCTION pg_temp.rr_visible(p_role text, p_uid uuid, p_table text, p_where text DEFAULT 'true')
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN json_build_object('role', p_role)::text
         ELSE json_build_object('sub', p_uid, 'role', p_role)::text END, false);
  EXECUTE format('SET ROLE %I', p_role);
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', p_table, p_where) INTO n;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', false);
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', false);
  RAISE;
END $$;

WITH
outsider AS (SELECT '11111111-2222-4333-8444-555555555555'::uuid AS uid),
member AS (
  SELECT m.user_id AS uid, m.household_id AS hid
  FROM household_members m
  ORDER BY (SELECT count(*) FROM week_days w WHERE w.household_id = m.household_id) DESC, m.user_id
  LIMIT 1
),
checks(ord, check_name, expected, actual) AS (
  -- 1. Usual days on household preferences
  SELECT 10, 'household_preferences.usual_days: type / not null / default', 'smallint[] / NO / ''{0,1,2,3,4}''::smallint[]',
         coalesce((SELECT format_type(a.atttypid, a.atttypmod) || ' / ' ||
                          CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END || ' / ' ||
                          pg_get_expr(d.adbin, d.adrelid)
                     FROM pg_attribute a
                     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                    WHERE a.attrelid = 'public.household_preferences'::regclass
                      AND a.attname = 'usual_days' AND NOT a.attisdropped), 'missing')
  UNION ALL SELECT 11, 'usual_days rule in place', '1',
         (SELECT count(*) FROM pg_constraint WHERE conname = 'household_preferences_usual_days_valid'
            AND conrelid = 'public.household_preferences'::regclass)::text
  UNION ALL SELECT 12, 'preferences rows with invalid usual days', '0',
         (SELECT count(*) FROM household_preferences WHERE NOT public.rr_valid_week_days(usual_days, 1))::text

  -- 2. The days rule itself (pure function, no data)
  UNION ALL SELECT 20, 'days rule: Sun–Thu ok / all 7 ok / empty ok for a week / empty not ok as usual',
         'true / true / true / false',
         public.rr_valid_week_days('{0,1,2,3,4}', 1)::text || ' / ' ||
         public.rr_valid_week_days('{6,5,4,3,2,1,0}', 1)::text || ' / ' ||
         public.rr_valid_week_days('{}', 0)::text || ' / ' ||
         public.rr_valid_week_days('{}', 1)::text
  UNION ALL SELECT 21, 'days rule rejects: 7 / -1 / repeat / null entry / null list',
         'false / false / false / false / false',
         public.rr_valid_week_days('{7}', 0)::text || ' / ' ||
         public.rr_valid_week_days('{-1}', 0)::text || ' / ' ||
         public.rr_valid_week_days('{1,1}', 0)::text || ' / ' ||
         public.rr_valid_week_days('{1,NULL}', 0)::text || ' / ' ||
         coalesce(public.rr_valid_week_days(NULL, 0), false)::text
  UNION ALL SELECT 22, 'days rule can''t be fooled by a 2-D list', 'false',
         public.rr_valid_week_days('{{0,1},{2,3}}', 0)::text

  -- 3. week_days structure and rules
  UNION ALL SELECT 30, 'week_days: exists / security on / 4 membership rules / other rules', 'true / true / 4 / 0',
         (to_regclass('public.week_days') IS NOT NULL)::text || ' / ' ||
         coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.week_days')), false)::text || ' / ' ||
         (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'week_days'
            AND (coalesce(p.qual,'') || coalesce(p.with_check,'')) LIKE '%is_household_member(household_id)%')::text || ' / ' ||
         (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'week_days'
            AND (coalesce(p.qual,'') || coalesce(p.with_check,'')) NOT LIKE '%is_household_member%')::text
  UNION ALL SELECT 31, 'insert rule also checks who added it', '1',
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'week_days'
            AND cmd = 'INSERT' AND with_check LIKE '%auth.uid()%')::text
  UNION ALL SELECT 32, 'week_days: one row per household + week (primary key)', 'household_id, week_start',
         coalesce((SELECT string_agg(a.attname, ', ' ORDER BY k.ord)
                     FROM pg_index i
                     CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
                     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                    WHERE i.indrelid = to_regclass('public.week_days') AND i.indisprimary), 'none')
  UNION ALL SELECT 33, 'week_days rules: starts on Sunday / valid days', '2',
         (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('public.week_days')
            AND conname IN ('week_days_starts_sunday', 'week_days_days_valid'))::text
  UNION ALL SELECT 34, 'week_days updated_at trigger in place', '1',
         (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'week_days_set_updated_at'
            AND tgrelid = to_regclass('public.week_days'))::text
  UNION ALL SELECT 35, 'logged-out key has no access (select / insert)', 'false / false',
         has_table_privilege('anon', 'public.week_days', 'select')::text || ' / ' ||
         has_table_privilege('anon', 'public.week_days', 'insert')::text
  UNION ALL SELECT 36, 'existing rows: not on a Sunday / invalid days', '0 / 0',
         (SELECT count(*) FROM week_days WHERE extract(dow FROM week_start) <> 0)::text || ' / ' ||
         (SELECT count(*) FROM week_days WHERE NOT public.rr_valid_week_days(days, 0))::text

  -- 4. Who can see what
  UNION ALL SELECT 40, 'outsider sees 0 rows: week_days', '0',
         pg_temp.rr_visible('authenticated', (SELECT uid FROM outsider), 'week_days')::text
  UNION ALL SELECT 41, 'member sees own household (all) / other households (none): week_days',
         (SELECT count(*) FROM week_days WHERE household_id = (SELECT hid FROM member))::text || ' / 0',
         pg_temp.rr_visible('authenticated', (SELECT uid FROM member), 'week_days',
                            format('household_id = %L', (SELECT hid FROM member)))::text || ' / ' ||
         pg_temp.rr_visible('authenticated', (SELECT uid FROM member), 'week_days',
                            format('household_id <> %L', (SELECT hid FROM member)))::text
)
SELECT check_name, expected, actual, (expected = actual) AS pass
FROM checks ORDER BY ord;
