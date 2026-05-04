-- Verification queries for 20260503000001_structured_ingredients_and_household.sql
--
-- Run AFTER the main migration. Structural checks confirm columns, constraint,
-- and defaults. The one behavioral check (CHECK rejects adults = 0) uses a DO
-- block that always raises an error and rolls back — no state change survives.
--
-- Run the full file, or sections individually, in the Supabase SQL Editor.


-- =========================================================================
-- 1. vault.ingredients_structured — column exists, jsonb, nullable
-- =========================================================================
-- Expected: 1 row | data_type = 'jsonb' | is_nullable = 'YES'

SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'vault'
  AND  column_name  = 'ingredients_structured';


-- =========================================================================
-- 2. vault.servings — column exists, integer, nullable
-- =========================================================================
-- Expected: 1 row | data_type = 'integer' | is_nullable = 'YES'

SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'vault'
  AND  column_name  = 'servings';


-- =========================================================================
-- 3. household_preferences.adults — NOT NULL, default 2
-- =========================================================================
-- Expected: 1 row | data_type = 'integer' | is_nullable = 'NO'
--           column_default contains '2'

SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'household_preferences'
  AND  column_name  = 'adults';


-- =========================================================================
-- 4. household_preferences.children — NOT NULL, default 0
-- =========================================================================
-- Expected: 1 row | data_type = 'integer' | is_nullable = 'NO'
--           column_default contains '0'

SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'household_preferences'
  AND  column_name  = 'children';


-- =========================================================================
-- 5. CHECK constraint exists on household_preferences
-- =========================================================================
-- Expected: 1 row with conname = 'household_prefs_eater_counts_chk'

SELECT conname,
       pg_get_constraintdef(oid) AS definition
FROM   pg_constraint
WHERE  conrelid = 'public.household_preferences'::regclass
  AND  conname  = 'household_prefs_eater_counts_chk';


-- =========================================================================
-- 6. CHECK constraint rejects adults = 0 (behavioral test — always rolls back)
-- =========================================================================
-- Expected: NOTICE "CHECK constraint correctly rejected adults=0 — PASS"
-- If you see the EXCEPTION message instead, the constraint is missing.

DO $$
BEGIN
  INSERT INTO public.household_preferences (user_id, adults, children)
  VALUES ('00000000-0000-0000-0000-000000000099'::uuid, 0, 0);
  RAISE EXCEPTION 'CHECK should have rejected adults=0 but did not — FAIL';
EXCEPTION
  WHEN check_violation THEN
    RAISE NOTICE 'CHECK constraint correctly rejected adults=0 — PASS';
  WHEN unique_violation THEN
    -- The sentinel UUID already exists (re-run); re-test via UPDATE.
    BEGIN
      UPDATE public.household_preferences
         SET adults = 0
       WHERE user_id = '00000000-0000-0000-0000-000000000099'::uuid;
      RAISE EXCEPTION 'CHECK should have rejected adults=0 on UPDATE but did not — FAIL';
    EXCEPTION
      WHEN check_violation THEN
        RAISE NOTICE 'CHECK constraint correctly rejected adults=0 on UPDATE — PASS';
    END;
END $$;


-- =========================================================================
-- 7. Existing vault rows: ingredients_structured = NULL, servings = NULL
-- =========================================================================
-- Expected: unexpected_structured = 0, unexpected_servings = 0
-- (The migration is additive; it does not backfill existing rows.
--  Bite β backfill script populates these for existing recipes.)

SELECT
  COUNT(*) FILTER (WHERE ingredients_structured IS NOT NULL) AS unexpected_structured,
  COUNT(*) FILTER (WHERE servings IS NOT NULL)               AS unexpected_servings,
  COUNT(*)                                                    AS total_vault_rows
FROM public.vault;


-- =========================================================================
-- 8. Existing household_preferences rows: defaults applied
-- =========================================================================
-- Expected: bad_adults_default = 0, bad_children_default = 0
-- ADD COLUMN … NOT NULL DEFAULT applies the default to all existing rows.

SELECT
  COUNT(*) FILTER (WHERE adults   != 2) AS bad_adults_default,
  COUNT(*) FILTER (WHERE children != 0) AS bad_children_default,
  COUNT(*)                               AS total_prefs_rows
FROM public.household_preferences;
