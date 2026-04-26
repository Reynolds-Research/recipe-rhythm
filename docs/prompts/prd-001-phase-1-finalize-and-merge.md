# Claude Code Prompt — PRD-001 Phase 1: Finalize the RPC + merge to main

**For:** Claude Code (executor)
**Authored by:** Claude.ai (planning surface) on 2026-04-25
**Linked PRD:** [`docs/prds/PRD-001-recipe-vault-and-cooking-record.md`](../prds/PRD-001-recipe-vault-and-cooking-record.md)
**Linked prompt:** [`docs/prompts/prd-001-phase-1-meals-vault-link.md`](./prd-001-phase-1-meals-vault-link.md) (the prompt that produced the work this one finalizes)
**Branch:** `claude/infallible-thompson-323a50` (already pushed to `origin`; not yet merged to `main`)

---

## Goal (one sentence)

Resolve the only outstanding issue on the Phase 1 branch — the reverted RPC fix — verify the work locally, then walk through a controlled hand-off where the user applies the migration to live Supabase and you complete the merge to `main` with cleanup once they've confirmed.

## Why this matters (mental model)

The Phase 1 work is otherwise complete. Eight commits on `claude/infallible-thompson-323a50` add the `meals.vault_id` column, the `vault_fuzzy_match` RPC, the `vaultMatch` utility, the disambiguation UI in LogMode, and the back-link on Save-to-Cookbook.

But there's an unresolved fix-then-revert pair. Commit `bac68d9` ("fix(db): rename vault_fuzzy_match output columns to dodge ambiguity") fixed a Supabase Preview Branch migration failure by renaming the RPC's `RETURNS TABLE` columns to `match_id`, `match_name`, etc. so they wouldn't collide with the same-named columns of `public.vault` inside the function body. The fix was correct and grounded in a real failure. Commit `5d530b1` then reverted it with no explanation other than the default git revert message.

Re-applying the fix is the safe move. The qualified-output form works whether or not Postgres rejects the original (some versions and contexts do, some don't). There's no downside to keeping it; there's a real downside if it's needed and missing.

## Context to read first

1. **The two commits at the heart of this work:**
   - `git show bac68d9` — the original fix (this is what we want)
   - `git show 5d530b1` — the revert (this is what we're undoing)
2. **Files involved in the fix:**
   - `supabase/migrations/20260425000001_meals_vault_link.sql` — the `vault_fuzzy_match` RPC
   - `src/lib/vaultMatch.js` — the JS caller that maps RPC output back to `(id, name, image_url)`
   - `src/lib/__tests__/vaultMatch.test.js` — the test fixture
3. **Supporting files (do NOT modify):**
   - `docs/prompts/prd-001-phase-1-meals-vault-link.md` — the original prompt; references the now-superseded RPC shape
   - `docs/prds/PRD-001-recipe-vault-and-cooking-record.md` — the PRD; will be updated only if the fix changes anything user-visible (it does not)

If anything in the branch state diverges from what's described here, **stop and ask** rather than improvising.

---

## Step 1 — Verify the starting state

Run:

```bash
cd "/Users/Matt/Desktop/Current Projects/recipe-rhythm"
git status
git branch --show-current
```

Expected: clean working tree, currently on `main` (or wherever the user invoked you). If the working tree has uncommitted changes you didn't make, stop and ask.

Switch to the Phase 1 branch:

```bash
git checkout claude/infallible-thompson-323a50
git log --oneline -8
```

Expected last 8 commits, in order (newest first):
```
5d530b1  Revert "fix(db): rename vault_fuzzy_match output columns to dodge ambiguity"
bac68d9  fix(db): rename vault_fuzzy_match output columns to dodge ambiguity
e372014  fix(build): use named Sheet import from react-modal-sheet
1258d12  docs(schema): document meals.notes column (verified via information_schema)
6f1cb37  feat(logmode): back-link meal to vault on Save-to-Cookbook (PRD-001 P0.4)
8a473de  feat(logmode): auto-link meals to vault with disambiguation UI (PRD-001 P0.2 + P0.3)
5c14d9d  feat(lib): add vaultMatch utility with pg_trgm fuzzy matcher (PRD-001 P0.2)
2d81166  feat(db): add meals.vault_id column + pg_trgm extension (PRD-001 P0.1)
```

If the order doesn't match, ask before proceeding.

Run the existing test suite to confirm the branch is green BEFORE our changes:

```bash
npm install
npm run test:unit
npm run lint
```

If anything fails, stop and report. Don't try to fix unrelated test failures yourself.

---

## Step 2 — Re-apply the reverted fix

Use `git revert` to undo the revert. This is the canonical "I undid the wrong thing; bring it back" pattern:

```bash
git revert --no-edit 5d530b1
```

This creates a new commit whose diff is the inverse of the revert — i.e., the original fix re-applied. The default commit message will be `Revert "Revert "fix(db): rename vault_fuzzy_match output columns to dodge ambiguity""`. Improve the message:

```bash
git commit --amend -m "fix(db): re-apply vault_fuzzy_match output column rename (PRD-001 P0.2)

Restores commit bac68d9 which was reverted in 5d530b1 with no explanation.
The rename qualifies the RPC's RETURNS TABLE columns (match_id, match_name,
match_image_url, match_similarity) so they cannot collide with the same-named
columns of public.vault inside the function body. The original commit
identified this as the root cause of a Supabase Preview Branch migration
failure on this PR. Re-applying because:

  1. The original fix was specific and grounded in observed failure.
  2. The revert had no documented reasoning.
  3. The qualified form works whether or not Postgres rejects the unqualified
     form, so there is no downside to keeping it.

Reverts: 5d530b1
Restores: bac68d9
Co-Authored-By: Claude (planning surface) <noreply@anthropic.com>"
```

(Adjust the `Co-Authored-By` line to match the conventions of other commits on this branch — look at `git log` to see how previous Claude Code commits are signed.)

---

## Step 3 — Verify the fix is well-formed

Read the migration file at the new HEAD:

```bash
cat supabase/migrations/20260425000001_meals_vault_link.sql
```

Confirm:
- The `vault_fuzzy_match` RPC's `RETURNS TABLE` clause uses prefixed names like `match_id`, `match_name`, `match_image_url`, `match_similarity` — NOT `id`, `name`, `image_url`, `similarity`
- The SELECT inside the function body qualifies columns with the source table (e.g., `v.id`, `v.name` or `vault.id`, `vault.name`)

Read the JS caller:

```bash
cat src/lib/vaultMatch.js
```

Confirm:
- The RPC call (`supabase.rpc('vault_fuzzy_match', {...})`) maps the prefixed columns back to `(id, name, image_url)` so the rest of the codebase doesn't need to know about the rename. The pattern is something like:
  ```js
  matches: fuzzy.map(({ match_id, match_name, match_image_url }) => ({
    id: match_id, name: match_name, image_url: match_image_url
  })),
  ```

Read the test fixture:

```bash
cat src/lib/__tests__/vaultMatch.test.js | head -60
```

Confirm the mocked RPC return values use the prefixed shape (`match_id`, `match_name`, ...). If they don't, the revert may have left the test fixture in a stale state — fix it now.

Re-run the test suite:

```bash
npm run test:unit
npm run lint
```

All green. If anything fails because of the rename, fix it inside `vaultMatch.js` or the test fixture (NOT the migration — the migration is the source of truth here).

---

## Step 4 — Push the branch

```bash
git push origin claude/infallible-thompson-323a50
```

If the push is rejected because the remote is behind, **stop and ask** — do not force-push without confirmation. The user may have a PR open; rewriting history on a PR branch is rude.

If a PR is already open for this branch (check via `gh pr view` if `gh` is installed and authenticated, or report "PR status unknown — please verify in the GitHub UI"), the push will trigger CI and Supabase Preview Branch automation. The user's Supabase Preview Branch should now run the migration successfully. **Note this in your output**: "Pushed. If a PR is open, watch the GitHub Actions and Supabase Preview Branch checks."

---

## Step 5 — STOP. The user's turn.

**Do not proceed past this step until the user confirms the migration has been applied to live Supabase.**

Print a clear hand-off message to the user, exactly like this (don't paraphrase — copy these instructions verbatim so the user has unambiguous steps):

```
==============================================================
USER ACTION REQUIRED — apply the migration to Supabase
==============================================================

1. Open your Supabase project's SQL Editor in a browser
   (https://supabase.com/dashboard → your recipe-rhythm project → SQL Editor)

2. Paste and run the contents of:
   supabase/migrations/20260425000001_meals_vault_link.sql

3. Then paste and run the contents of:
   supabase/migrations/verify_20260425.sql

   Every check should return the expected result. If any check fails,
   tell me which one — DO NOT proceed to step 4.

4. Smoke test in the running app:
   - Run `npm run dev` in another terminal
   - Open the app, log a meal whose name matches an existing vault recipe
   - In Supabase Table Editor, open the `meals` table
   - Confirm the new row has `vault_id` populated (not NULL)

5. When all of the above pass, reply to me with: "migration applied,
   smoke test passed" — and I'll complete the merge to main.

If anything fails: paste the exact error message and I'll diagnose
before we merge anything.
==============================================================
```

Then wait. Do not auto-proceed.

---

## Step 6 — Merge to main (after user confirmation)

When the user confirms the migration is live and the smoke test passed:

```bash
git checkout main
git pull origin main                # make sure main is up to date with origin
git merge --no-ff claude/infallible-thompson-323a50 -m "Merge branch 'claude/infallible-thompson-323a50' — PRD-001 Phase 1: meals → vault link

Closes PRD-001 P0.1–P0.4. Adds meals.vault_id, the vault_fuzzy_match RPC,
the vaultMatch utility, LogMode disambiguation UI, and the Save-to-Cookbook
back-link. Migration applied to Supabase and smoke-tested before merge."
git push origin main
```

If the user has a PR open and prefers to merge via GitHub:
- Tell them the local branch is ready and CI should be green
- Suggest they merge via the GitHub UI (squash or merge — their preference; we used `--no-ff` locally, but the PR can use squash if that's the project convention)
- Ask them to confirm when merge is done; THEN proceed to Step 7

---

## Step 7 — Cleanup

After the merge is confirmed (locally or via PR):

```bash
git fetch --all --prune              # sync remote refs, prune deleted origin branches
git branch -d claude/infallible-thompson-323a50    # safe delete; refuses if unmerged
git worktree prune                    # remove the stale worktree gitlink under .claude/worktrees
```

If `git branch -d` refuses because the branch isn't fully merged (shouldn't happen if Step 6 went well — but just in case), STOP and ask before forcing.

Update `RECIPE_TODOS.md` (in `~/Documents/Claude/Projects/Recipe Rhythym/`, NOT the codebase) to mark PRD-001 P0.1–P0.4 as done. Add an entry to the Done section dated 2026-04-25:

```
- [x] **2026-04-25 — SHIPPED: PRD-001 Phase 1 (meals → vault link)** ✅
  Branch `claude/infallible-thompson-323a50` merged to main. Migration
  applied to Supabase. P0.1 (meals.vault_id + pg_trgm + vault_fuzzy_match
  RPC), P0.2 (vaultMatch utility), P0.3 (disambiguation UI), P0.4
  (Save-to-Cookbook back-link) all complete. Bonus: meals.notes column
  documented in schema.md. Phase 2 (data hygiene) is now unblocked.
```

Tick the corresponding checkboxes in the "From PRD-001 (Recipe Vault & Cooking Record)" Phase 1 subsection of Feature Requests so they show as `[x]`.

---

## Acceptance criteria (everything done means all of this true)

- [ ] All eight original Phase 1 commits + the new "re-apply fix" commit are on the `claude/infallible-thompson-323a50` branch
- [ ] `npm run test:unit` and `npm run lint` pass on the branch
- [ ] The branch is pushed to `origin`
- [ ] The migration is applied to live Supabase (user-confirmed in Step 5)
- [ ] `verify_20260425.sql` returns expected results (user-confirmed)
- [ ] Smoke test passed: a logged meal whose name matches a vault recipe has `vault_id` populated (user-confirmed)
- [ ] `main` contains all Phase 1 commits + the merge commit
- [ ] `claude/infallible-thompson-323a50` is deleted locally and the worktree is pruned
- [ ] `RECIPE_TODOS.md` reflects the shipped state

---

## Constraints

- **Don't force-push** without explicit user confirmation
- **Don't auto-proceed past Step 5** — the migration application is the gate
- **Don't modify the Phase 1 prompt or PRD** — those describe the original intent; the rename is a fix to a real production issue, but the user-visible behavior is unchanged
- **Don't run the migration yourself.** You don't have access to the user's Supabase instance and shouldn't try via curl, Supabase CLI, or any other side channel
- **Don't squash-merge locally** even if the project usually uses squash; the local merge in Step 6 uses `--no-ff` to preserve the audit trail of which commits did what. If the user wants a squash on the PR, they can do it via GitHub UI

---

## Out of scope (do NOT touch)

- Any Phase 2 work (soft-delete, constants centralization, custom-tags table) — that's `prd-001-phase-2-data-hygiene.md` and runs in a separate session
- Any PRD-002 or PRD-003 work
- Updating the master Claude Project prompt — that's a manual paste-into-the-Claude-web-UI step
- Modifying the Phase 1 prompt itself — it produced correct work; a stale-but-original prompt is fine

---

## When you finish

1. Confirm all acceptance-criteria checkboxes are checked
2. Print a final summary: branch state, what was merged, what's live in Supabase, RECIPE_TODOS state
3. Suggest the next prompt the user can hand to a fresh session: `docs/prompts/prd-001-phase-2-data-hygiene.md`
