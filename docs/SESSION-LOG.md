# Recipe Rhythm — Session log

Newest on top. One entry per working session, written at the end of it, so the next session can
start clean: **Done** (with PR numbers) · **Verified** (what was checked, how) · **Open / owed** ·
**Next** (the one `TASKS.md` item to pick up). Keep entries short; detail lives in PRs and STATUS.

---

## 2026-11-05 (evening) — Link-reading test; grocery shop-amounts mockup

**Done:** branch `docs/link-read-test` (this PR, docs only).
- **Link test** (TASKS "Read the real recipe from a link"): prod read-only, her household has 23 linked recipes, only 1 NYT. The other 22 fetched once each from the Mac (Safari user agent), checked for a schema.org Recipe block: 9 have one (8 clean, with amounts + `recipeYield`; 1 run together in one string); 7 blocked (403: gimmesomeoven, ambitiouskitchen); 6 load with no block (broccyourbody, smittenkitchen, enjoybrami = bot check). Recommendation: **keep**, as P2 after shop amounts; the item is rewritten with a Done-when that includes trying it from Vercel.
- **Mockup** "Grocery Shop Amounts Mockup" (Design canvas, 3 screens) from her real Nov 1–7 list: today / proposed shop amounts / Check you have opened.

**Verified:** counts come from the script output (one fetch per page). Not verified: fetching from Vercel's servers (likely blocked more often; inference); whether the 6 block-less pages have the recipe as plain text.

**Open / owed (Matt):** merge this PR; react to the mockup (placement of Check you have: top vs bottom; which items count as "check you have"; whether "Recipes use" should show on every line).

**Next:** build Grocery list: shop amounts + "Check you have" once the mockup is agreed.

## 2026-11-05 (later still) — Recipe source: link and screenshots side by side

**Done:** on PR #222 (branch `fix/recipe-card-one-list`). Matt's phone feedback: the screenshot button was too loud; a recipe's link could only be added through Edit. Mockup "Recipe Source Mockup" (5 screens) agreed after one round (app style, small text actions, quiet panel, short copy).
- `src/pages/Vault/RecipeSource.jsx`, used on a Cookbook card (above the ingredient chips) and in Add a recipe (under the name): "Add link" and "Add screenshots" side by side as small text actions. A link is added or changed right on the card (no Edit): `useVault.setRecipeLink`; `https://` added if missing; empty = removed. Screenshots: "Amounts from your screenshots · Serves N · Replace". Right after a read, a quiet cream "Here's what I read" box with "Looks right". Status: "Amounts estimated · Serves N" / "No amounts saved yet." / "No ingredients yet."
- The card's old link line at the bottom is gone (it's in Recipe source). Add a recipe: the photo moved down to "Add a photo of the dish (optional)".

**Verified:** Vitest 1025/1025, eslint, build. Real Chromium at phone width (fake Supabase + stubbed AI): add link on the card → saved; screenshots → panel → Looks right; saved row = link + `screenshot` + servings 4; no page errors.

**Next:** unchanged — her screenshot test on the preview, then Grocery list: shop amounts + "Check you have".

---

## 2026-11-05 (later) — Recipe card: one ingredient list; no doubled units

**Done:** PR (open), branch `fix/recipe-card-one-list`. Matt's feedback after testing #221 on his phone: two ingredient lists on one card is redundant; "8 ounces ounces". Matt decided: the card keeps the essential / optional chips as its one list; the amounts are saved (grocery list) but shown only right after a screenshot read, in a dashed "Here's what I read" panel with "Looks right", which closes it. Below the chips: "Amounts from your screenshots · Serves 4" (or "estimated", or "No ingredients yet").
- Doubled units: the AI writes the unit in the quantity AND the unit field. `formatAmount` (groceryRecipes.js) adds the unit only when the quantity doesn't already end with it — fixes the card and the grocery-list prompt, including recipes already saved.

**Verified:** Vitest 1020/1020, eslint, build. Real Chromium at phone width with the fake Supabase + a stubbed AI read: before → panel (no "ounces ounces") → "Looks right" → one list; no page errors.

**Next:** unchanged — her screenshot test on the preview, then Grocery list: shop amounts + "Check you have".

---

## 2026-11-05 — Recipe ingredients: save them, read screenshots, fill the gaps

**Why:** her first confirmed week (preview, real data). Amounts like "1.125 lbs shrimp"; linked recipes didn't feed their real ingredients; Penne alla Vodka added nothing. Found (prod, read-only): all 4 linked recipes that week had no saved amounts or servings (added Oct 31 – Nov 3); new recipes never saved the list `analyze-recipe` returns (only the 2026-05 backfill had); 9 of 36 recipes affected; `analyze-recipe` can't open links (URL is just text); the Cookbook photo was never sent to the AI. The odd decimals = AI-estimated amounts × household 3 ÷ assumed yield 4.

**Done:** PR (open), branch `feat/recipe-ingredients`. Matt decided: separate screenshot button (up to 3, not the photo); fill the 9 now as marked estimates, replaceable by screenshots; save stays instant, list fills in the background.
- Migration `20261105000001_vault_ingredients_source` (`'screenshot'` / `'estimated'`), verify + rollback. Rehearsed on preview: preview = prod fingerprints, applied twice, verify 4/4, write checks 3/3, rollback fingerprint identical, re-applied. **Not on prod yet.**
- `analyze-recipe`: up to 3 images, "copy exactly" rule; 400 on more / wrong type / empty.
- `src/lib/recipeIngredients.js`; Cookbook form button; recipe card list + source + replace-by-screenshot; Settings "Fill in N recipes" (only recipes with no list; replaced the old re-extract-everything button); suggestions + LogMode save the estimate; a tag edit never re-estimates a screenshot list; an estimate is guarded in the database too.
- Confirm the week names recipes that added nothing or whose part is a guess.

**Verified:** Vitest 1014/1015 (the 1 = RecipeCard "Last cooked" DST test, fails on `main` too); eslint, build, `lint:ds`. Nine deliberate breaks each failed a test. Real Chromium: a 1290×2796 screenshot → 738×1600 JPEG, 142 KB (3 fit far under Vercel's 4.5 MB). **Not verified:** a real AI read of a screenshot — the Mac's `.env` still has the old, revoked Anthropic key (401). Reviewer (fresh context): **PASS**; flags 1–4 fixed (deploy-order note, estimate guarded in the DB, Save waits for screenshots, servings > 0 + `estimateFields` test).

**Open / owed (Matt):** (1) apply `20261105000001` to prod and run its verify — before anything ships, or the Cookbook won't load; (2) merge the PR; (3) on a preview: Settings → "Fill in 9 recipes", then she adds screenshots to one real NYT recipe and re-confirms the week; (4) optional: put the new Anthropic key in the Mac's `.env` (local AI calls fail today). Then tick the item.

**Next:** Grocery list: shop amounts + "Check you have".

---

## 2026-11-05 — Vault: rename a recipe

**Done:** PR (open), branch `claude/wonderful-lovelace-ti0378`. Ad-hoc request (not a TASKS item): recipe names are now editable in the Vault edit panel (text box at the top of "Edit"). Trimmed; blank disables Save; renaming to a name another active recipe uses shows "already in your vault" and keeps the editor open (case-only changes allowed). No AI spell-check on rename (a hand edit is deliberate). No migration: plans snapshot the name, so past plans keep the old name by design.
**Verified:** 3 new tests in `src/pages/__tests__/Vault.test.jsx`; full Vitest 930/930 pass; `npm run build` ok; `lint:ds` clean. 4 test files can't load locally without Supabase env vars (`supabaseUrl is required`), the same on `main`.
**Open / owed:** check on a phone after the preview deploys.
**Next:** unchanged; pick up the top of `TASKS.md`.

---

## 2026-11-04 (later) — PRD-008 2b-3: Confirm the week + groceries

**Done:** PR (open), branch `feat/prd-008-confirm-week`. Ticked 2b-2 (#216 + #218 merged, both used it on phones).
- "Confirm the week" (bottom of the week): stamps a `week_confirmations` row for Sun–Sat, then makes the week's grocery list from exactly its meals through the existing `/api/grocery-list`, and opens it in a sheet. Empty days from today on are told ("Wed Nov 4 has no meal yet. The grocery list will skip it." → Confirm anyway / Not yet), never blocking. Meals not in the Cookbook are left off and named under the list.
- Confirmed week: "✓ Confirmed <day>" + Grocery list button. After an edit (the 2a trigger stamps `changed_at`): banner at the top, **Update list** or **Keep as is** (Matt's choice, both). If the list can't be made, the week stays confirmed and offers "Make the grocery list".
- Remaking never edits the old list: new list → link → clear the stamp only if it's still the one we saw (a partner's edit meanwhile keeps the prompt) → delete the old list.
- `src/lib/weekGroceries.js`; `src/lib/groceryRecipes.js` (recipe-building moved out of `GroceryListBody`, unchanged); `WeekConfirm.jsx`, `GrocerySheet.jsx`. No migration (2a tables are on prod; checked read-only: 0 confirmations, 4 rules).
- Matt decided: the list shows in a read-only sheet on the Prep Table; share + add-your-own stay on the Groceries tab until 2c.

**Verified:** Vitest 973/973 (34 new), eslint, build, `lint:ds`. Nine deliberate breaks: eight each failed the right test; the ninth ("stamp twice") is unreachable (Confirm only shows on an unconfirmed week). Real Chromium at phone width with the stateful fake Supabase + a stubbed AI: confirm → empty-day prompt → Confirm anyway → list sheet; changed banner → Update list → new list linked, old one deleted, stamp cleared; no page errors. Reviewer (fresh context): **PASS**; its flags 1, 2 and 4 fixed (stale sheet after changing weeks, a linked list reported as failed, an unchecked link), each with a test. Not fixed (harmless): two partners remaking at once leaves a spare unlinked list; the "No ingredients saved for…" note stays until the next confirm / week change.

**Open / owed (Matt):** merge the PR; then she confirms one real week on a preview deploy (same `git archive` + `vercel deploy --build-env VITE_NEW_PREP_TABLE=true` steps as 2b-2). That writes a real confirmation + list on prod and makes one AI call. Then tick 2b-3.

**Next:** 2c, Switch-over (fresh session).

---

## 2026-11-04 — PRD-008 2b-2 follow-up: drag-and-drop + brand orange

**Done:** PR (open), branch `feat/prd-008-week-drag`. Her feedback after trying the new Prep Table: she liked it; wants to **drag meals between days** (part of how she plans) and **brand colours** (the cooked tick was green).
- `src/pages/PrepTable/dragDrop.js`: sensors copied from the old screen (mouse 8px, touch 250ms hold, plus keyboard from the grip), `resolveDrop`, a collision rule that also works for keyboard drags. Each day row is a drop target (lights up); each meal card is draggable (grip shown). A drop moves only that meal, to the end of the day; it shows at once, then saves; a failed save puts it back and says so.
- Cooked tick: `bg-brand-600` (the old screen's `#D74520`), no green left in `src/pages/PrepTable/`.
- **Swap (Matt, same day):** only the dragged meal moves; a taken spot swaps. Meal cards are drop targets too; a one-meal day swaps with its meal; 2+ meals and not on a card = join the end. The day's header shows "⇄ Swap with …" (the dragged card hides the target card). A swap is two saves; if the second fails the first is undone and the screen goes back.

**Verified:** Vitest 910/910 (18 new). Two real bugs caught and fixed: a failed drop's reload cleared the error message (a test); offline, a failed save + failed reload left the meal on the wrong day (reviewer) — now the week from before the drop is put straight back. Four deliberate breaks (offline revert, PointerSensor swap, keyboard drag on the whole card, no busy guard) each failed exactly the right test. Screen-reader announcements use meal + day names; eslint, build, `lint:ds`. Real Chromium with fake data: mouse drag Mon → Wed lit the target and saved; touch quick swipe moved nothing, press-and-hold + drag Tue → Thu saved; no errors.

- **Cooked tick on a move (Matt):** moved to a future day or a plain move → tick comes off; swapped with another cooked meal (today / past) → both keep it; never gained by moving; same-day reorder keeps it. Same rule for the "Which day?" button. `keepsCookedTick` in `plannedMeals.js`; `moveMeal` takes `cooked` / `cookedAt` so a failed swap's undo restores the tick exactly.

Extra bug found in the real-browser check and fixed: a mouse/touch drag let go outside every day could still drop on whatever the card overlapped (that fallback is now keyboard-only). Vitest 939/939 after the swap + tick work; ten deliberate breaks of the swap logic each failed a test. Reviewer round 3 FAIL: if half a swap saved and the undo also failed, the screen showed the old plan — now it reloads what is really saved, or says to refresh.

- **After both tried it on their phones ("looks and works great"):** Matt asked for subtler drag feedback — the dashed outlines are gone; the day being dragged over gets a soft tint (brand-50), a meal card about to be swapped a slightly stronger one (brand-100); the "⇄ Swap with …" text and the solid outline on the card being carried stay.

**Open / owed:** Matt merges #218; then tick 2b-2 (both have used the drag version on their phones).

**Next:** 2b-3, Confirm the week + groceries (fresh session).

---

## 2026-11-03 — PRD-008 2b-2: week screen behind the switch

**Done:** PR (open), branch `feat/prd-008-week-screen`. Also: 2b-1 rehearsed on preview through the new preview connector (records in PR #214).
- `src/pages/PrepTable/`: week tab (← / →, day buttons, day rows with + add / ✨ suggest, "Didn't get to these" tray) and Maybe tab. `usePrepTable` writes one row per action and reloads. Suggestions live only in memory until ✓ (D3).
- `src/lib/weekSuggest.js` (cookbook-only proposals via the existing recommender) and `src/lib/featureFlags.js` (`VITE_NEW_PREP_TABLE`). `App.jsx` picks the screen; unset = today's app.
- Matt decided: a recipe on the Maybe list still shows in "Didn't get to these".

**Verified:** Vitest 889/889 (37 new: 25 screen, 2 app switch, 2 flag, 6 suggest; no existing test changed), eslint, build, `lint:ds`. Reviewer FAIL on a real race (a slow reload after a save could paint the old week under the new title and save wrong days): fixed (numbered loads, the screen only draws the week matching its title, ← / → wait during saves) plus 44px targets, a visible locked-day message, failed ✓ keeps the suggestion. Seven deliberate breaks each failed a test. Screens rendered with fake data in Chromium at phone width.

**Incident (fixed in code, owed by Matt):** the first preview build put every `VITE_` setting into its public JS, including the unused `VITE_ANTHROPIC_API_KEY`, because `isNewPrepTableEnabled` defaulted to the whole `import.meta.env` object. The preview sat behind Vercel's login wall; production was clean. Fix: read only `import.meta.env.VITE_NEW_PREP_TABLE`, plus a new guard test (`src/__tests__/no-whole-env-in-client.test.js`) that fails on whole-object use; a build with planted fake secrets shows none in `dist/`. Matt did all three on 2026-11-03: leaky preview deleted, `VITE_ANTHROPIC_API_KEY` removed, new `ANTHROPIC_API_KEY` (Production + Preview), production redeployed from `main` (`px4ag78v2`; scanned: no `sk-ant`, no `VITE_` names). Still to confirm: the old key deleted in the Anthropic console, and one signed-in AI call (grocery list / recipe parse) works on production.

**Open / owed:**
- Preview deploys use the production database. Matt chose (2026-11-03) to try the new screen on real data through this PR's preview only; deployed by hand with `vercel deploy --build-env VITE_NEW_PREP_TABLE=true` (auto-deploy is broken, and Vercel blocks commits authored by Claude, so the deploy is from a copy without git history).
- Follow-ups noticed, not fixed: a stale `VITE_ANTHROPIC_API_KEY` sits in Vercel (not referenced by the code, so not in the bundle; delete it); the Vercel project shown by the CLI is `mreynolds08-glitchs-projects/recipe-rhythm`, not the team in CLAUDE.md (may explain the auto-deploy gap).

- **Try-it preview (current):** `https://recipe-rhythm-n99jg73g2-mreynolds08-glitchs-projects.vercel.app` — new screen on, real data, new key, scanned clean. Behind Vercel's login wall: open it signed in to Matt's Vercel, or ask for a ~23-hour share link. Older previews (`gmw0c9whc`, blocked `1iqub1ows`) can be deleted.
- How the preview was made (repeat for any rebuild): on the Mac, `git archive feat/prd-008-week-screen` into a temp folder, copy `.vercel/`, then `npx vercel deploy --build-env VITE_NEW_PREP_TABLE=true`; scan the bundle for `sk-ant` / `VITE_` before sharing. A plain `vercel deploy` from a checkout is blocked because the branch commits are authored by Claude.
- Open PRs for Matt to merge: #216 (this, 2b-2) and #217 (`.gitignore`: `.vercel`, `.env*`, keep `.env.example`; run `git checkout .gitignore` locally first).

**Next:** (1) she plans one real week on the preview; anything awkward gets fixed on #216 before merge; tick 2b-2. (2) Fresh session: 2b-3, Confirm the week + groceries — start from `TASKS.md` 2b-3, `src/pages/PrepTable/`, `week_confirmations` (`docs/schema.md`) and the existing `/api/grocery-list` + `src/lib/groceryList.js`.

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
