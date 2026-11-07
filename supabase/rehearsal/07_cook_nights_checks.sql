-- =========================================================================
-- Rehearsal — PRD-008 phase 3a (Matt's nights). PREVIEW ONLY: uses the fake
-- accounts from 01_seed_fake_accounts.sql and refuses to run anywhere else.
-- Run after 20261108000001_cook_nights.sql.
--
-- Every scenario runs in its own sub-transaction that is always undone, so
-- this leaves no data behind. Then ONE SELECT: expected vs actual per scenario.
--   A. Who can hand over a night, and who sees it.
--   B. What the rules reject (a cook from outside, a row stamped as someone else).
--   C. Handing a night to someone else restarts the clock; taking it back.
--   D. Display names: only your own, 1–30 characters, the other member sees it.
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
         (SELECT household_id FROM household_members WHERE user_id = 'a0000000-0000-4000-8000-000000000001') AS home,
         current_date + 2 AS tue
),
attempts(ord, attempt, expected, actual) AS (
  -- A. Hand over a night
  SELECT 10, 'she hands a night to Matt → Matt sees it as his', 'matt',
         pg_temp.rr_scenario(her, ARRAY[
             format('@INSERT INTO public.cook_nights (user_id, cooks_on, cook_id) VALUES (%L, %L, %L)', her, tue, matt)],
           format('SELECT pg_temp.rr_seen_by(%L, %L)', matt,
             format('SELECT CASE WHEN cook_id = %L THEN ''matt'' ELSE ''other'' END FROM public.cook_nights WHERE cooks_on = %L', matt, tue))) FROM ids
  UNION ALL SELECT 11, 'the row records who handed it over and when', 'her / now',
         pg_temp.rr_scenario(her, ARRAY[
             format('@INSERT INTO public.cook_nights (user_id, cooks_on, cook_id) VALUES (%L, %L, %L)', her, tue, matt)],
           format('SELECT CASE WHEN user_id = %L THEN ''her'' ELSE ''?'' END || '' / '' || CASE WHEN assigned_at > now() - interval ''1 minute'' THEN ''now'' ELSE ''old'' END FROM public.cook_nights WHERE household_id = %L AND cooks_on = %L', her, home, tue)) FROM ids
  UNION ALL SELECT 12, 'an outsider sees none of their nights', '0',
         pg_temp.rr_scenario(her, ARRAY[
             format('@INSERT INTO public.cook_nights (user_id, cooks_on, cook_id) VALUES (%L, %L, %L)', her, tue, matt)],
           format('SELECT pg_temp.rr_seen_by(%L, %L)', other, 'SELECT count(*)::text FROM public.cook_nights')) FROM ids
  UNION ALL SELECT 13, 'Matt can take his own night (both edit everything)', 'matt',
         pg_temp.rr_scenario(matt, ARRAY[
             format('@INSERT INTO public.cook_nights (user_id, cooks_on, cook_id) VALUES (%L, %L, %L)', matt, tue, matt)],
           format('SELECT CASE WHEN cook_id = %L THEN ''matt'' ELSE ''other'' END FROM public.cook_nights WHERE household_id = %L AND cooks_on = %L', matt, home, tue)) FROM ids

  -- B. What the rules reject
  UNION ALL SELECT 20, 'an outsider can''t hand out a night in her household', 'denied',
         pg_temp.rr_scenario(other, ARRAY[
             format('@INSERT INTO public.cook_nights (household_id, user_id, cooks_on, cook_id) VALUES (%L, %L, %L, %L)', home, other, tue, matt)],
           'SELECT ''saved''') FROM ids
  UNION ALL SELECT 21, 'she can''t hand a night to someone outside the household', 'denied',
         pg_temp.rr_scenario(her, ARRAY[
             format('@INSERT INTO public.cook_nights (user_id, cooks_on, cook_id) VALUES (%L, %L, %L)', her, tue, other)],
           'SELECT ''saved''') FROM ids
  UNION ALL SELECT 22, 'not even an admin insert can give a night to an outsider', 'error',
         left(pg_temp.rr_scenario(her, ARRAY[
             format('INSERT INTO public.cook_nights (household_id, user_id, cooks_on, cook_id) VALUES (%L, %L, %L, %L)', home, her, tue, other)],
           'SELECT ''saved'''), 5) FROM ids
  UNION ALL SELECT 23, 'she can''t save a row stamped as handed over by Matt', 'denied',
         pg_temp.rr_scenario(her, ARRAY[
             format('@INSERT INTO public.cook_nights (user_id, cooks_on, cook_id) VALUES (%L, %L, %L)', matt, tue, matt)],
           'SELECT ''saved''') FROM ids
  UNION ALL SELECT 24, 'one night per date: a second row for the same day is rejected', 'denied',
         pg_temp.rr_scenario(her, ARRAY[
             format('@INSERT INTO public.cook_nights (user_id, cooks_on, cook_id) VALUES (%L, %L, %L)', her, tue, matt),
             format('@INSERT INTO public.cook_nights (user_id, cooks_on, cook_id) VALUES (%L, %L, %L)', her, tue, her)],
           'SELECT ''saved''') FROM ids
  UNION ALL SELECT 26, 'she can''t hand an existing night over to someone outside the household', 'denied',
         pg_temp.rr_scenario(her, ARRAY[
             format('INSERT INTO public.cook_nights (household_id, user_id, cooks_on, cook_id) VALUES (%L, %L, %L, %L)', home, her, tue, matt),
             format('@UPDATE public.cook_nights SET cook_id = %L WHERE cooks_on = %L', other, tue)],
           'SELECT ''saved''') FROM ids
  UNION ALL SELECT 27, 'an outsider gets the same refusal whoever the cook is (no membership leak)', 'same',
         CASE WHEN pg_temp.rr_scenario(other, ARRAY[
                     format('@INSERT INTO public.cook_nights (household_id, user_id, cooks_on, cook_id) VALUES (%L, %L, %L, %L)', home, other, tue, matt)],
                   'SELECT ''saved''')
                 = pg_temp.rr_scenario(other, ARRAY[
                     format('@INSERT INTO public.cook_nights (household_id, user_id, cooks_on, cook_id) VALUES (%L, %L, %L, %L)', home, other, tue, other)],
                   'SELECT ''saved''')
              THEN 'same' ELSE 'different' END FROM ids
  UNION ALL SELECT 25, 'an outsider''s delete of her night changes nothing', '1',
         pg_temp.rr_scenario(other, ARRAY[
             format('INSERT INTO public.cook_nights (household_id, user_id, cooks_on, cook_id) VALUES (%L, %L, %L, %L)', home, her, tue, matt),
             format('@DELETE FROM public.cook_nights WHERE cooks_on = %L', tue)],
           format('SELECT count(*)::text FROM public.cook_nights WHERE household_id = %L AND cooks_on = %L', home, tue)) FROM ids

  -- C. The clock, and taking a night back
  UNION ALL SELECT 30, 'handing the night to someone else restarts assigned_at', 'restarted',
         pg_temp.rr_scenario(her, ARRAY[
             format('INSERT INTO public.cook_nights (household_id, user_id, cooks_on, cook_id, assigned_at) VALUES (%L, %L, %L, %L, now() - interval ''2 days'')', home, her, tue, matt),
             format('@UPDATE public.cook_nights SET cook_id = %L WHERE cooks_on = %L', her, tue)],
           format('SELECT CASE WHEN assigned_at > now() - interval ''1 minute'' THEN ''restarted'' ELSE ''kept'' END FROM public.cook_nights WHERE household_id = %L AND cooks_on = %L', home, tue)) FROM ids
  UNION ALL SELECT 31, 'any other update keeps assigned_at (and moves updated_at)', 'kept / moved',
         pg_temp.rr_scenario(her, ARRAY[
             format('INSERT INTO public.cook_nights (household_id, user_id, cooks_on, cook_id, assigned_at, updated_at) VALUES (%L, %L, %L, %L, now() - interval ''2 days'', now() - interval ''2 days'')', home, her, tue, matt),
             format('@UPDATE public.cook_nights SET user_id = %L WHERE cooks_on = %L', her, tue)],
           format('SELECT CASE WHEN assigned_at < now() - interval ''1 day'' THEN ''kept'' ELSE ''restarted'' END || '' / '' || CASE WHEN updated_at > now() - interval ''1 minute'' THEN ''moved'' ELSE ''stuck'' END FROM public.cook_nights WHERE household_id = %L AND cooks_on = %L', home, tue)) FROM ids
  UNION ALL SELECT 32, 'she takes the night back (delete) → it''s an ordinary night', '0',
         pg_temp.rr_scenario(her, ARRAY[
             format('INSERT INTO public.cook_nights (household_id, user_id, cooks_on, cook_id) VALUES (%L, %L, %L, %L)', home, her, tue, matt),
             format('@DELETE FROM public.cook_nights WHERE cooks_on = %L', tue)],
           format('SELECT count(*)::text FROM public.cook_nights WHERE household_id = %L AND cooks_on = %L', home, tue)) FROM ids

  -- D. Display names
  UNION ALL SELECT 40, 'she saves her name → Matt sees it', 'Sara',
         pg_temp.rr_scenario(her, ARRAY['@SELECT public.rr_set_my_display_name(''  Sara '')'],
           format('SELECT pg_temp.rr_seen_by(%L, %L)', matt,
             format('SELECT display_name FROM public.household_members WHERE user_id = %L', her))) FROM ids
  UNION ALL SELECT 41, 'saving her name leaves Matt''s alone', 'null',
         pg_temp.rr_scenario(her, ARRAY['@SELECT public.rr_set_my_display_name(''Sara'')'],
           format('SELECT display_name FROM public.household_members WHERE user_id = %L', matt)) FROM ids
  UNION ALL SELECT 42, 'a blank name clears it', 'null',
         pg_temp.rr_scenario(her, ARRAY['@SELECT public.rr_set_my_display_name(''Sara'')', '@SELECT public.rr_set_my_display_name(''   '')'],
           format('SELECT display_name FROM public.household_members WHERE user_id = %L', her)) FROM ids
  UNION ALL SELECT 43, 'a name over 30 characters is rejected', 'denied',
         pg_temp.rr_scenario(her, ARRAY[format('@SELECT public.rr_set_my_display_name(%L)', repeat('x', 31))],
           'SELECT ''saved''') FROM ids
  UNION ALL SELECT 44, 'she can''t write the membership table directly (e.g. Matt''s name)', 'denied',
         pg_temp.rr_scenario(her, ARRAY[format('@UPDATE public.household_members SET display_name = ''X'' WHERE user_id = %L', matt)],
           'SELECT ''saved''') FROM ids
  UNION ALL SELECT 45, 'an outsider can''t see their names', '0',
         pg_temp.rr_scenario(her, ARRAY['@SELECT public.rr_set_my_display_name(''Sara'')'],
           format('SELECT pg_temp.rr_seen_by(%L, %L)', other,
             format('SELECT count(*)::text FROM public.household_members WHERE household_id = %L', (SELECT home FROM ids)))) FROM ids
)
SELECT attempt, expected, actual, (expected = actual) AS pass FROM attempts ORDER BY ord;
