-- PRD-004 Phase A (P0.1): Smarter ingredient filtering — foundation column
--
-- See: docs/prds/PRD-004-smarter-ingredient-filtering.md §"Phase A"
--      docs/adr/ADR-002-ingredient-classification.md
--
-- Adds vault.ingredients_classified: AI-classified essentiality of each
-- ingredient (or category-level ingredient name) for the recipe. Shape:
--   [{name: string, essentiality: 'essential' | 'omittable', source: 'ai' | 'user'}, ...]
-- NULL = not yet classified. The bulk-backfill script
-- (scripts/backfill-ingredients-classification.js) populates existing rows
-- via /api/classify-ingredients (Haiku 4.5).
--
-- Phase A is foundation only: no read/write of this column from the client
-- yet, no change to passesPreferences. Phase C (P0.7) flips the filter.
--
-- RLS: vault already has owner-scoped per-operation policies keyed on
-- auth.uid() = user_id (see docs/schema.md §RLS). Adding a column does not
-- change row visibility — existing policies cover the new column. No
-- policy work required for this migration.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS guards re-runs.

ALTER TABLE vault
  ADD COLUMN IF NOT EXISTS ingredients_classified jsonb;

COMMENT ON COLUMN vault.ingredients_classified IS
  'PRD-004 / ADR-002: AI-classified ingredient essentiality. Shape: [{name, essentiality, source}, ...] where essentiality in (essential, omittable) and source in (ai, user). NULL until the row has been classified by /api/classify-ingredients (one-time backfill or, in Phase C, on save). Drives the smarter excluded-ingredients filter — see src/lib/preferenceFilter.js (post-Phase C).';
