-- verify_20261108000001 — PRD-008 phase 3a, Matt's nights (P0.5).
-- Read-only (the one CREATE is a throwaway helper in pg_temp, gone when the
-- session ends). Then ONE SELECT: every row is a check with expected / actual / pass.
-- Safe on prod. The write checks (who can hand over a night, names) are in
-- supabase/rehearsal/07_cook_nights_checks.sql (preview only).
--
-- The helper counts what a table shows when you are logged in as someone
-- (same helper as verify_20261102000002): the checks run through the real
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
  ORDER BY (SELECT count(*) FROM household_members x WHERE x.household_id = m.household_id) DESC, m.user_id
  LIMIT 1
),
checks(ord, check_name, expected, actual) AS (
  -- 1. Display names
  SELECT 10, 'household_members.display_name: type / nullable', 'text / YES',
         coalesce((SELECT data_type || ' / ' || is_nullable FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'household_members'
                      AND column_name = 'display_name'), 'missing')
  UNION ALL SELECT 11, 'display name rule in place / names breaking it', '1 / 0',
         (SELECT count(*) FROM pg_constraint WHERE conname = 'household_members_display_name_valid'
            AND conrelid = 'public.household_members'::regclass)::text || ' / ' ||
         (SELECT count(*) FROM household_members
           WHERE display_name IS NOT NULL
             AND (display_name <> btrim(display_name) OR char_length(display_name) NOT BETWEEN 1 AND 30))::text
  UNION ALL SELECT 12, 'members still can''t write the membership table (insert / update / delete rules)', '0',
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'household_members'
            AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL'))::text
  UNION ALL SELECT 13, 'rr_set_my_display_name: signed-in may run it / logged-out key may not', 'true / false',
         has_function_privilege('authenticated', 'public.rr_set_my_display_name(text)', 'execute')::text || ' / ' ||
         has_function_privilege('anon', 'public.rr_set_my_display_name(text)', 'execute')::text

  -- 2. cook_nights structure and rules
  UNION ALL SELECT 20, 'cook_nights: exists / security on / 4 membership rules / other rules', 'true / true / 4 / 0',
         (to_regclass('public.cook_nights') IS NOT NULL)::text || ' / ' ||
         coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.cook_nights')), false)::text || ' / ' ||
         (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'cook_nights'
            AND (coalesce(p.qual,'') || coalesce(p.with_check,'')) LIKE '%is_household_member(household_id)%')::text || ' / ' ||
         (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'cook_nights'
            AND (coalesce(p.qual,'') || coalesce(p.with_check,'')) NOT LIKE '%is_household_member%')::text
  UNION ALL SELECT 21, 'insert rule also checks who handed it over', '1',
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cook_nights'
            AND cmd = 'INSERT' AND with_check LIKE '%auth.uid()%')::text
  UNION ALL SELECT 22, 'cook_nights: one row per household + date (primary key)', 'household_id, cooks_on',
         coalesce((SELECT string_agg(a.attname, ', ' ORDER BY k.ord)
                     FROM pg_index i
                     CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
                     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                    WHERE i.indrelid = to_regclass('public.cook_nights') AND i.indisprimary), 'none')
  UNION ALL SELECT 23, 'triggers: updated_at / reassigned restarts clock / cook is a member', '3',
         (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = to_regclass('public.cook_nights')
            AND tgname IN ('cook_nights_set_updated_at', 'cook_nights_reassigned', 'cook_nights_cook_is_member'))::text
  UNION ALL SELECT 24, 'logged-out key has no access (select / insert)', 'false / false',
         has_table_privilege('anon', 'public.cook_nights', 'select')::text || ' / ' ||
         has_table_privilege('anon', 'public.cook_nights', 'insert')::text
  UNION ALL SELECT 25, 'existing nights whose cook isn''t in the household', '0',
         (SELECT count(*) FROM cook_nights c
           WHERE NOT EXISTS (SELECT 1 FROM household_members m
                              WHERE m.household_id = c.household_id AND m.user_id = c.cook_id))::text

  -- 3. Who can see what
  UNION ALL SELECT 30, 'outsider sees 0 rows: cook_nights', '0',
         pg_temp.rr_visible('authenticated', (SELECT uid FROM outsider), 'cook_nights')::text
  UNION ALL SELECT 31, 'member sees own household (all) / other households (none): cook_nights',
         (SELECT count(*) FROM cook_nights WHERE household_id = (SELECT hid FROM member))::text || ' / 0',
         pg_temp.rr_visible('authenticated', (SELECT uid FROM member), 'cook_nights',
                            format('household_id = %L', (SELECT hid FROM member)))::text || ' / ' ||
         pg_temp.rr_visible('authenticated', (SELECT uid FROM member), 'cook_nights',
                            format('household_id <> %L', (SELECT hid FROM member)))::text
  UNION ALL SELECT 32, 'member sees the other member''s row (for their name) / outsider sees no members',
         (SELECT count(*) FROM household_members WHERE household_id = (SELECT hid FROM member))::text || ' / 0',
         pg_temp.rr_visible('authenticated', (SELECT uid FROM member), 'household_members',
                            format('household_id = %L', (SELECT hid FROM member)))::text || ' / ' ||
         pg_temp.rr_visible('authenticated', (SELECT uid FROM outsider), 'household_members')::text
)
SELECT check_name, expected, actual, (expected = actual) AS pass
FROM checks ORDER BY ord;
