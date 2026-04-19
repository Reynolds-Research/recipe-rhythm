-- ADR-001 Phase 1: Planning-period save state schema
--
-- See: docs/adr/ADR-001-planning-period-save-state.md
--
-- This migration:
--   1. Enables btree_gist (needed for the period-overlap EXCLUDE constraint)
--   2. Adds period_start / period_end / finalized_at to meal_plans (all nullable so existing rows pass)
--   3. Creates meal_plan_items (normalized child of meal_plans; replaces items jsonb)
--   4. Adds overlap-prevention EXCLUDE constraint on meal_plans (partial — only rows with both period dates set)
--   5. Creates current_leftovers view (uncooked items from finalized periods, <=14 days stale)
--   6. Enables RLS on meal_plan_items with owner-scoped policies (mirrors assumed meal_plans pattern)
--   7. Backfills existing meal_plans rows: period_start/end/finalized_at + unpacks items jsonb into meal_plan_items
--
-- Idempotent: safe to re-run. Does NOT drop old columns (days/week_label/items) — that's ADR Phase 7.
--
-- BEFORE RUNNING: confirm RLS is enabled on meal_plans and matches the auth.uid() = user_id pattern.
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'meal_plans';
--   SELECT polname, polcmd, qual FROM pg_policy WHERE polrelid = 'meal_plans'::regclass;
-- If meal_plans has no RLS, STOP — resolve AUDIT C3 first before continuing.

-- =========================================================================
-- 1. Extensions
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;


-- =========================================================================
-- 2. Add columns to meal_plans (all nullable)
-- =========================================================================

ALTER TABLE meal_plans ADD COLUMN IF NOT EXISTS period_start  DATE;
ALTER TABLE meal_plans ADD COLUMN IF NOT EXISTS period_end    DATE;
ALTER TABLE meal_plans ADD COLUMN IF NOT EXISTS finalized_at  TIMESTAMPTZ;

COMMENT ON COLUMN meal_plans.period_start IS
  'ADR-001: inclusive start of the planning period. Nullable during soft migration; new rows must set it.';
COMMENT ON COLUMN meal_plans.period_end IS
  'ADR-001: inclusive end of the planning period. Nullable during soft migration; new rows must set it.';
COMMENT ON COLUMN meal_plans.finalized_at IS
  'ADR-001 Q2: when the user locked in the period via end-of-period review. NULL = active or ended-but-not-reviewed. Backfilled rows get served_at (treated as historical finalized).';


-- =========================================================================
-- 3. meal_plan_items table (ADR Decision 2)
-- =========================================================================

CREATE TABLE IF NOT EXISTS meal_plan_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meal_plan_id    uuid        NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
  scheduled_date  DATE        NOT NULL,
  position        int         NOT NULL DEFAULT 0,
  vault_id        uuid        REFERENCES vault(id) ON DELETE SET NULL,
  name            text        NOT NULL,
  is_wildcard     boolean     NOT NULL DEFAULT false,
  source_url      text,
  cooked          boolean     NOT NULL DEFAULT false,
  cooked_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE meal_plan_items IS
  'ADR-001: one row per scheduled meal within a planning period. Replaces the old meal_plans.items jsonb. Cooked tracking, leftovers, and roll-forward all key off this table.';

CREATE INDEX IF NOT EXISTS meal_plan_items_user_scheduled_idx
  ON meal_plan_items (user_id, scheduled_date);
CREATE INDEX IF NOT EXISTS meal_plan_items_meal_plan_id_idx
  ON meal_plan_items (meal_plan_id);
CREATE INDEX IF NOT EXISTS meal_plan_items_user_cooked_idx
  ON meal_plan_items (user_id, cooked);


-- =========================================================================
-- 4. EXCLUDE constraint: no overlapping periods per user
-- =========================================================================
--
-- Partial constraint — only enforced when BOTH period dates are non-NULL.
-- During soft migration, pre-backfill rows are exempt (they're updated in step 7 below).
-- After backfill, the constraint covers every row and any future overlap will error at write time.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meal_plans_no_period_overlap'
      AND conrelid = 'meal_plans'::regclass
  ) THEN
    ALTER TABLE meal_plans
      ADD CONSTRAINT meal_plans_no_period_overlap
      EXCLUDE USING gist (
        user_id WITH =,
        daterange(period_start, period_end, '[]') WITH &&
      )
      WHERE (period_start IS NOT NULL AND period_end IS NOT NULL);
  END IF;
END $$;


-- =========================================================================
-- 5. current_leftovers view (ADR Decision 3 + Retention Policy)
-- =========================================================================
--
-- "Leftovers" = uncooked items from a FINALIZED period whose period_end is in the past
-- but within the last 14 days. The 14-day cap is a label-staleness rule, not data deletion
-- (the underlying rows are permanent per the Retention Policy section of ADR-001).

CREATE OR REPLACE VIEW current_leftovers AS
SELECT
  mpi.id,
  mpi.user_id,
  mpi.meal_plan_id,
  mpi.scheduled_date,
  mpi.position,
  mpi.vault_id,
  mpi.name,
  mpi.is_wildcard,
  mpi.source_url,
  mpi.cooked,
  mpi.cooked_at,
  mpi.created_at,
  mp.period_start  AS source_period_start,
  mp.period_end    AS source_period_end,
  mp.finalized_at  AS source_finalized_at
FROM meal_plan_items mpi
JOIN meal_plans mp ON mpi.meal_plan_id = mp.id
WHERE mpi.cooked = false
  AND mp.finalized_at IS NOT NULL
  AND mp.period_end < CURRENT_DATE
  AND mp.period_end >= (CURRENT_DATE - INTERVAL '14 days');

COMMENT ON VIEW current_leftovers IS
  'ADR-001 Decision 3: uncooked meal_plan_items from recently-finalized periods. Surface on the gap-day view for roll-forward.';


-- =========================================================================
-- 6. RLS on meal_plan_items
-- =========================================================================

ALTER TABLE meal_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meal_plan_items_select_own ON meal_plan_items;
CREATE POLICY meal_plan_items_select_own ON meal_plan_items
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS meal_plan_items_insert_own ON meal_plan_items;
CREATE POLICY meal_plan_items_insert_own ON meal_plan_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS meal_plan_items_update_own ON meal_plan_items;
CREATE POLICY meal_plan_items_update_own ON meal_plan_items
  FOR UPDATE USING (auth.uid() = user_id)
                WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS meal_plan_items_delete_own ON meal_plan_items;
CREATE POLICY meal_plan_items_delete_own ON meal_plan_items
  FOR DELETE USING (auth.uid() = user_id);


-- =========================================================================
-- 7. Backfill existing rows (ADR Decision 4 — soft migrate)
-- =========================================================================
--
-- Step 7a: populate period_start / period_end / finalized_at on meal_plans.
--
-- Non-overlap protection: for each user, period_end = min(served_at + 6 days, next_plan_start - 1).
-- This avoids EXCLUDE constraint violations for users who served plans closer than 7 days apart.
--
-- Edge case not handled: if two plans share the same served_at::date for one user, they'll
-- produce overlapping single-day ranges and the constraint will reject one. If that happens,
-- inspect with:
--   SELECT user_id, served_at::date, COUNT(*) FROM meal_plans GROUP BY 1,2 HAVING COUNT(*) > 1;
-- and manually DELETE the duplicate you don't want to keep before re-running.

WITH ordered AS (
  SELECT
    id,
    served_at,
    served_at::date AS ps,
    LEAD(served_at::date) OVER (PARTITION BY user_id ORDER BY served_at) AS next_ps
  FROM meal_plans
  WHERE served_at IS NOT NULL
)
UPDATE meal_plans mp
SET
  period_start = o.ps,
  period_end   = CASE
                   WHEN o.next_ps IS NULL         THEN o.ps + 6
                   WHEN o.next_ps <= o.ps         THEN o.ps          -- same-day dup: single-day range
                   ELSE LEAST(o.ps + 6, o.next_ps - 1)
                 END,
  finalized_at = o.served_at
FROM ordered o
WHERE mp.id = o.id
  AND mp.period_start IS NULL;

--
-- Step 7b: unpack meal_plans.items jsonb → meal_plan_items rows.
--
-- Maps each item's weekday string ('Sun'|'Mon'|…|'Sat') to a calendar date by computing
-- the offset from period_start's own weekday. Item-level weekday → DOW offset:
--   target_dow = CASE day WHEN 'Sun' THEN 0 WHEN 'Mon' THEN 1 … WHEN 'Sat' THEN 6 END
--   offset_days = (target_dow - EXTRACT(DOW FROM period_start) + 7) % 7
--   scheduled_date = period_start + offset_days
--
-- Items are marked cooked = true because they're historical — we have no way to know
-- after the fact whether the user actually cooked them. This means they'll never appear
-- in current_leftovers (good: we don't want to surface unknowable leftovers from before
-- the feature existed).
--
-- WHERE NOT EXISTS guard makes the insert idempotent: re-running won't double-insert.

INSERT INTO meal_plan_items (
  user_id,
  meal_plan_id,
  scheduled_date,
  position,
  vault_id,
  name,
  is_wildcard,
  source_url,
  cooked,
  cooked_at
)
SELECT
  mp.user_id,
  mp.id,
  (mp.period_start
    + ((
        (CASE item->>'day'
           WHEN 'Sun' THEN 0 WHEN 'Mon' THEN 1 WHEN 'Tue' THEN 2 WHEN 'Wed' THEN 3
           WHEN 'Thu' THEN 4 WHEN 'Fri' THEN 5 WHEN 'Sat' THEN 6
         END)
        - EXTRACT(DOW FROM mp.period_start)::int + 7
      ) % 7) * INTERVAL '1 day'
  )::date                                                            AS scheduled_date,
  ord.idx::int                                                       AS position,
  NULLIF(item->>'vault_id', '')::uuid                                AS vault_id,
  COALESCE(item->>'name', '(unnamed)')                               AS name,
  COALESCE((item->>'is_wildcard')::boolean, false)                   AS is_wildcard,
  NULLIF(item->>'source_url', '')                                    AS source_url,
  true                                                               AS cooked,
  mp.served_at                                                       AS cooked_at
FROM meal_plans mp,
     LATERAL jsonb_array_elements(mp.items) WITH ORDINALITY AS ord(item, idx)
WHERE mp.items IS NOT NULL
  AND jsonb_typeof(mp.items) = 'array'
  AND mp.period_start IS NOT NULL
  AND item->>'day' IN ('Sun','Mon','Tue','Wed','Thu','Fri','Sat')
  AND NOT EXISTS (
    SELECT 1 FROM meal_plan_items mpi WHERE mpi.meal_plan_id = mp.id
  );
