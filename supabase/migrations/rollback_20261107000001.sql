-- =========================================================================
-- Rollback: 20261107000001_vault_ingredients_source_page
-- Puts the allowed values back to screenshot / estimated.
-- Recipes already read from their page keep their ingredient list; only the
-- label changes, to NULL ("not known"), because the old rule has no 'page'.
-- (The app then treats them as guesses again; reading the links would put
-- 'page' back once the migration is re-applied.)
-- =========================================================================
BEGIN;

UPDATE public.vault SET ingredients_source = NULL WHERE ingredients_source = 'page';

ALTER TABLE public.vault
  DROP CONSTRAINT IF EXISTS vault_ingredients_source_valid;
ALTER TABLE public.vault
  ADD CONSTRAINT vault_ingredients_source_valid
  CHECK (ingredients_source IS NULL OR ingredients_source IN ('screenshot', 'estimated'));

COMMENT ON COLUMN public.vault.ingredients_source IS
  'Where ingredients_structured came from: screenshot (read from her screenshots) or estimated (AI guess from the name). NULL = unknown (saved before 2026-11-05).';

COMMIT;

-- Expect one row: false (the rule no longer mentions page).
SELECT pg_get_constraintdef(oid) LIKE '%page%' AS allows_page
  FROM pg_constraint WHERE conrelid = 'public.vault'::regclass AND conname = 'vault_ingredients_source_valid';
