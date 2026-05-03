-- PRD-003 P0.1: grocery_lists + grocery_list_items schema
--
-- See: docs/prds/PRD-003-grocery-tracking.md §6 P0.1 + §7 Data Model
--
-- Creates two tables that form the foundation for the in-app grocery-list
-- feature. No API endpoint, no UI — schema + RLS only (Phase 1 foundation).
--
-- Key design decisions (see PRD-003 for full rationale):
--   - share_token is nullable text (unique); NULL = not shared. Populated only
--     when the user generates a share link (Phase 3 P0.9). Revoke = SET NULL.
--   - meal_plan_id FK uses ON DELETE SET NULL: the grocery list survives plan
--     deletion (the items are still useful even if the plan is gone).
--   - Unique partial index on (user_id, meal_plan_id) WHERE meal_plan_id IS NOT
--     NULL prevents two lists for the same plan while still allowing multiple
--     ad-hoc lists (meal_plan_id IS NULL). The partial index intentionally
--     excludes the NULL case — future-proofing for multi-list-per-user.
--   - quantity is free-text (OQ.A resolved): AI output verbatim ("2 lbs",
--     "1 bunch"). Structured {value, unit} is a P2 migration.
--   - section CHECK constraint mirrors GROCERY_SECTIONS in src/lib/constants.js
--     (defense in depth — app-level validation is the first gate, DB is the
--     second). Adding a new section requires both a constants.js change AND a
--     migration to relax/replace this CHECK.
--   - Public-via-token RLS: the application validates the token in the query
--     (WHERE share_token = :token). RLS only checks that share_token IS NOT
--     NULL — any row with a non-null token is visible to the anon role. Token
--     is never returned in bulk queries (the app always queries by specific
--     token value).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DO-block guards for trigger + constraint. DROP POLICY IF EXISTS before each
-- CREATE POLICY. CREATE INDEX IF NOT EXISTS. Safe to re-run.
--
-- Reversibility (manual rollback, if ever needed):
--   DROP TRIGGER IF EXISTS grocery_lists_set_updated_at ON grocery_lists;
--   DROP FUNCTION IF EXISTS public.grocery_lists_set_updated_at();
--   DROP TABLE IF EXISTS grocery_list_items;
--   DROP TABLE IF EXISTS grocery_lists;


-- =========================================================================
-- 1. grocery_lists table
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.grocery_lists (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- ON DELETE SET NULL: the grocery list outlives its source plan.
  meal_plan_id  uuid        REFERENCES meal_plans(id) ON DELETE SET NULL,
  -- Nullable; populated only when the user generates a share link.
  -- NULL after revocation (Phase 3 P0.10). UNIQUE prevents token collision.
  share_token   text        UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.grocery_lists IS
  'PRD-003 P0.1: one grocery list per meal-planning period (or ad-hoc). share_token is NULL until the user generates a share link; set to NULL again on revoke (P0.10). meal_plan_id uses ON DELETE SET NULL so the list survives plan deletion. The unique partial index grocery_lists_user_plan_idx prevents duplicate lists for the same plan while allowing multiple ad-hoc (meal_plan_id IS NULL) lists.';

COMMENT ON COLUMN public.grocery_lists.share_token IS
  'PRD-003 P0.9: opaque random token (32+ chars) generated on first share. NULL = not shared. Set to NULL to revoke (P0.10). Public RLS policy allows anon SELECT when this is NOT NULL; the application always queries with WHERE share_token = :token for validation.';

COMMENT ON COLUMN public.grocery_lists.meal_plan_id IS
  'FK to meal_plans(id) ON DELETE SET NULL. Unique partial index on (user_id, meal_plan_id) WHERE meal_plan_id IS NOT NULL ensures at most one list per plan. NULL = ad-hoc list (no plan association).';


-- =========================================================================
-- 2. Indexes on grocery_lists
-- =========================================================================

-- Fast lookup of all lists for a user (e.g. list history, nav badge).
CREATE INDEX IF NOT EXISTS grocery_lists_user_idx
  ON public.grocery_lists (user_id);

-- One plan → at most one list. Partial so ad-hoc lists (meal_plan_id IS NULL)
-- are unconstrained — a user may accumulate multiple ad-hoc lists over time.
CREATE UNIQUE INDEX IF NOT EXISTS grocery_lists_user_plan_idx
  ON public.grocery_lists (user_id, meal_plan_id)
  WHERE meal_plan_id IS NOT NULL;


-- =========================================================================
-- 3. RLS on grocery_lists
-- =========================================================================

ALTER TABLE public.grocery_lists ENABLE ROW LEVEL SECURITY;

-- --- owner-scoped policies ---

DROP POLICY IF EXISTS grocery_lists_select_own ON public.grocery_lists;
CREATE POLICY grocery_lists_select_own
  ON public.grocery_lists
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS grocery_lists_insert_own ON public.grocery_lists;
CREATE POLICY grocery_lists_insert_own
  ON public.grocery_lists
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS grocery_lists_update_own ON public.grocery_lists;
CREATE POLICY grocery_lists_update_own
  ON public.grocery_lists
  FOR UPDATE
  TO authenticated
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS grocery_lists_delete_own ON public.grocery_lists;
CREATE POLICY grocery_lists_delete_own
  ON public.grocery_lists
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- --- public share policy ---
-- Allows the anon role to SELECT a list when share_token IS NOT NULL.
-- The application always queries with WHERE share_token = :token so only the
-- intended row is returned. RLS does not validate the token value — that is
-- the application's responsibility. Phase 3 (P0.9) wires the actual token
-- generation; this policy is a no-op until rows have a non-null share_token.

DROP POLICY IF EXISTS grocery_lists_public_share ON public.grocery_lists;
CREATE POLICY grocery_lists_public_share
  ON public.grocery_lists
  FOR SELECT
  TO anon
  USING (share_token IS NOT NULL);


-- =========================================================================
-- 4. updated_at trigger on grocery_lists
-- =========================================================================
--
-- Matches the household_preferences pattern: a small in-repo BEFORE UPDATE
-- trigger rather than enabling the moddatetime extension.

CREATE OR REPLACE FUNCTION public.grocery_lists_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname   = 'grocery_lists_set_updated_at'
      AND tgrelid  = 'public.grocery_lists'::regclass
  ) THEN
    CREATE TRIGGER grocery_lists_set_updated_at
      BEFORE UPDATE ON public.grocery_lists
      FOR EACH ROW
      EXECUTE FUNCTION public.grocery_lists_set_updated_at();
  END IF;
END $$;


-- =========================================================================
-- 5. grocery_list_items table
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.grocery_list_items (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    uuid        NOT NULL REFERENCES grocery_lists(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  -- Free-text per OQ.A: AI output verbatim ("2 lbs", "1 bunch"). Structured
  -- {value, unit} is a P2 migration. NULL = quantity unknown or not specified.
  quantity   text,
  -- Validated by CHECK below AND by GROCERY_SECTIONS in src/lib/constants.js
  -- (defense in depth). Adding a new section requires both files to change.
  section    text        NOT NULL DEFAULT 'Other',
  is_bought  boolean     NOT NULL DEFAULT false,
  -- TRUE for items the user typed in manually (OQ.E: defaults to 'Other';
  -- AI-suggest on ad-hoc is a P1 enhancement).
  is_adhoc   boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT grocery_list_items_section_valid
    CHECK (section IN (
      'Produce',
      'Meat & Seafood',
      'Dairy',
      'Pantry',
      'Frozen',
      'Bakery',
      'Beverages',
      'Other'
    ))
);

COMMENT ON TABLE public.grocery_list_items IS
  'PRD-003 P0.1: individual line items within a grocery_list. section is constrained to the GROCERY_SECTIONS enum in src/lib/constants.js (CHECK constraint is defense-in-depth). quantity is free-text (PRD OQ.A — structured units are P2). is_adhoc = TRUE for user-typed additions (default section: Other per OQ.E).';

COMMENT ON COLUMN public.grocery_list_items.quantity IS
  'Free-text quantity from the AI (e.g. "2 lbs", "1 bunch", "a generous handful"). NULL = not specified. Structured {value, unit} is a P2 migration (PRD OQ.A).';

COMMENT ON COLUMN public.grocery_list_items.section IS
  'One of GROCERY_SECTIONS from src/lib/constants.js. Enforced app-side first; the CHECK constraint is a defense-in-depth backstop. Adding a new section requires both constants.js and a migration to relax this CHECK.';


-- =========================================================================
-- 6. Indexes on grocery_list_items
-- =========================================================================

-- Primary access pattern: load all items for a list in one query.
CREATE INDEX IF NOT EXISTS grocery_list_items_list_idx
  ON public.grocery_list_items (list_id);


-- =========================================================================
-- 7. RLS on grocery_list_items
-- =========================================================================
--
-- grocery_list_items has no user_id column; ownership is derived by joining
-- through grocery_lists. This keeps the schema lean and avoids denormalization
-- drift, at the cost of a subquery in each policy USING expression.

ALTER TABLE public.grocery_list_items ENABLE ROW LEVEL SECURITY;

-- --- owner-scoped policies ---

-- IN-subquery form (not EXISTS): the policy column `list_id` lives OUTSIDE
-- the subquery, so PostgreSQL unambiguously resolves it to the policy table's
-- column without depending on cross-scope name resolution. Avoids the
-- "column 'list_id' does not exist" failure mode that EXISTS-based policies
-- can hit when the outer table reference isn't visible inside the subquery.

DROP POLICY IF EXISTS grocery_list_items_select_own ON public.grocery_list_items;
CREATE POLICY grocery_list_items_select_own
  ON public.grocery_list_items
  FOR SELECT
  TO authenticated
  USING (
    list_id IN (
      SELECT id FROM public.grocery_lists WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS grocery_list_items_insert_own ON public.grocery_list_items;
CREATE POLICY grocery_list_items_insert_own
  ON public.grocery_list_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    list_id IN (
      SELECT id FROM public.grocery_lists WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS grocery_list_items_update_own ON public.grocery_list_items;
CREATE POLICY grocery_list_items_update_own
  ON public.grocery_list_items
  FOR UPDATE
  TO authenticated
  USING (
    list_id IN (
      SELECT id FROM public.grocery_lists WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    list_id IN (
      SELECT id FROM public.grocery_lists WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS grocery_list_items_delete_own ON public.grocery_list_items;
CREATE POLICY grocery_list_items_delete_own
  ON public.grocery_list_items
  FOR DELETE
  TO authenticated
  USING (
    list_id IN (
      SELECT id FROM public.grocery_lists WHERE user_id = auth.uid()
    )
  );

-- --- public share policy ---
-- Allows the anon role to SELECT items whose parent list has a non-null
-- share_token. Mirrors the grocery_lists_public_share logic: the app always
-- fetches by joining on a known token value, so RLS just needs to confirm the
-- parent list is in a shareable state.

DROP POLICY IF EXISTS grocery_list_items_public_share ON public.grocery_list_items;
CREATE POLICY grocery_list_items_public_share
  ON public.grocery_list_items
  FOR SELECT
  TO anon
  USING (
    list_id IN (
      SELECT id FROM public.grocery_lists WHERE share_token IS NOT NULL
    )
  );
