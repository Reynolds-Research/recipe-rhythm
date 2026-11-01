# Recipe Rhythm — Session log

Newest on top. One entry per working session, written at the end of it, so the next session can
start clean: **Done** (with PR numbers) · **Verified** (what was checked, how) · **Open / owed** ·
**Next** (the one `TASKS.md` item to pick up). Keep entries short; detail lives in PRs and STATUS.

---

## 2026-11-01 — plan draft syncs to the account

**Done:** Her in-progress plan now saves to her account (~1 s after each edit), so it follows her across devices; on load the newer copy wins (device or account); serving or resetting deletes the draft. A status line under "Serve This Plan" says "Draft saved to your account" or "…on this device only". New table `plan_drafts` (separate from `meal_plans` on purpose — every `meal_plans` reader assumes "served"). Ticked the stale React-mismatch blocker (fixed in `5ff8dd4`). PR: see `feat/plan-draft-sync`.

**Verified:** 762/762 Vitest (13 new data-layer tests, 5 new BrainstormMode tests), `npx eslint .` 0 errors, `lint:ds` clean, `npm run build` ok. Migration applied to **prod** by Matt via SQL Editor (meant for preview; harmless — additive, empty table); live check: 4 columns, RLS on, 4 owner policies, 0 rows. Not applied to the preview branch. Supabase MCP `apply_migration` confirmations timed out 3× (prompt never reached Matt); read-only `execute_sql` works without a prompt.

**Open / owed:** after merge, check on two devices that a draft started on one appears on the other. Still separate accounts: Matt can't see her draft until the household spec ships.

**Next:** write the household-sharing spec (shared plan, Matt's nights as slots she hands him), then the silent meal-log save failure (P0-1).

---

## 2026-10-31 — North Star ratified

**Done:** Replaced the draft `docs/NORTH-STAR.md` (which was reverse-engineered from the shipped PRDs) with one built from a facilitated interview with Matt, including his wife's own priority ranking. Goal: every week she plans is fully covered, varied, and shopped for, and the app helps close the gaps, including Matt's nights. Five outcome criteria, three non-goals, a "not now" list, and drift signals for the monthly PRD-drift audit. Every line is tagged CONFIRMED or INFERRED.

**Verified:** Gap check against all seven PRDs (problem, goals and non-goals sections) and TASKS.md. Biggest gaps: Matt can't use the shared plan (single-user model; partner collaboration is a non-goal in two PRDs), no variety flag on her own picks, no grocery coverage check, no measurement hooks.

**Open / owed (Matt):** review and merge the PR; decide which suggested TASKS.md and PRD changes to adopt.

**Next:** fix main being red (the React / React DOM version mismatch). Still the blocker.

---

## 2026-10-30 (later) — audit reports local only

**Done:** `run-audits.sh` no longer posts GitHub issues (repo is public; security/RLS findings). Reports go to `.audit-logs/<audit>-<date>.md`, indexed newest-first in `.audit-logs/INDEX.md`. README, systemd unit and TASKS updated.

**Verified:** with a stub `claude`, two runs wrote both reports, stripped the outer code fence, and put the newer run first in INDEX.md; no `gh` calls remain in the script.

**Owed (Matt):** after merge, on the PC: switch to `main`, `scripts/systemd/install.sh`, enable the timer.

**Next:** P0-1.

---

## 2026-10-30 — project-system audit fixes (Cowork, Linux PC)

**Done:** this PR. Added `docs/NORTH-STAR.md` (DRAFT for Matt), the `reviewer` subagent, a "Definition of done" in `CLAUDE.md`, `CI` on every PR (Vitest + build), this log. `TASKS.md` is now the single next-work list with a Done-when per item (ROADMAP folded in). The PRD-drift audit prompt points at STATUS / NORTH-STAR / PRD-001–007 / ADR-001–005 instead of the retired `RECIPE_TODOS.md`. The audit runner runs on Linux (`scripts/systemd/`, not armed). STATUS reconciled to `18b60cb`. The two 2026-10-25 commits from `backup/pre-migration-2026-10-25` were carried onto `main` here.

**Verified:** `npm run build` passes on `main`. `npx vitest run` on `main`: 27 of 62 files fail at import (React 19.2.7 vs react-dom 19.2.6); the 529 tests that load pass. So `CI` will be red until FIX-REACT-PAIR lands — that's the gate working.

**Open / owed (Matt):** ratify or edit `docs/NORTH-STAR.md`; decide where audit findings go before arming the timer (the repo is public); switch the PC checkout from the backup branch to `main` after merge.

**Next:** FIX-REACT-PAIR, then P0-1.
