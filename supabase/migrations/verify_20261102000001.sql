-- verify_20261102000001 — PRD-008 phase 2a, calendar data (P0.3).
-- Read-only (the one CREATE is a throwaway helper in pg_temp, gone when the
-- session ends). Then ONE SELECT: every row is a check with expected / actual / pass.
--
-- Run it after the migration, and again right after each
--   SELECT public.rr_copy_legacy_plans();
-- The copy checks (section 2) compare the new tables with the old ones. They
-- assume nobody has edited a copied meal on the new screens yet — true until
-- the switch-over (2c). After that, "kept_edited" meals are expected to differ.
--
-- The helper counts what a table shows when you are logged in as someone
-- (same helper as verify_20261101000002): the checks run through the real
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
-- A real member: one from the household with the most planned meals.
member AS (
  SELECT m.user_id AS uid, m.household_id AS hid
  FROM household_members m
  ORDER BY (SELECT count(*) FROM planned_meals p WHERE p.household_id = m.household_id) DESC, m.user_id
  LIMIT 1
),
tables(t) AS (VALUES ('planned_meals'), ('week_confirmations')),
-- The old plans as the copy should have turned them into new rows.
want_meals AS (
  SELECT i.id, i.household_id, i.scheduled_date AS planned_on, coalesce(i.position, 0) AS position,
         i.name, i.vault_id, coalesce(i.is_wildcard, false) AS is_wildcard, i.source_url,
         (coalesce(i.cooked, false) AND i.scheduled_date IS NOT NULL) AS cooked, i.user_id
  FROM meal_plan_items i
),
want_weeks AS (
  SELECT p.id, p.household_id, p.period_start, p.period_end, p.served_at, p.user_id,
         (SELECT g.id FROM grocery_lists g WHERE g.meal_plan_id = p.id ORDER BY g.created_at LIMIT 1) AS list_id
  FROM meal_plans p
  WHERE p.served_at IS NOT NULL AND p.period_start IS NOT NULL AND p.period_end IS NOT NULL
),
checks(ord, check_name, expected, actual) AS (
  -- 1. Structure and rules
  SELECT 10 + row_number() OVER (ORDER BY t), t || ': exists / security on / 4 membership rules / other rules', 'true / true / 4 / 0',
         (to_regclass('public.' || t) IS NOT NULL)::text || ' / ' ||
         coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t)), false)::text || ' / ' ||
         (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = tables.t
            AND (coalesce(p.qual,'') || coalesce(p.with_check,'')) LIKE '%is_household_member(household_id)%')::text || ' / ' ||
         (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = tables.t
            AND (coalesce(p.qual,'') || coalesce(p.with_check,'')) NOT LIKE '%is_household_member%')::text
  FROM tables
  UNION ALL SELECT 13, 'logged-out key has no access to the new tables (select on meals / weeks)', 'false / false',
         has_table_privilege('anon', 'public.planned_meals', 'select')::text || ' / ' ||
         has_table_privilege('anon', 'public.week_confirmations', 'select')::text
  UNION ALL SELECT 14, 'the copy can''t be run from the app (logged in / logged out)', 'false / false',
         has_function_privilege('authenticated', 'public.rr_copy_legacy_plans()', 'execute')::text || ' / ' ||
         has_function_privilege('anon', 'public.rr_copy_legacy_plans()', 'execute')::text
  UNION ALL SELECT 15, 'triggers in place: updated_at x2, changed-since-confirmed', '3',
         (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
           ('planned_meals_set_updated_at','week_confirmations_set_updated_at','planned_meals_mark_week_changed'))::text

  -- 2. Every old plan item exists as a dated meal (Maybe items: no date)
  UNION ALL SELECT 20, 'old plan items / copied meals', (SELECT count(*) FROM meal_plan_items)::text,
         (SELECT count(*) FROM planned_meals WHERE legacy_item_id IS NOT NULL)::text
  UNION ALL SELECT 21, 'old items with no copy', '0',
         (SELECT count(*) FROM meal_plan_items i WHERE NOT EXISTS
           (SELECT 1 FROM planned_meals p WHERE p.legacy_item_id = i.id))::text
  UNION ALL SELECT 22, 'copies whose old item is gone', '0',
         (SELECT count(*) FROM planned_meals p WHERE p.legacy_item_id IS NOT NULL AND NOT EXISTS
           (SELECT 1 FROM meal_plan_items i WHERE i.id = p.legacy_item_id))::text
  UNION ALL SELECT 23, 'copies that differ from their old item (household, date, name, recipe, cooked, who)', '0',
         (SELECT count(*) FROM want_meals w JOIN planned_meals p ON p.legacy_item_id = w.id
           WHERE (p.household_id, p.planned_on, p.position, p.name, p.vault_id, p.is_wildcard, p.source_url, p.cooked, p.user_id)
                 IS DISTINCT FROM
                 (w.household_id, w.planned_on, w.position, w.name, w.vault_id, w.is_wildcard, w.source_url, w.cooked, w.user_id))::text
  UNION ALL SELECT 24, 'Maybe items copied with no date / scheduled items copied with their date',
         (SELECT count(*) FROM meal_plan_items WHERE is_shortlisted)::text || ' / ' ||
         (SELECT count(*) FROM meal_plan_items WHERE NOT is_shortlisted)::text,
         (SELECT count(*) FROM planned_meals p JOIN meal_plan_items i ON i.id = p.legacy_item_id
           WHERE i.is_shortlisted AND p.planned_on IS NULL)::text || ' / ' ||
         (SELECT count(*) FROM planned_meals p JOIN meal_plan_items i ON i.id = p.legacy_item_id
           WHERE NOT i.is_shortlisted AND p.planned_on = i.scheduled_date)::text
  UNION ALL SELECT 25, 'cooked meals copied (old cooked, scheduled)',
         (SELECT count(*) FROM meal_plan_items WHERE cooked AND scheduled_date IS NOT NULL)::text,
         (SELECT count(*) FROM planned_meals WHERE legacy_item_id IS NOT NULL AND cooked)::text

  -- 3. Old served periods became confirmations, with their grocery list
  UNION ALL SELECT 30, 'served old plans / copied confirmations', (SELECT count(*) FROM want_weeks)::text,
         (SELECT count(*) FROM week_confirmations WHERE legacy_plan_id IS NOT NULL)::text
  UNION ALL SELECT 31, 'confirmations that differ from their old plan (household, range, who, when, grocery list)', '0',
         (SELECT count(*) FROM want_weeks w JOIN week_confirmations c ON c.legacy_plan_id = w.id
           WHERE (c.household_id, c.starts_on, c.ends_on, c.user_id, c.confirmed_at, c.grocery_list_id)
                 IS DISTINCT FROM (w.household_id, w.period_start, w.period_end, w.user_id, w.served_at, w.list_id))::text
  UNION ALL SELECT 32, 'old grocery lists tied to a plan / linked to a confirmation',
         (SELECT count(DISTINCT w.list_id) FROM want_weeks w WHERE w.list_id IS NOT NULL)::text,
         (SELECT count(*) FROM week_confirmations WHERE legacy_plan_id IS NOT NULL AND grocery_list_id IS NOT NULL)::text
  UNION ALL SELECT 33, 'copied confirmations marked "changed" by the copy itself', '0',
         (SELECT count(*) FROM week_confirmations WHERE legacy_plan_id IS NOT NULL AND changed_at IS NOT NULL)::text

  -- 4. Who can see what
  UNION ALL SELECT 40 + row_number() OVER (ORDER BY t), 'outsider sees 0 rows: ' || t, '0',
         pg_temp.rr_visible('authenticated', (SELECT uid FROM outsider), t)::text FROM tables
  UNION ALL SELECT 50 + row_number() OVER (ORDER BY t),
         'member sees own household (all) / other households (none): ' || t,
         CASE t
           WHEN 'planned_meals'      THEN (SELECT count(*) FROM planned_meals      WHERE household_id = (SELECT hid FROM member))
           WHEN 'week_confirmations' THEN (SELECT count(*) FROM week_confirmations WHERE household_id = (SELECT hid FROM member))
         END::text || ' / 0',
         pg_temp.rr_visible('authenticated', (SELECT uid FROM member), t,
                            format('household_id = %L', (SELECT hid FROM member)))::text || ' / ' ||
         pg_temp.rr_visible('authenticated', (SELECT uid FROM member), t,
                            format('household_id <> %L', (SELECT hid FROM member)))::text
  FROM tables
)
SELECT check_name, expected, actual, (expected = actual) AS pass
FROM checks ORDER BY ord;
