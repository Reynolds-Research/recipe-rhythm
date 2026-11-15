-- =========================================================================
-- Rehearsal — add-on on a planned meal (20261114000001). PREVIEW ONLY: uses
-- the fake accounts from 01_seed_fake_accounts.sql and refuses to run anywhere
-- else. Run after 20261114000001_planned_meals_add_on.sql.
--
-- Every scenario runs in its own sub-transaction that is always undone, so
-- this leaves no data behind. Then ONE SELECT: expected vs actual per scenario.
--   A. Who can set an add-on (her, Matt; not an outsider).
--   B. What the rule rejects (padded, empty, over 80 characters).
--   C. "Changed since confirmed": add / change / clear an add-on stamps the
--      week; re-saving the same add-on or ticking cooked does not.
--   D. An add-on never creates a cookbook row.
-- =========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email NOT LIKE '%@example.test') THEN
    RAISE EXCEPTION 'Refusing: this project has real accounts. Rehearsal scripts are for the preview project only.';
  END IF;
END $$;

-- Same helpers as 05_week_days_checks.sql.
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

CREATE OR REPLACE FUNCTION pg_temp.rr_seen_by(p_uid uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  RETURN v;
END $$;

WITH ids AS (
  SELECT 'a0000000-0000-4000-8000-000000000001'::uuid AS her,
         'a0000000-0000-4000-8000-000000000002'::uuid AS matt,
         'a0000000-0000-4000-8000-000000000003'::uuid AS other,
         'b0000000-0000-4000-8000-0000000000a1'::uuid AS meal,
         (SELECT household_id FROM household_members WHERE user_id = 'a0000000-0000-4000-8000-000000000001') AS home,
         current_date + 400 AS d
),
setup AS (   -- as the server: her meal on day d, linked to one of her recipes
  SELECT ids.*,
         format('INSERT INTO public.planned_meals (id, household_id, user_id, planned_on, name, vault_id) '
                'SELECT %L, %L, %L, %L, v.name, v.id FROM public.vault v WHERE v.household_id = %L AND v.deleted_at IS NULL ORDER BY v.id LIMIT 1',
                meal, home, her, d, home) AS add_meal,
         format('INSERT INTO public.week_confirmations (household_id, user_id, starts_on, ends_on) VALUES (%L, %L, %L, %L)',
                home, her, d - 1, d + 5) AS confirm,
         format('UPDATE public.week_confirmations SET changed_at = NULL WHERE household_id = %L AND starts_on = %L', home, d - 1) AS clear_stamp,
         format('SELECT (changed_at IS NOT NULL)::text FROM public.week_confirmations WHERE household_id = %L AND starts_on = %L', home, d - 1) AS stamped,
         format('SELECT coalesce(add_on, ''null'') FROM public.planned_meals WHERE id = %L', meal) AS saved
  FROM ids
),
attempts(ord, attempt, expected, actual) AS (
  -- A. Who can set it
  SELECT 1, 'she sets "shrimp" on her meal', 'shrimp',
         pg_temp.rr_scenario(her, ARRAY[add_meal, format('@UPDATE public.planned_meals SET add_on = ''shrimp'' WHERE id = %L', meal)], saved) FROM setup
  UNION ALL SELECT 2, 'she adds a new meal with an add-on in one step', 'garlic bread',
         pg_temp.rr_scenario(her, ARRAY[format('@INSERT INTO public.planned_meals (id, user_id, planned_on, name, add_on) VALUES (%L, %L, %L, ''Lasagna'', ''garlic bread'')', meal, her, d)], saved) FROM setup
  UNION ALL SELECT 3, 'Matt sets an add-on on her meal (same household)', 'shrimp',
         pg_temp.rr_scenario(matt, ARRAY[add_meal, format('@UPDATE public.planned_meals SET add_on = ''shrimp'' WHERE id = %L', meal)], saved) FROM setup
  UNION ALL SELECT 4, 'an outsider can''t set one (no row changes)', 'null',
         pg_temp.rr_scenario(other, ARRAY[add_meal, format('@UPDATE public.planned_meals SET add_on = ''shrimp'' WHERE id = %L', meal)], saved) FROM setup
  -- B. The rule
  UNION ALL SELECT 5, 'padded text (" shrimp ") is rejected', 'denied',
         pg_temp.rr_scenario(her, ARRAY[add_meal, format('@UPDATE public.planned_meals SET add_on = '' shrimp '' WHERE id = %L', meal)], saved) FROM setup
  UNION ALL SELECT 6, 'empty text is rejected (the app saves NULL instead)', 'denied',
         pg_temp.rr_scenario(her, ARRAY[add_meal, format('@UPDATE public.planned_meals SET add_on = '''' WHERE id = %L', meal)], saved) FROM setup
  UNION ALL SELECT 7, '81 characters is rejected', 'denied',
         pg_temp.rr_scenario(her, ARRAY[add_meal, format('@UPDATE public.planned_meals SET add_on = %L WHERE id = %L', repeat('x', 81), meal)], saved) FROM setup
  UNION ALL SELECT 8, '80 characters is fine', '80',
         pg_temp.rr_scenario(her, ARRAY[add_meal, format('@UPDATE public.planned_meals SET add_on = %L WHERE id = %L', repeat('x', 80), meal)],
           format('SELECT char_length(add_on)::text FROM public.planned_meals WHERE id = %L', meal)) FROM setup
  -- C. Changed since confirmed
  UNION ALL SELECT 9, 'adding an add-on in a confirmed week stamps it', 'true',
         pg_temp.rr_scenario(her, ARRAY[add_meal, confirm, clear_stamp, format('@UPDATE public.planned_meals SET add_on = ''shrimp'' WHERE id = %L', meal)], stamped) FROM setup
  UNION ALL SELECT 10, 'changing the add-on stamps it', 'true',
         pg_temp.rr_scenario(her, ARRAY[add_meal, format('UPDATE public.planned_meals SET add_on = ''shrimp'' WHERE id = %L', meal), confirm, clear_stamp,
           format('@UPDATE public.planned_meals SET add_on = ''chicken'' WHERE id = %L', meal)], stamped) FROM setup
  UNION ALL SELECT 11, 'clearing the add-on stamps it', 'true',
         pg_temp.rr_scenario(her, ARRAY[add_meal, format('UPDATE public.planned_meals SET add_on = ''shrimp'' WHERE id = %L', meal), confirm, clear_stamp,
           format('@UPDATE public.planned_meals SET add_on = NULL WHERE id = %L', meal)], stamped) FROM setup
  UNION ALL SELECT 12, 're-saving the same add-on doesn''t stamp it', 'false',
         pg_temp.rr_scenario(her, ARRAY[add_meal, format('UPDATE public.planned_meals SET add_on = ''shrimp'' WHERE id = %L', meal), confirm, clear_stamp,
           format('@UPDATE public.planned_meals SET add_on = ''shrimp'' WHERE id = %L', meal)], stamped) FROM setup
  UNION ALL SELECT 13, 'ticking cooked still doesn''t stamp it', 'false',
         pg_temp.rr_scenario(her, ARRAY[add_meal, format('UPDATE public.planned_meals SET add_on = ''shrimp'' WHERE id = %L', meal), confirm, clear_stamp,
           format('@UPDATE public.planned_meals SET cooked = true, cooked_at = now() WHERE id = %L', meal)], stamped) FROM setup
  UNION ALL SELECT 14, 'renaming still stamps it (unchanged behaviour)', 'true',
         pg_temp.rr_scenario(her, ARRAY[add_meal, confirm, clear_stamp,
           format('@UPDATE public.planned_meals SET name = ''Renamed'' WHERE id = %L', meal)], stamped) FROM setup
  -- D. No cookbook row
  UNION ALL SELECT 15, 'an add-on creates no cookbook row', 'same',
         pg_temp.rr_scenario(her, ARRAY[add_meal, 'CREATE TEMP TABLE rr_before ON COMMIT DROP AS SELECT count(*) AS n FROM public.vault',
           format('@UPDATE public.planned_meals SET add_on = ''shrimp'' WHERE id = %L', meal)],
           'SELECT CASE WHEN (SELECT count(*) FROM public.vault) = (SELECT n FROM rr_before) THEN ''same'' ELSE ''changed'' END') FROM setup
  UNION ALL SELECT 16, 'the recipe link is unchanged after adding an add-on', 'same',
         pg_temp.rr_scenario(her, ARRAY[add_meal, 'CREATE TEMP TABLE rr_link ON COMMIT DROP AS SELECT vault_id FROM public.planned_meals WHERE id = ''b0000000-0000-4000-8000-0000000000a1''',
           format('@UPDATE public.planned_meals SET add_on = ''shrimp'' WHERE id = %L', meal)],
           format('SELECT CASE WHEN vault_id IS NOT DISTINCT FROM (SELECT vault_id FROM rr_link) AND vault_id IS NOT NULL THEN ''same'' ELSE ''changed'' END FROM public.planned_meals WHERE id = %L', meal)) FROM setup
)
SELECT attempt, expected, actual, (expected = actual) AS pass FROM attempts ORDER BY ord;
