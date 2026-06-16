# Recipe-Rhythm — Roadmap

> **Purpose:** Near-term sequencing of work, optimized for **stability first**. This complements `docs/STATUS.md` (which records what has *shipped*); this file records what to do *next* and in what order. Covers roughly the next 2–3 working sessions ("sprints").
>
> **Created:** 2026-06-16 (Cowork planning session) · **Horizon:** next 2–3 sprints · **Bias:** fix what's broken before building what's new.

---

## Context snapshot (as of 2026-06-16)

The app is mature — five of six PRDs are feature-complete (all P0 shipped); PRD-003 has Phase 1 shipped with P1 polish remaining. Since `STATUS.md` was last verified (2026-05-30 @ `7d71a52`), `origin/main` has also gained:

- **PR #135** — P0 crash fix (`current_leftovers` excludes shortlisted rows). Merged.
- **PR #133 + #134** — JWT auth + per-user rate limiting on `/api/*`, plus a production config guard. Merged.
- **Dependabot** — React 19.2.6 and **Tailwind CSS v3 → v4** (a major-version upgrade). Merged.

Two things to be aware of before starting:

1. **`STATUS.md` is stale** relative to the above — reconciling it is the first task (repo rule: outdated STATUS is a release blocker).
2. **The current working branch (`chore/prd-002-p26-and-leftover-leak-e2e`) is behind `origin/main`** — its `package.json` still pins Tailwind 3.4.19, i.e. it predates the v4 bump. It needs rebasing.
3. **Three planning docs are uncommitted local files** in the working tree: `QA-EDGE-CASE-AUDIT-2026-06-02.md`, `docs/prds/PRD-007-mid-period-leftovers.md`, and `docs/prompts/fix-brainstorm-mobile-drag.md`. They need to be committed so they're backed up and visible to Claude Code.

---

## Sprint 1 — Stabilize (do this first)

Goal: the app is trustworthy and the repo is honest about its own state.

| # | Task | Why it's here | Source |
|---|---|---|---|
| 1.1 | **Reconcile `STATUS.md`** with `origin/main` (PRs #135, #133/#134, #118/#119). Bump the "Last verified" line. | Repo rule: stale STATUS blocks releases. Cheap, unblocks everything else. | git history |
| 1.2 | **Commit the orphaned planning docs** (QA audit, PRD-007, drag-fix prompt). | They only exist locally right now — no backup, invisible to Claude Code. | working tree |
| 1.3 | **Fix LogMode "last night" date off-by-one (VP-1).** Before 11am, subtract a day for the "last night" case; add a Vitest test with a mocked 06:00 clock. | **P1, confirmed live.** Silently corrupts the cooking record feeding badges, recommendations, and the calendar. Deterministic, not edge-case. | QA audit VP-1 |
| 1.4 | **Restore mobile drag-and-drop in BrainstormMode.** Likely a missing/misconfigured `TouchSensor` in dnd-kit. Prompt already drafted. | User-reported regression — "drag doesn't do anything on my phone." Core planning interaction. | `fix-brainstorm-mobile-drag.md` |
| 1.5 | **Surface load/save failures (VP-2).** Add error state + retry to `useVault.fetchRecipes` and `LogMode.finalizeSave` (ideally a shared toast). | **P1.** A failed load looks like an empty cookbook; a failed save looks like a dead button. | QA audit VP-2 |
| 1.6 | **Verify the Tailwind v4 + React 19.2.6 upgrade.** Run the test suite and eyeball key screens on `origin/main`. | Major CSS-framework version jump merged via Dependabot — confirm nothing broke visually or in CI. | Dependabot PR #119 |

**Exit criteria:** STATUS reconciled; planning docs committed; the two P1 bugs fixed with tests; mobile drag works on a real device; Tailwind v4 confirmed clean.

---

## Sprint 2 — Harden & clean up

Goal: clear the small-stuff backlog and the branch clutter so Sprint 3 starts clean.

| # | Task | Why it's here | Source |
|---|---|---|---|
| 2.1 | **Merge the in-flight `chore/prd-002-p26-and-leftover-leak-e2e` branch** (PRD-002 P2.6 served_at untangling + leftover-leak e2e regression). Rebase onto current `origin/main` first. | Work already in progress; finish and land it before it rots. | current branch |
| 2.2 | **Branch hygiene.** Delete merged-but-undeleted remote branches (~50 exist); investigate/retire the two stale `feat/prd-006-bite-{beta,gamma}` branches that show unmerged commits for already-shipped work. `git worktree prune`. | The branch list is unreadable; makes it hard to see what's actually open. | git state |
| 2.3 | **QA P2 batch.** Pick off the cheap hygiene fixes: recipe-name length cap (VP-3), delete confirmation/undo (VP-5), atomic grocery regenerate (VP-7), hoist ErrorBoundary to wrap the whole app (VP-8), clear lingering auth success message (VP-9). | Low-risk, high-polish. None individually urgent, but they add up. | QA audit VP-3,5,7,8,9 |
| 2.4 | **QA housekeeping.** Delete the leftover "Audit Offbyone Probe" test row; refresh the test account's expired baseline meal plan to a rolling window (ENV-2). | Test account is in a stale state that blocks live drag/Serve smoke tests. | QA audit HK-2, ENV-2 |

**Exit criteria:** P2.6 merged; branch list down to genuinely-open work; P2 hygiene batch shipped; test account usable for smoke tests again.

---

## Sprint 3 — Build (PRD-007: Mid-Period Leftovers)

Goal: start the one major new feature, now that the foundation is stable. PRD-007 is fully drafted with all prerequisites met. It's phased into four independently-shippable chunks — this sprint targets the first one (and optionally starts the second).

| # | Task | Notes | Source |
|---|---|---|---|
| 3.1 | **PRD-007 Phase 1 — schema + migration.** Add `meal_plan_items.leftover_source_id` FK (ON DELETE CASCADE) + index + paired verify SQL; behind a feature flag. Audit the existing `LeftoverPicker` data shape (OQ.B) before writing the one-shot migration script. | Validates the "ghost slot" data model before any UI. Follow the standard DB-touching workflow (Supabase preview branch → apply → verify → hand off to prod). | PRD-007 §6 P0.1, §11 Phase 1 |
| 3.2 | *(stretch)* **PRD-007 Phase 2 — plan-time "Stretch to N nights" picker** + ghost-slot rendering + collision-to-Maybe. | The most visible UX chunk. Only start if Phase 1 lands cleanly with sprint time left. | PRD-007 §11 Phase 2 |

**Before Sprint 3 starts:** resolve PRD-007's open questions OQ.A–OQ.G (a few are quick product calls you can make directly — e.g. auto-pick the next open day, global-vs-per-recipe opt-out).

---

## Parked (not in the next 3 sprints)

Tracked so they don't get lost, but explicitly *not* scheduled yet:

- **PRD-003 grocery P1 polish** — auto-regenerate prompt, individual-item edit, plain-text export, custom section order, source-recipe captions, staple override.
- **PRD-007 Phases 3–4** — cook-time "Any leftovers?" prompt in LogMode + served-plan exception; grocery-list dedup + `LeftoverPicker` rewrite.
- **Scattered P1 nice-to-haves** across PRD-001/002/004/005 — skeleton loaders, standardized haptics, per-day filter chips, override-frequency analytics, `/dev/styleguide` route, empty-state illustrations.
- **PRD-001 ops** — `api_rate_limits` nightly cleanup cron; bulk-link cleanup tool for old `meals.vault_id IS NULL` rows.

---

## How to use this file

- This is a *planning* artifact. As items ship, record them in `STATUS.md` (the source of truth for shipped work), then check the item off or remove it here.
- Re-sequence freely at the start of each planning session — stability items should always float to the top if new bugs appear.
- When a sprint's work is fully shipped, delete that sprint's section and pull the next batch up from "Parked."
