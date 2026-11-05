-- =========================================================================
-- Migration: 20261105000002_grocery_items_shop_amounts
-- Grocery list: what to buy vs. what the recipes use, and "Assumed you have".
-- Undo: rollback_20261105000002.sql. Verify: verify_20261105000002.sql.
-- =========================================================================
--
-- Mental model: each grocery line now carries two amounts.
--   quantity         what to buy, in store units ("1¼ lb", "1 bag (5 oz)")
--                    — the same column every screen already shows, so old
--                    screens show store amounts with no change
--   recipe_quantity  what the week's recipes use in total ("1⅛ lb"); NULL =
--                    not known (every list made before this migration)
--   assumed          TRUE = a cupboard item she probably has (spices, oils,
--                    sauces). Shown under "Assumed you have", not on the list,
--                    until she taps Add (which sets it FALSE).
--
-- Additive: existing rows get recipe_quantity NULL and assumed FALSE, which
-- is exactly how they show today. Security rules are unchanged (the item
-- rules cover every column).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.grocery_list_items
  ADD COLUMN IF NOT EXISTS recipe_quantity text,
  ADD COLUMN IF NOT EXISTS assumed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.grocery_list_items.recipe_quantity IS
  'What the recipes use in total (e.g. "1⅛ lb"); quantity is what to buy. NULL = unknown (lists before 2026-11-05).';
COMMENT ON COLUMN public.grocery_list_items.assumed IS
  'TRUE = cupboard item she probably has; shown under "Assumed you have" until she adds it.';
