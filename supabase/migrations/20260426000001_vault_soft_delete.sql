-- PRD-001 Phase 2 Step 1 (P0.5): Vault soft-delete
--
-- See: docs/prds/PRD-001-recipe-vault-and-cooking-record.md §6 P0.5 + §7 Migration B
-- See: docs/prompts/prd-001-phase-2-data-hygiene.md §Step 1
--
-- This migration:
--   1. Adds vault.deleted_at (timestamptz, nullable). NULL = active recipe;
--      non-NULL = soft-deleted (preserved for historical references in
--      meals.vault_id and meal_plan_items.vault_id).
--   2. Adds a partial index on (user_id) WHERE deleted_at IS NULL — keeps
--      the active-row queries fast as soft-deleted rows accumulate.
--   3. Updates the vault_fuzzy_match RPC to filter out soft-deleted rows
--      so LogMode's auto-link (which delegates to this RPC via
--      src/lib/vaultMatch.js) never matches a deleted recipe.
--
-- Why soft-delete?
--   meal_plan_items.vault_id and meals.vault_id both point to vault. A hard
--   DELETE would either cascade (losing history) or null out the FK (losing
--   the ability to render the recipe's image_url / metadata in history
--   views). Soft-delete preserves the row so historical references still
--   resolve, and gives us optional future affordances like "Trash" / "Undo
--   delete" without a schema change.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- DROP FUNCTION IF EXISTS + CREATE OR REPLACE FUNCTION. Re-running this
-- migration is a no-op.

-- =========================================================================
-- 1. vault.deleted_at column
-- =========================================================================

ALTER TABLE vault
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN vault.deleted_at IS
  'PRD-001 P0.5: soft-delete timestamp. NULL = active; non-NULL = deleted (preserved for historical references in meals.vault_id and meal_plan_items.vault_id). All client-side Vault SELECTs filter `WHERE deleted_at IS NULL`.';


-- =========================================================================
-- 2. Partial index for active rows
-- =========================================================================
--
-- Most queries are scoped by user_id and only want active rows. A partial
-- index excluding soft-deleted rows means deleted rows don't bloat the
-- index and lookups stay fast even after years of soft-deletes accumulate.

CREATE INDEX IF NOT EXISTS vault_user_active_idx
  ON vault (user_id)
  WHERE deleted_at IS NULL;


-- =========================================================================
-- 3. Update vault_fuzzy_match RPC to respect soft-delete
-- =========================================================================
--
-- The RPC was created in Phase 1 (20260425000001_meals_vault_link.sql) with
-- output columns (match_id, match_name, image_url, similarity) — `id` and
-- `name` got the `match_` prefix to dodge an OUT-vs-table-column ambiguity
-- Postgres flagged in LANGUAGE sql functions; `image_url` was left
-- un-prefixed because it didn't trigger the ambiguity. We keep that exact
-- signature here (CREATE OR REPLACE rejects column-name changes; PR #26
-- had to fix exactly that error).
--
-- The only behavior change: add `AND v.deleted_at IS NULL` to the WHERE
-- clause so soft-deleted recipes never appear in fuzzy-match results.
--
-- DROP first: kept for parity with Phase 1's pattern and so this migration
-- is safe to re-run from any prior state, even if someone manually altered
-- the function out-of-band.

DROP FUNCTION IF EXISTS vault_fuzzy_match(uuid, text, real);

CREATE OR REPLACE FUNCTION vault_fuzzy_match(
  p_user_id   uuid,
  p_query     text,
  p_threshold real DEFAULT 0.6
)
RETURNS TABLE (
  match_id   uuid,
  match_name text,
  image_url  text,
  similarity real
)
LANGUAGE sql STABLE
AS $$
  SELECT v.id, v.name, v.image_url, similarity(v.name, p_query)
  FROM public.vault v
  WHERE v.user_id = p_user_id
    AND v.deleted_at IS NULL
    AND similarity(v.name, p_query) >= p_threshold
  ORDER BY similarity(v.name, p_query) DESC
  LIMIT 5;
$$;

COMMENT ON FUNCTION vault_fuzzy_match(uuid, text, real) IS
  'PRD-001 P0.2 (P0.5 soft-delete filter added): up to 5 vault rows whose name has pg_trgm similarity >= p_threshold to p_query, excluding soft-deleted rows. SECURITY INVOKER — RLS on vault still applies.';
