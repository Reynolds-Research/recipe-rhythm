-- =========================================================================
-- Migration: 20261107000001_vault_ingredients_source_page
-- Recipe ingredients read from the recipe's own page.
-- Undo: rollback_20261107000001.sql. Verify: verify_20261107000001.sql.
-- =========================================================================
--
-- Mental model: vault.ingredients_source says where a recipe's ingredient
-- list came from. Until now: 'screenshot' (her screenshots) or 'estimated'
-- (the AI's guess from the name). Recipe links were saved but never opened
-- (found 2026-11-06), so most lists were guesses. The app now opens the link
-- and copies the list from the page; it records that as a third value:
--
--   'page'  read from the recipe page at vault.recipe_url (the real recipe)
--
-- Only the allowed-values rule changes. No row changes. Security rules are
-- unchanged (the vault's household rules cover every column).
--
-- Apply BEFORE deploying the app that writes 'page' (or the write is refused).
-- Idempotent: the constraint is dropped and re-added.
ALTER TABLE public.vault
  DROP CONSTRAINT IF EXISTS vault_ingredients_source_valid;
ALTER TABLE public.vault
  ADD CONSTRAINT vault_ingredients_source_valid
  CHECK (ingredients_source IS NULL OR ingredients_source IN ('screenshot', 'page', 'estimated'));

COMMENT ON COLUMN public.vault.ingredients_source IS
  'Where ingredients_structured came from: screenshot (read from her screenshots), page (read from the recipe page at recipe_url) or estimated (AI guess from the name). NULL = unknown (saved before 2026-11-05).';
