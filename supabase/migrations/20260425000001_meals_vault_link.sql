-- PRD-001 Phase 1 (P0.1): Restore the meals → vault link
--
-- See: docs/prds/PRD-001-recipe-vault-and-cooking-record.md §6 P0.1 + §7 Migration A
--
-- This migration:
--   1. Enables pg_trgm (used by the vault_fuzzy_match RPC defined in step 4)
--   2. Adds meals.vault_id (uuid, nullable) referencing vault(id) ON DELETE SET NULL
--      so the recommendation engine in src/lib/recommendations.js stops operating
--      on near-zero signal. Existing rows safely default to NULL.
--   3. Adds an index on (user_id, vault_id) to support the recommendation queries
--      that filter recent meals by user + then group by vault_id for frequency.
--   4. Defines the vault_fuzzy_match RPC used by src/lib/vaultMatch.js to filter
--      similar vault rows server-side via the trigram threshold.
--
-- ON DELETE SET NULL mirrors the existing meal_plan_items.vault_id contract added
-- by 20260418000001_planning_periods_schema.sql. Soft-delete on vault is PRD-001
-- P0.5 (a future Phase 2 item) and won't change this contract — it lets a deleted
-- recipe blank out its FK references rather than cascading the delete to history.
--
-- Idempotent: safe to re-run. All statements are guarded with IF NOT EXISTS or
-- CREATE OR REPLACE.

-- =========================================================================
-- 1. Extensions
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- =========================================================================
-- 2. meals.vault_id column
-- =========================================================================

ALTER TABLE meals
  ADD COLUMN IF NOT EXISTS vault_id uuid REFERENCES vault(id) ON DELETE SET NULL;

COMMENT ON COLUMN meals.vault_id IS
  'PRD-001 P0.1: links a logged meal to the Vault recipe it represents. NULL when no match was found at log time, or when the linked vault row was deleted (ON DELETE SET NULL). Drives frequency/recency scoring in src/lib/recommendations.js.';


-- =========================================================================
-- 3. Index for the recommendation engine
-- =========================================================================
--
-- Recommendations.js scopes meals by user_id, then groups by vault_id. The
-- composite (user_id, vault_id) index lets Postgres pick the right rows
-- without a full meals scan once vault_id is densely populated.

CREATE INDEX IF NOT EXISTS meals_user_vault_idx
  ON meals (user_id, vault_id);


-- =========================================================================
-- 4. vault_fuzzy_match RPC
-- =========================================================================
--
-- Used by src/lib/vaultMatch.js to find candidate vault rows whose name has
-- pg_trgm similarity to the query >= the threshold.
--
-- SECURITY INVOKER (the default) means RLS on `vault` still applies — the
-- function only returns rows the calling user is allowed to read. Combined
-- with the explicit `user_id = p_user_id` filter this is double-belted.
--
-- Threshold default 0.6 is the PRD-001 OQ.A starting point; callers may pass
-- a different value to tune sensitivity later.

CREATE OR REPLACE FUNCTION vault_fuzzy_match(
  p_user_id   uuid,
  p_query     text,
  p_threshold real DEFAULT 0.6
)
RETURNS TABLE (id uuid, name text, image_url text, similarity real)
LANGUAGE sql STABLE
AS $$
  SELECT id, name, image_url, similarity(name, p_query) AS similarity
  FROM vault
  WHERE user_id = p_user_id
    AND similarity(name, p_query) >= p_threshold
  ORDER BY similarity DESC
  LIMIT 5;
$$;

COMMENT ON FUNCTION vault_fuzzy_match(uuid, text, real) IS
  'PRD-001 P0.2: returns up to 5 vault rows whose name has pg_trgm similarity >= p_threshold to p_query. SECURITY INVOKER — RLS on vault still applies.';
