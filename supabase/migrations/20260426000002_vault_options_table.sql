-- ============================================================================
-- PRD-001 Phase 2 Step 3 (P0.7): persist custom chip-picker tags
-- ============================================================================
-- See: docs/prds/PRD-001-recipe-vault-and-cooking-record.md §6 P0.7 + §7 Migration D
-- See: docs/prompts/prd-001-phase-2-data-hygiene.md §Step 3
-- See: docs/prompts/prd-001-phase-2-step-3-vault-options-and-closeout.md
--
-- Replaces the previous vault_extra_* localStorage scheme. Per-user, per-
-- category, per-value custom tags. RLS owner-scoped on user_id, mirroring
-- meals / vault / meal_plan_items. Safe to re-run.
--
-- Why move off localStorage?
--   localStorage is per-device, per-browser, per-profile. The instant the
--   user clears site data, opens incognito, or signs in on a new phone,
--   their custom tags vanish. Persisting in Postgres + RLS gives us the
--   same one-user-many-devices semantics the rest of the app already has.
--
-- One-time client migration: src/lib/vaultOptions.js#migrateLocalStorageExtras
-- runs on Vault mount, upserts any pre-existing vault_extra_* values, then
-- clears the localStorage keys so it can't run twice.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, drop-then-create policies. Re-
-- running this migration is a no-op.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vault_options (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category   text        NOT NULL CHECK (category IN (
    'cuisine_type', 'flavor_profile', 'proteins',
    'cooking_method', 'main_carb', 'dietary_tags',
    'dairy_components', 'vegetables', 'fruits'
  )),
  value      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category, value)
);

COMMENT ON TABLE public.vault_options IS
  'PRD-001 P0.7: user-managed custom values for vault chip-pickers. Replaces the
   pre-2026-04-26 vault_extra_* localStorage scheme. One row per (user, category,
   value). Built-in option lists live in src/lib/constants.js; this table holds
   only user additions on top of those.';

ALTER TABLE public.vault_options ENABLE ROW LEVEL SECURITY;

-- Drop-then-create so the migration is safe to re-run on a DB that already
-- has earlier versions of these policies under the same names.
DROP POLICY IF EXISTS vault_options_select_own ON public.vault_options;
DROP POLICY IF EXISTS vault_options_insert_own ON public.vault_options;
DROP POLICY IF EXISTS vault_options_update_own ON public.vault_options;
DROP POLICY IF EXISTS vault_options_delete_own ON public.vault_options;

CREATE POLICY vault_options_select_own ON public.vault_options
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY vault_options_insert_own ON public.vault_options
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY vault_options_update_own ON public.vault_options
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY vault_options_delete_own ON public.vault_options
  FOR DELETE USING (auth.uid() = user_id);
