# Claude Code Prompt — PRD-001 Phase 3 Step 1: Spoonacular Cleanup + Wildcards Wiring (P0.8)

**For:** Claude Code (executor)
**Authored by:** Claude.ai (planning surface) on 2026-04-26
**Linked PRD:** [`docs/prds/PRD-001-recipe-vault-and-cooking-record.md`](../prds/PRD-001-recipe-vault-and-cooking-record.md), §6 P0.8 + §11 P0.8 row
**Depends on:** PRD-001 Phase 2 fully merged to `main`. Confirm `git log origin/main` shows commit `9aef9bd` (P0.7).

---

## ⚠ Pre-flight: confirm you're in the right place

The user has multiple Claude-Code worktrees on disk and prompts have been mis-routed before. **Run these checks FIRST**, before reading or editing anything else. If any check fails, stop and surface a clear error to the user — do NOT guess or pick a different path.

```bash
# 1) Canonical repo root
EXPECTED="/Users/Matt/Desktop/Current Projects/recipe-rhythm"
ACTUAL="$(git rev-parse --show-toplevel 2>/dev/null)"
echo "expected: $EXPECTED"
echo "actual:   $ACTUAL"
[ "$ACTUAL" = "$EXPECTED" ] || { echo "ABORT: not in the recipe-rhythm repo root"; exit 1; }

# 2) This prompt file must exist at the expected path within the repo
PROMPT="docs/prompts/prd-001-phase-3-step-1-spoonacular-cleanup.md"
test -f "$PROMPT" || { echo "ABORT: $PROMPT not found in this working tree"; exit 1; }

# 3) Show all worktrees so we can spot stale ones
git worktree list

# 4) If we're inside .claude/worktrees/<something>, switch to the canonical clone
case "$ACTUAL" in
  *".claude/worktrees/"*) echo "ABORT: running inside a Claude worktree — switch to $EXPECTED first"; exit 1 ;;
esac

# 5) Confirm Phase 2 has shipped (P0.7 commit must be on main)
git fetch origin --quiet
git log --oneline origin/main | grep -q "P0\.7" || { echo "ABORT: P0.7 not on main yet"; exit 1; }
```

If anything aborts: tell the user exactly which check failed, and ask whether they want you to `cd` to the canonical path or whether something else is going on. **Don't proceed on a guess.**

Once all five checks pass, start clean:

```bash
git checkout main
git pull --ff-only origin main
git worktree prune
git branch --merged | grep -vE '^\*|main' | xargs -r git branch -d
git checkout -b chore/spoonacular-cleanup
```

---

## Goal (one sentence)

Two surgical changes that finish PRD-001 P0.8: (1) delete the dead `WILDCARD_RATIO` constant + its "Spoonacular" comments from `src/lib/recommendations.js`, and (2) actually wire `BrainstormMode`'s call sites to source `wildcards` from the existing `/api/swap-suggestions` endpoint instead of passing an empty array — so the recommendation engine has fresh AI candidates to mix in alongside vault hits.

## Why this matters (mental model in plain English)

`getRecommendations(vaultItems, recentMeals, wildcards = [], ...)` was designed to mix two streams: (a) recipes already in the user's vault, ranked by recency / variety / frequency, and (b) "wildcards" — fresh recipe ideas from outside the vault. Originally those wildcards were going to come from Spoonacular (a third-party recipe API). That integration was never built; the parameter sits there with `wildcards = []` at every call site, the `WILDCARD_RATIO` constant is dead code, and the only remaining trace is a comment that says "20% from Spoonacular wildcards".

Meanwhile, the user already has `/api/swap-suggestions` (a Haiku-4.5-backed endpoint that returns three fresh recipe-name suggestions). It's used today only for the per-meal swap-out UI, but it's exactly the right source for the brainstorm-load wildcards too. This step deletes the dead Spoonacular code AND threads the existing endpoint's output into the two `getRecommendations` call sites, so on every brainstorm load the user gets both vault matches and fresh AI ideas.

After this PR, a repo-wide grep for "Spoonacular" should return zero matches, and the wildcards parameter should never be called with a hardcoded empty array.

---

## Context to read first (before any edits)

1. **Spec:** [`docs/prds/PRD-001-recipe-vault-and-cooking-record.md`](../prds/PRD-001-recipe-vault-and-cooking-record.md), §6 P0.8 + §11 P0.8 row.
2. **Files you'll modify on `main`:**
   - `src/lib/recommendations.js` — delete `WILDCARD_RATIO` (line 9) and the "Spoonacular" JSDoc reference (line 123); the function itself can keep splitting count between vault and wildcards by computing the split inline, OR you can replace `WILDCARD_RATIO` with a clearly-named constant inside the function. Either is fine; the goal is no Spoonacular references and no top-level dead constant.
   - `src/pages/BrainstormMode.jsx` — two call sites to `getRecommendations` (lines ~450 and ~540) need to pass real wildcards. Plus possibly a small refactor to `fetchSwapSuggestions` (lines ~317–345) so it can be reused at brainstorm-load time, not just for swap-out.
   - `src/lib/__tests__/recommendations.test.js` — currently has three tests, none of which exercise the wildcards path. Add coverage.
3. **Files you'll create:** none.
4. **Files for reference (do NOT modify):**
   - `api-server.mjs` lines 109+ and `api/swap-suggestions.js` — the endpoint shape (request body: `{ planNames, recentNames }`, response: `{ names: string[] }`). Already correct; don't change.
5. **Files NOT in scope:** `Vault.jsx` (decomposed in Step 2), `LogMode.jsx`, anything under `supabase/`. No migration in this PR.

If file structure or line numbers differ noticeably from the above (±20 lines), **stop and ask the user** rather than guessing.

---

## Step 1 — Delete the dead Spoonacular references

In `src/lib/recommendations.js`:

- Delete the line `const WILDCARD_RATIO = 0.2  // 20% from Spoonacular wildcards` at line 9.
- Inside `getRecommendations` (line 129), wherever `WILDCARD_RATIO` was referenced (computing `vaultCount` / `wildcardCount` around lines 149–151), replace with an inline split. Recommended: keep the same 80/20 split but compute it via a small named local — e.g. `const wildcardCount = Math.min(wildcards.length, Math.floor(count * 0.2))` and `const vaultCount = count - wildcardCount`. The behavior must remain bit-identical to before for callers passing `wildcards = []` (i.e., 100% vault when no wildcards exist).
- Update the JSDoc on `getRecommendations` (around line 123): change `* @param {Array}  wildcards       - Recipe objects fetched from Spoonacular` to `* @param {Array}  wildcards       - Recipe candidates returned by /api/swap-suggestions (Haiku 4.5). Each must have at least { id, name }; is_wildcard:true is set by the caller.`

After this step, run:

```bash
grep -rn "Spoonacular\|spoonacular\|WILDCARD_RATIO" src/ api/ api-server.mjs .env.example 2>/dev/null
```

This must return **zero matches**. If it returns anything, fix it before moving on.

---

## Step 2 — Wire `/api/swap-suggestions` into the brainstorm-load flow

In `src/pages/BrainstormMode.jsx`:

### 2a) Generalize `fetchSwapSuggestions`

Currently `fetchSwapSuggestions(currentPlan, recentMeals)` is called only from the swap-out flow. It already returns the right shape: `[{ id: 'ai-suggestion-N', name, is_wildcard: true, source_url }, ...]`. We can reuse it as-is — the function signature works for the brainstorm-load case too (the "current plan" is just whatever's seeded so far, often empty; the "recent meals" is the same recentMeals already in scope).

**Do not change** the function body. Just call it from new locations.

### 2b) Update the brainstorm-load call site (~line 450)

Find the call site that looks like:

```js
const suggestions = getRecommendations(
  vaultItems,
  recentMeals,
  [],
  sortedSeed.length,
  servedMeals,
)
```

Change it to fetch wildcards first, then pass them in:

```js
const wildcardCandidates = await fetchSwapSuggestions(plan, recentMeals)
const suggestions = getRecommendations(
  vaultItems,
  recentMeals,
  wildcardCandidates,
  sortedSeed.length,
  servedMeals,
)
```

The enclosing function (`loadData`) is already async and inside a `try` flow, so the await is fine. If `fetchSwapSuggestions` fails (network down, AI quota), it already returns `[]` per its existing error handling — `getRecommendations` will silently fall back to 100% vault picks. That's the right graceful-degradation behavior; don't add bespoke try/catch around it.

### 2c) Update the second call site (~line 540, the "add a date" handler)

This one is inside a synchronous `setPlan((curr) => { ... getRecommendations(...) ... })` callback, so introducing an `await` here is more invasive. Two options:

**Option A (simpler — recommended):** Don't add wildcards here. The "add a date" path is a single fresh slot, not a fresh brainstorm — keeping it 100% vault-driven is fine and the user can always swap-out into a wildcard from that slot. Add a code comment: `// Single-slot picks stay 100% vault — wildcards only flow through the brainstorm-load path. See PRD-001 P0.8.`

**Option B:** Refactor to fetch wildcards before calling setPlan — adds a small async dance and an extra round-trip per date click. Skip unless reviewer asks.

Pick Option A for this PR. We can revisit in a follow-up if the user wants wildcards in the add-a-date flow.

### 2d) Verify `is_wildcard` flag plumbing

`fetchSwapSuggestions` already sets `is_wildcard: true` on each suggestion (line ~341). After your change, when those rows flow through `getRecommendations`, the existing JSX (line ~193 in BrainstormMode renders a "Wildcard" badge for `slot.is_wildcard`) should light up automatically. No JSX changes required.

Quick smoke read: trace one wildcard from `fetchSwapSuggestions` → `getRecommendations` (where it lands in `wildcardPicks` at line ~154 of recommendations.js) → `buildPlan` → `setPlan` → JSX badge. If the chain is broken anywhere, fix it.

---

## Step 3 — Tests

### 3a) Extend `src/lib/__tests__/recommendations.test.js`

Add new test cases:

- **Wildcards mix in when provided.** Given `vaultItems = 5 items`, `recentMeals = []`, `wildcards = [{id:'w1',name:'X'}, {id:'w2',name:'Y'}]`, `count = 7`. Expect: result has length 7, includes at least one wildcard (name `X` or `Y`) marked `is_wildcard: true`.
- **Wildcards limited by available count.** Given `count = 5` and `wildcards = 10 items`, expect at most ~20% are wildcards (i.e., 1 wildcard, not 5).
- **Empty wildcards = 100% vault (regression).** Existing default behavior preserved — given `wildcards = []`, every result has `is_wildcard !== true`.

### 3b) Extend `src/pages/__tests__/BrainstormMode.test.jsx`

The file already mocks `getRecommendations` (line 41) and `fetchSwapSuggestions` is part of the component, so:

- Mock `fetch` (or use the existing fetch mock pattern) so the brainstorm-load flow's call to `/api/swap-suggestions` returns a known body, e.g. `{ names: ['Test Wildcard 1', 'Test Wildcard 2'] }`.
- Assert that `getRecommendations.mockReturnValue` was called with a non-empty third argument (the wildcards array) — the existing mock-call inspector pattern works.
- One negative case: when `/api/swap-suggestions` returns `!ok`, the brainstorm still loads (silently falls back to no wildcards). Assert `getRecommendations` was called with `[]` as the third argument and the page renders without crashing.

---

## Step 4 — Sanity sweep

```bash
# No Spoonacular anywhere
grep -rn "Spoonacular\|spoonacular\|WILDCARD_RATIO" src/ api/ api-server.mjs .env.example 2>/dev/null
# (must be empty)

# Tests + lint
npm run test:unit
npm run lint
```

Both clean. If `npm run test:unit` flags a pre-existing failure unrelated to this work, **stop and ask** — don't expand scope.

---

## Acceptance criteria (Step 1 done means all of this true)

- [ ] Branch `chore/spoonacular-cleanup` created from a fresh `main`
- [ ] All five pre-flight working-tree checks pass
- [ ] `recommendations.js` no longer contains `WILDCARD_RATIO` or the word "Spoonacular"; the JSDoc accurately describes `/api/swap-suggestions` as the wildcards source
- [ ] `getRecommendations` behavior is bit-identical for callers passing `wildcards = []` (the existing tests still pass without modification)
- [ ] `BrainstormMode.jsx` brainstorm-load call site (~line 450) fetches wildcards from `/api/swap-suggestions` before calling `getRecommendations`
- [ ] `BrainstormMode.jsx` add-a-date call site (~line 540) keeps 100% vault picks with an explanatory comment referencing PRD-001 P0.8
- [ ] `recommendations.test.js` covers: wildcards mix in, wildcards capped by ratio, empty wildcards = 100% vault
- [ ] `BrainstormMode.test.jsx` covers: brainstorm-load passes non-empty wildcards on success; falls back to `[]` and doesn't crash on failure
- [ ] `npm run test:unit` and `npm run lint` both pass
- [ ] `grep -rn "Spoonacular\|spoonacular\|WILDCARD_RATIO" src/ api/ api-server.mjs .env.example` returns zero results
- [ ] Manual smoke test: run `npm run dev` + `npm run dev:api` (or whatever the user's local dev script is). Open BrainstormMode. Trigger a regenerate. Confirm at least one slot renders with the "Wildcard" badge (assuming the AI returns at least one suggestion the user doesn't already have in vault).

---

## Constraints

- **Stack:** React 19.2 + Vite 8 + Tailwind 3.4 + lucide-react. No new dependencies.
- **No migration in this PR.** Schema is untouched.
- **Don't expand scope.** This is a focused cleanup PR. If you spot unrelated issues (e.g., the `is_wildcard` column on `vault` looks weird, or the `fetchSwapSuggestions` URL hardcoding bothers you), note them in the PR description as follow-ups; don't fix them here.
- **No new dependencies.** Everything you need (fetch, the existing endpoint, the existing mock patterns) is in place.

---

## Out of scope (do NOT touch)

- Vault.jsx → Vault/* decomposition (PRD-001 P0.9 — that's Step 2 of Phase 3, separate prompt: `docs/prompts/prd-001-phase-3-step-2-vault-decomposition.md`)
- `/api/*` endpoint internals — both `api-server.mjs` and `api/swap-suggestions.js` are already correct
- API rate limiting / auth (PRD-001 P1.6, separate work)
- Anything in PRD-002 (meal planning) or PRD-003 (grocery)

---

## Commit cadence

One or two commits, your call:

1. `refactor(recommendations): drop Spoonacular references and wire wildcards from /api/swap-suggestions (PRD-001 P0.8)`

If you split into two:

1. `refactor(recommendations): drop Spoonacular references; rename WILDCARD_RATIO to inline split (PRD-001 P0.8)`
2. `feat(brainstorm): source wildcards from /api/swap-suggestions on brainstorm-load (PRD-001 P0.8)`

---

## When you finish

1. Run the full acceptance checklist above.
2. Open the PR. Title: `PRD-001 P0.8: Spoonacular cleanup + wire wildcards from /api/swap-suggestions`.
3. In the PR description, list any deviations from this prompt and why.
4. Note any follow-ups discovered along the way. (Likely candidate: a `useSwapSuggestions` hook to centralize the fetch logic — but that's out of scope here.)
5. After merge, the next prompt to execute is `docs/prompts/prd-001-phase-3-step-2-vault-decomposition.md` (P0.9).
