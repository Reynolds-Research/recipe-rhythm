# Claude Code Prompt — PRD-002 Phase 1: Audit Bug Fixes (U3 + U8)

**For:** Claude Code (executor)
**Authored by:** Claude.ai (planning surface) on 2026-04-26
**Linked PRD:** [`docs/prds/PRD-002-meal-planning.md`](../prds/PRD-002-meal-planning.md), §6 P0.10 + P0.11 + §11 Phase 1 + §12 Testing Plan
**Linked audit findings:** [`AUDIT.md`](../../AUDIT.md) U3 (last-week mapping ignores week boundaries), U8 (timezone-naive date handling)
**Depends on:** PRD-001 fully shipped (it is — through PR #36) AND `docs/prd-001-closeout` PR merged to `main` (so CLAUDE.md, schema.md, and PRD-001 v1.0 reflect post-decomposition reality before Claude Code reads them).

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
PROMPT="docs/prompts/prd-002-phase-1-audit-fixes.md"
test -f "$PROMPT" || { echo "ABORT: $PROMPT not found in this working tree"; exit 1; }

# 3) Show all worktrees so we can spot stale ones
git worktree list

# 4) If we're inside .claude/worktrees/<something>, switch to the canonical clone
case "$ACTUAL" in
  *".claude/worktrees/"*) echo "ABORT: running inside a Claude worktree — switch to $EXPECTED first"; exit 1 ;;
esac

# 5) Confirm the PRD-001 closeout PR has merged (CLAUDE.md should describe Vault/ directory, not Vault.jsx)
git fetch origin --quiet
grep -q "src/pages/Vault/" CLAUDE.md || { echo "ABORT: CLAUDE.md still references Vault.jsx — merge docs/prd-001-closeout first"; exit 1; }

# 6) Confirm PRD-001 final commit (P0.9) is on main
git log --oneline origin/main | grep -q "P0\.9" || { echo "ABORT: PRD-001 P0.9 not on main yet"; exit 1; }
```

If anything aborts: tell the user exactly which check failed, and ask whether they want you to `cd` to the canonical path or whether something else is going on. **Don't proceed on a guess.**

Once all six checks pass, start clean:

```bash
git checkout main
git pull --ff-only origin main
git worktree prune
git branch --merged | grep -vE '^\*|main' | xargs -r git branch -d
git checkout -b fix/prd-002-phase-1-audit-fixes
```

---

## Goal (one sentence)

Two surgical bug fixes that close out PRD-002 Phase 1 and validate the existing roll-forward mechanics before Phase 2 piles new features on: (P0.10) make `BrainstormMode`'s "last week" view source meals from the immediately-prior planning period rather than a fixed 7-day window, and (P0.11) centralize a `formatLocalDate(date)` helper in a new `src/lib/dateUtils.js` so date-only writes use the user's local calendar instead of UTC.

## Why this matters (mental model in plain English)

**P0.10 — the "two Tuesdays" bug (audit U3).** Today, BrainstormMode's "last week" mini-view at the top of the page shows what was eaten on each weekday Mon–Fri. The lookup grabs meals from the past 7 calendar days and matches them to weekday labels. Two problems: (1) if a planning period was Thu–Wed (8 days ago to 1 day ago), some prior-period meals fall outside the 7-day window and don't show up; (2) if the recent-meals window happens to contain two meals on the same weekday (e.g., two Tuesdays), the lookup picks one ambiguously. Both issues vanish if we instead source meals from the *immediately prior period's actual date range* (which we can read from `listUserPeriods`). When no prior period exists (first-ever brainstorm), keep today's behavior as the fallback.

**P0.11 — the 11pm-Pacific bug (audit U8).** Today, `LogMode.jsx:50` writes `eaten_on: new Date().toISOString().split('T')[0]`. That converts the user's local time to UTC, then takes the date part. For a user logging dinner at 11pm Pacific, UTC is already the next day — so the `eaten_on` row says tomorrow. The fix is to format the date using local-calendar components (`getFullYear()`, `getMonth()`, `getDate()`) rather than going through `toISOString()`. We already have a private `formatLocalYmd` helper inside `src/lib/mealPlanReader.js` (line ~6) doing exactly this; this prompt promotes it to a real shared module so every consumer can import it.

After this PR, both audit items move from "Pending" to "Fixed" in PRD-002 §2.

---

## Context to read first (before any edits)

1. **Spec:** [`docs/prds/PRD-002-meal-planning.md`](../prds/PRD-002-meal-planning.md), §6 P0.10 + P0.11.
2. **Audit findings:** [`AUDIT.md`](../../AUDIT.md), U3 + U8 entries (around line 100). Both quoted in the "Why this matters" section above.
3. **Files you'll modify:**
   - `src/pages/BrainstormMode.jsx` — `buildLastWeekSlots` at ~line 507 (PRD says 323 — drifted post-ADR-001-Phase-1) and the call-site filter at ~line 386 where `lastWeekMeals` is built. The function's caller already has `periods` in scope from `listUserPeriods(supabase, userId)`.
   - `src/pages/LogMode.jsx` — line 50: replace `new Date().toISOString().split('T')[0]` with the new `formatLocalDate(new Date())`.
   - `src/lib/mealPlanReader.js` — refactor: replace the private `formatLocalYmd` helper (~line 6) with an import of the new shared `formatLocalDate`. Keep the same behavior; just remove the duplicate.
   - `docs/schema.md` — line 55, the `eaten_on` row currently warns "see AUDIT U8 for the timezone caveat" — update to note the fix is in.
4. **Files you'll create:**
   - `src/lib/dateUtils.js` — exports `formatLocalDate(date)` (and any related local-time helpers if they're trivially needed). Tiny — maybe 20 lines.
   - `src/lib/__tests__/dateUtils.test.js` — vitest coverage including the 11pm-PT regression.
   - `src/pages/__tests__/BrainstormMode.lastWeek.test.jsx` — vitest coverage for the period-aware logic.
5. **Files for reference (do NOT modify):**
   - `src/lib/mealPlanWriter.js` — already takes pre-formatted `'YYYY-MM-DD'` strings; no fix needed there.
   - The other `new Date().toISOString()` call sites identified during scoping (`Vault/useVault.js:229`, `mealPlanWriter.js:158`/`:192`, `Vault/useVault.js`'s `deleted_at`) write **full timestamps** to `timestamptz` columns — those are correct and do not need changing.

If file structure or line numbers differ noticeably from the above (±20 lines), **stop and ask the user** rather than guessing.

---

## Step 1 — P0.11: Create `src/lib/dateUtils.js` + tests

Why this step first: the new module is tiny and self-contained, lands without touching any UI flow, and gives us the helper we'll then thread into LogMode and (if useful) the period-aware logic in Step 2.

### 1a) Create `src/lib/dateUtils.js`

```js
/**
 * Date helpers — local-calendar-aware, NOT UTC.
 *
 * Why this module exists: `new Date().toISOString().split('T')[0]` is the
 * tempting one-liner for a YYYY-MM-DD date string, but it converts to UTC
 * first. For a user in Pacific time logging dinner at 11pm, that produces
 * tomorrow's date. AUDIT U8 / PRD-002 P0.11.
 *
 * Use `formatLocalDate(d)` for any 'YYYY-MM-DD' write that's meant to
 * represent the user's local calendar day (e.g., `eaten_on`,
 * `scheduled_date`, `period_start`, `period_end`).
 */

/**
 * Format a Date as 'YYYY-MM-DD' using local-calendar components.
 * Mirrors the shape that mealPlanWriter expects for date strings.
 *
 * @param {Date} date - the Date to format. Defaults to `new Date()`.
 * @returns {string} 'YYYY-MM-DD' in the user's local timezone.
 */
export function formatLocalDate(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
```

Keep the surface minimal — just `formatLocalDate`. Other date helpers (e.g., `addDays` already exists somewhere) can move into this module later in Phase 2 or Phase 3 if it makes sense; not now.

### 1b) Create `src/lib/__tests__/dateUtils.test.js`

Mirror the vitest pattern used in `src/lib/__tests__/recommendations.test.js` (no Supabase mock needed for this one).

Cover these cases:

- `formatLocalDate(new Date(2026, 3, 26))` returns `'2026-04-26'` (April is month index 3 — verify month is 1-indexed in output).
- Single-digit months and days are zero-padded: `formatLocalDate(new Date(2026, 0, 5))` → `'2026-01-05'`.
- The 11pm-PT regression — the explicit reason this module exists. Vitest supports `vi.useFakeTimers()` + `vi.setSystemTime(...)`. Construct a Date that, in the test runner's local timezone, represents "11:30pm" but in UTC is the next day. Assert that `formatLocalDate(d)` returns the local date, not the UTC one. The exact mechanics:
  ```js
  // Pretend it's 11:30pm local on April 26
  const lateLocal = new Date(2026, 3, 26, 23, 30, 0)
  expect(formatLocalDate(lateLocal)).toBe('2026-04-26')
  // Confirm toISOString() would have given the wrong answer (sanity check)
  // Skip if test runner happens to be in UTC — the assertion is timezone-dependent.
  ```
- Default arg behavior: `formatLocalDate()` (no arg) returns today's local date. Use `vi.setSystemTime` to make this deterministic.

If your test environment runs in UTC (CI sometimes does), the 11pm regression test won't actually exercise the bug. Add a comment noting this and use a mock `Date` via `vi.setSystemTime` so the test is hermetic.

**Commit:** `feat(dateUtils): add formatLocalDate helper for local-calendar YYYY-MM-DD writes (PRD-002 P0.11)`

---

## Step 2 — P0.11 cont'd: Replace the duplicate in `mealPlanReader.js`

In `src/lib/mealPlanReader.js`:

- Add `import { formatLocalDate } from './dateUtils'` near the top.
- Find the private `formatLocalYmd` function (~line 6). Two options:
  - **Option A (recommended):** Delete it. Replace every internal call to `formatLocalYmd(...)` with `formatLocalDate(...)` (same semantics, new name).
  - **Option B:** Keep `formatLocalYmd` as a thin wrapper that calls `formatLocalDate`. Use only if grep shows `formatLocalYmd` is referenced outside this file (it shouldn't be — it's not exported).
- Update the explanatory comment that referenced "the writer's formatLocalDate" to point at the new shared module: e.g., "Format a Date as 'YYYY-MM-DD' via the shared `formatLocalDate` helper in `dateUtils.js` (lets us compare against the DATE strings stored in period_start / period_end without timezone drift; PRD-002 P0.11 / AUDIT U8)."

Run the existing tests:

```bash
npm run test:unit
```

Should still pass — semantics unchanged.

**Commit:** `refactor(mealPlanReader): use shared formatLocalDate (PRD-002 P0.11)`

---

## Step 3 — P0.11 cont'd: Fix `LogMode.jsx`

In `src/pages/LogMode.jsx`:

- Add `import { formatLocalDate } from '../lib/dateUtils'` near the existing imports.
- Line 50: change `eaten_on: new Date().toISOString().split('T')[0]` to `eaten_on: formatLocalDate()` (the default-arg `new Date()` is exactly what we want here).

This is the actual user-visible bug fix. After this commit, dinner logged at 11pm Pacific saves with today's date.

### Test extension

Look at `src/pages/__tests__/LogMode.test.jsx` if it exists. If there's an existing "save inserts a meal row" test, extend it with a fake-timer regression: set system time to 11:30pm in a `getTimezoneOffset > 0` zone (or mock `Date` to return the right local components), invoke save, assert the inserted row's `eaten_on` is the local date, not the UTC-shifted one. If the test file doesn't exist or the existing test pattern doesn't expose the inserted row easily, add a comment noting why and skip — the `dateUtils.test.js` regression covers the same logic at a lower level.

**Commit:** `fix(logmode): write eaten_on with local-calendar date (PRD-002 P0.11 / AUDIT U8)`

---

## Step 4 — P0.10: Make `buildLastWeekSlots` period-aware

This is the meatier change of the two. Read the full context first:

### 4a) Find the call site

In `src/pages/BrainstormMode.jsx`, the relevant chunk is around line 386 inside `loadData`:

```js
// Last week = meals from the past 7 days, mapped to Mon–Fri slots
const sevenDaysAgo = addDays(today, -7)
const lastWeekMeals = recentMeals.filter(
  m => new Date(m.eaten_on) >= sevenDaysAgo
)
setLastWeek(buildLastWeekSlots(lastWeekMeals))
```

`periods` is already in scope from `listUserPeriods(supabase, userId)` earlier in `loadData`. The plan-classification logic just above already touches `periods`, so this call site has access to the full period history.

### 4b) Compute the prior period

A prior period is one whose `period_end < today` (already finished). The "immediately prior" one is the most recent of those. The currently-active or future periods don't count.

Sketch (adjust to match the exact `periods` shape returned by `listUserPeriods` — peek at `mealPlanReader.js` to confirm field names):

```js
function findImmediatelyPriorPeriod(periods, today) {
  const todayYmd = formatLocalDate(today)
  // periods sorted by period_start ascending typical; find the last one
  // whose period_end is strictly before today
  return [...periods]
    .filter((p) => p.period_end && p.period_end < todayYmd)
    .sort((a, b) => b.period_end.localeCompare(a.period_end))[0] || null
}
```

If you find an existing helper for "prior period" in `mealPlanReader.js` already, use that instead — don't introduce a parallel implementation. (Spot-check with `grep -n "priorPeriod\|previousPeriod" src/lib/mealPlanReader.js`.)

### 4c) Update the meal-window selection

Replace the existing `lastWeekMeals` filter with a period-aware version:

```js
const priorPeriod = findImmediatelyPriorPeriod(periods, today)
const sevenDaysAgo = addDays(today, -7)

const windowStartYmd = priorPeriod
  ? priorPeriod.period_start
  : formatLocalDate(sevenDaysAgo)
const windowEndYmd = priorPeriod
  ? priorPeriod.period_end
  : formatLocalDate(today)

const lastWeekMeals = recentMeals.filter((m) => {
  const ymd = m.eaten_on  // already 'YYYY-MM-DD' from the DB
  return ymd >= windowStartYmd && ymd <= windowEndYmd
})
setLastWeek(buildLastWeekSlots(lastWeekMeals))
```

Note we compare YMD strings lexically — that's safe and timezone-free for zero-padded ISO date strings. The original code used `new Date(m.eaten_on)` comparisons which is fine but less direct.

### 4d) `buildLastWeekSlots` itself — keep or improve?

The current function at ~line 507:

```js
function buildLastWeekSlots(meals) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  return days.map(day => {
    const match = meals.find(m => {
      const d = new Date(m.eaten_on)
      return d.toLocaleDateString('en-US', { weekday: 'short' }) === day
    })
    return { day, name: match?.name || null }
  })
}
```

Two issues remain inside the function even after we narrow the input:

1. `new Date(m.eaten_on)` — `eaten_on` is a 'YYYY-MM-DD' string. Parsing that with `new Date(str)` uses UTC, so weekday computation can be off-by-one for users east of UTC. Fix: parse with explicit local components: `new Date(year, month - 1, day)` after splitting the string. Or, more simply, build the matching the other way: convert each `m.eaten_on` to its weekday once via the local-aware path, then bucket by weekday.
2. **Duplicate-weekday ambiguity (the audit U3 example).** If two meals fall on Tuesday (which only happens if periods overlap or longer than 7 days — extremely rare given current constraints, but possible), `meals.find(...)` returns the first match. Replace with "the most recent match" by sorting `meals` by `eaten_on` descending before the find, OR by using `meals.reduce` to keep the latest.

Recommended consolidated fix:

```js
function buildLastWeekSlots(meals) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  // Sort meals most-recent-first so .find returns the latest match per weekday
  const sorted = [...meals].sort((a, b) => b.eaten_on.localeCompare(a.eaten_on))
  return days.map(day => {
    const match = sorted.find(m => {
      const [y, mo, d] = m.eaten_on.split('-').map(Number)
      const local = new Date(y, mo - 1, d)
      return local.toLocaleDateString('en-US', { weekday: 'short' }) === day
    })
    return { day, name: match?.name || null }
  })
}
```

### 4e) Tests

**Create** `src/pages/__tests__/BrainstormMode.lastWeek.test.jsx`. Three cases minimum:

1. **Period-aware (the U3 fix).** Given `periods = [{ period_start: '2026-04-13', period_end: '2026-04-19', ... }]` (a Thu–Wed period that ended 7 days before "today"), `today = 2026-04-26`, and `recentMeals` containing one meal eaten on `2026-04-15` (within the prior period) and one eaten on `2026-04-25` (after the prior period), expect the last-week view to include only the `2026-04-15` meal. The post-period meal does NOT appear.
2. **No prior period — fallback.** Given `periods = []`, fall back to the past-7-days behavior.
3. **Duplicate-weekday picks the latest.** Given two meals both eaten on Mondays inside the window, the most-recent one wins (not the first encountered).

If the existing `BrainstormMode.test.jsx` is large and brittle, prefer extracting the period-aware logic into a small pure function (e.g., `selectLastWeekMeals(meals, periods, today)`) that can be unit-tested without rendering BrainstormMode. That's a cleaner test surface and isolates the fix. If you do this, put the helper in `src/lib/lastWeek.js` (or inline it within `mealPlanReader.js` if it belongs there).

**Commit:** `fix(brainstorm): last-week view sources meals from prior period, not fixed 7d window (PRD-002 P0.10 / AUDIT U3)`

---

## Step 5 — Documentation touch-ups

### 5a) Update `docs/schema.md`

Find the `eaten_on` row (~line 55):

```markdown
| `eaten_on` | `date` | Written as `new Date().toISOString().split('T')[0]` — see AUDIT U8 for the timezone caveat. |
```

Change to:

```markdown
| `eaten_on` | `date` | Written via `formatLocalDate()` from `src/lib/dateUtils.js` (PRD-002 P0.11; resolves AUDIT U8). |
```

### 5b) No PRD edits

Don't update PRD-002 itself — its acceptance-criteria language is the standard the PR is being evaluated against. The Revision History entry is the user's call when they decide to mark the work complete.

**Commit (folded into the appropriate earlier commit, or its own):** `docs(schema): note local-calendar date helper landed (PRD-002 P0.11)`

---

## Step 6 — Final sweep

```bash
npm run test:unit
npm run lint
npm run build
```

All three must pass. The build check matters because `BrainstormMode.jsx` is imported into the main app and a syntax slip there breaks production.

```bash
# No more raw toISOString().split for date-only writes
grep -rn "toISOString().split('T')\[0\]" src/
# Should return: nothing (or only test files asserting the OLD format for regression)
```

---

## Acceptance criteria (Phase 1 done means all of this true)

- [ ] All six pre-flight working-tree checks pass
- [ ] Branch `fix/prd-002-phase-1-audit-fixes` created from a fresh `main` (post-closeout)
- [ ] `src/lib/dateUtils.js` exists, exports `formatLocalDate`
- [ ] `src/lib/__tests__/dateUtils.test.js` exists, includes the 11pm-PT regression with `vi.setSystemTime`
- [ ] `src/lib/mealPlanReader.js` no longer has its own `formatLocalYmd`; it imports `formatLocalDate` instead (or wraps it in a thin alias)
- [ ] `src/pages/LogMode.jsx` line 50 uses `formatLocalDate()` for `eaten_on`
- [ ] `src/pages/BrainstormMode.jsx` `buildLastWeekSlots` (and its caller) source meals from the immediately-prior period when one exists, falling back to past-7-days otherwise
- [ ] `buildLastWeekSlots` parses `eaten_on` with local-aware components (no `new Date('YYYY-MM-DD')` UTC pitfall)
- [ ] `src/pages/__tests__/BrainstormMode.lastWeek.test.jsx` exists with the three described cases (or equivalent — a pure-function extraction is also fine)
- [ ] `docs/schema.md`'s `eaten_on` row notes the fix
- [ ] `grep -rn "toISOString().split('T')\\[0\\]" src/` returns no production-code matches
- [ ] `npm run test:unit`, `npm run lint`, and `npm run build` all pass
- [ ] Manual smoke test plan in PR description (2 minutes):
  1. `npm run dev` + `npm run dev:api`. Open LogMode. Log a meal. In Supabase, confirm `eaten_on` matches today's local date.
  2. (If feasible — won't trigger reliably) Set system time to 11:30pm Pacific via OS settings. Log a meal. Confirm `eaten_on` is still today's date, not tomorrow's. Skip if the user is on east-of-UTC time and can't reproduce.
  3. Open BrainstormMode. The "last week" Mon–Fri view at top: with at least one prior period that ended within the last 7 days, confirm it shows meals from that prior period (not later meals).

---

## Constraints

- **Stack:** React 19.2 + Vite 8 + Tailwind 3.4 + lucide-react. No new dependencies.
- **No migration.** Both fixes are client-side; no schema change.
- **Pure bug-fix.** Don't expand scope into the rest of PRD-002 (preferences schema, prep_time, Maybe tray — all those are Phase 2/3/4).
- **Don't fix unrelated lint or test errors.** If you spot some, note them in the PR description as follow-ups; don't expand scope.
- **Don't introduce a `react-router-dom` route** for the new test surface or anything else — routing is reserved for PRD-003.
- **Test framework:** Vitest + RTL only. Use `vi.setSystemTime` and `vi.useFakeTimers()` for time-sensitive tests; this is the standard pattern.

---

## Out of scope (do NOT touch)

- PRD-002 P0.1–P0.9 (preferences, prep_time, scoring changes, Maybe tray, tap-a-day picker) — Phases 2/3/4
- PRD-002 P0.12 (preference change warning) — Phase 3
- ADR-001 Phase 7 (deprecated `meal_plans` columns cleanup) — separate work
- Any of the other audit items (U1, U2, U4, U5, U6, U7) — different scope, different work
- BrainstormMode.jsx general decomposition (1,136 lines) — not in this PRD
- Any `supabase/migrations/` changes — no schema in this phase
- The `family_rating` scoring weight — Phase 2
- The Spoonacular wildcard wiring — already shipped as PRD-001 P0.8

---

## Commit cadence

Three to four commits, one logical change per commit. Recommended split:

1. `feat(dateUtils): add formatLocalDate helper for local-calendar YYYY-MM-DD writes (PRD-002 P0.11)`
2. `refactor(mealPlanReader): use shared formatLocalDate (PRD-002 P0.11)`
3. `fix(logmode): write eaten_on with local-calendar date (PRD-002 P0.11 / AUDIT U8)`
4. `fix(brainstorm): last-week view sources meals from prior period (PRD-002 P0.10 / AUDIT U3)`

Schema doc update can fold into commit 3 or be its own. Either way, keep each commit logically self-contained — `npm run test:unit && npm run lint` should pass at every commit so the user can `git bisect` later if needed.

---

## When you finish

1. Run the full acceptance checklist above.
2. Open the PR. Title: `PRD-002 Phase 1: U3 + U8 audit fixes`.
3. In the PR description:
   - List the new file structure (just `dateUtils.js` + its test + the BrainstormMode test)
   - Note any deviations from this prompt and why
   - Include the 3-step manual smoke test plan
   - Add a footer: "After merge, mark **PRD-002 P0.10 and P0.11 as complete in `RECIPE_TODOS.md`** (lives in the user's Claude.ai project knowledge, not this repo). PRD-002 Phase 1 closes out; Phase 2 (suggestion-quality upgrade) is next."
4. Note any follow-ups (e.g., should other YMD writes elsewhere migrate to `formatLocalDate` proactively, even though they're not strictly buggy today?).
5. Wait for the user to spot-check the manual smoke tests before merging.
