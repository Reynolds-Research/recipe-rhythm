# Claude Code prompt — ADR-001 Phase 7: cleanup

_Hand the block between the two `---` markers to Claude Code._

**Dependencies:** ADR-001 Phases 2-6 must be merged AND the system must have been running stable on the new schema for **at least 1-2 weeks** (per ADR Decision 4). Do NOT run this phase immediately after Phase 6. Let plans get served, finalized, and rolled forward first so you have real-world evidence the new schema is load-bearing.

**Before starting, verify stability:**

1. Open Supabase and run:
   ```sql
   SELECT COUNT(*) AS plans_missing_new_schema
   FROM meal_plans
   WHERE period_start IS NULL OR period_end IS NULL;
   ```
   Expected: 0. If > 0, STOP — there are rows that the Phase 1 backfill or a later write missed. Resolve before dropping columns.

2. Run:
   ```sql
   SELECT COUNT(*) AS legacy_only_plans
   FROM meal_plans mp
   WHERE mp.items IS NOT NULL
     AND jsonb_typeof(mp.items) = 'array'
     AND NOT EXISTS (SELECT 1 FROM meal_plan_items mpi WHERE mpi.meal_plan_id = mp.id);
   ```
   Expected: 0. If > 0, the fallback path in `mealPlanReader.js` is still carrying the UI — do NOT remove it yet.

3. Grep the repo (from the project root):
   ```
   rg '\bweek_label\b|\.items\b|\bmeal_plans\.days\b' src/
   ```
   Every hit must be reviewed. Any remaining read/write reference to the deprecated columns blocks this phase.

If all three checks pass, proceed.

---

## Context

You are working on **Recipe Rhythm**, a React 19 + Vite 8 + Supabase meal-tracking app.

**Required reading:**

- `docs/adr/ADR-001-planning-period-save-state.md` — focus on `Action Items → Phase 7` (lines 359-361) and Decision 4 (soft-migrate strategy).
- `supabase/migrations/20260418000001_planning_periods_schema.sql` — the original migration that added the new schema; the deprecated columns referenced there are what you'll now drop.
- `docs/schema.md` — you'll update this to remove the deprecated-column rows after the migration runs.
- `src/lib/mealPlanReader.js` — you'll remove the legacy-fallback branch in `fetchMostRecentPlan`.

**State of the system:**

- All new writes go through `createServedPlan` in `mealPlanWriter.js` and do NOT populate `week_label`, `days`, or `items`.
- Reads prefer `meal_plan_items`; fallback to `items` jsonb has not triggered for real traffic in the stability window.
- The deprecated columns on `meal_plans` (`week_label TEXT`, `days`, `items JSONB`) are still physically present, holding historical data.

## Task

Drop the deprecated columns from `meal_plans` and remove the code paths that read/write them. Finalize the soft migration that started in Phase 1.

This is the last phase of ADR-001. After this merges, the legacy schema and its fallback branches are gone from the codebase.

## Deliverables

### 1. New Supabase migration

Create `supabase/migrations/<YYYYMMDDHHMMSS>_drop_legacy_meal_plans_columns.sql` (timestamp it based on current UTC). Contents:

```sql
-- ADR-001 Phase 7: drop deprecated columns from meal_plans
--
-- Context: Phase 1 (20260418000001_planning_periods_schema.sql) added the
-- new period_start / period_end / finalized_at columns and the
-- meal_plan_items table. Legacy columns (week_label, days, items) were kept
-- populated during soft migration so the UI fallback could serve stale data
-- if the backfill missed anything. Phases 2 and 3 moved reads and writes off
-- the legacy columns. After a stability window with zero fallback triggers,
-- this migration removes them.
--
-- Idempotent via IF EXISTS clauses. Safe to re-run.
--
-- Recovery note: if you need the legacy data back for debugging, restore from
-- a Supabase point-in-time backup taken before this migration applied.

ALTER TABLE meal_plans DROP COLUMN IF EXISTS week_label;
ALTER TABLE meal_plans DROP COLUMN IF EXISTS days;
ALTER TABLE meal_plans DROP COLUMN IF EXISTS items;
```

Also create `supabase/migrations/verify_<YYYYMMDD>_phase7.sql` with read-only checks:

```sql
-- Phase 7 verification: confirm columns are gone and app-facing queries still work.

-- 1. Columns are dropped
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'meal_plans'
  AND column_name IN ('week_label', 'days', 'items');
-- Expected: 0 rows

-- 2. Plans still readable
SELECT id, user_id, period_start, period_end, finalized_at, served_at
FROM meal_plans
ORDER BY served_at DESC
LIMIT 5;

-- 3. meal_plan_items still readable
SELECT meal_plan_id, scheduled_date, name, cooked
FROM meal_plan_items
ORDER BY scheduled_date DESC
LIMIT 5;

-- 4. current_leftovers view still functional
SELECT COUNT(*) FROM current_leftovers;
```

### 2. Remove the legacy-fallback branch in `src/lib/mealPlanReader.js`

Simplify `fetchMostRecentPlan`:

- Delete the fallback branch that reads `plan.items` / `plan.days` / `plan.week_label`.
- Delete the code that maps legacy jsonb entries to the UI shape.
- Delete the `source: 'legacy'` return value; the `source` field can go entirely since there's only one source now. If you kept `source` for telemetry, drop it and update callers.
- The `meal_plans` select statement should no longer list `items`, `days`, `week_label` (they no longer exist in the DB anyway — the query would fail if run).
- Simplify the `meal_plan_items` empty-result path: return the plan with `items: []`, `days: []`.

### 3. Remove dead tests

In `src/lib/__tests__/mealPlanReader.test.js`:

- Delete the "Fallback path" test (no longer possible).
- Delete the "Preference: new wins over legacy" test (no legacy branch to compete with).
- Keep all other tests.
- If any test built fixtures around the legacy shape, update to the current shape only.

### 4. Update `docs/schema.md`

In the `public.meal_plans` section:

- Delete the rows for `week_label`, `days`, and `items`.
- Remove the "⚠️ Deprecated by ADR-001" warnings from that table.
- Update the "Last verified" date and add a note like: "Legacy columns `week_label`, `days`, `items` dropped <YYYY-MM-DD> via ADR-001 Phase 7."

In the `Migrations` table at the bottom:

- Add a row for the new migration file.

### 5. Final sweep

Grep the repo one more time for stragglers:

```
rg '\bweek_label\b' src/ docs/ supabase/
rg '"items"|\.items\b' src/   # careful with false positives — review each hit
rg '\bbuildWeekLabel\b' src/
```

Every remaining hit in `src/` must be a genuine unrelated use (e.g., React's array items, a jsonb column on an unrelated table). Purge any that turn out to be dead code.

## Acceptance criteria

- The new migration applies cleanly in Supabase SQL Editor. Verification SQL confirms the columns are gone and app-facing queries still work.
- `fetchMostRecentPlan` is simpler — one branch, not two. Tests updated accordingly.
- `npm run test:unit -- --run` passes.
- `npm run test:e2e` passes.
- `npm run lint` and `npm run build` succeed.
- Manual smoke test documented in PR: load the Brainstorm page — nothing regresses. Serve a fresh plan, finalize it, start a new one, import leftovers — full ADR-001 flow still works.
- `docs/schema.md` no longer lists the deprecated columns or any "Deprecated by ADR-001" warnings.

## Out of scope (explicitly)

- Any new features. This phase is pure cleanup.
- RLS or policy changes on `meal_plans` — the EXCLUDE constraint and existing policies are untouched.
- Touching the `meals` or `vault` tables.
- Refactoring `BrainstormMode.jsx` into smaller pieces (AUDIT M1 — separate task).
- Converting the app to TypeScript (AUDIT M5 — separate task).

## Deliverable format

One PR:
- `supabase/migrations/<ts>_drop_legacy_meal_plans_columns.sql` (new)
- `supabase/migrations/verify_<date>_phase7.sql` (new)
- `src/lib/mealPlanReader.js` (simplified)
- `src/lib/__tests__/mealPlanReader.test.js` (trimmed)
- `docs/schema.md` (updated)
- PR description that includes:
  - Confirmation that the three stability checks at the top of this prompt all returned 0.
  - Link to ADR-001 Phase 7.
  - A note on when the migration was applied to production.

---

## Notes for the human (you)

**This is the irreversible phase.** Dropping a column is not a code change — it's a data change. Once the migration runs against Supabase, the historical jsonb `items` column and its contents are gone unless you recover from a backup. Do NOT merge and apply this on the same day; merge the code, apply the migration during a quiet period with a backup in hand, and keep the PR ready to revert if a surprise pops up.

**Why the stability window matters.** The fallback in `fetchMostRecentPlan` exists to catch plans whose `meal_plan_items` somehow didn't get populated. If you drop the columns before running "zero fallback triggers" for a week or two, you have no safety net for the class of bug that fallback exists to handle. The stability check at the top of this prompt enforces this — don't skip it.

**What the codebase looks like after this lands.** Clean. One read helper, one write helper, one lifecycle classifier, one calendar view, one new-period flow. The ADR has retired. The only hangover is the non-migration tech debt the AUDIT still flags (BrainstormMode.jsx size, TypeScript migration, recommendation engine randomness) — all future work.

**Suggested commit cadence for this PR, once you open it:**

1. First commit: the migration SQL files only. Apply them to Supabase immediately after merging this commit (or on a scheduled maintenance moment).
2. Second commit: the code changes (reader simplification, test trims, schema doc updates).
3. Optional third commit: any stragglers from the final grep sweep.

Splitting it this way lets you apply the DB migration first and confirm the app keeps working on the old code — because the old code tolerates missing legacy columns via the fallback. Only after the DB is updated do you deploy the simplified reader. This is the safest cutover order.
