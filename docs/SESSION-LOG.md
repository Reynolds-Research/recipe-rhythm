# Recipe Rhythm — Session log

Newest on top. One entry per working session, written at the end of it, so the next session can
start clean: **Done** (with PR numbers) · **Verified** (what was checked, how) · **Open / owed** ·
**Next** (the one `TASKS.md` item to pick up). Keep entries short; detail lives in PRs and STATUS.

---

## 2026-11-01 (later) — lockout found, household + calendar spec

**Done:** Mapped the Prep Table flow from the code and built a Playwright lockout explorer on a stateful fake Supabase (PR #201): four traps reproduced, all from locked "period" boxes. Wrote PRD-008 (shared household + calendar planning: meals sit on dates, nothing locks, "Confirm the week" is her final say, Matt's nights, tested rollbacks). TASKS.md: PRD-008 phases + the parked Supabase two-connector fix. STATUS: PRD-008 row.

**Verified:** Explorer 6/6 scenarios ran to completion; findings cross-checked against her production plan history (read-only). Confirmed which account is hers (read-only; emails kept out of the repo).

**Answered (her):** week = Sun–Thu with Fri/Sat on demand; fine with tapping ✓ on suggestions; yes to the stopgap — shipped as PR #205 (ended week opens straight into the suggested-week view; explorer rerun: Friday → brainstorm, next week from fresh suggestions, week 1 history intact; still locked mid-week until PRD-008).

**Open / owed (Matt):** merge PRs #200, #201, #204, #205 (order doesn't matter; #205 is independent). #199 (jest-dom 7) needs its own look.

**Next:** PRD-008 phase 1 — household schema, setup migration, membership security rules, rollback script rehearsed on preview.

---

## 2026-11-01 — Prep Table drag easier on phones

**Done:** Requested by Matt's wife: moving meals between days wasn't discoverable and barely worked on a phone. Root cause: `PointerSensor` claimed touch presses and the browser cancelled them as a scroll, so press-and-hold never started a drag. Swapped to `MouseSensor` + `TouchSensor`; the whole meal card is now the handle (bigger, darker grip), with a buzz and lift on pickup and an outlined landing day. Served plans no longer show a grip that does nothing. PR on `feat/prep-drag-affordance`.

**Verified:** New Vitest (`MealPlanCard.test.jsx`) and a new Playwright test (`e2e/prep-table-touch-drag.spec.js`) that drives real touch events at phone size against the mocked backend; both fail without the fix. Full Vitest 747/747, all 5 e2e, build, `lint:ds`. Not tried on a real phone yet.

**Open / owed:** Moving meals after a plan is served is a bigger change (DB writes); revisit with the lockout findings. `TASKS.md` still lists "main is red" (react/react-dom mismatch), but Vitest is fully green on `origin/main` @ `9aa2276` after #197; close that item after checking.

**Next:** close the react-pair blocker if confirmed, then P0-1 (meal-log save fails silently).

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
