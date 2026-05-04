-- PRD-006 P0.1: structured ingredients + household composition
--
-- See: docs/prds/PRD-006-structured-ingredients-and-household-scaling.md §P0.1
--
-- Adds four columns across two tables:
--
--   vault.ingredients_structured  — AI-parsed ingredient list (jsonb, nullable).
--   vault.servings                — AI-extracted recipe yield (int, nullable).
--   household_preferences.adults  — number of adults in household (int, NOT NULL, default 2).
--   household_preferences.children— number of children in household (int, NOT NULL, default 0).
--
-- Plus the CHECK constraint household_prefs_eater_counts_chk (adults >= 1,
-- children >= 0) on household_preferences.
--
-- No new tables, no new RLS policies: existing vault and household_preferences
-- owner-scoped policies already cover new columns on those tables.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; DO block guard for the CHECK constraint
-- (ADD CONSTRAINT IF NOT EXISTS requires PG17; the DO guard works on PG14+).
--
-- Reversibility (manual rollback, if ever needed):
--   ALTER TABLE public.household_preferences DROP CONSTRAINT IF EXISTS household_prefs_eater_counts_chk;
--   ALTER TABLE public.household_preferences DROP COLUMN IF EXISTS children;
--   ALTER TABLE public.household_preferences DROP COLUMN IF EXISTS adults;
--   ALTER TABLE public.vault DROP COLUMN IF EXISTS servings;
--   ALTER TABLE public.vault DROP COLUMN IF EXISTS ingredients_structured;


-- =========================================================================
-- 1. vault: ingredients_structured
-- =========================================================================
-- NULL sentinel = "not yet parsed" or "parse failed; needs retry".
-- Shape: [{name, quantity, unit, notes?}]
-- The human-readable vault.ingredients text[] remains the source of truth.
-- ingredients_structured is AI-populated; it is backfilled in Bite β and
-- re-parsed on ingredients edit in Bite γ (PRD-006 P0.7).

ALTER TABLE public.vault
  ADD COLUMN IF NOT EXISTS ingredients_structured jsonb;

COMMENT ON COLUMN public.vault.ingredients_structured IS
  'PRD-006 P0.1: AI-parsed ingredient list. NULL = not yet parsed or parse failed (backfill scheduled). Shape: [{name: text, quantity: text|null, unit: text|null, notes: text|null}]. The human-readable vault.ingredients text[] remains the source of truth; this column is derived from it (re-parsed on ingredients edit in PRD-006 P0.7 Bite γ). Existing vault RLS policies cover this column — no policy changes required.';


-- =========================================================================
-- 2. vault: servings
-- =========================================================================
-- AI-extracted recipe yield. NULL = AI couldn't infer; caller should use
-- default_servings fallback (household_preferences.adults in Bite γ, or
-- the hardcoded fallback of 4 in Bite α).

ALTER TABLE public.vault
  ADD COLUMN IF NOT EXISTS servings int;

COMMENT ON COLUMN public.vault.servings IS
  'PRD-006 P0.1: AI-extracted recipe yield (number of portions). NULL = AI could not infer from the recipe text; callers should fall back to household_preferences.adults (wired in Bite γ) or the hardcoded default of 4. Populated by /api/analyze-recipe (Bite α) on new recipe saves; Bite β backfill script covers existing rows.';


-- =========================================================================
-- 3. household_preferences: adults
-- =========================================================================

ALTER TABLE public.household_preferences
  ADD COLUMN IF NOT EXISTS adults int NOT NULL DEFAULT 2;

COMMENT ON COLUMN public.household_preferences.adults IS
  'PRD-006 P0.1: number of adults in the household. Drives the default serving-size multiplier for grocery list scaling (Bite γ). Default 2. CHECK constraint household_prefs_eater_counts_chk enforces >= 1.';


-- =========================================================================
-- 4. household_preferences: children
-- =========================================================================

ALTER TABLE public.household_preferences
  ADD COLUMN IF NOT EXISTS children int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.household_preferences.children IS
  'PRD-006 P0.1: number of children in the household. Combined with adults to compute total household size for grocery scaling (Bite γ). Default 0. CHECK constraint household_prefs_eater_counts_chk enforces >= 0.';


-- =========================================================================
-- 5. CHECK constraint: adults >= 1 AND children >= 0
-- =========================================================================
-- DO block for idempotency: ADD CONSTRAINT IF NOT EXISTS requires PG17;
-- the pg_constraint guard works on PG14+ (Supabase uses PG15).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname   = 'household_prefs_eater_counts_chk'
      AND  conrelid  = 'public.household_preferences'::regclass
  ) THEN
    ALTER TABLE public.household_preferences
      ADD CONSTRAINT household_prefs_eater_counts_chk
      CHECK (adults >= 1 AND children >= 0);
  END IF;
END $$;
