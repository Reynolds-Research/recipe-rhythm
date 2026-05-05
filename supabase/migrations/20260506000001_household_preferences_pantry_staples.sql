-- PRD-003 P0.2: household_preferences.pantry_staples
--
-- See: docs/prds/PRD-003-grocery-tracking.md §P0.2
--
-- Adds a single column on household_preferences holding the user's pantry
-- staples — items they always have on hand and want skipped from generated
-- grocery lists. Mirrors excluded_ingredients in shape and policy:
--
--   - text[] NOT NULL DEFAULT '{}'  — read path stays branch-free.
--   - Vocabulary is free-text; no DB-level CHECK enum. App-level
--     normalization (trim + lowercase + dedupe) lives in
--     src/lib/preferences.js, mirroring normalizeIngredients() for
--     excluded_ingredients.
--
-- /api/grocery-list already accepts a pantryStaples parameter (PRD-003
-- P0.3, Bite C-1). The page is currently sending []; this column is
-- where the actual values come from after this migration.
--
-- No new RLS work: the existing owner-scoped policies on
-- household_preferences cover the new column.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
--
-- Reversibility (manual rollback, if ever needed):
--   ALTER TABLE public.household_preferences DROP COLUMN IF EXISTS pantry_staples;


-- =========================================================================
-- 1. household_preferences: pantry_staples
-- =========================================================================

ALTER TABLE public.household_preferences
  ADD COLUMN IF NOT EXISTS pantry_staples text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.household_preferences.pantry_staples IS
  'PRD-003 P0.2: array of free-text ingredient strings the user always has on hand. Skipped from generated grocery lists. Normalized in src/lib/preferences.js before write: trim + lowercase + dedupe (same pattern as excluded_ingredients). No app-side vocabulary check — the substring filter in /api/grocery-list is intentionally permissive ("salt" matches "kosher salt"). Existing owner-scoped RLS policies cover this column.';
