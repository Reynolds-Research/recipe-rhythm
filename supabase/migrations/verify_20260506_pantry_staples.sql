-- Verification queries for 20260506000001_household_preferences_pantry_staples.sql
--
-- Run AFTER the main migration. Structural checks confirm the new column
-- exists with the expected shape and default. The smoke check confirms
-- existing rows received the default array.
--
-- Run the full file, or sections individually, in the Supabase SQL Editor.


-- =========================================================================
-- 1. household_preferences.pantry_staples — column exists, text[], NOT NULL
-- =========================================================================
-- Expected: 1 row | data_type = 'ARRAY' | is_nullable = 'NO'
--           column_default contains '{}'

SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'household_preferences'
  AND  column_name  = 'pantry_staples';


-- =========================================================================
-- 2. udt_name confirms the array element type is text
-- =========================================================================
-- Expected: 1 row | udt_name = '_text'  (PostgreSQL's internal name for text[])

SELECT column_name, udt_name
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'household_preferences'
  AND  column_name  = 'pantry_staples';


-- =========================================================================
-- 3. Existing rows: defaults applied (every row has pantry_staples = '{}')
-- =========================================================================
-- Expected: bad_default = 0
-- ADD COLUMN ... NOT NULL DEFAULT applies the default to all existing rows.

SELECT
  COUNT(*) FILTER (WHERE pantry_staples IS NOT NULL
                     AND  cardinality(pantry_staples) = 0) AS got_default,
  COUNT(*) FILTER (WHERE pantry_staples IS NULL
                      OR cardinality(pantry_staples) > 0)  AS bad_default,
  COUNT(*)                                                  AS total_rows
FROM public.household_preferences;
