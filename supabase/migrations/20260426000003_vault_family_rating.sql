-- PRD-001 P1.1: Family rating field on vault
--
-- See: docs/prds/PRD-001-recipe-vault-and-cooking-record.md §6 P1.1 + §7 Migration C
--
-- Adds vault.family_rating: a 1-5 integer (smallint) rating, nullable, with a
-- CHECK constraint enforcing the 1..5 range. Existing rows default to NULL
-- ("not yet rated"). The rating is a single shared household value until
-- partner-collab decides otherwise (see PRD-001 §4 non-goals + the future
-- partner-collab ADR).
--
-- This unblocks PRD-002 (Meal Planning) which uses the rating as a "family hits"
-- ranking signal for the brainstorm surface.
--
-- Naming: smallint (rather than int) because we'll never need more than 5.
-- A 2-byte column saves a small amount per row over plain `int` and signals
-- intent.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS guards the column add. The CHECK
-- constraint is added inline so the IF NOT EXISTS guards both the column
-- and its constraint. Re-running this migration is a no-op.

-- =========================================================================
-- 1. vault.family_rating column
-- =========================================================================

ALTER TABLE vault
  ADD COLUMN IF NOT EXISTS family_rating smallint
    CHECK (family_rating IS NULL OR (family_rating BETWEEN 1 AND 5));

COMMENT ON COLUMN vault.family_rating IS
  'PRD-001 P1.1: 1-5 household rating on a Vault recipe. NULL = not yet rated. Drives the "family hits" signal that PRD-002 (Meal Planning) uses to rank brainstorm suggestions.';
