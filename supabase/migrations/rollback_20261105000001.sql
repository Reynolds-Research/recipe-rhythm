-- =========================================================================
-- Rollback: 20261105000001_vault_ingredients_source
-- Puts the database back exactly as it was before the migration.
-- Loses only the "screenshot / estimated" labels — no ingredients, no recipes.
-- =========================================================================
BEGIN;

ALTER TABLE public.vault
  DROP CONSTRAINT IF EXISTS vault_ingredients_source_valid,
  DROP COLUMN IF EXISTS ingredients_source;

COMMIT;

-- Expect one row: false.
SELECT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'vault'
                  AND column_name = 'ingredients_source') AS ingredients_source_left;
