-- =========================================================================
-- Migration: 20260530000002_current_leftovers_exclude_shortlist
-- =========================================================================
--
-- Bug fix: the `current_leftovers` view was authored in
-- 20260418000001_planning_periods_schema.sql, BEFORE PRD-002 P0.6 added the
-- `meal_plan_items.is_shortlisted` column (a "Maybe" / shortlist tray for
-- meals the user is interested in but hasn't scheduled). Shortlisted rows
-- carry `scheduled_date = NULL` by design — they aren't on any day yet.
--
-- The view's WHERE clause filters by `cooked = false`, finalized period, and
-- a 14-day staleness window — but never excludes `is_shortlisted = true`. So
-- a user with at least one shortlisted item from a finalized period gets
-- those rows surfaced as "leftovers" with NULL scheduled_date. The
-- LeftoverPicker (rendered after the user confirms dates for a new period)
-- calls `parseIso(item.scheduled_date)` which throws on NULL — the global
-- ErrorBoundary then renders "Something went wrong" and the user is stuck.
--
-- Fix: replace the view definition with the same WHERE clause + an added
-- `AND mpi.is_shortlisted = false`. CREATE OR REPLACE VIEW is sufficient
-- because the column list (and grants) are unchanged.
--
-- App layer also gets a defense-in-depth filter in fetchCurrentLeftovers
-- and a `if (!iso) return ''` guard in LeftoverPicker.formatShortDate. See
-- the companion PR for those.
--
-- Idempotent: CREATE OR REPLACE — safe to re-run.

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
  AND mpi.is_shortlisted = false
  AND mp.finalized_at IS NOT NULL
  AND mp.period_end < CURRENT_DATE
  AND mp.period_end >= (CURRENT_DATE - INTERVAL '14 days');

COMMENT ON VIEW current_leftovers IS
  'ADR-001 Decision 3: uncooked, non-shortlisted meal_plan_items from recently-finalized periods. Surface on the gap-day view for roll-forward. Shortlisted ("Maybe") rows excluded — they have scheduled_date = NULL and were never planned.';
