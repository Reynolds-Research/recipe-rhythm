# ADR-001: Planning Period Save State Schema

**Status:** Accepted
**Date:** 2026-04-18
**Deciders:** Matt (project owner)
**Approved:** 2026-04-18 (all four decisions accepted as-drafted; open questions Q1 and Q2 resolved below)
**Related:**
- `RECIPE_TODOS.md` → Feature Requests → "Planning period save state with roll-forward of uncooked meals" (P1 · H)
- `AUDIT.md` → H3 (no schema docs in repo) — this ADR begins to address that gap
- `AUDIT.md` → C3 (no RLS verified) — RLS for new tables must be defined as part of this work

---

## Context

### What Recipe-Rhythm does today

The app has a "Brainstorm" page where the user assembles a meal plan for an upcoming week. When satisfied, they click **Serve** which saves the plan to the `meal_plans` table and locks the UI to prevent edits. The next time the app loads, if the most recent served plan is within the last 7 days, the UI restores it as locked; otherwise a fresh plan is generated from the user's Cookbook (`vault` table).

### The current `meal_plans` schema (inferred from code, since AUDIT H3 flags no schema docs)

Columns referenced in `src/pages/BrainstormMode.jsx`:

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid (PK) | Primary key |
| `user_id` | uuid (FK → auth.users) | Owner |
| `week_label` | text | Display string like "Sun–Thu" |
| `days` | text[] (or jsonb array) | Weekday strings: `['Sun','Mon','Tue','Wed','Thu']` — **NOT real dates** |
| `items` | jsonb | Array of `{day, name, vault_id, is_wildcard, source_url}` |
| `served_at` | timestamptz | When user clicked "Serve" |

The "current week" is implicit: a plan is "this week's" if `served_at` is within the last 7 days. Past plans are immutable history. There is no concept of cooked-vs-uncooked, leftovers, or explicit period boundaries.

### What we want to change

The new feature requirements (per recent decisions in `RECIPE_TODOS.md`):

1. **User-defined planning periods** — User picks a start AND end date for each period. Periods can be any length, cannot overlap with prior periods, and can have gap days between them.
2. **Cooked tracking** — Each meal in a period can be marked "cooked" or "not cooked." Uncooked meals become **leftovers**.
3. **Leftover persistence + roll-forward** — During gap days (no active period), the planner shows leftovers from the most recent prior period plus a "Start new planning period" CTA. Clicking the CTA opens a date-range picker AND offers to pull leftovers into the new period.
4. **Calendar-based UI** — Dates picked via calendar picker; periods visualized on an in-app calendar view.

### Forces / constraints at play

- **Schema mismatch:** Today's `days` column holds weekday strings, not dates. The new feature requires real calendar dates. This is a structural change, not a tweak.
- **Coexistence:** The existing "Serve / lock" flow must keep working through the migration. We can't break the user's current Brainstorm page mid-development.
- **Backwards data:** Existing rows in `meal_plans` need to be migrated or coexist with the new schema. The user has been using the app already.
- **Future features depend on this:** The partner-collaboration feature (P1 · H, Open Questions pending) and friend-sharing (P2 · M) will both touch this schema. Decisions made here ripple forward.
- **Single-developer constraint:** The user is a novice developer working solo. Bias toward fewer concurrent moving parts; prefer clarity over cleverness.
- **Stack:** React 19 + Vite 8 + Tailwind 3 + Supabase (Postgres) + lucide-react. Mobile-only (PWA planned). No TypeScript currently. No `api-server.mjs` yet (will be added as part of fixing C1 security issue).

---

## Decision Summary

This ADR proposes **four schema decisions** that together define the planning-period save state. In one sentence each:

1. **Period bounds** → Add `period_start DATE` and `period_end DATE` columns to `meal_plans`.
2. **Cooked status per meal** → Normalize `items` jsonb into a new `meal_plan_items` table with a `cooked BOOLEAN` column.
3. **Leftovers storage** → Reuse the same `meal_plan_items` table; "leftovers" is a query, not a separate entity.
4. **Migration strategy** → Soft-migrate (backfill new fields, keep old columns temporarily as a safety net, drop them in a follow-up).

---

## Detailed Decisions

### Decision 1: How do we store planning period bounds?

**Options Considered**

#### Option 1A — Add `period_start` and `period_end` columns to `meal_plans`

Add two new `DATE` columns directly to the existing table.

| Dimension | Assessment |
|---|---|
| Complexity | Low — two `ALTER TABLE` statements, no joins added |
| Cost | Negligible |
| Scalability | Fine — one row per period, indexed on dates |
| Team familiarity | High — flat-table pattern is what the user knows |

**Pros:**
- Simplest possible model: a planning period IS a row in `meal_plans`
- Fast queries — no joins to find "current period" or "all my periods"
- Overlap validation can be enforced via Postgres `EXCLUDE` constraint with a `daterange` operator (one-line SQL guarantee that periods can never overlap)
- Existing code that reads `meal_plans` can keep working as-is, just gets two more columns

**Cons:**
- Couples "the planning period" and "the served meal plan" into one entity. If we ever wanted multiple plans per period (e.g., partner collab where each partner drafts a plan before merging), we'd need to revisit
- Old rows have NULL period dates initially (handled in Decision 4)

#### Option 1B — New `planning_periods` table with FK from `meal_plans`

Create `planning_periods (id, user_id, period_start, period_end)`. Each `meal_plans` row gets a `period_id` foreign key.

| Dimension | Assessment |
|---|---|
| Complexity | Medium — new table, new FK, joins required everywhere |
| Cost | Negligible |
| Scalability | Equal to Option A in practice |
| Team familiarity | Lower — adds normalization the user doesn't have today |

**Pros:**
- Cleanly separates "the period" (a time bucket) from "the plan" (the content). Lets multiple plans share a period if we ever need that.
- Future partner-collab is a tiny bit easier: a `planning_periods` row can be shared between two users; each draws their own `meal_plans` row from it.

**Cons:**
- Adds a join to every read query
- More migration work for existing rows
- Premature abstraction — we don't yet have the "multiple plans per period" requirement and YAGNI ("you ain't gonna need it") usually wins on speculative normalization
- More tables = more RLS policies to write (and AUDIT C3 already shows we're behind on RLS)

**Recommendation: Option 1A** — Add columns directly to `meal_plans`.

The "multiple plans per period" justification is speculative. Partner collab is more likely to be solved via household-level ownership of meal_plans (one shared plan, two writers) than via per-user drafts. We can always extract a `planning_periods` table later if a real requirement emerges. For now, fewer joins and simpler queries win.

---

### Decision 2: How do we track cooked vs. uncooked per meal?

**Options Considered**

#### Option 2A — Add `cooked` field to each entry in the `items` jsonb

Mutate the existing jsonb column. Each item becomes `{day, name, vault_id, is_wildcard, source_url, cooked}`.

| Dimension | Assessment |
|---|---|
| Complexity | Low — no new tables, just expand an existing field |
| Cost | Negligible |
| Scalability | OK at small scale; jsonb mutations get awkward with many items |
| Team familiarity | High — same pattern as today |

**Pros:**
- Minimal change — same shape, one new field
- Read pattern unchanged: `SELECT items FROM meal_plans` still works

**Cons:**
- **jsonb mutations are clunky** — to mark one item cooked, you have to read the whole array, modify in code, and write the whole array back. Race conditions if two updates land at once.
- Hard to query — "show me all uncooked items across all periods" requires unnesting the jsonb in SQL, which is painful and slow
- Hard to enforce constraints — Postgres can't easily say "every item must have a `cooked` boolean"
- RLS gets messy — granting per-item permissions for partner collab later is much harder when items are nested inside a jsonb blob

#### Option 2B — Normalize `items` into a new `meal_plan_items` table

Create a child table:

```
meal_plan_items
  id              uuid PRIMARY KEY
  meal_plan_id    uuid REFERENCES meal_plans(id) ON DELETE CASCADE
  scheduled_date  DATE  -- the actual calendar date this meal is on
  position        int   -- order within the day, if multiple meals per day
  vault_id        uuid REFERENCES vault(id)
  name            text  -- denormalized snapshot in case vault entry is later edited/deleted
  is_wildcard     boolean DEFAULT false
  source_url      text
  cooked          boolean DEFAULT false
  cooked_at       timestamptz  -- when marked cooked, useful for stats
```

| Dimension | Assessment |
|---|---|
| Complexity | Medium — new table, FK, indexes, RLS policy |
| Cost | Negligible |
| Scalability | Better than 2A — proper relational model, fast indexed queries |
| Team familiarity | Slightly lower — but it's just standard SQL |

**Pros:**
- One row per scheduled meal — queries become natural: "all my uncooked items" is `SELECT * FROM meal_plan_items WHERE cooked = false AND user_id = ?`
- Updating cooked status is a single-row UPDATE, no race conditions
- Proper foreign key to `vault` lets us add `ON DELETE SET NULL` if a vault recipe is deleted, avoiding broken references
- Each row uses a real calendar `scheduled_date`, killing the weekday-string mess and resolving AUDIT bug U3 (last-week mapping ignores week boundaries) at the source
- RLS policies become trivial — one policy per table, future partner collab can extend cleanly
- Sets up well for future partner collab (e.g., `cooked_by_user_id` on each row to track who cooked what)

**Cons:**
- More upfront work — new table, new RLS policy, new query patterns
- Existing read code in `BrainstormMode.jsx` has to change (it currently reads `items` jsonb directly)
- Migration of existing rows is more involved — have to unpack jsonb arrays into rows

**Recommendation: Option 2B** — Normalize into `meal_plan_items` table.

This is the foundational decision in the ADR. Yes, it's more work upfront — but the cooked-tracking, leftover-roll-forward, and (eventually) partner-collab features all become *much* simpler with normalized data. JSONB-as-array-of-records is an anti-pattern at the point where you need to query, mutate, or constrain individual entries — which is exactly where we're headed. AUDIT.md's M5 (push toward TypeScript) is also easier with proper relational rows than with jsonb blobs.

This decision also kills two birds: by making `scheduled_date` a real DATE, we natively fix AUDIT U3 (last-week meal-mapping ignores week boundaries) and U8 (timezone-naive date handling) within the new schema. Old code paths still need cleanup, but new code paths will be correct by construction.

---

### Decision 3: Where do leftover meals live?

Reminder of the requirement: during gap days (no active period), the meal planner shows the previous period's uncooked meals as "leftovers." Clicking "Start new planning period" lets the user optionally pull those leftovers into the new period.

**Options Considered**

#### Option 3A — Reuse `meal_plan_items`; "leftovers" is just a query

Leftover meals are simply rows where `cooked = false` AND the parent `meal_plans.period_end` has passed AND no newer period exists for the user. No new table; this is a SQL view or a query helper.

| Dimension | Assessment |
|---|---|
| Complexity | Low — no new schema |
| Cost | Negligible |
| Scalability | Excellent — index on `(user_id, cooked, scheduled_date)` |
| Team familiarity | High — just a query |

**Pros:**
- No data duplication — the leftover IS the original meal_plan_item, just unconsumed
- Zero migration risk — no new table to populate
- "Pull leftover into new period" is just `UPDATE meal_plan_items SET meal_plan_id = <new>, scheduled_date = <new>` — one line of code
- The user's mental model — "this leftover came from period X" — is preserved automatically (we can show "first scheduled on Tuesday from your March 2-9 period")

**Cons:**
- Have to be careful about the query that defines "current leftovers" — accidentally including cooked items would be a bug. (Mitigation: write a SQL view called `current_leftovers` once, use it everywhere)

#### Option 3B — Separate `leftovers` table

Create a `leftovers` table; when a period ends, copy uncooked items into it; pull from there when starting a new period.

| Dimension | Assessment |
|---|---|
| Complexity | Medium — new table + sync logic |
| Cost | Negligible |
| Scalability | Equal |
| Team familiarity | Lower |

**Pros:**
- Clean conceptual separation — "leftovers" is its own thing
- Easier to add metadata only relevant to leftovers (e.g., `expires_at`)

**Cons:**
- Data duplication: same meal exists in both `meal_plan_items` (cooked=false in old period) and `leftovers`
- Sync risk: if the two get out of sync, debugging is painful
- More migration logic
- Needs a "when does leftover get created?" trigger or app-level event — more moving parts

**Recommendation: Option 3A** — Leftovers is a query, not a table.

The conceptual purity of a separate `leftovers` table doesn't justify the data duplication and sync risk. Leftovers are uncooked meals from the past — the data is already there; we just need to ask the right question. A SQL view (`CREATE VIEW current_leftovers AS ...`) makes this trivial in code.

---

### Decision 4: Migration strategy for existing `meal_plans` rows

The user has been using the app already, so there's existing data with the old schema (`days` weekday strings, `items` jsonb). What do we do with it?

**Options Considered**

#### Option 4A — Hard migrate (write one-time migration, drop old columns)

Run a single migration: convert old rows to new schema (backfill `period_start`/`period_end` from `served_at`, unpack `items` jsonb into `meal_plan_items` rows), then drop the old columns.

**Pros:** Cleanest end state; no dual-tracking to maintain.
**Cons:** Higher risk — if backfill logic has a bug, old data is gone. Hard to roll back.

#### Option 4B — Soft migrate (backfill new fields, keep old columns temporarily)

Run a one-time migration that populates new fields from old, but doesn't drop the old columns. Old code paths can keep reading old fields during the transition. Drop in a follow-up PR after a stability period.

**Pros:** Safety net — if the new code has a bug, the old data is still there. Two-phase rollout (migrate → verify → drop) reduces blast radius.
**Cons:** Two sources of truth temporarily — must remember to write to both during the transition (or only write to new and document that old is deprecated).

#### Option 4C — No migration; new schema only applies to new periods

Leave existing rows alone with NULL period dates and no `meal_plan_items`. New periods use the new schema; old "history" remains in legacy form.

**Pros:** Zero migration risk.
**Cons:** Two parallel data models forever. UI has to handle both. Future analytics queries (e.g., "when did I cook this recipe?") break across the boundary.

**Recommendation: Option 4B** — Soft migrate.

The user has only been using the app for a few weeks (audit was generated April 17, code dates back to early April), so the data volume is small — backfill is fast. The safety net of keeping old columns for ~1-2 weeks of stability before dropping them is worth the temporary duplication. We document the deprecation explicitly so it doesn't linger.

**Concrete migration steps:**

1. Create new tables/columns (`period_start`, `period_end`, `meal_plan_items` table)
2. Populate `period_start = served_at::date`, `period_end = served_at::date + INTERVAL '6 days'` for existing rows (best-guess based on the implicit 7-day window)
3. For each row, unpack `items` jsonb into `meal_plan_items` rows. Map weekday strings to actual dates by computing `period_start + (weekday_offset_from_period_start_dow)`
4. Mark all migrated items as `cooked = true` (since they're historical and we have no other way to know)
5. Add `EXCLUDE` constraint on `meal_plans (user_id, daterange(period_start, period_end, '[]'))` to prevent overlap going forward
6. New code reads ONLY new schema. Old fields (`days`, `week_label`, `items`) are deprecated — flagged with a code comment but not yet removed
7. After 1-2 weeks of confirmed stability, drop the old columns in a follow-up migration

---

## Trade-off Analysis Summary

The biggest tension across decisions is **simplicity now vs. flexibility later**. Decision 1 (period columns vs. separate table) leaned toward simplicity; Decision 2 (jsonb vs. normalized table) leaned toward flexibility. The reasoning differs:

- **Period bounds** rarely need to be split from the plan that owns them — keep them together (Option 1A).
- **Individual meal items** very often need to be queried, updated, and constrained individually — break them out (Option 2B).

The asymmetric calls are intentional. We optimize for the queries we know we'll write, not the queries we might one day write.

---

## Consequences

### What becomes easier
- Cooked tracking, leftover surfaces, and roll-forward all become simple SQL queries
- The end-of-period review UI is a list of `meal_plan_items` with checkboxes for `cooked`
- AUDIT bugs U3 (week-boundary mapping) and U8 (timezone-naive dates) are killed at the source for any new code touching the new schema
- Future partner collab gets a much cleaner foundation — one shared meal_plan, items can have `cooked_by_user_id`
- Schema documentation gets started (addresses AUDIT H3) — this ADR is the first artifact
- RLS policies become writable (addresses AUDIT C3 partially) — we'll define them as part of the migration

### What becomes harder
- `BrainstormMode.jsx` (already 791 lines, AUDIT M1) needs to change in non-trivial ways — fetching from `meal_plan_items` instead of `meal_plans.items`. This is a good forcing function to start splitting it, but it does make the change set bigger.
- Two-phase migration discipline required — must remember not to write to old columns during the transition
- `vault_id` foreign key on `meal_plan_items` means deleting a vault recipe needs an explicit policy (`SET NULL` or `RESTRICT`) — pick one and document

### What we'll need to revisit
- If partner collab introduces "two users editing the same plan simultaneously," we may need to extract `planning_periods` after all (revisit Decision 1)
- If grocery-list-with-quantities (AUDIT U4) ever gets built, the `meal_plan_items` table is the natural place to attach `serving_count` and ingredient-level data
- The "EXCLUDE constraint for non-overlap" depends on Postgres `btree_gist` extension; verify this is enabled on Supabase (it is by default, but worth confirming during the migration)

---

## Action Items (Implementation Phases)

These will become a sequence of Claude Code prompts. Each phase leaves the app in a working state and is independently testable.

### Phase 0 — Pre-work (do FIRST, separately from this ADR)
1. [ ] Address AUDIT C2 (`.env.example` placeholders) — quick, isolated
2. [ ] Address AUDIT C3 (verify and document existing RLS policies) — must understand current state before adding new tables
3. [ ] Address AUDIT C1 (move Anthropic key off client) — security risk; aligns with "hybrid approach" by introducing `api-server.mjs`

### Phase 1 — Schema migration (database only, no UI changes)
4. [ ] Write SQL migration that:
   - Adds `period_start DATE`, `period_end DATE` to `meal_plans`
   - Creates `meal_plan_items` table with RLS policy
   - Creates `current_leftovers` view
   - Adds `EXCLUDE` constraint for period non-overlap
5. [ ] Backfill existing rows per Decision 4 steps
6. [ ] Document schema in `docs/schema.md` (also addresses AUDIT H3)

### Phase 2 — Read path migration (no UI changes visible to user)
7. [ ] Update `BrainstormMode.jsx` data load to read from new schema, fall back to old if new is empty (defensive)
8. [ ] Add Vitest tests covering the read-path behavior on both old and new data

### Phase 3 — Write path migration
9. [ ] Update `handleServe` in `BrainstormMode.jsx` to insert into new schema (period_start/period_end + meal_plan_items rows)
10. [ ] Stop writing to old `items` jsonb / `days` / `week_label` columns

### Phase 4 — New UI: end-of-period review
11. [ ] Build the cooked/uncooked review screen — list of items with checkboxes, "Save and close period" button
12. [ ] Add Vitest tests for the review flow

### Phase 5 — New UI: gap-day view + new-period flow
13. [ ] Build the gap-day view — leftovers + "Start new planning period" CTA
14. [ ] Build the date-range picker (calendar style) with overlap validation
15. [ ] Build the leftover roll-forward selection screen
16. [ ] Add Playwright e2e test covering full flow: end period → see leftovers → start new period → import leftovers

### Phase 6 — Calendar view
17. [ ] Build the in-app calendar visualization showing period boundaries and gap days

### Phase 7 — Cleanup
18. [ ] After 1-2 weeks of stability, drop the deprecated columns (`days`, `week_label`, `items`)
19. [ ] Remove fallback code paths from Phase 2

---

## Open Questions — Resolved on 2026-04-18

**Q1 — End-of-period trigger:** ✅ **Resolved.** Auto-prompt when the user opens the Brainstorm / Prep Table page AND `today > period_end` for their most recent period. The prompt offers two actions:
- **(a) "Edit what you actually ate this period"** — opens the period's `meal_plan_items` list so the user can correct/add logging for any days they fell behind
- **(b) "Lock in and finalize"** — marks the period as finalized. Any items still uncooked become leftovers (surfaced in the gap-day view via `current_leftovers` logic).

**Q2 — Mid-period editing:** ✅ **Resolved.** The plan is editable throughout the active period (no soft-lock while `today BETWEEN period_start AND period_end`). Users can add/remove meals, swap recipes, reorder, and mark items cooked at any time. The only "lock" is the end-of-period finalization (Q1 above), which happens *after* `period_end`.

Implications for implementation:
- Phase 3 write path is simpler — no read-only state management during active periods
- Phase 4 end-of-period review is the only UI gate on a period's lifecycle
- We should add a `finalized_at` timestamp to `meal_plans` so we can distinguish "active," "ended-but-not-reviewed," and "finalized" states

## Retention Policy (added 2026-04-18 per user feedback)

**All meal data is permanent.** Specifically:
- `meals` (logged eaten meals): permanent
- `vault` (saved Cookbook recipes): permanent
- `meal_plans` (historical plans, including finalized ones): permanent
- `meal_plan_items` (individual scheduled meals): permanent

**Leftover LABEL staleness (not data deletion):** An uncooked `meal_plan_item` from a finalized period stops appearing in the `current_leftovers` view **14 days after its parent period's `period_end`.** The item itself is never deleted — the user can always see it in their history. The rule simply keeps the gap-day "leftovers to roll forward" view focused on recent, actionable items.

Implementation: the `current_leftovers` view's WHERE clause includes `AND meal_plans.period_end >= (CURRENT_DATE - INTERVAL '14 days')`.

---

## Future Considerations (out of scope for this ADR)

- **Partner collaboration:** When this lands, expect to add `household_id` (or similar) to `meal_plans` and write RLS policies that scope access by household membership rather than by individual user_id.
- **Friend sharing via link:** Will likely add a `share_token` column to `meal_plans` (and maybe `vault`) and a public read-only RLS policy gated on the token. Doesn't conflict with this ADR.
- **Grocery list with quantities (AUDIT U4):** Likely adds `serving_count` to `meal_plan_items` and a separate `meal_plan_item_ingredients` join table. Builds cleanly on this ADR.
- **TypeScript migration (AUDIT M5):** Normalized rows are easier to type than jsonb blobs. This ADR makes that future migration easier.

---

## Approval

If you approve this ADR, the next step is for me to draft the **Phase 1 Claude Code prompt** (the schema migration) so you can hand it off and we begin execution. We'd also tackle Phase 0 items in parallel since they're security-critical and largely independent.

If you want to push back on any of the four decisions — especially Decision 2 (the jsonb vs. normalized-table call, which is the biggest commitment) — now is the time. After we start writing migrations, reversing course gets expensive.
