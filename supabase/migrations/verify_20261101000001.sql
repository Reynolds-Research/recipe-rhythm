-- verify_20261101000001 — PRD-008 phase 1, household schema + setup (P0.1).
-- Read-only. ONE SELECT: every row is one check with expected / actual / pass.
-- "after setup" rows expect the shared household to exist (2 members); on a
-- run where the email placeholders were left in, they show pass = false.
WITH kitchen(t, total, no_household, wrong_household, legacy_rows, ownerless) AS (
  SELECT 'vault', count(*), count(*) FILTER (WHERE household_id IS NULL),
         count(*) FILTER (WHERE household_id IS DISTINCT FROM COALESCE((SELECT h.id FROM households h WHERE h.created_for = x.user_id), '00000000-0000-4000-8000-000000000000')),
         count(*) FILTER (WHERE household_id = '00000000-0000-4000-8000-000000000000'),
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id)) FROM vault x
  UNION ALL SELECT 'vault_options', count(*), count(*) FILTER (WHERE household_id IS NULL),
         count(*) FILTER (WHERE household_id IS DISTINCT FROM COALESCE((SELECT h.id FROM households h WHERE h.created_for = x.user_id), '00000000-0000-4000-8000-000000000000')),
         count(*) FILTER (WHERE household_id = '00000000-0000-4000-8000-000000000000'),
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id)) FROM vault_options x
  UNION ALL SELECT 'meals', count(*), count(*) FILTER (WHERE household_id IS NULL),
         count(*) FILTER (WHERE household_id IS DISTINCT FROM COALESCE((SELECT h.id FROM households h WHERE h.created_for = x.user_id), '00000000-0000-4000-8000-000000000000')),
         count(*) FILTER (WHERE household_id = '00000000-0000-4000-8000-000000000000'),
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id)) FROM meals x
  UNION ALL SELECT 'meal_plans', count(*), count(*) FILTER (WHERE household_id IS NULL),
         count(*) FILTER (WHERE household_id IS DISTINCT FROM COALESCE((SELECT h.id FROM households h WHERE h.created_for = x.user_id), '00000000-0000-4000-8000-000000000000')),
         count(*) FILTER (WHERE household_id = '00000000-0000-4000-8000-000000000000'),
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id)) FROM meal_plans x
  UNION ALL SELECT 'meal_plan_items', count(*), count(*) FILTER (WHERE household_id IS NULL),
         count(*) FILTER (WHERE household_id IS DISTINCT FROM COALESCE((SELECT h.id FROM households h WHERE h.created_for = x.user_id), '00000000-0000-4000-8000-000000000000')),
         count(*) FILTER (WHERE household_id = '00000000-0000-4000-8000-000000000000'),
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id)) FROM meal_plan_items x
  UNION ALL SELECT 'grocery_lists', count(*), count(*) FILTER (WHERE household_id IS NULL),
         count(*) FILTER (WHERE household_id IS DISTINCT FROM COALESCE((SELECT h.id FROM households h WHERE h.created_for = x.user_id), '00000000-0000-4000-8000-000000000000')),
         count(*) FILTER (WHERE household_id = '00000000-0000-4000-8000-000000000000'),
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id)) FROM grocery_lists x
  UNION ALL SELECT 'household_preferences', count(*), count(*) FILTER (WHERE household_id IS NULL),
         count(*) FILTER (WHERE household_id IS DISTINCT FROM COALESCE((SELECT h.id FROM households h WHERE h.created_for = x.user_id), '00000000-0000-4000-8000-000000000000')),
         count(*) FILTER (WHERE household_id = '00000000-0000-4000-8000-000000000000'),
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id)) FROM household_preferences x
  UNION ALL SELECT 'plan_drafts', count(*), count(*) FILTER (WHERE household_id IS NULL),
         count(*) FILTER (WHERE household_id IS DISTINCT FROM COALESCE((SELECT h.id FROM households h WHERE h.created_for = x.user_id), '00000000-0000-4000-8000-000000000000')),
         count(*) FILTER (WHERE household_id = '00000000-0000-4000-8000-000000000000'),
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id)) FROM plan_drafts x
),
member_counts AS (
  SELECT h.id, h.created_for, count(m.user_id) AS members
  FROM households h LEFT JOIN household_members m ON m.household_id = h.id GROUP BY h.id, h.created_for
),
checks(ord, check_name, expected, actual) AS (
  SELECT 10, 'accounts with no household', '0',
         (SELECT count(*) FROM auth.users u WHERE NOT EXISTS (SELECT 1 FROM household_members m WHERE m.user_id = u.id))::text
  UNION ALL SELECT 11, 'accounts in more than one household', '0',
         (SELECT count(*) FROM (SELECT user_id FROM household_members GROUP BY user_id HAVING count(*) > 1) d)::text
  UNION ALL SELECT 12, 'solo households = accounts', (SELECT count(*) FROM auth.users)::text,
         (SELECT count(*) FROM households WHERE created_for IS NOT NULL)::text
  UNION ALL SELECT 13, 'legacy household has no members', '0',
         (SELECT members FROM member_counts WHERE id = '00000000-0000-4000-8000-000000000000')::text
  UNION ALL SELECT 14, 'after setup: households with 2 members', '1',
         (SELECT count(*) FROM member_counts WHERE members = 2)::text
  UNION ALL SELECT 15, 'after setup: solo households left with 0 members (Matt''s old rows)', '1',
         (SELECT count(*) FROM member_counts WHERE created_for IS NOT NULL AND members = 0)::text
  UNION ALL SELECT 20 + row_number() OVER (ORDER BY t), t || ': rows with no household', '0', no_household::text FROM kitchen
  UNION ALL SELECT 30 + row_number() OVER (ORDER BY t), t || ': rows outside their owner''s original household (0 right after migration)', '0', wrong_household::text FROM kitchen
  UNION ALL SELECT 40 + row_number() OVER (ORDER BY t), t || ': ownerless rows all in legacy household', ownerless::text, legacy_rows::text FROM kitchen
  UNION ALL SELECT 50, 'household_id NOT NULL + defaults to current_household_id() on all 8 tables', '8',
         (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'household_id'
            AND is_nullable = 'NO' AND column_default = 'current_household_id()'
            AND table_name IN ('vault','vault_options','meals','meal_plans','meal_plan_items','grocery_lists','household_preferences','plan_drafts'))::text
  UNION ALL SELECT 51, 'household_preferences primary key', 'PRIMARY KEY (household_id)',
         (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'household_preferences_pkey')
  UNION ALL SELECT 52, 'vault_options primary key', 'PRIMARY KEY (household_id, category, value)',
         (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'vault_options_pkey')
  UNION ALL SELECT 53, 'period overlap rule is per household', 'true',
         (SELECT (pg_get_constraintdef(oid) LIKE 'EXCLUDE USING gist (household_id WITH =%')::text FROM pg_constraint WHERE conname = 'meal_plans_no_period_overlap')
  UNION ALL SELECT 54, 'one grocery list per plan per household (old per-user index gone)', '1 / 0',
         (SELECT count(*) FROM pg_indexes WHERE indexname = 'grocery_lists_household_plan_idx')::text || ' / ' ||
         (SELECT count(*) FROM pg_indexes WHERE indexname = 'grocery_lists_user_plan_idx')::text
  UNION ALL SELECT 55, 'plan_drafts stays one per person', 'PRIMARY KEY (user_id)',
         (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'plan_drafts_pkey')
  UNION ALL SELECT 60, 'helpers are SECURITY DEFINER with a pinned search_path', '3',
         (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosecdef
            AND proconfig @> ARRAY['search_path=""']
            AND proname IN ('is_household_member','current_household_id','handle_new_user_household'))::text
  UNION ALL SELECT 61, 'anon cannot run the helpers', 'false / false',
         has_function_privilege('anon', 'public.is_household_member(uuid)', 'execute')::text || ' / ' ||
         has_function_privilege('anon', 'public.current_household_id()', 'execute')::text
  UNION ALL SELECT 62, 'sign-up trigger on auth.users', '1',
         (SELECT count(*) FROM pg_trigger WHERE tgname = 'on_auth_user_created_household' AND tgrelid = 'auth.users'::regclass)::text
  UNION ALL SELECT 63, 'RLS on + one read rule each: households, household_members', 'true true / 2',
         (SELECT string_agg(relrowsecurity::text, ' ' ORDER BY relname) FROM pg_class
            WHERE relnamespace = 'public'::regnamespace AND relname IN ('households','household_members')) || ' / ' ||
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('households','household_members'))::text
)
SELECT check_name, expected, actual, (expected = actual) AS pass
FROM checks ORDER BY ord;
