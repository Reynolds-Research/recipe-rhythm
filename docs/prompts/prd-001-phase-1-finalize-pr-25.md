# Finalize PRD-001 Phase 1 — apply migration to Supabase, merge PR #25, cleanup

**Repo:** github.com/matt-reynolds-research/recipe-rhythm
**Open PR:** https://github.com/matt-reynolds-research/recipe-rhythm/pull/25
**Branch:** `fix/vault-fuzzy-match-column-rename` → `main`

## Context (read first)

The PRD-001 Phase 1 work (meals → vault link) was merged to main via PR #23,
but a column-rename fix to the `vault_fuzzy_match` RPC was reverted along the
way (commit `5d530b1` reverting `bac68d9`), so the broken form is currently
live on main: the RPC's `RETURNS TABLE` column names (`id`, `name`, `image_url`,
`similarity`) collide with `public.vault`'s columns inside the LANGUAGE sql
function body. Postgres flags this as ambiguous in some contexts (notably
fresh DBs / Supabase Preview Branches).

PR #25 is the re-apply. It cherry-picks `bac68d9` cleanly: the `RETURNS TABLE`
columns become (`match_id`, `match_name`, `image_url`, `similarity`); the
function body is qualified with `public.vault v`; `src/lib/vaultMatch.js`
maps the prefixed names back to `(id, name, image_url)` for callers; the
test fixture in `src/lib/__tests__/vaultMatch.test.js` mirrors the new shape.
132/132 unit tests pass.

A pre-existing eslint error in `.claude/worktrees/.../api/_lib/anthropic.js`
exists on plain main and is unrelated. Do NOT try to fix it.

## What you should do

### Step A — WAIT for me

Do nothing until I reply **"migration applied, smoke test passed"**.

Order matters: the migration must run on live Supabase BEFORE PR #25
merges. The migration changes the RPC's return-column names; PR #25's JS
expects the new names. If PR #25 merges first, deployed JS will destructure
undefined from the old RPC shape and the vault-match flow will break.

If I report a failure during migration apply, diagnose from the SQL error;
DO NOT modify the migration without my OK.

### Step B — once I confirm, merge PR #25

```bash
gh pr merge 25 --merge   # or --squash if I tell you to use squash
gh pr view 25            # confirm merged
```

### Step C — cleanup

```bash
git checkout main
git pull origin main
git fetch --all --prune
git branch -d fix/vault-fuzzy-match-column-rename
```

GitHub auto-deletes the remote branch on merge if that setting is on; if
not, `git push origin --delete fix/vault-fuzzy-match-column-rename`.

### Step D — update RECIPE_TODOS.md

File lives at `~/Documents/Claude/Projects/Recipe Rhythym/RECIPE_TODOS.md`
(NOT in the codebase). Add to the Done section dated 2026-04-25:

```
- [x] **2026-04-25 — SHIPPED: PRD-001 Phase 1 (meals → vault link)** ✅
  Phase 1 merged via PR #23; column-rename bug it shipped fixed via PR #25.
  Migration applied to live Supabase. P0.1–P0.4 complete. Phase 2 unblocked.
```

Tick the matching boxes in the "From PRD-001 Phase 1" Feature Requests
subsection.

## Constraints

- DO NOT run the migration yourself (no curl, no Supabase CLI, no MCP).
  I apply it via the Supabase SQL Editor in a browser.
- DO NOT auto-merge before I confirm. Wait for "migration applied, smoke
  test passed" verbatim.
- DO NOT force-push or push to main directly.
- DO NOT touch the pre-existing eslint error or any Phase 2 work.

## Out of scope

- Phase 2 (soft-delete, constants, custom-tags) — separate session.
- Modifying the PRD or earlier prompts — user-visible behavior is unchanged.

## Acceptance criteria

- [ ] PR #25 merged to main
- [ ] Live Supabase has the qualified RPC (user-confirmed)
- [ ] Smoke test passed: a logged meal matching a vault recipe has
      `meals.vault_id` populated (user-confirmed)
- [ ] `fix/vault-fuzzy-match-column-rename` deleted locally (and remotely
      if not auto-deleted)
- [ ] `RECIPE_TODOS.md` updated
