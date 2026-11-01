-- =========================================================================
-- Rehearsal step 0b — fake accounts + data on the PREVIEW project, shaped
-- like prod's awkward cases. PREVIEW ONLY (same guard as step 0a).
--
--   her@example.test     — the main planner: recipes (one soft-deleted), tag
--                          options, meal log, two finalized periods (one with an
--                          uncooked meal → shows in current_leftovers, one Maybe
--                          item), a share-linked grocery list, preferences, a draft.
--   matt@example.test    — own recipes, the SAME tag option as hers, a period that
--                          OVERLAPS hers, preferences, a draft (all must stay his).
--   other@example.test   — an unrelated household with its own rows.
--   empty@example.test   — an account with no data at all.
--   Ownerless rows       — 2 recipes + 2 meals with no user_id, and 1 recipe whose
--                          user_id points at an account that doesn't exist.
-- =========================================================================
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email NOT LIKE '%@example.test') THEN
    RAISE EXCEPTION 'Refusing: this project has real accounts. Rehearsal scripts are for the preview project only.';
  END IF;
END $$;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'her@example.test',   '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'matt@example.test',  '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'other@example.test', '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'empty@example.test', '{}', '{}', now(), now());

INSERT INTO public.vault (id, user_id, name, cuisine_type, deleted_at) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Green curry',     'Thai',    NULL),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'Sheet-pan gnocchi','Italian', NULL),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'Old soup',        NULL,      now()),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000002', 'Green curry',     'Thai',    NULL),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000002', 'Smash burgers',   'American',NULL),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000003', 'Moussaka',        'Greek',   NULL),
  ('b0000000-0000-4000-8000-000000000007', NULL,                                   'Legacy lasagna',  NULL,      NULL),
  ('b0000000-0000-4000-8000-000000000008', NULL,                                   'Legacy tacos',    NULL,      NULL),
  ('b0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000099', 'Ghost chili',     NULL,      NULL);

INSERT INTO public.vault_options (user_id, category, value) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'cuisine', 'Thai'),
  ('a0000000-0000-4000-8000-000000000001', 'protein', 'Tofu'),
  ('a0000000-0000-4000-8000-000000000002', 'cuisine', 'Thai'),
  ('a0000000-0000-4000-8000-000000000003', 'cuisine', 'Greek');

INSERT INTO public.meals (user_id, vault_id, name, eaten_on) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Green curry',  current_date - 10),
  ('a0000000-0000-4000-8000-000000000001', NULL,                                   'Takeout pho',  current_date - 3),
  ('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000005', 'Smash burgers',current_date - 5),
  ('a0000000-0000-4000-8000-000000000003', NULL,                                   'Moussaka',     current_date - 2),
  (NULL, NULL, 'Legacy meal one', current_date - 200),
  (NULL, NULL, 'Legacy meal two', current_date - 190);

INSERT INTO public.meal_plans (id, user_id, period_start, period_end, finalized_at, served_at) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', current_date - 14, current_date - 10, now() - interval '14 days', now() - interval '14 days'),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', current_date - 7,  current_date - 3,  now() - interval '7 days',  now() - interval '7 days'),
  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', current_date - 12, current_date - 8,  now() - interval '12 days', now() - interval '12 days'),
  ('c0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000003', current_date - 7,  current_date - 3,  now() - interval '7 days',  now() - interval '7 days');

INSERT INTO public.meal_plan_items (user_id, meal_plan_id, scheduled_date, position, vault_id, name, cooked, is_shortlisted) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', current_date - 14, 0, 'b0000000-0000-4000-8000-000000000001', 'Green curry',       true,  false),
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', current_date - 6,  0, 'b0000000-0000-4000-8000-000000000002', 'Sheet-pan gnocchi', false, false),
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', current_date - 5,  0, NULL,                                   'Tacos',             true,  false),
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', NULL,              0, NULL,                                   'Maybe: ramen',      false, true),
  ('a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003', current_date - 9,  0, 'b0000000-0000-4000-8000-000000000005', 'Smash burgers',     false, false),
  ('a0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000004', current_date - 4,  0, 'b0000000-0000-4000-8000-000000000006', 'Moussaka',          false, false);

INSERT INTO public.grocery_lists (id, user_id, meal_plan_id, share_token) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'tok-her-shared'),
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000004', NULL);

INSERT INTO public.grocery_list_items (list_id, name, section) VALUES
  ('d0000000-0000-4000-8000-000000000001', 'Gnocchi', 'Pantry'),
  ('d0000000-0000-4000-8000-000000000001', 'Limes',   'Produce'),
  ('d0000000-0000-4000-8000-000000000002', 'Eggplant','Produce');

INSERT INTO public.household_preferences (user_id, excluded_ingredients, adults, children) VALUES
  ('a0000000-0000-4000-8000-000000000001', '{cilantro}', 2, 1),
  ('a0000000-0000-4000-8000-000000000002', '{}',         2, 1),
  ('a0000000-0000-4000-8000-000000000003', '{}',         1, 0);

INSERT INTO public.plan_drafts (user_id, plan, selected_dates) VALUES
  ('a0000000-0000-4000-8000-000000000001', '[{"name":"Her draft"}]', '[]'),
  ('a0000000-0000-4000-8000-000000000002', '[{"name":"Matt draft"}]', '[]');

COMMIT;

-- Row counts after seeding (expected: users 4, vault 9, options 4, meals 6,
-- plans 4, items 6, lists 2, list items 3, prefs 3, drafts 2, leftovers 3 — one per account with a recent uncooked meal).
SELECT (SELECT count(*) FROM auth.users) AS users, (SELECT count(*) FROM vault) AS vault,
       (SELECT count(*) FROM vault_options) AS options, (SELECT count(*) FROM meals) AS meals,
       (SELECT count(*) FROM meal_plans) AS plans, (SELECT count(*) FROM meal_plan_items) AS items,
       (SELECT count(*) FROM grocery_lists) AS lists, (SELECT count(*) FROM grocery_list_items) AS list_items,
       (SELECT count(*) FROM household_preferences) AS prefs, (SELECT count(*) FROM plan_drafts) AS drafts,
       (SELECT count(*) FROM current_leftovers) AS leftovers;
