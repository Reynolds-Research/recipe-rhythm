-- =========================================================================
-- Migration: 20261105000001_vault_ingredients_source
-- Recipe ingredients: where a recipe's ingredient list came from.
-- Undo: rollback_20261105000001.sql. Verify: verify_20261105000001.sql.
-- =========================================================================
--
-- Mental model: a recipe's ingredient list (vault.ingredients_structured) is
-- either read from screenshots of the real recipe, or the AI's best guess from
-- the recipe's name and link. The Cookbook says which, so "estimated" amounts
-- are never mistaken for the real recipe, and a screenshot can replace them.
--
--   'screenshot'  read from screenshots she added (the real recipe)
--   'estimated'   the AI's guess from the name (and link text; it can't open links)
--   NULL          not known (every recipe saved before this migration)
--
-- Additive and nullable: nothing reads it until the app ships, and no
-- existing row changes. Security rules are unchanged (the vault's household
-- rules cover every column).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; the constraint is dropped and re-added.

ALTER TABLE public.vault
  ADD COLUMN IF NOT EXISTS ingredients_source text;

ALTER TABLE public.vault
  DROP CONSTRAINT IF EXISTS vault_ingredients_source_valid;
ALTER TABLE public.vault
  ADD CONSTRAINT vault_ingredients_source_valid
  CHECK (ingredients_source IS NULL OR ingredients_source IN ('screenshot', 'estimated'));

COMMENT ON COLUMN public.vault.ingredients_source IS
  'Where ingredients_structured came from: screenshot (read from her screenshots) or estimated (AI guess from the name). NULL = unknown (saved before 2026-11-05).';
