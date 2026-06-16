# Claude Code Prompt — Fix LogMode "last night" off-by-one date (no PRD)

**For:** Claude Code (executor)
**Authored by:** Cowork (planning surface) on 2026-06-16
**Type:** Bug fix, not a PRD phase. Will NOT update `docs/STATUS.md`.
**Roadmap item:** Sprint 1, item 1.3 (`docs/ROADMAP.md`).
**Source:** QA audit finding **VP-1** (`QA-EDGE-CASE-AUDIT-2026-06-02.md`) — confirmed live, priority P1.

---

## ⚠ Pre-flight: confirm you're in the right place

```bash
EXPECTED="/Users/Matt/projects/recipe-rhythm"
ACTUAL="$(git rev-parse --show-toplevel 2>/dev/null)"
[ "$ACTUAL" = "$EXPECTED" ] || { echo "ABORT: not in recipe-rhythm repo root"; exit 1; }
git fetch origin
git switch -c fix/logmode-lastnight-date origin/main   # branch off LATEST main
git status   # working tree should be clean
```

If the working tree isn't clean, stop and surface to the user.

---

## The bug (confirmed live — do not re-investigate from scratch)

`src/pages/LogMode.jsx` shows a **time-aware prompt** but writes an **unconditional date**:

```js
// ~line 64 — header is time-aware:
const timeAwareString = todayHour < 11
  ? 'What did you eat last night?'   // implies YESTERDAY
  : 'What did you eat tonight?'      // implies TODAY

// ~line 58 — but the insert is always TODAY:
eaten_on: formatLocalDate()
```

So a meal logged before 11am under "What did you eat **last night**?" is stored on **today's** date instead of yesterday's. `formatLocalDate()` itself is correct (the AUDIT U8 / PRD-002 P0.11 timezone fix is intact); the bug is purely that nothing subtracts a day for the "last night" case.

**Impact:** every morning log lands on the wrong day, corrupting the cooking record that feeds the "last cooked" badge, recommendation scoring, and the Calendar. Deterministic, not edge-case.

> ⚠️ Confirm the exact line numbers and the `todayHour < 11` threshold against the current file before editing — line numbers above are from the 2026-06-02 audit and may have drifted.

---

## Chosen fix (minimal)

When the prompt means "last night" (`todayHour < 11`), write **yesterday's** local date. Keep `formatLocalDate()` for the "tonight" case. Do **not** change `formatLocalDate` itself.

The single source of "which day does this prompt refer to" must drive **both** the header string and the `eaten_on` value — derive the date from the same `todayHour < 11` condition so they can never disagree again.

### Step 1 — add an `addDays` helper to `src/lib/dateUtils.js`

There is no date-arithmetic helper today. Add one (pure, timezone-safe, testable):

```js
/**
 * Returns a new Date offset from `date` by `n` calendar days (n may be negative).
 * Operates on local-calendar fields so it composes safely with formatLocalDate().
 *
 * @param {number} n            days to add (negative to subtract)
 * @param {Date} [date=new Date()]
 * @returns {Date}
 */
export function addDays(n, date = new Date()) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}
```

### Step 2 — use it in `src/pages/LogMode.jsx`

Derive the target date from the same condition that drives `timeAwareString`. For example:

```js
const isLastNight = todayHour < 11
const eatenOn = isLastNight
  ? formatLocalDate(addDays(-1))
  : formatLocalDate()
// ...then write eaten_on: eatenOn in the insert payload
```

Import `addDays` alongside the existing `formatLocalDate` import. Keep the diff minimal — do not refactor unrelated LogMode code.

> **Note on the alternative the audit raised:** VP-1 also suggested replacing the implicit "last night/tonight" assumption with an *explicit, editable date control* on the Log screen. That's a larger UX change — out of scope for this fix. If the user wants it, it should be its own PRD/roadmap item. This prompt does the minimal correctness fix only.

---

## Step 3 — tests (Vitest)

Add tests proving the fix with a **mocked clock**, since the bug is time-of-day dependent.

1. `src/lib/__tests__/dateUtils.test.js` (extend or create): assert `addDays(-1, new Date('2026-06-02T06:00:00'))` formats via `formatLocalDate` to `'2026-06-01'`; assert `addDays(0)` is today; assert a month/year boundary case (e.g. `addDays(-1, new Date('2026-03-01T06:00:00'))` → `'2026-02-28'`).
2. `src/pages/__tests__/LogMode.test.jsx` (extend or create): with the system clock mocked to **06:00 local**, simulate entering a meal and tapping save, and assert the Supabase insert payload's `eaten_on` equals **yesterday's** local date. With the clock mocked to **e.g. 20:00 local**, assert `eaten_on` equals **today's** local date. Use `vi.useFakeTimers()` / `vi.setSystemTime(...)` and the existing Supabase mock pattern (see `src/lib/__tests__/recommendations.test.js`).

Run `npm test` (or the project's test command) and confirm green before opening the PR.

---

## Acceptance criteria

- [ ] Logging before 11am ("last night") writes **yesterday's** local `eaten_on`.
- [ ] Logging at/after 11am ("tonight") writes **today's** local `eaten_on` (unchanged behavior).
- [ ] Header string and `eaten_on` are both derived from the **same** `todayHour < 11` condition.
- [ ] New `addDays` helper in `dateUtils.js` with tests, including a month-boundary case.
- [ ] LogMode test with a mocked 06:00 clock asserts yesterday's date.
- [ ] No changes to `formatLocalDate`. No unrelated refactors. No `docs/STATUS.md` change.
- [ ] Standard frontend verification: push branch, check the Vercel preview build via MCP, report status in the PR description.

Branch: `fix/logmode-lastnight-date`. PR title: `fix(logmode): write yesterday's date for the "last night" prompt (VP-1)`.

## If something doesn't match

Stop and ask the user. Specifically: if the current LogMode code already conditionalizes `eaten_on` (i.e. the bug was already fixed in a branch you can't see), confirm before changing anything.
