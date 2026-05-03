-- Verification queries for 20260502000001_grocery_lists_schema.sql
--
-- Run AFTER the main migration. Read-only structural checks only — mirrors
-- the pattern of prior verify_* files. Behavioral testing (does the CHECK
-- actually reject bad input? does the unique partial index actually block
-- duplicates? does RLS actually deny cross-user reads?) is covered by Vitest
-- + e2e tests at the application layer, not here.
--
-- Run the full file, or sections individually, in the Supabase SQL Editor.


-- =========================================================================
-- 1. grocery_lists — column shapes
-- =========================================================================
-- Expected: six rows for id, user_id, meal_plan_id, share_token,
-- created_at, updated_at. Note: is_nullable = YES for meal_plan_id,
-- share_token. column_default for id = gen_random_uuid(), for
-- created_at/updated_at = now().

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'grocery_lists'
ORDER BY ordinal_position;


-- =========================================================================
-- 2. grocery_list_items — column shapes
-- =========================================================================
-- Expected: eight rows for id, list_id, name, quantity, section,
-- is_bought, is_adhoc, created_at. quantity is nullable; all others NOT NULL.
-- section default = 'Other'; is_bought default = false; is_adhoc default = false.

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'grocery_list_items'
ORDER BY ordinal_position;


-- =========================================================================
-- 3. grocery_lists — RLS enabled
-- =========================================================================
-- Expected: relrowsecurity = true for grocery_lists.

SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'grocery_lists'
  AND relnamespace = 'public'::regnamespace;


-- =========================================================================
-- 4. grocery_list_items — RLS enabled
-- =========================================================================
-- Expected: relrowsecurity = true for grocery_list_items.

SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'grocery_list_items'
  AND relnamespace = 'public'::regnamespace;


-- =========================================================================
-- 5. grocery_lists — all six policies present
-- =========================================================================
-- Expected: five rows —
--   grocery_lists_delete_own     (d / authenticated)
--   grocery_lists_insert_own     (a / authenticated)
--   grocery_lists_public_share   (r / anon)
--   grocery_lists_select_own     (r / authenticated)
--   grocery_lists_update_own     (w / authenticated)

SELECT
  polname,
  polcmd,
  pg_get_expr(polqual,      polrelid) AS using_expr,
  pg_get_expr(polwithcheck, polrelid) AS with_check_expr
FROM pg_policy
WHERE polrelid = 'public.grocery_lists'::regclass
ORDER BY polname;


-- =========================================================================
-- 6. grocery_list_items — all five policies present
-- =========================================================================
-- Expected: five rows —
--   grocery_list_items_delete_own
--   grocery_list_items_insert_own
--   grocery_list_items_public_share
--   grocery_list_items_select_own
--   grocery_list_items_update_own

SELECT
  polname,
  polcmd,
  pg_get_expr(polqual,      polrelid) AS using_expr,
  pg_get_expr(polwithcheck, polrelid) AS with_check_expr
FROM pg_policy
WHERE polrelid = 'public.grocery_list_items'::regclass
ORDER BY polname;


-- =========================================================================
-- 7. grocery_lists — indexes
-- =========================================================================
-- Expected: three index rows —
--   grocery_lists_pkey              (primary key on id)
--   grocery_lists_user_idx          (on user_id)
--   grocery_lists_user_plan_idx     (unique partial, on user_id + meal_plan_id
--                                    WHERE meal_plan_id IS NOT NULL)
-- Also expect: grocery_lists_share_token_key (unique on share_token).

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'grocery_lists'
  AND schemaname = 'public'
ORDER BY indexname;


-- =========================================================================
-- 8. grocery_list_items — indexes
-- =========================================================================
-- Expected: two index rows —
--   grocery_list_items_pkey         (primary key on id)
--   grocery_list_items_list_idx     (on list_id)

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'grocery_list_items'
  AND schemaname = 'public'
ORDER BY indexname;


-- =========================================================================
-- 9. grocery_list_items CHECK constraint definition
-- =========================================================================
-- Expected: one row, conname = 'grocery_list_items_section_valid', and the
-- definition contains all eight section values from GROCERY_SECTIONS:
-- Produce, Meat & Seafood, Dairy, Pantry, Frozen, Bakery, Beverages, Other.

SELECT
  con.conname,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class      tbl ON tbl.oid = con.conrelid
WHERE tbl.relname = 'grocery_list_items'
  AND con.contype = 'c';


-- =========================================================================
-- 10. Smoke: both tables start empty
-- =========================================================================
-- Expected: 0 rows in each table immediately after migration.

SELECT 'grocery_lists'      AS tbl, COUNT(*) AS row_count FROM public.grocery_lists
UNION ALL
SELECT 'grocery_list_items' AS tbl, COUNT(*) AS row_count FROM public.grocery_list_items;
