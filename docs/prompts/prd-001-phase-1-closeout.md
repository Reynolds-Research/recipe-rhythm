# Claude Code Prompt — PRD-001 Phase 1 Closeout (one shot)

**For:** Claude Code (executor)
**Authored by:** Claude.ai (planning surface)
**Why this exists:** The user has been hitting "ERROR: 42P13: cannot change return type of existing function" repeatedly when applying the Phase 1 migration to Supabase, despite PR #26 having merged a fix that adds `DROP FUNCTION` before `CREATE OR REPLACE`. There are also docs (CLAUDE.md, PRDs, phase prompts) that were committed on a feature branch but never reached `main`. This prompt drives the closeout to completion in a single session, with one clear hand-off to the user.

---

## Goal (one sentence)

Get `main` into a clean, complete state — DROP fix verified in the migration on `main`, docs commit cherry-picked onto `main` if missing — then walk the user through applying the migration to Supabase using the *correct* file (not the stale local copy that's been causing the error), and complete cleanup once they confirm.

## Why the user keeps hitting the same error (mental model)

The migration on `origin/main` has the DROP. PR #26 (commit `061a90f`) added it. But when the user pastes "the migration" into the Supabase SQL Editor, they're almost certainly pasting from a stale source — most likely their local working tree on the `fix/vault-fuzzy-match-column-rename` branch, where the file does NOT yet have the DROP. Or a cached query in Supabase. Or a previously open editor buffer.

The fix is simple: get the user onto a fresh `main` checkout, then have them paste from the file at that path. The file at `origin/main:supabase/migrations/20260425000001_meals_vault_link.sql` has the DROP. Confirmed.

---

## Step A — Sync `main` and bring the docs commit onto it (Claude Code)

Run these checks first, in order:

```bash
cd "/Users/Matt/Desktop/Current Projects/recipe-rhythm"
git status
git branch --show-current
```

If the working tree has uncommitted changes that you didn't make: STOP and ask the user before proceeding.

Now switch to `main` and pull the latest:

```bash
git fetch origin
git checkout main
git pull origin main --ff-only
```

If the pull fails (non-fast-forward, conflicts, etc.): STOP and ask. Don't force.

Verify `main` is at PR #26's merge or later:

```bash
git log --oneline -10
grep -n "DROP FUNCTION" supabase/migrations/20260425000001_meals_vault_link.sql
```

The grep MUST return at least one line containing `DROP FUNCTION IF EXISTS vault_fuzzy_match`. If it doesn't: STOP and tell the user — main is in an unexpected state.

Check whether the docs commit (CLAUDE.md, PRDs, phase prompts) is on main:

```bash
git ls-tree main CLAUDE.md
git ls-tree -d main docs/prds
```

**If both return content:** the docs are already on main. Skip to Step B.

**If both are empty:** the docs commit isn't on main yet. Locate it:

```bash
git log --all --oneline | grep -i "CLAUDE.md\|PRDs 001-003" | head -5
```

You should see a commit like `cd05df6 docs: add CLAUDE.md, PRDs 001-003, and Claude Code phase prompts`. Use that commit hash (or whatever exact hash the grep returned) in the cherry-pick:

```bash
git cherry-pick <hash>
```

The cherry-pick should be conflict-free because the commit only adds new files (CLAUDE.md, docs/prds/*, docs/prompts/*) that don't exist on main. If it conflicts: STOP and ask.

Push:

```bash
git push origin main
```

Verify everything's in place after the push:

```bash
git ls-tree main CLAUDE.md docs/prds docs/prompts | head -10
```

You should see the new files listed.

---

## Step B — Make the migration trivially copy-pastable, then STOP

The user has been getting the "cannot change return type" error because their pasted SQL was missing the DROP. The fix is to make ABSOLUTELY sure they paste from the right file. Help them:

1. Confirm the file content is what we expect:

   ```bash
   grep -B 1 -A 2 "DROP FUNCTION" supabase/migrations/20260425000001_meals_vault_link.sql
   ```

   Confirm visually that the DROP appears IMMEDIATELY before the `CREATE OR REPLACE FUNCTION vault_fuzzy_match` block. Print the output to the user.

2. Open the file in their default editor so they can copy from it cleanly:

   ```bash
   open supabase/migrations/20260425000001_meals_vault_link.sql
   ```

   (`open` is macOS — adjust if the user is on Linux/Windows. If unsure, just print the absolute path: `/Users/Matt/Desktop/Current Projects/recipe-rhythm/supabase/migrations/20260425000001_meals_vault_link.sql`.)

3. **STOP.** Print these instructions verbatim to the user (don't paraphrase — copy this block exactly):

```
==============================================================
STOP — your turn
==============================================================

The migration file is now open in your editor. The DROP FUNCTION
line is present (I just verified it). Apply it like this:

1. In the open file, select ALL contents (Cmd+A on Mac, Ctrl+A
   elsewhere) and copy (Cmd+C / Ctrl+C).

2. Open the Supabase Dashboard → your recipe-rhythm project →
   SQL Editor.

3. Click "New query" to make sure you're not in a stale tab.

4. Paste the file contents.

5. Run the query.

This time it WILL succeed because the DROP runs first and removes
the broken function before the CREATE rebuilds it.

6. Open the verify file:
     supabase/migrations/verify_20260425.sql
   Copy its contents into another new SQL Editor query and run it.
   Every check should pass.

7. Smoke test in your running dev server:
   - npm run dev (in another terminal)
   - Log a meal whose name FUZZY-matches a vault recipe (e.g.,
     type "tacos" if you have "Carnitas Tacos" or similar)
   - In Supabase Table Editor, open the `meals` table and confirm
     the new row has vault_id set (not NULL)

8. Reply to me with one of:
   - "migration applied, smoke test passed" — I'll finish cleanup
   - "still erroring with: <paste the exact error>" — I'll diagnose

If the smoke test logs but vault_id is NULL despite the recipe
existing in the vault, that's also a "still erroring" case — let
me know the meal name + vault recipe name so I can trace.
==============================================================
```

**Do not auto-proceed past this point.** Wait for the user.

---

## Step C — Cleanup (only after user confirms success)

When the user replies that the migration applied and the smoke test passed:

```bash
git fetch --all --prune
```

Try to delete the leftover Phase 1 branches:

```bash
git branch -d claude/infallible-thompson-323a50 2>/dev/null || echo "branch already gone"
git branch -d fix/vault-fuzzy-match-column-rename 2>/dev/null || echo "branch already gone"
git branch -d claude/elegant-shirley-7f373a       2>/dev/null || echo "branch already gone"
git branch -d claude/sweet-mirzakhani-069c7e      2>/dev/null || echo "branch already gone"
```

If any of those refuse with "not fully merged", STOP and ask before forcing — they may have unmerged work.

Prune worktrees:

```bash
git worktree prune
git worktree list
```

Confirm only the main worktree remains.

Update `RECIPE_TODOS.md` (it's in `/Users/Matt/Documents/Claude/Projects/Recipe Rhythym/RECIPE_TODOS.md`, NOT in this repo). Two changes:

1. Add a Done entry dated today:
   ```
   - [x] **2026-04-25 — SHIPPED: PRD-001 Phase 1 (meals → vault link) FULLY CLOSED** ✅
     PR #23 merged Phase 1 to main; PR #25 added the RPC column rename;
     PR #26 added the DROP FUNCTION fix; migration applied to live Supabase
     and smoke-tested. CLAUDE.md, PRD-001/002/003, and phase prompts also
     committed to main. Phase 2 (data hygiene) is now unblocked.
   ```

2. In the "From PRD-001 (Recipe Vault & Cooking Record)" subsection of Feature Requests, change the Phase 1 items (P0.1, P0.2, P0.3, P0.4) from `[ ]` to `[x]` to mark them done.

---

## Step D — Final summary (print to user)

Print a short summary:

```
✅ PRD-001 Phase 1 closed out.

  • main contains: meals.vault_id, pg_trgm, vault_fuzzy_match RPC
    (with rename + DROP), vaultMatch utility, VaultMatchSheet,
    LogMode auto-link + back-link, CLAUDE.md, PRD-001/002/003,
    and the phase prompts.
  • Live Supabase: migration applied and verified. Fuzzy match
    smoke test passed.
  • Branches cleaned up; worktrees pruned.

Suggested next session (start fresh — `exit`, then `claude` again):
  - PRD-001 P1.1 (family_rating) — small, 1 sitting; unlocks PRD-002's
    top-three ranking signal.
  - OR PRD-001 Phase 2 (data hygiene) — soft-delete + constants
    centralization + custom-tags table. The Phase 2 prompt at
    docs/prompts/prd-001-phase-2-data-hygiene.md needs a small
    update to use the renamed RPC form before you run it; ask Claude.ai
    (the planning surface) to refresh it.
```

---

## Constraints

- Do not force-push.
- Do not delete unmerged branches without asking.
- Do not auto-proceed past the STOP in Step B.
- Do not modify the migration SQL — it's correct on main; the issue is the user's paste source, not the file.
- Do not run the migration yourself. You don't have access to the user's Supabase instance and shouldn't try via curl/CLI/etc.

## Out of scope

- Phase 2 work (`prd-001-phase-2-data-hygiene.md`) — runs in a separate session
- PRD-001 P1.1 (family_rating) — runs in a separate session
- PRD-002 / PRD-003 work
- Updating the Claude.ai project's master prompt — manual paste-into-the-Claude-web-UI step
