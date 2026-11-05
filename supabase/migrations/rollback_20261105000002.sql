-- =========================================================================
-- Rollback: 20261105000002_grocery_items_shop_amounts
-- Puts the database back exactly as it was before the migration.
-- Loses only the recipe totals and the "assumed" marks; every item, with its
-- buy amount, stays. (Assumed items then show as ordinary list items.)
-- =========================================================================
BEGIN;

ALTER TABLE public.grocery_list_items
  DROP COLUMN IF EXISTS recipe_quantity,
  DROP COLUMN IF EXISTS assumed;

COMMIT;

-- Expect one row: 0.
SELECT count(*) AS columns_left FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'grocery_list_items'
   AND column_name IN ('recipe_quantity', 'assumed');
