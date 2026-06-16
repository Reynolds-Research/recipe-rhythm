# PRD-005 loose-ends cleanup

> **Scope:** Close the two visible follow-ups from the 2026-05-02 PRD-005 audit. Both are listed in `RECIPE_TODOS.md` under "Tech Debt & Refactoring." Each is small, low-risk, and independent of any in-flight work (PRD-006 Bite γ, PRD-004 Phase C). After this lands, the design-system CI guardrail is 100% clean across the repo.

## What you're doing

Two unrelated cleanups, ideally as **two separate PRs** so they can be reviewed and reverted independently:

1. **Sub-task A — Delete a stale Finder-copy artifact.** The file `src/components/MealNameConfirmSheet 2.jsx` (note the space + "2") is almost certainly a duplicate Finder created by accident. The 2026-05-02 PRD-005 audit found this is the **only** remaining file in the repo that still contains banned design-system classes. Delete it and the design-system CI guardrail goes 100% green.
2. **Sub-task B — Merge the existing `fix/ui-lint-remaining-violations` branch.** Commit `4b585a8` on that branch contains the `DateRangePicker.jsx` design-system sweep that was meant to ship with PRD-005 P0.11 but didn't make it into the original commit. The branch is not yet on `main`.

## Why this is safe to do now

- Independent of PRD-006 (the active workstream) — only touches `src/components/`.
- Closes the two loose ends listed in `RECIPE_TODOS.md` Tech Debt section.
- Both items are P2·E or P3·E. Combined effort: under an hour.
- No schema, API, or data migration involved. No Supabase MCP work needed.

## Setup

```
git fetch origin
git checkout main
git pull
git status   # confirm clean working tree
```

Confirm you're at the latest commit:

```
git log --oneline -5
```

The most recent commit on `main` should be `ade8103` (the PRD-006 backfill-script registration) or newer.

---

## Sub-task A — Delete `MealNameConfirmSheet 2.jsx`

**Goal:** Remove the stale duplicate file. Confirm zero imports, zero test references. Confirm the design-system grep returns zero hits afterward across the whole repo.

### Steps

1. **Branch off main:**
   ```
   git checkout -b chore/delete-mealnameconfirmsheet-duplicate
   ```

2. **Verify the file is unreferenced.** Run a comprehensive search:
   ```
   grep -rn "MealNameConfirmSheet 2" src/ tests/ e2e/ 2>/dev/null
   grep -rn 'MealNameConfirmSheet\\ 2' src/ tests/ e2e/ 2>/dev/null
   ```
   Both should return zero results. If they don't — STOP and report what you found. Don't proceed.

3. **Confirm the canonical file still exists and is the one being imported.** The "real" file should be `src/components/MealNameConfirmSheet.jsx` (no space, no "2"):
   ```
   ls -la "src/components/MealNameConfirmSheet"*
   grep -rn "from.*MealNameConfirmSheet" src/
   ```
   Every import should point at the no-space version. If anything imports the duplicate — STOP.

4. **Delete the file.** The space in the filename means quoting matters:
   ```
   git rm "src/components/MealNameConfirmSheet 2.jsx"
   ```

5. **Run the design-system grep that the CI guardrail uses.** Open `.github/workflows/design-system-lint.yml` to see the exact patterns; at minimum it checks `text-[10–13px]`, `text-gray-(200|300|400)`, and half-step padding `(p|px|py|…)-N.5`. Run those greps against `src/**/*.{js,jsx}` and confirm zero hits.

6. **Run unit tests** to confirm nothing was importing the duplicate:
   ```
   npm run test:unit
   ```

7. **Commit and push:**
   ```
   git commit -m "chore: delete stale MealNameConfirmSheet 2.jsx Finder-copy artifact"
   git push -u origin chore/delete-mealnameconfirmsheet-duplicate
   ```

8. **Open a PR** with `gh pr create`:
   - Title: `chore: delete stale MealNameConfirmSheet 2.jsx duplicate`
   - Body: link to the relevant `RECIPE_TODOS.md` tech-debt line. Note that this closes the only remaining banned-design-system-class file in the repo per the 2026-05-02 PRD-005 audit. Mention the design-system CI guardrail should now be 100% clean.

9. **Verify the Vercel preview builds clean** via the Vercel MCP. Check the design-system-lint CI workflow on the PR — it should pass without warnings.

---

## Sub-task B — Merge `fix/ui-lint-remaining-violations`

**Goal:** Bring commit `4b585a8` (the `DateRangePicker.jsx` design-system sweep) into `main` via a clean PR.

### Steps

1. **Locate the branch.** Check both local and remote:
   ```
   git branch -a | grep ui-lint-remaining-violations
   ```
   - If it's only local, you'll need to push it.
   - If it's on `origin`, fetch the latest first.

2. **Inspect the diff vs current main** (without checking out the branch — use the cross-branch reading pattern from `CLAUDE.md`):
   ```
   git diff main..fix/ui-lint-remaining-violations -- src/components/DateRangePicker.jsx
   ```
   Confirm the diff is **only** design-system class swaps inside `DateRangePicker.jsx` (e.g. `text-gray-400` → `text-gray-700`, banned spacing values → sanctioned ones). If the branch contains anything else — STOP and report what you found.

3. **Check it out and rebase on latest main:**
   ```
   git checkout fix/ui-lint-remaining-violations
   git rebase origin/main
   ```

4. **Resolve any conflicts** by preferring the design-system-compliant version (the whole point of the branch). If conflicts are non-trivial or touch anything outside `DateRangePicker.jsx` — STOP and report.

5. **Run the design-system grep** against `src/components/DateRangePicker.jsx` (and the rest of the repo) to confirm zero banned-class hits. Run unit tests:
   ```
   npm run test:unit
   ```

6. **Push (force-with-lease since you rebased):**
   ```
   git push --force-with-lease origin fix/ui-lint-remaining-violations
   ```

7. **Open a PR** with `gh pr create`:
   - Title: `PRD-005 P0.11 follow-up: DateRangePicker design-system sweep`
   - Body: explain this is the carry-forward from the 2026-05-02 PRD-005 audit; commit `4b585a8` originally contained this work but didn't make it into the P0.11 merge. Link to the relevant `RECIPE_TODOS.md` tech-debt line.

8. **Verify** the Vercel preview builds clean and the design-system-lint CI workflow passes.

---

## Verification & hand-off

After both PRs are open:

1. **Check Vercel previews via MCP** for each PR. If a build fails, read the logs and try to fix it on-branch before pinging the user.
2. **Check the design-system-lint workflow status** for each PR — both should pass.
3. **Don't merge.** That's the user's manual step via the GitHub UI.
4. **Report back to the user with:**
   - PR URLs (both)
   - Vercel preview URLs (both)
   - Confirmation that design-system-lint passed on each
   - Confirmation that `npm run test:unit` is green on each
   - Anything unexpected encountered along the way

## Out-of-scope guardrails

- **Do NOT expand the design-system sweep** beyond `DateRangePicker.jsx` and the deletion of `MealNameConfirmSheet 2.jsx`. If you find other banned classes elsewhere, note them in the PR description as follow-ups — don't fix them here. Per `CLAUDE.md`: "Don't fix unrelated lint or test errors while doing focused work."
- **Do NOT touch any PRD-006 files** (`scripts/backfill-structured-ingredients.mjs`, `api/analyze-recipe.js`, `vault.ingredients_structured` consumers, etc.).
- **Do NOT touch any PRD-004 files** (the `ingredients_classified` backfill is its own separate problem; out of scope here).
- **Do NOT modify `RECIPE_TODOS.md`** — that file lives in the user's Claude.ai project knowledge folder, not in the repo. Instead, in each PR description, include a clearly labeled "TODOs to update" section the user can copy across.
- **Do NOT combine the two sub-tasks into one PR** unless both diffs are genuinely trivial AND there's a clear reason. Default is two PRs.

## Definition of done

- [ ] `src/components/MealNameConfirmSheet 2.jsx` is removed from `main`.
- [ ] `DateRangePicker.jsx` design-system sweep is merged to `main`.
- [ ] Repo-wide design-system grep returns zero banned-class hits.
- [ ] Both PRs' Vercel previews built successfully.
- [ ] Both PRs' design-system-lint workflow passed.
- [ ] `npm run test:unit` is green on both.
- [ ] Each PR description includes a "TODOs to update" section for the user.
