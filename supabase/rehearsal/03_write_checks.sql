-- =========================================================================
-- Rehearsal step 3 — can members WRITE what they should, and nothing else?
-- PREVIEW ONLY (uses the fake accounts from 01_seed_fake_accounts.sql).
-- Every attempt runs inside a savepoint that is rolled back, so this leaves
-- no data behind. Then ONE SELECT shows each attempt: expected vs actual.
-- =========================================================================
CREATE OR REPLACE FUNCTION pg_temp.rr_try(p_uid uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
    SET ROLE authenticated;
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION 'rr_rollback:%', n;          -- always undo the attempt
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', false);
    IF SQLERRM LIKE 'rr_rollback:%' THEN
      RETURN CASE WHEN split_part(SQLERRM, ':', 2) = '0' THEN 'no rows' ELSE 'ok' END;
    END IF;
    RETURN 'denied';
  END;
END $$;

-- Sign-up: a brand-new account gets its own solo household (the trigger).
CREATE OR REPLACE FUNCTION pg_temp.rr_signup_gets_household()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  BEGIN
    INSERT INTO auth.users (instance_id, id, aud, role, email)
    VALUES ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-0000000000aa',
            'authenticated', 'authenticated', 'signup-check@example.test');
    SELECT count(*) INTO n FROM public.household_members m JOIN public.households h ON h.id = m.household_id
    WHERE m.user_id = 'a0000000-0000-4000-8000-0000000000aa' AND h.created_for = m.user_id;
    RAISE EXCEPTION 'rr_rollback:%', n;          -- always undo
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'rr_rollback:%' THEN
      RETURN CASE WHEN split_part(SQLERRM, ':', 2) = '1' THEN 'ok' ELSE 'missing' END;
    END IF;
    RETURN 'error: ' || SQLERRM;
  END;
END $$;

WITH ids AS (
  SELECT 'a0000000-0000-4000-8000-000000000001'::uuid AS her,
         'a0000000-0000-4000-8000-000000000002'::uuid AS matt,
         'a0000000-0000-4000-8000-000000000003'::uuid AS other,
         (SELECT household_id FROM household_members WHERE user_id = 'a0000000-0000-4000-8000-000000000001') AS home,
         (SELECT household_id FROM household_members WHERE user_id = 'a0000000-0000-4000-8000-000000000003') AS other_home
),
attempts(ord, attempt, expected, actual) AS (
  SELECT 1, 'Matt adds a recipe (household filled in by default)', 'ok',
         pg_temp.rr_try(matt, format('INSERT INTO public.vault (user_id, name) VALUES (%L, ''Matt night pasta'')', matt)) FROM ids
  UNION ALL SELECT 2, 'Matt edits HER recipe', 'ok',
         pg_temp.rr_try(matt, 'UPDATE public.vault SET notes = ''edited by Matt'' WHERE id = ''b0000000-0000-4000-8000-000000000001''') FROM ids
  UNION ALL SELECT 3, 'Matt saves the shared preferences (upsert on household)', 'ok',
         pg_temp.rr_try(matt, format('INSERT INTO public.household_preferences (household_id, user_id, adults) VALUES (%L, %L, 2)
                                      ON CONFLICT (household_id) DO UPDATE SET adults = 3, user_id = EXCLUDED.user_id', home, matt)) FROM ids
  UNION ALL SELECT 4, 'Matt adds a tag option she already has → one shared row (conflict, no error)', 'no rows',
         pg_temp.rr_try(matt, format('INSERT INTO public.vault_options (household_id, user_id, category, value) VALUES (%L, %L, ''cuisine'', ''Thai'')
                                      ON CONFLICT DO NOTHING', home, matt)) FROM ids
  UNION ALL SELECT 5, 'Matt adds a grocery item to her list', 'ok',
         pg_temp.rr_try(matt, 'INSERT INTO public.grocery_list_items (list_id, name) VALUES (''d0000000-0000-4000-8000-000000000001'', ''Basil'')') FROM ids
  UNION ALL SELECT 6, 'Matt adds a recipe pretending SHE added it', 'denied',
         pg_temp.rr_try(matt, format('INSERT INTO public.vault (user_id, name) VALUES (%L, ''forged'')', her)) FROM ids
  UNION ALL SELECT 7, 'Matt adds a recipe into ANOTHER household', 'denied',
         pg_temp.rr_try(matt, format('INSERT INTO public.vault (household_id, user_id, name) VALUES (%L, %L, ''sneaky'')', other_home, matt)) FROM ids
  UNION ALL SELECT 8, 'Matt moves her recipe into another household', 'denied',
         pg_temp.rr_try(matt, format('UPDATE public.vault SET household_id = %L WHERE id = ''b0000000-0000-4000-8000-000000000001''', other_home)) FROM ids
  UNION ALL SELECT 9, 'Outsider edits her recipe (row is invisible → nothing changes)', 'no rows',
         pg_temp.rr_try(other, 'UPDATE public.vault SET notes = ''x'' WHERE id = ''b0000000-0000-4000-8000-000000000001''') FROM ids
  UNION ALL SELECT 10, 'Outsider deletes her grocery items', 'no rows',
         pg_temp.rr_try(other, 'DELETE FROM public.grocery_list_items WHERE list_id = ''d0000000-0000-4000-8000-000000000001''') FROM ids
  UNION ALL SELECT 11, 'Outsider adds an item to her list', 'denied',
         pg_temp.rr_try(other, 'INSERT INTO public.grocery_list_items (list_id, name) VALUES (''d0000000-0000-4000-8000-000000000001'', ''x'')') FROM ids
  UNION ALL SELECT 12, 'Anyone adds themselves to a household (no invite flow)', 'denied',
         pg_temp.rr_try(other, format('INSERT INTO public.household_members (household_id, user_id) VALUES (%L, %L)', home, other)) FROM ids
  UNION ALL SELECT 13, 'Matt plans a period overlapping one of HERS (one household → refused)', 'denied',
         pg_temp.rr_try(matt, format('INSERT INTO public.meal_plans (user_id, period_start, period_end) VALUES (%L, current_date - 6, current_date - 4)', matt)) FROM ids
  UNION ALL SELECT 14, 'A new sign-up gets its own solo household (trigger)', 'ok', pg_temp.rr_signup_gets_household()
)
SELECT attempt, expected, actual, (expected = actual) AS pass FROM attempts ORDER BY ord;
