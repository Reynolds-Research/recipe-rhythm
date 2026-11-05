# Recipe Rhythm — TODO

> **The single next-work list** (2026-10-30). `docs/ROADMAP.md` is superseded as a work list; its open
> items are folded in below. `docs/STATUS.md` records what shipped; `docs/NORTH-STAR.md` is where we're going.
> **One item per session.** Each open item has a **Done when** — that is what the `reviewer` subagent
> (`.claude/agents/reviewer.md`) checks before the item is ticked. Close each session with a row in
> `docs/SESSION-LOG.md`.

## ⛔ Blocker — main is red

- [x] ~~**FIX-REACT-PAIR · `react` 19.2.7 vs `react-dom` 19.2.6**~~ ✅ _(fixed in `5ff8dd4`; both pinned to 19.2.7, Dependabot groups React; CI green on `main` 2026-10-31. Ticked 2026-11-01.)_ — `7cebd16` (Dependabot) bumped `react` alone; 27 of 62 Vitest files fail at import ("Incompatible React versions"). Fix: bump `react-dom` to the same version (and keep Dependabot grouping them). Effort: XS.
  - **Done when:** `npm ls react react-dom` shows one version; the `CI` workflow is green (62/62 test files load).

## 🔴 P0 — ship first

_From the 2026-08-02 UXR audit ([`audits/2026-08-02-uxr-heuristic-evaluation.md`](audits/2026-08-02-uxr-heuristic-evaluation.md)). These three are the highest-consequence, lowest-effort fixes — a silent data-loss path, an unguarded destructive action, and an app-wide contrast failure. Full P1/P2 list under **UX / Accessibility** below._

- [ ] **P0-1 · Meal-log save fails silently** — on a failed `meals` insert, `src/pages/LogMode.jsx:64-67` only `console.error`s and returns; the button drops from `Saving…` back to idle with no message. `LogMode` has no error state at all. User believes dinner is logged when it isn't. Fix: add an `error` state, set it in that branch, render it by the button (every sibling page already does this). Effort: XS (~2 lines).
  - **Done when:** a forced `meals` insert failure shows an on-screen error by the Save button, covered by a unit test (= ROADMAP VP-16).
- [ ] **P0-2 · Recipe delete has no confirm and no undo** — `RecipeCard.jsx:408-414` "Remove" → `Vault/index.jsx:82-85` deletes immediately, discarding a ~dozen-field AI-classified record. The DB write is a *soft* delete (`useVault.js:272-278` sets `deleted_at`), so data is recoverable. Fix: reuse the reset-plan confirmation sheet (`BrainstormMode/index.jsx:411-418`), then an undo snackbar that clears `deleted_at`. Effort: S.
  - **Done when:** Remove asks to confirm, and an undo snackbar restores the recipe by clearing `deleted_at`; a test covers both paths (= ROADMAP VP-5).
- [ ] **P0-3 · Brand orange fails AA contrast on every primary button** — white on `#EF4D23` = 3.64:1 (need 4.5:1); as 12px text on cream = 3.46:1. Hits `.btn-primary` app-wide. Fix: darken the brand fill token to ~`#C63D1C` (note `index.html:10` already uses the darker `#D74520` for `theme-color`). Effort: XS (one token) + extend `lint:ds` to guard the pair.
  - **Done when:** white on the primary fill measures ≥ 4.5:1, and `lint:ds` fails if the old `#EF4D23` pair comes back.

## 🧭 Shared household & calendar planning (PRD-008)

_Spec: [`docs/prds/PRD-008-shared-household-and-calendar-planning.md`](docs/prds/PRD-008-shared-household-and-calendar-planning.md). Evidence: [`docs/research/2026-11-01-prep-table-lockout.md`](docs/research/2026-11-01-prep-table-lockout.md). One phase per item; each phase may take more than one session._

- [x] ~~**Phase 1 · Household** — schema, setup migration, membership security rules, rollback script rehearsed on preview.~~ ✅ _(2026-11-01, PR #208; applied to prod the same day)_
  - **Done when:** verify SQL (one combined query) shows every kitchen row has a household and an outsider sees 0 rows; the rollback was rehearsed on preview (apply → roll back → apply); Matt applied it to prod.
- [ ] **Phase 2 · Calendar data + new Prep Table** — `planned_meals`, `week_confirmations`, data copy at switch-over, week grid, Confirm the week, grocery list per confirmed week. _Split 2026-11-02 into 2a–2c (too big for one session); the phase is done when 2c is._
  - **Done when:** every old plan item exists as a dated meal; the new Prep Table is live; the lockout explorer's four traps don't reproduce on the new screens.
  - [ ] **2a · Calendar data** (P0.3, P0.9 for P0.3) — the two new tables with membership rules, "changed since confirmed" stamping, a re-runnable copy of the old plans (`rr_copy_legacy_plans()`), verify + rollback, rehearsed on preview. No app change. Matt may apply the tables to prod early (nothing reads them); the copy only runs for real at 2c.
    - **Done when:** on preview, verify shows every old plan item as a meal (Maybe items with no date) and every served period as a confirmation, an outsider sees 0 rows; the rehearsal checks pass (writes, "changed since confirmed", re-run mirroring); rollback restores the schema + data fingerprint exactly.
  - [ ] **2b · New Prep Table behind an off switch** (P0.4, P0.6). Old screens untouched; the switch defaults off. Week shape decided 2026-11-02: option B, day buttons (PRD D8 v0.6; mockup "Prep Table Week Shapes"). Split into three sessions:
    - [x] ~~**2b-1 · Week data + helpers**~~ ✅ _(2026-11-02, PR #213; on prod 2026-11-02, rehearsed on preview 2026-11-03)_ — small migration (with verify + rollback, rehearsed on preview): her usual days on `household_preferences`, and the days shown for a specific week (only weeks she changed). `src/lib/weekRange.js` (Sun–Sat week for a date, ← / →, which days show: the week's own days, else usual days, plus any day with a meal) and `src/lib/plannedMeals.js` (load a week, add, move, remove, mark cooked, Maybe list, "Didn't get to these" = uncooked meals from the last two weeks). Vitest for both, Supabase mocked the existing way.
      - **Done when:** verify passes on preview with the rollback rehearsed; Vitest covers week boundaries (incl. a DST week), the shown-days rule (a day with a meal always shows), and each data helper's query.
      - _Done: PR #213. Matt applied it to prod first (verify 15/15); the preview rehearsal ran after, through the new preview connector: fingerprint before = after rollback (`78d1e166…` / 1008 / `bbaf7ed5…`), verify 15/15, write checks 15/15, re-applied. Switch decided: `VITE_NEW_PREP_TABLE` build setting._
    - [x] ~~**2b-2 · Week screen behind the switch**~~ ✅ _(2026-11-04, PRs #216 + #218; both used the drag version on their phones)_ — day buttons, ← / →, day rows with + add (recipe search, reuses `searchRecipes`) and ✨ suggest (proposals saved only on ✓, D3), Maybe tab, "Didn't get to these" tray. Switch: the `VITE_NEW_PREP_TABLE` build setting (decided 2026-11-02 in 2b-1): on for preview deploys, off in production until 2c.
      - **Done when:** with the switch on (preview deploy) she can plan a week without the old screens; switch off = today's app exactly (existing tests unchanged); component tests for hiding a day, the locked day with a meal, and ✓ on a suggestion.
      - _Status 2026-11-03: built (PR pending): `src/pages/PrepTable/` behind `VITE_NEW_PREP_TABLE`, `weekSuggest.js`, `featureFlags.js`; 37 new tests. **Open:** Vercel preview deploys use the production database (same `VITE_SUPABASE_URL` for Preview and Production), so "switch on in a preview deploy" means real data — Matt to decide how to try it._
      - _2026-11-04: she tried it on the preview and liked it; #216 merged (switch still off in production). Her two asks: drag meals between days, and brand orange instead of green — both on `feat/prd-008-week-drag`. Tick 2b-2 once she's tried the drag version._
    - [ ] **2b-3 · Confirm the week + groceries** — Confirm the week writes a `week_confirmations` row and generates that week's grocery list (existing `/api/grocery-list`); "changed since you confirmed → update the grocery list?"; empty nights told, never blocking.
      - **Done when:** confirm → list for exactly that week's meals; an edit after confirming shows the update prompt; Vitest covers "changed since confirmed" and the confirm flow.
      - _Status 2026-11-04: built on `feat/prd-008-confirm-week` (PR pending). Tick once she has confirmed one real week on a preview deploy (that writes a real confirmation + grocery list: the preview uses the production database). Decided by Matt: the list shows in a sheet on the Prep Table (share + add-your-own stay on the Groceries tab until 2c); the change prompt offers "Update list" and "Keep as is"._
      - _Note (2026-11-04, from the drag-and-drop review): a swap is two separate saves, and each one stamps the week "changed since confirmed" — so swapping two meals inside a confirmed week (same groceries) still triggers the "update the grocery list?" prompt, as does a swap that failed and was undone. Harmless (an extra prompt, never a missed one); don't mistake it for a bug. Could be refined later by comparing the meal set rather than stamping per write._
  - [ ] **2c · Switch-over** — re-run the copy on prod (mirrors whatever she planned on the old screens since), turn the switch on, deploy (Vercel auto-deploy is broken — see CI / Infrastructure), point the other readers of the old plan tables at `planned_meals` (Calendar tab via `fetchScheduledItemsInRange`, the grocery sheet via `fetchMostRecentPlan`, Preferences' clean-up of meals that break a new rule), rerun the lockout explorer on the new screens.
    - **Done when:** the phase's own **Done when** above holds on prod.
- [ ] **Phase 3 · Matt's nights** — assign a day, "pick something", suggestions that account for her nights.
- [ ] **Phase 4 · Retire the old flow** — periods, gap-day screen, lock-in, review, leftovers picker, plan drafts, overlap constraint.
- [ ] **Phase 5 · Measurement** — handoff-timing query, "added by" labels.

## 🛒 Grocery list quality (from her first confirmed week, 2026-11-05)

Her test of Confirm the week: amounts like "1.125 lbs shrimp" weren't store units, recipes she linked didn't feed their real ingredients, and Penne alla Vodka added nothing. Found (prod, read-only): the 4 linked recipes had no saved amounts or servings — new recipes never saved the list `analyze-recipe` returns (only a 2026-05 backfill had); `analyze-recipe` can't open links (it sees the URL as text); the Cookbook's photo was never sent to the AI. She uses NYT Cooking (paywalled), so screenshots are her way in.

- [ ] **Recipe ingredients: save them, read screenshots, fill the gaps** — branch `feat/recipe-ingredients` (PR pending). Matt decided 2026-11-05: a separate "Read ingredients from screenshots" button (up to 3, not the recipe photo); fill the 9 incomplete recipes now as AI estimates, marked, replaceable by screenshots; saving stays instant and the list fills in the background. Migration `20261105000001_vault_ingredients_source` (rehearsed on preview). **Apply the migration to prod first, or the Cookbook won't load**: the app reads and writes this column (this includes any preview deploy, which uses the prod database).
  - **Done when:** a recipe saved with screenshots stores their exact list + servings, marked "From your screenshots"; one saved without gets an estimate in the background, marked "Estimated"; an estimate never replaces a screenshot list (incl. after a tag edit); Settings fills only recipes with no list; Confirm names recipes whose part is a guess or empty. Vitest for each; on prod, the 9 recipes filled and one real recipe read from her screenshots.
- [ ] **Grocery list: shop amounts + "Check you have"** — each line shows what to buy ("1 lb bag") with the recipe total under it; pantry/spice items in a "Check you have" group. (Recommended over a toggle; revisit if she prefers one.)
  - _Status 2026-11-05: mockup "Grocery Shop Amounts Mockup" (3 screens, her real Nov 1–7 list): today → shop amount on the right with "Recipes use …" under it (only when different) → "Check you have" opened at the top, "Need it" moves an item onto the list, saved pantry staples named as left off. Waiting on Matt / her sign-off before building._
  - _Revised 2026-11-05 (Matt + her answer): "Check you have" becomes **"Assumed you have"** — a statement, not a weekly checklist (most spices last months, so asking every week would get ignored). Collapsed at the top; opened, each item has **Add** (onto the list) and **Always have** (writes to the existing `household_preferences.pantry_staples`, so it never shows again; Undo). Her habit: she checks the cupboard right before making the list when she's home, otherwise guesses — so the line sits where the list is made, and when she's away it at least names what this week needs. No new data for this part._
- [ ] **Read the real recipe from a link** — **Keep (reopened 2026-11-05 by a test).** The "likely unnecessary" guess was wrong: of her 23 linked recipes only 1 is NYT; 22 are open food blogs. P2, after the shop-amounts item. Effort: S–M.
  - _Test 2026-11-05 (prod read-only for the list; each page fetched once from the Mac with a Safari user agent; schema.org `Recipe` in JSON-LD):_ **9 of 22** have a Recipe block, all with `recipeYield` — 8 with a clean `recipeIngredient` list where most lines carry amounts (saltandlavender ×2, pinchofyum ×2, cookingclassy ×2, mission-food, alisoneroman), 1 with the whole list run together in one string (aseasonedgreeting). **7 of 22 blocked** (HTTP 403: gimmesomeoven ×4, ambitiouskitchen ×3). **6 of 22** load but have no Recipe block (broccyourbody ×3, smittenkitchen ×2; enjoybrami returned a bot-check page). Not tested: fetching from Vercel's servers (a data-centre address is likely blocked more often than a home Mac — inference), and whether the 6 without a block have the recipe as plain page text.
  - Shape: on "Add link", the server tries the page's Recipe block; if it finds one, save its list + servings marked "From the recipe page" (same rules as screenshots: never replaced by an estimate). Blocked / no block → say so in one quiet line and point to "Add screenshots". No AI call on the happy path.
  - **Done when:** a link to a page with a Recipe block saves its exact list + servings, marked; a blocked or block-less page shows the screenshots fallback and saves nothing; Vitest covers both with mocked fetches; on prod, one of her 8 readable links is read from Vercel (or Vercel is shown to be blocked, and the item is dropped).

## 🍝 Meal shapes (recipe + add-ons) — from her feedback, 2026-11-05

Her planned meals come in three shapes: a whole recipe, a set of simple parts, or a recipe plus an add-on ("Penne alla Vodka + shrimp"). Decided: keep it subtle. A planned meal stays a name plus an optional link to one recipe; add-ons are plain text on the planned meal, never cookbook entries, no component records, no meal-builder screen.

_Found (prod, read-only, 2026-11-05): all three shapes already exist in her plans. "Penne alla Vodka with Shrimp" is linked to the recipe "Penne alla Vodka", so she may already be renaming after picking. Her cookbook has no duplicates (an earlier "full of duplicates" read was wrong; that query covered every account)._

- [ ] **Watch her add a recipe + add-on meal once** — do first. See whether she already renames the meal after picking a recipe. If she does, the gap is mostly that the option is hard to find, and the next item may shrink to a small change that makes it visible. Effort: XS (one observation).
  - **Done when:** one observation is noted here (renames already / doesn't), and the next item's scope is confirmed or shrunk to match.
- [ ] **Add-on text on a planned meal** — P2. After she picks a recipe, a small, quiet "+ add something" text action; the meal shows as "Penne alla Vodka + shrimp" and keeps its recipe link. Nothing is written to the cookbook. Match the existing style: a subtle text action, no big button, no dashed outlines. Effort: M.
  - **Done when:** she can add an add-on to a planned meal on the Prep Table and it shows in the meal's name, with these Vitest cases:
    - adding an add-on keeps the recipe link (`vault_id` unchanged) and creates no new cookbook row;
    - the grocery-list input for a meal with an add-on includes both the linked recipe's ingredients and the add-on text, using the injected (mocked) AI client per the existing dependency-injection pattern.
- [ ] **Grocery list reads add-on text** — P2. Depends on **Add-on text on a planned meal**. The linked recipe brings its own ingredients; the add-on text goes to the AI to estimate, the same way one-off meals work today. Related: **Recipe ingredients: save them, read screenshots, fill the gaps** above, which makes the linked recipe's part real. Effort: S.
  - **Done when:** confirming a week with "Penne alla Vodka + shrimp" puts the recipe's ingredients and shrimp on the list; Vitest covers the input (the second case above).
- [ ] **"Usually with…" add-on suggestions** — P3. If a recipe has been paired with the same add-on before, offer it as a one-tap chip. Worked out from past plans when shown; no new stored data. Effort: M.
  - **Done when:** a recipe paired with the same add-on before shows it as a chip, tapping it adds it, a recipe never paired shows none; Vitest covers the pairing rule; no migration.
- [ ] **Cookbook cleanup: test data + typo** — P3. Remove the test rows from prod ("Forced Error Test Meal", "Audit Offbyone Probe", security-probe names) and fix the typo "Sesame Chicken Stir Fru". Use the migration workflow: rehearse on preview (apply → verify → roll back → verify → apply), one combined SELECT for verification, a rollback file. Covers the probe row in **R2.4 · QA housekeeping** below; tick that part there too. Effort: S.
  - **Done when:** the combined verify SELECT shows no test rows and no "Stir Fru"; the preview rehearsal passed with the rollback file; Matt applied it to prod.

**Open question (for her):** How often is the side dish something she'd want saved as a recipe? _Rarely:_ one recipe link plus add-on text is enough. _Often:_ add an optional second link for a side (a second optional column or a small link table, still not a component system). Revisit after **Watch her add a recipe + add-on meal once**, or once there are ~30 more planned meals to count from.

## Security

- [ ] **Fix high-severity Vite vulnerability** (reported 2026-04-18 by `npm audit`)
  - **Done when:** `npm audit` shows no high-severity `vite` advisory; CI green.
  - Package: `vite` 8.0.0 – 8.0.4 (currently installed)
  - Advisories:
    - [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) — Path traversal in optimized deps `.map` handling
    - [GHSA-v2wj-q39q-566r](https://github.com/advisories/GHSA-v2wj-q39q-566r) — `server.fs.deny` bypassed with queries
    - [GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583) — Arbitrary file read via dev-server WebSocket
  - Fix: `npm audit fix` (upgrades Vite past 8.0.4). Re-run `npm run test:unit -- --run` and `npm run build` afterward to confirm nothing regressed.
  - Impact: dev-server only — no production exposure, but still worth patching.

## CI / Infrastructure

- [ ] **Reconnect Vercel to GitHub (merges aren't deploying)** — found 2026-11-02: production stayed on PR #202 while #200, #205–#208 merged; the Vercel project shows no linked repo (likely lost when the repo moved to `Reynolds-Research`). Matt deployed `main` by hand (`npx vercel --prod`, live at `d65771c`). Fix: Vercel → Project → Settings → Git → connect `Reynolds-Research/recipe-rhythm`.
  - **Done when:** a merge to `main` produces a production deployment without a manual step.
  - **Found 2026-11-03:** the CLI shows the project under `mreynolds08-glitchs-projects/recipe-rhythm` (not the team in CLAUDE.md), and Vercel **blocks deploys whose commit author isn't on the project** — Claude-authored branch commits fail with "commit author doesn't have permission". Fix both together (connect the repo; allow or account for bot-authored commits on previews).
- [ ] **Move Matt's email out of the public repo** — it's in the LogMode feedback `mailto:` (`src/pages/LogMode.jsx`) and `QA-EDGE-CASE-AUDIT-2026-06-02.md` (pre-existing, found during PRD-008 phase 1). Fix: a `VITE_FEEDBACK_EMAIL` env var (or a form), and redact the audit doc. Note: git history keeps it either way.
  - **Done when:** `git grep` finds no real email address in the working tree.
- [ ] **Supabase connector: split into preview (writable) + prod (read-only)** — the connector's approval pop-up never reaches Matt in Cowork (3 timeouts on 2026-10-31/11-01; Supabase documents this as a client not showing form elicitations). Fix: two custom connectors — preview `https://mcp.supabase.com/mcp?project_ref=<preview-ref>&skip_elicitations=apply_migration,execute_sql`, prod `https://mcp.supabase.com/mcp?project_ref=mbhgornybnedsloqzdhz&read_only=true` — so prod can't be changed by Claude by construction. Until then Matt applies migrations by hand. **Interim since 2026-11-01:** Claude runs preview SQL from Matt's PC via `~/rr-sql/run.mjs` and the gitignored `.env.preview` (refuses any non-preview URL). Also consider replacing the leftover `feat/api-auth-rate-limit` preview branch with one persistent `dev` branch.
  - **Done when:** Claude can apply a migration to preview without a pop-up, and a write attempt against prod is refused by the connector.
  - **Progress 2026-11-03:** Matt added both connectors (`Supabase Preview Rehearsal`, writable; `Supabase Prod Read Only`). Preview half met: the 2b-1 rehearsal applied and rolled back with no pop-up. Prod: the connector logs in as `supabase_read_only_user` with `transaction_read_only = on`; a direct write test wasn't run (Claude's own safety check stopped it before it reached prod). To tick: Matt runs one harmless write through the prod connector, or accepts the read-only role as proof.

- [x] ~~**Disable scheduled CI audit workflows + pin Sonnet on manual runs**~~ ✅ _(2026-05-19, `chore/disable-audit-crons-pin-sonnet`, merged 2026-05-19)_
  - **Why this shipped:** the Anthropic API spend audit on 2026-05-19 (full diagnosis in the matching indigo-flow `SESSION-LOG.md` row) traced ~$17 of May spend on this repo to 11 scheduled `audit-*.yml` workflows running `claude -p` on the default model (Opus). The same audits already run locally via `scripts/run-audits.sh` (launchd, daily at 02:00) against the Max subscription for free — see the script's header comment: _"Uses your Max subscription, not the API."_ So the GitHub Actions copies were paying for audits the launchd job was running anyway. The May 11 spike (~95 Opus requests/min rate-limited) was specifically the `audit-dependencies` cron, which runs daily, racing through the codebase.
  - **What changed:** in all 11 `.github/workflows/audit-*.yml` files, the `schedule:` block and its `- cron:` line are commented out with a dated `# DISABLED 2026-05-19 — API-spend audit. Re-enable by uncommenting…` marker. `workflow_dispatch:` is preserved on every file so the audits can still be triggered manually from the Actions tab if a one-off review is wanted. The `claude -p --permission-mode bypassPermissions` invocation in each file now reads `claude -p --model sonnet --permission-mode bypassPermissions` so any future manual run defaults to Sonnet (~5x cheaper than Opus, plenty capable for the audit prompts).
  - **Net file change:** 11 files, +33/-33 (3 insertions + 3 deletions each). No behavior change to the local launchd path or to any of the prompts in `audits/prompts/`.

- [x] ~~**Mirror `TD-API-KEY-CLEANUP-1`** — Verify in `console.anthropic.com/settings/keys` that no leftover Recipe Rhythm keys are sitting unused. As of 2026-05-19 only one key was listed against the Recipe Rhythm workspace and it had a "Last used: 2026-05-11" entry consistent with the disabled `audit-dependencies` cron. If a second key surfaces, delete it. Effort: XS (Console-only).~~ ✅ _(2026-05-19, Console action — no code change; verified clean. The unused indigo-flow key that prompted the original `TD-API-KEY-CLEANUP-1` was deleted in the same Console pass.)_

- [x] ~~**Mirror `TD-API-COST-CAP-1`** — Set a monthly spend cap under `console.anthropic.com/settings/limits` so a runaway script (or a re-enabled-and-forgotten cron) can't drain credits silently. The cap applies org-wide, not per-workspace, so this is a single setting that protects both projects. Effort: XS (Console-only).~~ ✅ _(2026-05-19, Console action — no code change; org-wide monthly cap set via `console.anthropic.com/settings/limits`. Single setting covers both workspaces.)_

- [ ] **Mirror `TD-GITLEAKS-1`** — Add a `gitleaks` (or `trufflehog`) pre-commit hook in this repo too, plus a `.github/workflows/secret-scan.yml` job on every PR. Recipe Rhythm's git history is clean of API keys per the 2026-05-19 audit (`git log --all -S "sk-ant-api03"` returned zero hits), but the indigo-flow leak that triggered the audit shows the cost of not having a guard. Effort: XS (~30 min). _Cross-reference:_ same task is filed in indigo-flow's `TODOS.md` as `TD-GITLEAKS-1`.
  - **Done when:** a secret-scan workflow runs on every PR and a planted fake key makes it fail.

- [ ] **Optional: rethink the launchd audit cadence** — `scripts/run-audits.sh` only runs when the laptop is awake at 02:00. For audits with a hard cadence requirement (e.g. weekly security), the trade-off now that the GitHub Actions copies are disabled is: (a) keep one `audit-security.yml`-style workflow re-enabled with `--model sonnet` pinned, or (b) run the Max-backed CLI under a hosted box that's always on. Not urgent — the local cadence has been working — but worth noting so the trade-off is visible if a missed-audit gap ever surfaces. Effort: M if pursued.
  - **Done when:** superseded 2026-10-30 — the runner is ported to a systemd timer on the Linux PC (`scripts/systemd/`). Matt decided 2026-10-30: reports stay local on the PC (`.audit-logs/`, listed in `INDEX.md`); nothing posts to GitHub. Done when the timer is armed and one run shows in `.audit-logs/INDEX.md`.

## Code health

- [x] ~~**Lint errors to zero (LINT-REACT-1)**~~ ✅ _(2026-10-31: `useBrainstorm` mount effect moved below `loadData`; `canServe` is a plain expression; `DateRangePicker` resets overlap state in the tap handler, with a new test; `npx eslint .` now runs in CI.)_
- [x] ~~**Move data fetching out of effects (FETCH-IN-EFFECT-1)**~~ ✅ _(2026-10-31: the four suppressions are gone. Recent meals (`App.jsx`) and recipes (`useVault`) now use a plain query function whose result the effect applies in a callback with a cancel flag, the pattern `GapDayView` and `SharedGroceryList` already use. The meal-planning load runs without a leading `setLoading` on mount (`loading` starts true). The day picker derives `loading`, keeps its regenerate excludes in a ref, and resets on close during render; two new tests cover reopen and regenerate. No data-fetching library added.)_

## UX / Accessibility

_Source: [`audits/2026-08-02-uxr-heuristic-evaluation.md`](audits/2026-08-02-uxr-heuristic-evaluation.md) — Nielsen heuristic evaluation of the live app at 375px, axe-core 4.10.2 + tap-target sweep. Screenshots + raw axe JSON in [`audits/uxr-2026-08-02/`](audits/uxr-2026-08-02/). Severity IDs (P0/P1/P2) are the report's._

### P0 — ship first

_Moved to the **🔴 P0 — ship first** section at the top of this file: P0-1 (silent meal-log save failure), P0-2 (unguarded recipe delete), P0-3 (brand-orange contrast)._

### P1

- [ ] **P1-1 · Add-recipe form is ~5.7 screens tall with no bottom cancel** — ~90 optional chips across 8 sections between name and Save; only exit is the header ✕, which unmounts `RecipeForm` and silently destroys all draft state. Fix: bottom Save/Cancel pair; collapse chip sections behind an "Add details" disclosure; move Prep time + Notes above the chips. Effort: M (worth designing, not patching).
  - **Done when:** the form has a bottom Save/Cancel pair, chip sections sit behind "Add details", and leaving with a draft asks first.
- [ ] **P1-2 · Invented vocabulary at high-stakes moments** — "Your period has ended" banner (DB `planning_period` term; also an unfortunate collision given the app's stated primary user) and "Serve the plan" (`DayPicker.jsx:202`, means "commit & stop editing" — nearly the opposite of serving food). Fix: "Last week's plan is done — mark what you actually cooked"; reuse "Lock in" instead of "Serve." Copy-only.
  - **Done when:** neither "Your period has ended" nor "Serve the plan" appears in `src/`.
- [ ] **P1-3 · Selects/inputs missing accessible names** — Cuisine + Flavor `<select>`s have no label (`RecipeForm.jsx:307-314`, axe `select-name` ×2 critical); the image-upload file input has none (axe `label` critical). Fix: `aria-label` on all three. Effort: XS.
  - **Done when:** axe reports no `select-name` or `label` violation on the recipe form.
- [ ] **P1-4 · Star-rating tap targets are 22×22px** — half the 44px minimum, and 20 of them sit adjacent on the Cookbook screen, so a mis-tap silently sets the wrong rating (no undo). Also the 14×14 "View recipe" icon opens an external URL. Fix: 44px hit areas via padding/overlay, keep the glyph size. Effort: S.
  - **Done when:** star and view-recipe hit areas are ≥ 44×44 px in the tap-target sweep.
- [ ] **P1-5 · Drag-and-drop reorder has no keyboard path** _(= `AUDIT.md` L2, confirmed still open)_ — `useBrainstorm.js:259-266` registers only Pointer + Touch sensors; the drag handle is a `<div>` with no `tabIndex`/`role`. Fix: add `@dnd-kit` `KeyboardSensor` and make the handle focusable. Effort: S (~10 lines).
  - **Done when:** a planned meal can be reordered with the keyboard alone; a test drives `KeyboardSensor`.
- [ ] **P1-6 · Invalid ARIA on every recipe card** — `aria-expanded` on a `<div>` with no `role` (axe `aria-allowed-attr` ×4 critical), so the expand/collapse state is announced to nobody. Fix: `role="button"` + `tabIndex={0}`, or make it a real `<button>`. Effort: XS.
  - **Done when:** axe reports no `aria-allowed-attr` on recipe cards, and a card toggles with Enter and Space.

### P2 — backlog

- [ ] **P2-1 · Cookbook has no search / sort / filter** — invisible at 4 recipes, primary complaint at 40; seed suggestions occupy ~60% of the screen and should demote to a single entry point once the vault is non-empty. Effort: M.
  - **Done when:** the Cookbook can be searched by name and sorted; seed suggestions collapse to one entry once the vault is non-empty.
  - **Progress:** search shipped (PR #209 — Cookbook + Prep Table day picker, shared `src/lib/recipeSearch.js`); sort + seed collapse still open.
- [ ] **P2-2 · Read-path errors are silent or raw** — Auth passes Supabase's message straight through (`Auth.jsx:22,30`); Vault fetch failures only `console.error` (`useVault.js:60,66`) despite a wired-up `vaultError` banner (`index.jsx:233-238`), so a failed load looks identical to an empty Cookbook. Fix: map provider errors; populate `vaultError` on the fetch path. Effort: S.
  - **Done when:** a failed vault fetch shows the `vaultError` banner, and Auth shows mapped messages, not raw provider text (covers ROADMAP 1.5 / VP-2).
- [ ] **P2-3 · Sole surviving `alert()`** — `BrainstormMode/index.jsx:95` clipboard-copy fallback (fires on desktop, where a blocking native dialog looks worst). Replace with an inline banner. _(This is the tail of `AUDIT.md` M8, otherwise closed.)_ Effort: XS.
  - **Done when:** `grep -rn "alert(" src/` returns nothing.
- [ ] **P2-4 · No in-app help / first-run onboarding** — nothing for `onboard|firstRun|tour|welcome`; "About" is a personal letter, not help. A reviewer on the public demo can't learn what "Serve" means. Fix: one line of helper text under ambiguous controls (not a tour). Effort: XS.
  - **Done when:** each control named in P1-2 has one line of helper text.
- [ ] **P2-5 · Misc a11y** — `react-modal-sheet` backdrop is a nameless button (axe `button-name` critical, library-owned); calendar out-of-range day numbers render at 2.56:1 (`#9D9FA4` on `#FCFBFA`), removing the day's identity not just its emphasis. Effort: S.
  - **Done when:** out-of-range calendar days measure ≥ 4.5:1 and the sheet backdrop has an accessible name.
- [x] ~~**P2-6 · Pre-serve plan is device-local, unmarked**~~ ✅ _(2026-11-01, `feat/plan-draft-sync`: draft saved to the account via new `plan_drafts` table, newer copy wins on load, status line under Serve says where it's saved. Moved up per the North Star — step one toward Matt filling his nights.)_ — `handleDragEnd`/plan state persist to `localStorage` only (`useBrainstorm.js:213`), so a plan built on a phone won't appear on a laptop until served — yet the sign-in screen promises "sync your meal plan safely." Fix: mark "saved on this device" vs "saved to your account," or persist pre-serve. Effort: M.
  - **Done when:** the plan shows whether it's saved on this device or to the account, or pre-serve plans persist to the account.

## Folded from `docs/ROADMAP.md` (2026-10-30)

_Rationale and full finding text stay in ROADMAP.md (Sprints 1–3, QA edge-case audit VP-IDs). Status of each re-checked against `main` @ `18b60cb`, which hasn't changed since 2026-06-16._

- [ ] **R1.3 · LogMode "last night" off-by-one (VP-1)** — **Done when:** before 11 am, "last night" logs yesterday's date; a Vitest test with a mocked 06:00 clock covers it.
- [ ] **R1.4 · Mobile drag-and-drop in BrainstormMode** — prompt `docs/prompts/fix-brainstorm-mobile-drag.md`. **Done when:** a meal can be dragged on a phone (touch), verified on the preview deploy; a test covers the `TouchSensor` config.
- [ ] **R1.6 · Verify the Tailwind v4 + React 19.2 upgrade** — tests: answered by FIX-REACT-PAIR above. **Done when:** CI green and key screens checked by eye on the preview deploy.
- [ ] **R2.1 · Merge `chore/prd-002-p26-and-leftover-leak-e2e`** — **Done when:** rebased on `main`, CI green, merged; or closed with a reason.
- [ ] **R2.2 · Branch hygiene** — **Done when:** merged remote branches deleted; the stale `feat/prd-006-bite-{beta,gamma}` branches retired with a note.
- [ ] **R2.3 · QA P2 batch** (VP-3, VP-7 + the auth item; VP-8 is largely addressed per the 08-02 re-check; VP-5 is P0-2 above) — **Done when:** each VP-ID is fixed with a test, or split into its own item here.
- [ ] **R2.4 · QA housekeeping** — **Done when:** the "Audit Offbyone Probe" row is gone and the test account's baseline plan is a rolling window (ENV-2).
- [ ] **VP-10 / VP-11 / VP-12 / VP-13 (P1)** — photo-upload partial save, long-word overflow, duplicate recipes, swap-suggestion errors collapsed to `[]`. **Done when:** each is fixed with a test, or split out.
- [ ] **VP-14 / VP-15 / VP-17 (P2)** — legacy-plan date offset, DST "days ago", unescaped `.ilike()`. **Done when:** each is fixed with a test, or split out.
- [ ] **R3.1 · PRD-007 Phase 1 — schema + migration** — **Done when:** PRD-007 §11 Phase 1 acceptance rows pass the reviewer; migration + paired verify SQL applied to a preview branch; STATUS updated.

## Notes

- **Session log:** `docs/SESSION-LOG.md` (created 2026-10-30), newest on top. Before that there was no `SESSION-LOG.md` analogue to indigo-flow's. The 2026-05-19 Anthropic API spend audit narrative lives in `indigo-flow/docs/active/planning/SESSION-LOG.md` because the diagnostic work originated there; the recipe-rhythm side of the same audit is captured by the shipped item above plus the 11 file edits themselves.
