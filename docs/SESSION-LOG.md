# Recipe Rhythm — Session log

Newest on top. One entry per working session, written at the end of it, so the next session can
start clean: **Done** (with PR numbers) · **Verified** (what was checked, how) · **Open / owed** ·
**Next** (the one `TASKS.md` item to pick up). Keep entries short; detail lives in PRs and STATUS.

---

## 2026-11-03 — PRD-008 2b-2: week screen behind the switch

**Done:** PR (open), branch `feat/prd-008-week-screen`. Also: 2b-1 rehearsed on preview through the new preview connector (records in PR #214).
- `src/pages/PrepTable/`: week tab (← / →, day buttons, day rows with + add / ✨ suggest, "Didn't get to these" tray) and Maybe tab. `usePrepTable` writes one row per action and reloads. Suggestions live only in memory until ✓ (D3).
- `src/lib/weekSuggest.js` (cookbook-only proposals via the existing recommender) and `src/lib/featureFlags.js` (`VITE_NEW_PREP_TABLE`). `App.jsx` picks the screen; unset = today's app.
- Matt decided: a recipe on the Maybe list still shows in "Didn't get to these".

**Verified:** Vitest 889/889 (37 new: 25 screen, 2 app switch, 2 flag, 6 suggest; no existing test changed), eslint, build, `lint:ds`. Reviewer FAIL on a real race (a slow reload after a save could paint the old week under the new title and save wrong days): fixed (numbered loads, the screen only draws the week matching its title, ← / → wait during saves) plus 44px targets, a visible locked-day message, failed ✓ keeps the suggestion. Seven deliberate breaks each failed a test. Screens rendered with fake data in Chromium at phone width.

**Open / owed:**
- **Preview deploys talk to the production database** (one `VITE_SUPABASE_URL` for Preview + Production in Vercel). Switching the new screen on in a preview means planning on real data. Matt to choose: try it on real data, point previews at the preview database, or test locally.
- Follow-ups noticed, not fixed: a stale `VITE_ANTHROPIC_API_KEY` sits in Vercel (not referenced by the code, so not in the bundle; delete it); the Vercel project shown by the CLI is `mreynolds08-glitchs-projects/recipe-rhythm`, not the team in CLAUDE.md (may explain the auto-deploy gap).

**Next:** finish 2b-2's Done when (try it with the switch on), then 2b-3, Confirm the week + groceries.

---

## 2026-11-02 (late) — PRD-008 2b-1: week data + helpers

**Done:** PR #213, merged (`d4d3d4e`). Applied to prod 2026-11-02 by Matt (verify 15/15) — before the preview rehearsal, by mistake; harmless (additive, nothing reads it yet).
- Migration `20261102000002_week_days`: `household_preferences.usual_days` (Sun–Thu default) and `week_days` (a week's own days, only for weeks she changed), membership rules, `rr_valid_week_days()`. Verify (15 checks), rollback, `rehearsal/05_week_days_checks.sql` (15 scenarios).
- `src/lib/weekRange.js` (Sun–Sat weeks, ← / →, shown days = chosen days + any day with a meal, day-button toggle; DST-safe) and `src/lib/plannedMeals.js` (load a week, save its days, add / move / remove / cooked, Maybe list, "Didn't get to these").
- Switch for the new screens: `VITE_NEW_PREP_TABLE` build setting (Matt's choice).

**Verified:** full rehearsal kit on a local Postgres 16 (prod shape → seed → phase 1 → 2a + copy → this): applied twice, verify 15/15, write checks 15/15 (each refusal for the intended reason), rollback → fingerprint identical, 2a verify still 21/21, re-apply passes. Read-only: preview has 2a and only fake accounts; prod has 2a. Vitest 854/854, eslint clean, build green. Reviewer subagent: FAIL on one real bug (the day toggle saved meal days into the week and the usual days), fixed with tests; re-reviewed.

**Open / owed:**
- ~~Preview rehearsal~~ done 2026-11-03 through the new preview connector: fingerprint before = after rollback (`78d1e166…` / 1008 / `bbaf7ed5…`), verify 15/15, write checks 15/15, re-applied, so preview matches prod.
- Supabase connector item (TASKS): preview half met; prod is a read-only role, but a direct write test is still to do.
- Decide: should a recipe parked on the Maybe list still show in "Didn't get to these"? (Today: yes.)

**Next:** 2b-2, the week screen behind `VITE_NEW_PREP_TABLE`.

---

## 2026-11-02 — PRD-008 phase 2a: calendar data

**Done:** PR #211 (open, not merged). Phase 2 split into 2a data / 2b screens / 2c switch-over (`TASKS.md`).
- `planned_meals` (one row per meal; no date = Maybe) and `week_confirmations` (a stamp on a date range, linked to its grocery list), with the household membership rules.
- "Changed since confirmed": a trigger stamps `changed_at` when a meal in a confirmed range is added, removed, renamed, re-linked or moved; ticking cooked / reordering / assigning don't.
- `rr_copy_legacy_plans()`: admin-only, re-runnable, mirrors the old tables (Matt's choice) but never overwrites, removes or re-adds a meal touched on the new screens (`rr_legacy_copied` ledger).
- No app change.

**Verified:** preview, from a fresh rebuild: verify 21/21; rehearsal scenarios 27/27 (writes, "changed since confirmed", re-run mirroring); rollback → schema + data fingerprint identical; applying twice and copying twice are no-ops. Vitest 802/802, build green. Reviewer subagent: PASS; its flags 1, 2, 4 and 5 fixed in the second commit. Prod data checked read-only: 21 dated + 3 Maybe items and 10 served plans, none of which break the new rules.

**Open / owed:**
- Matt: review + merge the PR; optionally apply to prod now (steps in the PR). The real copy runs again at 2c either way.
- Confirm the D4 narrowing (cooked / reorder / assign don't mark a week changed), marked INFERRED in the PRD.
- Week shape for 2b: she must be able to show fewer days as well as more. Decide on a mockup.
- Known, not fixed: one meal edit stops a copied confirmation from mirroring (safe side); update rules let a member rewrite "who added it" (same as phase 1).

**Next:** 2b, the new Prep Table behind an off switch. Start with the week-grid mockup.

---

## 2026-11-01 (late) — Recipe search (P2-1, search half)

**Done:** PR #209 (open, not merged).
- `searchRecipes(recipes, query)` in `src/lib/recipeSearch.js`: every word must match name / tags / notes; accent- and case-insensitive; ranked name-prefix → all words in name → the rest. Pure, so PRD-008 phase 2's "+ add" can reuse it.
- `RecipeSearchInput` (× and Escape clear; 16px text, no iOS zoom).
- Prep Table day picker: typing swaps the three sections for "From your cookbook" plus `Add "<query>" as-is` (one-off meal, not saved). No AI call while searching.
- Cookbook: filters the list, "N of M recipes", no-match message + Clear search, starter suggestions hidden while searching.
- The Prep Table's vault query now also loads `dietary_tags, notes` so search can see them.

**Verified:** Vitest — all new tests pass; lint, `lint:ds`, build green. Reviewer subagent: PASS (table in PR). Not yet clicked through on a preview deploy.

**Open / owed:**
- Matt: try both search boxes on the preview deploy, then merge #209.
- Two `RecipeCard.test.jsx` last-cooked tests fail locally on `main` too: "N days ago" is built by subtracting 24h steps, which crosses the 2026-11-01 DST change. CI (UTC) is unaffected. Follow-up, not fixed here.

**Next:** PRD-008 phase 2 — calendar data + new Prep Table (`TASKS.md` "Phase 2"); P2-1 sort + seed collapse remain open.

---

## 2026-11-01 (evening) — PRD-008 phase 1: shared household live

**Done:** PR #208.
- **Migrations:** households + one-per-account membership; `household_id` on the 8 kitchen tables; membership security rules via a SECURITY DEFINER helper; sign-up trigger. Matt now shares his wife's household ("Our kitchen"); his 6 old recipes stay in his old, memberless household.
- **Security fix:** `current_leftovers` had been readable with the public key (it ignored the security rules).
- **App:** ~27 `user_id` filters → household (`src/lib/household.js`). Deliberate exceptions: `plan_drafts`, and LogMode's back-link of the meal just logged.
- **Rollbacks + rehearsal:** a rollback for each migration, plus a preview rehearsal kit (`supabase/rehearsal/`).

**Verified:**
- **Preview (Supabase):** schema rebuilt from prod's catalog (fingerprint identical to prod). Apply → 40/40, 37/37, 14/14 → roll back (schema + data identical to before) → apply again.
- **Prod (applied by Matt, one all-or-nothing paste):** read-only, 44/44 setup checks. Both accounts see the same 34 recipes / 7 plans / 13 items. An outsider sees 0 rows.
- **Tests:** Vitest 776/776, lint and build green. E2E green except 3 lockout-explorer scenarios that fail on `main` too; with #207's spec, 6/6. Reviewer subagent: PASS.

**Open / owed (Matt):**
- Merge #207 and #208 (#208 right away: the old app can't save preferences or tag options until it deploys).
- Then on both phones: sign out and back in, check you both see the same Cookbook and plan.
- The prod setup file with real emails is in `~/rr-sql/` (outside the repo). Delete it, plus `.env.preview`, when you no longer need them.

**Postscript (2026-11-02):** after merging, Matt's Cookbook was empty: the new app never deployed (Vercel isn't linked to GitHub; prod was still on #202, which filters by `user_id`). Matt deployed `main` by hand → live at `d65771c`, shared Cookbook confirmed by Matt. TASKS: reconnect Vercel to GitHub.

**Next:** PRD-008 phase 2 — calendar data + new Prep Table (`TASKS.md` "Phase 2").

---

## 2026-11-01 (later) — lockout found, household + calendar spec

**Done:** Mapped the Prep Table flow from the code and built a Playwright lockout explorer on a stateful fake Supabase (PR #201): four traps reproduced, all from locked "period" boxes. Wrote PRD-008 (shared household + calendar planning: meals sit on dates, nothing locks, "Confirm the week" is her final say, Matt's nights, tested rollbacks). TASKS.md: PRD-008 phases + the parked Supabase two-connector fix. STATUS: PRD-008 row.

**Verified:** Explorer 6/6 scenarios ran to completion; findings cross-checked against her production plan history (read-only). Confirmed which account is hers (read-only; emails kept out of the repo).

**Answered (her):** week = Sun–Thu with Fri/Sat on demand; fine with tapping ✓ on suggestions; yes to the stopgap — shipped as PR #205 (ended week opens straight into the suggested-week view; explorer rerun: Friday → brainstorm, next week from fresh suggestions, week 1 history intact; still locked mid-week until PRD-008).

**Open / owed (Matt):** merge PRs #200, #201, #204, #205 (order doesn't matter; #205 is independent). #199 (jest-dom 7) needs its own look.

**Next:** PRD-008 phase 1 — household schema, setup migration, membership security rules, rollback script rehearsed on preview.

---

## 2026-11-01 — plan draft syncs to the account

**Done:** Her in-progress plan now saves to her account (~1 s after each edit), so it follows her across devices; on load the newer copy wins (device or account); serving or resetting deletes the draft. A status line under "Serve This Plan" says "Draft saved to your account" or "…on this device only". New table `plan_drafts` (separate from `meal_plans` on purpose — every `meal_plans` reader assumes "served"). Ticked the stale React-mismatch blocker (fixed in `5ff8dd4`). PR: see `feat/plan-draft-sync`.

**Verified:** 762/762 Vitest (13 new data-layer tests, 5 new BrainstormMode tests), `npx eslint .` 0 errors, `lint:ds` clean, `npm run build` ok. Migration applied to **prod** by Matt via SQL Editor (meant for preview; harmless — additive, empty table); live check: 4 columns, RLS on, 4 owner policies, 0 rows. Not applied to the preview branch. Supabase MCP `apply_migration` confirmations timed out 3× (prompt never reached Matt); read-only `execute_sql` works without a prompt.

**Open / owed:** after merge, check on two devices that a draft started on one appears on the other. Still separate accounts: Matt can't see her draft until the household spec ships.

**Next:** write the household-sharing spec (shared plan, Matt's nights as slots she hands him), then the silent meal-log save failure (P0-1).

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
