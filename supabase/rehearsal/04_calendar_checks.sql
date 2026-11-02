-- =========================================================================
-- Rehearsal — PRD-008 phase 2a (calendar data). PREVIEW ONLY: uses the fake
-- accounts from 01_seed_fake_accounts.sql and refuses to run anywhere else.
-- Run after 20261102000001_calendar_data.sql + SELECT public.rr_copy_legacy_plans();
--
-- Every scenario runs in its own sub-transaction that is always undone, so
-- this leaves no data behind. Then ONE SELECT: expected vs actual per scenario.
--   A. Who can write planned meals and confirmations.
--   B. "Changed since confirmed": what stamps a confirmed week, what doesn't.
--   C. Re-running the copy mirrors the old tables, but never overwrites or
--      removes a meal someone has edited on the new screens.
-- =========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email NOT LIKE '%@example.test') THEN
    RAISE EXCEPTION 'Refusing: this project has real accounts. Rehearsal scripts are for the preview project only.';
  END IF;
END $$;

-- Run p_steps in order, the ones starting with "@" as the logged-in user p_uid
-- (through the real security rules), the rest as admin. Then run p_probe (one
-- value) and undo everything. Returns the probe's value, or 'denied' if a
-- logged-in step was refused.
CREATE OR REPLACE FUNCTION pg_temp.rr_scenario(p_uid uuid, p_steps text[], p_probe text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE s text; v text;
BEGIN
  BEGIN
    FOREACH s IN ARRAY p_steps LOOP
      IF left(s, 1) = '@' THEN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        BEGIN
          EXECUTE substr(s, 2);
        EXCEPTION WHEN OTHERS THEN
          RESET ROLE;
          RAISE EXCEPTION 'rr_denied:%', SQLERRM;
        END;
        RESET ROLE;
      ELSE
        EXECUTE s;
      END IF;
    END LOOP;
    EXECUTE p_probe INTO v;
    RAISE EXCEPTION 'rr_result:%', coalesce(v, 'null');      -- always undo
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    IF SQLERRM LIKE 'rr_result:%' THEN RETURN substr(SQLERRM, 11); END IF;
    IF SQLERRM LIKE 'rr_denied:%' THEN RETURN 'denied'; END IF;
    RETURN 'error: ' || SQLERRM;
  END;
END $$;

-- "Pretend the last copy ran an hour ago": the test can't wait for a new
-- transaction, so it moves the copy's timestamps back with triggers paused.
-- Afterwards an edit "on the new screens" (a normal UPDATE) is newer than the copy.
CREATE OR REPLACE FUNCTION pg_temp.rr_age_copy()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  UPDATE public.planned_meals SET updated_at = updated_at - interval '1 hour',
         legacy_synced_at = legacy_synced_at - interval '1 hour' WHERE legacy_item_id IS NOT NULL;
  UPDATE public.week_confirmations SET updated_at = updated_at - interval '1 hour',
         legacy_synced_at = legacy_synced_at - interval '1 hour' WHERE legacy_plan_id IS NOT NULL;
  SET LOCAL session_replication_role = origin;
END $$;

WITH ids AS (
  SELECT 'a0000000-0000-4000-8000-000000000001'::uuid AS her,
         'a0000000-0000-4000-8000-000000000002'::uuid AS matt,
         'a0000000-0000-4000-8000-000000000003'::uuid AS other,
         (SELECT household_id FROM household_members WHERE user_id = 'a0000000-0000-4000-8000-000000000003') AS other_home
),
-- Her confirmed week in the seed: plan c…02 (current_date-7 .. -3), copied.
wk AS (SELECT id, starts_on, ends_on FROM week_confirmations
        WHERE legacy_plan_id = 'c0000000-0000-4000-8000-000000000002'),
gnocchi AS (SELECT id FROM planned_meals                     -- an uncooked meal in that week
             WHERE legacy_item_id = (SELECT id FROM meal_plan_items WHERE name = 'Sheet-pan gnocchi')),
changed AS (SELECT format('SELECT (changed_at IS NOT NULL)::text FROM public.week_confirmations WHERE id = %L', id) AS q FROM wk),
attempts(ord, attempt, expected, actual) AS (
  -- A. Writes
  SELECT 1, 'Matt adds a meal to a day (household filled in by default)', 'ok',
         pg_temp.rr_scenario(matt, ARRAY[format('@INSERT INTO public.planned_meals (user_id, planned_on, name) VALUES (%L, current_date + 1, ''Matt pasta'')', matt)],
           'SELECT CASE WHEN count(*) = 1 THEN ''ok'' END FROM public.planned_meals WHERE name = ''Matt pasta''
              AND household_id = (SELECT household_id FROM public.household_members WHERE user_id = ''a0000000-0000-4000-8000-000000000001'')') FROM ids
  UNION ALL SELECT 2, 'Matt moves HER meal to another day', 'ok',
         pg_temp.rr_scenario(matt, ARRAY[format('@UPDATE public.planned_meals SET planned_on = current_date + 2 WHERE id = %L', (SELECT id FROM gnocchi))],
           format('SELECT CASE WHEN planned_on = current_date + 2 THEN ''ok'' END FROM public.planned_meals WHERE id = %L', (SELECT id FROM gnocchi))) FROM ids
  UNION ALL SELECT 3, 'Matt adds a meal pretending SHE added it', 'denied',
         pg_temp.rr_scenario(matt, ARRAY[format('@INSERT INTO public.planned_meals (user_id, planned_on, name) VALUES (%L, current_date, ''forged'')', her)],
           'SELECT ''ok''') FROM ids
  UNION ALL SELECT 4, 'Matt adds a meal into ANOTHER household', 'denied',
         pg_temp.rr_scenario(matt, ARRAY[format('@INSERT INTO public.planned_meals (household_id, user_id, planned_on, name) VALUES (%L, %L, current_date, ''sneaky'')', other_home, matt)],
           'SELECT ''ok''') FROM ids
  UNION ALL SELECT 5, 'Outsider deletes her meals (invisible → 0 removed)', '0',
         pg_temp.rr_scenario(other, ARRAY['@DELETE FROM public.planned_meals WHERE user_id = ''a0000000-0000-4000-8000-000000000001'''],
           'SELECT (4 - count(*))::text FROM public.planned_meals WHERE user_id = ''a0000000-0000-4000-8000-000000000001''') FROM ids
  UNION ALL SELECT 6, 'She confirms next week', 'ok',
         pg_temp.rr_scenario(her, ARRAY[format('@INSERT INTO public.week_confirmations (user_id, starts_on, ends_on) VALUES (%L, current_date + 1, current_date + 7)', her)],
           'SELECT CASE WHEN count(*) = 1 THEN ''ok'' END FROM public.week_confirmations WHERE starts_on = current_date + 1') FROM ids
  UNION ALL SELECT 7, 'Outsider confirms a week in her household', 'denied',
         pg_temp.rr_scenario(other, ARRAY[format('@INSERT INTO public.week_confirmations (household_id, user_id, starts_on, ends_on) VALUES ((SELECT household_id FROM public.household_members WHERE user_id = %L), %L, current_date, current_date + 6)', her, other)],
           'SELECT ''ok''') FROM ids
  UNION ALL SELECT 8, 'A meal with a blank name is refused', 'denied',
         pg_temp.rr_scenario(her, ARRAY[format('@INSERT INTO public.planned_meals (user_id, planned_on, name) VALUES (%L, current_date, ''  '')', her)],
           'SELECT ''ok''') FROM ids
  UNION ALL SELECT 9, 'Running the copy from the app is refused', 'denied',
         pg_temp.rr_scenario(her, ARRAY['@SELECT public.rr_copy_legacy_plans()'], 'SELECT ''ok''') FROM ids

  -- B. "Changed since confirmed" on her confirmed week
  UNION ALL SELECT 20, 'freshly copied week is not "changed"', 'false',
         pg_temp.rr_scenario(her, ARRAY['SELECT 1'], (SELECT q FROM changed)) FROM ids
  UNION ALL SELECT 21, 'adding a meal inside the week → changed', 'true',
         pg_temp.rr_scenario(her, ARRAY[format('@INSERT INTO public.planned_meals (user_id, planned_on, name) VALUES (%L, %L, ''Extra soup'')', her, (SELECT starts_on FROM wk))],
           (SELECT q FROM changed)) FROM ids
  UNION ALL SELECT 22, 'renaming a meal in the week → changed', 'true',
         pg_temp.rr_scenario(her, ARRAY[format('@UPDATE public.planned_meals SET name = ''Gnocchi bake'' WHERE id = %L', (SELECT id FROM gnocchi))],
           (SELECT q FROM changed)) FROM ids
  UNION ALL SELECT 23, 'moving a meal OUT of the week → changed', 'true',
         pg_temp.rr_scenario(her, ARRAY[format('@UPDATE public.planned_meals SET planned_on = current_date + 10 WHERE id = %L', (SELECT id FROM gnocchi))],
           (SELECT q FROM changed)) FROM ids
  UNION ALL SELECT 24, 'removing a meal from the week → changed', 'true',
         pg_temp.rr_scenario(her, ARRAY[format('@DELETE FROM public.planned_meals WHERE id = %L', (SELECT id FROM gnocchi))],
           (SELECT q FROM changed)) FROM ids
  UNION ALL SELECT 25, 'ticking "cooked" / assigning the night / reordering → NOT changed', 'false',
         pg_temp.rr_scenario(her, ARRAY[format('@UPDATE public.planned_meals SET cooked = true, cooked_at = now(), position = 3, assigned_to = %L, assigned_at = now() WHERE id = %L', matt, (SELECT id FROM gnocchi))],
           (SELECT q FROM changed)) FROM ids
  UNION ALL SELECT 26, 'adding a meal in a different week → NOT changed', 'false',
         pg_temp.rr_scenario(her, ARRAY[format('@INSERT INTO public.planned_meals (user_id, planned_on, name) VALUES (%L, current_date + 20, ''Later'')', her)],
           (SELECT q FROM changed)) FROM ids
  UNION ALL SELECT 27, 'Matt (other partner) adding a meal also stamps it', 'true',
         pg_temp.rr_scenario(matt, ARRAY[format('@INSERT INTO public.planned_meals (user_id, planned_on, name) VALUES (%L, %L, ''Matt chili'')', matt, (SELECT ends_on FROM wk))],
           (SELECT q FROM changed)) FROM ids

  -- C. Re-running the copy (as at switch-over), after the old screens kept being used
  UNION ALL SELECT 40, 'nothing changed → re-run changes nothing', '{"added": 0, "removed": 0, "updated": 0, "kept_edited": 0}',
         pg_temp.rr_scenario(her, ARRAY['SELECT pg_temp.rr_age_copy()'],
           'SELECT (public.rr_copy_legacy_plans() -> ''meals'')::text') FROM ids
  UNION ALL SELECT 41, 'old screen: meal added / renamed / deleted → re-run adds 1, updates 1, removes 1', '1 1 1',
         pg_temp.rr_scenario(her, ARRAY['SELECT pg_temp.rr_age_copy()',
             format('INSERT INTO public.meal_plan_items (household_id, user_id, meal_plan_id, scheduled_date, name) VALUES ((SELECT household_id FROM public.meal_plans WHERE id = ''c0000000-0000-4000-8000-000000000002''), %L, ''c0000000-0000-4000-8000-000000000002'', current_date - 4, ''Old-screen stew'')', her),
             'UPDATE public.meal_plan_items SET name = ''Tacos al pastor'' WHERE name = ''Tacos''',
             'DELETE FROM public.meal_plan_items WHERE name = ''Moussaka''',
             'CREATE TEMP TABLE rr_r ON COMMIT DROP AS SELECT public.rr_copy_legacy_plans() -> ''meals'' AS m'],
           'SELECT concat_ws('' '', m->>''added'', m->>''updated'', m->>''removed'') FROM rr_r') FROM ids
  UNION ALL SELECT 42, '… and afterwards the copy matches the old tables exactly', 'Tacos al pastor / Old-screen stew / no Moussaka',
         pg_temp.rr_scenario(her, ARRAY['SELECT pg_temp.rr_age_copy()',
             format('INSERT INTO public.meal_plan_items (household_id, user_id, meal_plan_id, scheduled_date, name) VALUES ((SELECT household_id FROM public.meal_plans WHERE id = ''c0000000-0000-4000-8000-000000000002''), %L, ''c0000000-0000-4000-8000-000000000002'', current_date - 4, ''Old-screen stew'')', her),
             'UPDATE public.meal_plan_items SET name = ''Tacos al pastor'' WHERE name = ''Tacos''',
             'DELETE FROM public.meal_plan_items WHERE name = ''Moussaka''',
             'SELECT public.rr_copy_legacy_plans()'],
           'SELECT concat_ws('' / '',
              (SELECT name FROM public.planned_meals WHERE name = ''Tacos al pastor''),
              (SELECT name FROM public.planned_meals WHERE name = ''Old-screen stew''),
              CASE WHEN NOT EXISTS (SELECT 1 FROM public.planned_meals WHERE name = ''Moussaka'') THEN ''no Moussaka'' END)') FROM ids
  UNION ALL SELECT 43, 'meal edited on the NEW screen, then changed on the old one → re-run keeps the new-screen edit', 'Gnocchi (her edit) / kept 1',
         pg_temp.rr_scenario(her, ARRAY['SELECT pg_temp.rr_age_copy()',
             format('@UPDATE public.planned_meals SET name = ''Gnocchi (her edit)'' WHERE id = %L', (SELECT id FROM gnocchi)),
             'UPDATE public.meal_plan_items SET name = ''Gnocchi (old screen)'' WHERE name = ''Sheet-pan gnocchi''',
             'CREATE TEMP TABLE rr_r ON COMMIT DROP AS SELECT public.rr_copy_legacy_plans() -> ''meals'' AS m'],
           format('SELECT (SELECT name FROM public.planned_meals WHERE id = %L) || '' / kept '' || (SELECT m->>''kept_edited'' FROM rr_r)', (SELECT id FROM gnocchi))) FROM ids
  UNION ALL SELECT 44, 'meal edited on the NEW screen, deleted on the old one → re-run keeps it', 'kept',
         pg_temp.rr_scenario(her, ARRAY['SELECT pg_temp.rr_age_copy()',
             format('@UPDATE public.planned_meals SET planned_on = current_date + 1 WHERE id = %L', (SELECT id FROM gnocchi)),
             'DELETE FROM public.meal_plan_items WHERE name = ''Sheet-pan gnocchi''',
             'SELECT public.rr_copy_legacy_plans()'],
           format('SELECT CASE WHEN EXISTS (SELECT 1 FROM public.planned_meals WHERE id = %L) THEN ''kept'' ELSE ''removed'' END', (SELECT id FROM gnocchi))) FROM ids
  UNION ALL SELECT 45, 'old plan served on the old screen after the first copy → re-run adds its confirmation', '1',
         pg_temp.rr_scenario(her, ARRAY['SELECT pg_temp.rr_age_copy()',
             format('INSERT INTO public.meal_plans (household_id, user_id, period_start, period_end, served_at) VALUES ((SELECT household_id FROM public.household_members WHERE user_id = %L), %L, current_date, current_date + 4, now())', her, her),
             'CREATE TEMP TABLE rr_r ON COMMIT DROP AS SELECT public.rr_copy_legacy_plans() -> ''confirmations'' AS c'],
           'SELECT c->>''added'' FROM rr_r') FROM ids
)
SELECT attempt, expected, actual, (expected = actual) AS pass FROM attempts ORDER BY ord;
