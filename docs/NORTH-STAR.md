# Recipe Rhythm — North Star

> **Status: DRAFT for Matt to ratify (2026-10-30).** Assembled only from what the PRDs and README already
> say; nothing here is new scope. Changing the goal, the criteria or the non-goals is Matt's call —
> agents propose edits, they don't make them. The PRD-drift audit (`audits/prompts/11-prd-drift.md`)
> checks the project against this page monthly.

## Goal

One household plans its meals, shops from one list, and records what it cooked, with near-zero
effort — tuned to how the household's primary planner actually cooks, plans and shops (README:
"her actual cooking, planning, and shopping behaviors were what I tested every product decision
against").

## Success criteria (each one checkable by someone else)

| # | Criterion | Source | How to check |
|---|---|---|---|
| S1 | Capture stays near-zero friction: adding a recipe takes < 3 s end-to-end, and logging an eaten meal never fails silently | PRD-001 G3, PRD-004 metrics, TASKS P0-1 | Time a recipe add on production; force a failed `meals` insert and see an on-screen error |
| S2 | Suggestions never violate a household hard preference | PRD-002 G5, PRD-004 | Unit/e2e test: no suggested recipe has an essential ingredient that a preference excludes |
| S3 | One tap produces a consolidated, sectioned grocery list, with zero duplicate items for planned-leftover days | PRD-003 G1/G5, PRD-007 G3 | e2e: plan a "cook for 2 nights" meal, generate the list, count that recipe's items once |
| S4 | The list opens for the partner from a link, read-only, with no login | PRD-003 G3 | Open the share link in a private window |
| S5 | Every screen meets WCAG AA contrast and 44 px touch targets, enforced by `lint:ds` | PRD-005 G1/G4/G8 | axe-core + tap-target sweep at 375 px (as in the 2026-08-02 UXR audit); today P0-3 and P1-4 in `TASKS.md` fail this |

## Non-goals

- Multi-user / partner collaboration and per-member preferences (single household, `auth.uid() = user_id`, until an ADR says otherwise) — PRD-001/002/006.
- Quantitative pantry tracking (quantities, expiry, replenishment) — PRD-003, PRD-006.
- Public sharing or social features beyond the read-only list link — PRD-001.
- Calendar-app integration — PRD-002.
- Structured ingredients replacing free text as the source of truth — PRD-006.

## Where this sits

`CLAUDE.md` (how to work) → **this page** (where we're going) → `docs/prds/` (what to build) →
`docs/STATUS.md` (what shipped) → `TASKS.md` (what's next, one item per session).
