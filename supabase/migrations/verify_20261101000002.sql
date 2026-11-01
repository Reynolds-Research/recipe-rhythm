-- verify_20261101000002 — PRD-008 phase 1, membership security rules (P0.2).
-- Read-only (the one CREATE is a throwaway helper in pg_temp, gone when the
-- session ends). Then ONE SELECT: every row is a check with expected / actual / pass.
--
-- The helper counts what a table shows when you are logged in as someone:
-- it switches to the app's role (authenticated, or anon), sets who you are
-- the way a real login does, counts, and switches back. So the checks below
-- run through the real security rules, not as the admin who bypasses them.
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
-- A logged-in account that belongs to no household (a made-up id).
outsider AS (SELECT '11111111-2222-4333-8444-555555555555'::uuid AS uid),
-- A real member: one from the household with the most recipes.
member AS (
  SELECT m.user_id AS uid, m.household_id AS hid
  FROM household_members m
  ORDER BY (SELECT count(*) FROM vault v WHERE v.household_id = m.household_id) DESC, m.user_id
  LIMIT 1
),
tables(t) AS (VALUES ('vault'),('vault_options'),('meals'),('meal_plans'),('meal_plan_items'),
                     ('grocery_lists'),('household_preferences'),('plan_drafts')),
checks(ord, check_name, expected, actual) AS (
  -- 1. The rules in place
  SELECT 10 + row_number() OVER (ORDER BY t), t || ': 4 membership rules / 0 owner-only rules', '4 / 0',
         (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = tables.t
            AND (coalesce(p.qual,'') || coalesce(p.with_check,'')) LIKE '%is_household_member(household_id)%')::text || ' / ' ||
         (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = tables.t
            AND (coalesce(p.qual,'') || coalesce(p.with_check,'')) NOT LIKE '%is_household_member%'
            AND p.policyname NOT LIKE '%public_share')::text
  FROM tables
  UNION ALL SELECT 19, 'grocery_list_items: 4 rules via the list''s household / 0 owner-only', '4 / 0',
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'grocery_list_items'
            AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%is_household_member(l.household_id)%')::text || ' / ' ||
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'grocery_list_items'
            AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%auth.uid()%')::text
  UNION ALL SELECT 20, 'share-link rules for logged-out visitors unchanged (lists, items)', '2',
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'grocery_list%public_share')::text
  UNION ALL SELECT 21, 'current_leftovers uses the caller''s rights / anon can read it', 'true / false',
         (SELECT coalesce(reloptions @> ARRAY['security_invoker=true'], false)::text FROM pg_class
            WHERE oid = 'public.current_leftovers'::regclass)
         || ' / ' || has_table_privilege('anon', 'public.current_leftovers', 'select')::text

  -- 2. A logged-in outsider (no household) sees nothing
  UNION ALL SELECT 30 + row_number() OVER (ORDER BY t), 'outsider sees 0 rows: ' || t, '0',
         pg_temp.rr_visible('authenticated', (SELECT uid FROM outsider), t)::text FROM tables
  UNION ALL SELECT 39, 'outsider sees 0 rows: grocery_list_items, households, household_members, current_leftovers', '0 0 0 0',
         pg_temp.rr_visible('authenticated', (SELECT uid FROM outsider), 'grocery_list_items')::text || ' ' ||
         pg_temp.rr_visible('authenticated', (SELECT uid FROM outsider), 'households')::text || ' ' ||
         pg_temp.rr_visible('authenticated', (SELECT uid FROM outsider), 'household_members')::text || ' ' ||
         pg_temp.rr_visible('authenticated', (SELECT uid FROM outsider), 'current_leftovers')::text

  -- 3. Logged out (the public anon key) sees only share-linked lists
  UNION ALL SELECT 40 + row_number() OVER (ORDER BY t), 'logged out sees 0 rows: ' || t, '0',
         pg_temp.rr_visible('anon', NULL, t)::text FROM tables WHERE t <> 'grocery_lists'
  UNION ALL SELECT 49, 'logged out sees only share-linked grocery lists',
         (SELECT count(*) FROM grocery_lists WHERE share_token IS NOT NULL)::text,
         pg_temp.rr_visible('anon', NULL, 'grocery_lists')::text

  -- 4. A member sees all of their household's rows and none of anyone else's
  UNION ALL SELECT 50 + row_number() OVER (ORDER BY t),
         'member sees own household (all) / other households (none): ' || t,
         CASE t
           WHEN 'vault'                 THEN (SELECT count(*) FROM vault                 WHERE household_id = (SELECT hid FROM member))
           WHEN 'vault_options'         THEN (SELECT count(*) FROM vault_options         WHERE household_id = (SELECT hid FROM member))
           WHEN 'meals'                 THEN (SELECT count(*) FROM meals                 WHERE household_id = (SELECT hid FROM member))
           WHEN 'meal_plans'            THEN (SELECT count(*) FROM meal_plans            WHERE household_id = (SELECT hid FROM member))
           WHEN 'meal_plan_items'       THEN (SELECT count(*) FROM meal_plan_items       WHERE household_id = (SELECT hid FROM member))
           WHEN 'grocery_lists'         THEN (SELECT count(*) FROM grocery_lists         WHERE household_id = (SELECT hid FROM member))
           WHEN 'household_preferences' THEN (SELECT count(*) FROM household_preferences WHERE household_id = (SELECT hid FROM member))
           WHEN 'plan_drafts'           THEN (SELECT count(*) FROM plan_drafts           WHERE household_id = (SELECT hid FROM member))
         END::text || ' / 0',
         pg_temp.rr_visible('authenticated', (SELECT uid FROM member), t,
                            format('household_id = %L', (SELECT hid FROM member)))::text || ' / ' ||
         pg_temp.rr_visible('authenticated', (SELECT uid FROM member), t,
                            format('household_id <> %L', (SELECT hid FROM member)))::text
  FROM tables
  UNION ALL SELECT 59, 'member sees only own household''s grocery list items (others)', '0',
         pg_temp.rr_visible('authenticated', (SELECT uid FROM member), 'grocery_list_items',
           format('list_id NOT IN (SELECT id FROM public.grocery_lists WHERE household_id = %L)', (SELECT hid FROM member)))::text
)
SELECT check_name, expected, actual, (expected = actual) AS pass
FROM checks ORDER BY ord;
