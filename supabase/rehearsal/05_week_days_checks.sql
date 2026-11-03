-- =========================================================================
-- Rehearsal — PRD-008 phase 2b-1 (which days a week shows). PREVIEW ONLY:
-- uses the fake accounts from 01_seed_fake_accounts.sql and refuses to run
-- anywhere else. Run after 20261102000002_week_days.sql.
--
-- Every scenario runs in its own sub-transaction that is always undone, so
-- this leaves no data behind. Then ONE SELECT: expected vs actual per scenario.
--   A. Who can save a week's days (her, Matt, an outsider).
--   B. What the rules reject (not a Sunday, bad days, empty usual days).
--   C. Saving again (upsert), updated_at, and the usual days.
-- =========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email NOT LIKE '%@example.test') THEN
    RAISE EXCEPTION 'Refusing: this project has real accounts. Rehearsal scripts are for the preview project only.';
  END IF;
END $$;

-- Same helper as 04_calendar_checks.sql: run p_steps in order, the ones
-- starting with "@" as the logged-in user p_uid (through the real security
-- rules), the rest as admin. Then run p_probe (one value) and undo everything.
-- Returns the probe's value, or 'denied' if a logged-in step was refused.
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

-- Count rows as a logged-in user (inside a scenario's probe).
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
         (SELECT household_id FROM household_members WHERE user_id = 'a0000000-0000-4000-8000-000000000001') AS home,
         (current_date - extract(dow FROM current_date)::int) AS sun           -- this week's Sunday
),
attempts(ord, attempt, expected, actual) AS (
  -- A. Who can save a week
  SELECT 10, 'she saves this week as Sun–Fri → Matt sees the same row', '{0,1,2,3,4,5}',
         pg_temp.rr_scenario(her, ARRAY[
             format('@INSERT INTO public.week_days (user_id, week_start, days) VALUES (%L, %L, ''{0,1,2,3,4,5}'')', her, sun)],
           format('SELECT pg_temp.rr_seen_by(%L, %L)', matt,
             format('SELECT days::text FROM public.week_days WHERE week_start = %L', sun))) FROM ids
  UNION ALL SELECT 11, 'an outsider sees none of her weeks', '0',
         pg_temp.rr_scenario(her, ARRAY[
             format('@INSERT INTO public.week_days (user_id, week_start, days) VALUES (%L, %L, ''{0,1}'')', her, sun)],
           format('SELECT pg_temp.rr_seen_by(%L, %L)', other, 'SELECT count(*)::text FROM public.week_days')) FROM ids
  UNION ALL SELECT 12, 'an outsider can''t save a week into her household', 'denied',
         pg_temp.rr_scenario(other, ARRAY[
             format('@INSERT INTO public.week_days (household_id, user_id, week_start, days) VALUES (%L, %L, %L, ''{0}'')', home, other, sun)],
           'SELECT ''saved''') FROM ids
  UNION ALL SELECT 13, 'she can''t save a row stamped as Matt', 'denied',
         pg_temp.rr_scenario(her, ARRAY[
             format('@INSERT INTO public.week_days (user_id, week_start, days) VALUES (%L, %L, ''{0}'')', matt, sun)],
           'SELECT ''saved''') FROM ids
  UNION ALL SELECT 14, 'an outsider''s update of her week changes nothing', '{0,1,2,3,4}',
         pg_temp.rr_scenario(other, ARRAY[
             format('INSERT INTO public.week_days (household_id, user_id, week_start, days) VALUES (%L, %L, %L, ''{0,1,2,3,4}'')', home, her, sun),
             format('@UPDATE public.week_days SET days = ''{6}'' WHERE week_start = %L', sun)],
           format('SELECT days::text FROM public.week_days WHERE household_id = %L AND week_start = %L', home, sun)) FROM ids
  UNION ALL SELECT 15, 'Matt changes a week she saved (both edit everything)', '{0,1,2,3,4,6}',
         pg_temp.rr_scenario(matt, ARRAY[
             format('INSERT INTO public.week_days (household_id, user_id, week_start, days) VALUES (%L, %L, %L, ''{0,1,2,3,4}'')', home, her, sun),
             format('@UPDATE public.week_days SET days = ''{0,1,2,3,4,6}'', user_id = %L WHERE week_start = %L', matt, sun)],
           format('SELECT days::text FROM public.week_days WHERE household_id = %L AND week_start = %L', home, sun)) FROM ids

  -- B. What the rules reject
  UNION ALL SELECT 20, 'a week that doesn''t start on Sunday is rejected', 'denied',
         pg_temp.rr_scenario(her, ARRAY[
             format('@INSERT INTO public.week_days (user_id, week_start, days) VALUES (%L, %L, ''{0}'')', her, sun + 1)],
           'SELECT ''saved''') FROM ids
  UNION ALL SELECT 21, 'day 7 is rejected', 'denied',
         pg_temp.rr_scenario(her, ARRAY[
             format('@INSERT INTO public.week_days (user_id, week_start, days) VALUES (%L, %L, ''{0,7}'')', her, sun)],
           'SELECT ''saved''') FROM ids
  UNION ALL SELECT 22, 'a repeated day is rejected', 'denied',
         pg_temp.rr_scenario(her, ARRAY[
             format('@INSERT INTO public.week_days (user_id, week_start, days) VALUES (%L, %L, ''{2,2}'')', her, sun)],
           'SELECT ''saved''') FROM ids
  UNION ALL SELECT 23, 'a week with no days (vacation) is allowed', '{}',
         pg_temp.rr_scenario(her, ARRAY[
             format('@INSERT INTO public.week_days (user_id, week_start, days) VALUES (%L, %L, ''{}'')', her, sun)],
           format('SELECT days::text FROM public.week_days WHERE household_id = %L AND week_start = %L', home, sun)) FROM ids
  UNION ALL SELECT 24, 'usual days can''t be empty', 'denied',
         pg_temp.rr_scenario(her, ARRAY[
             format('INSERT INTO public.household_preferences (household_id, user_id) VALUES (%L, %L) ON CONFLICT (household_id) DO NOTHING', home, her),
             format('@UPDATE public.household_preferences SET usual_days = ''{}'' WHERE household_id = %L', home)],
           'SELECT ''saved''') FROM ids

  -- C. Saving again, updated_at, usual days
  UNION ALL SELECT 30, 'saving the same week twice updates it (upsert, one row)', '1 / {0,6}',
         pg_temp.rr_scenario(her, ARRAY[
             format('@INSERT INTO public.week_days (user_id, week_start, days) VALUES (%L, %L, ''{0,1}'')', her, sun),
             format('@INSERT INTO public.week_days (user_id, week_start, days) VALUES (%L, %L, ''{0,6}'') ON CONFLICT (household_id, week_start) DO UPDATE SET days = EXCLUDED.days, user_id = EXCLUDED.user_id', her, sun)],
           format('SELECT count(*)::text || '' / '' || max(days::text) FROM public.week_days WHERE household_id = %L AND week_start = %L', home, sun)) FROM ids
  UNION ALL SELECT 31, 'an update moves updated_at', 'moved',
         pg_temp.rr_scenario(her, ARRAY[
             format('INSERT INTO public.week_days (household_id, user_id, week_start, days, updated_at) VALUES (%L, %L, %L, ''{0}'', now() - interval ''1 hour'')', home, her, sun),
             format('@UPDATE public.week_days SET days = ''{0,1}'' WHERE week_start = %L', sun)],
           format('SELECT CASE WHEN updated_at > now() - interval ''1 minute'' THEN ''moved'' ELSE ''stuck'' END FROM public.week_days WHERE household_id = %L AND week_start = %L', home, sun)) FROM ids
  UNION ALL SELECT 32, 'a new preferences row starts with Sun–Thu', '{0,1,2,3,4}',
         pg_temp.rr_scenario(her, ARRAY[
             format('DELETE FROM public.household_preferences WHERE household_id = %L', home),
             format('@INSERT INTO public.household_preferences (household_id, user_id) VALUES (%L, %L)', home, her)],
           format('SELECT usual_days::text FROM public.household_preferences WHERE household_id = %L', home)) FROM ids
  UNION ALL SELECT 33, 'she changes her usual days → Matt sees them', '{0,1,2,3,4,5}',
         pg_temp.rr_scenario(her, ARRAY[
             format('INSERT INTO public.household_preferences (household_id, user_id) VALUES (%L, %L) ON CONFLICT (household_id) DO NOTHING', home, her),
             format('@UPDATE public.household_preferences SET usual_days = ''{0,1,2,3,4,5}'' WHERE household_id = %L', home)],
           format('SELECT pg_temp.rr_seen_by(%L, %L)', matt,
             format('SELECT usual_days::text FROM public.household_preferences WHERE household_id = %L', home))) FROM ids
)
SELECT attempt, expected, actual, (expected = actual) AS pass FROM attempts ORDER BY ord;
