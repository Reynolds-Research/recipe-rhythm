# Claude Code prompt — ADR-001 Phase 6: calendar view

_Hand the block between the two `---` markers to Claude Code._

**Dependencies:** ADR-001 Phases 2-5 must be merged.

---

## Context

You are working on **Recipe Rhythm**, a React 19 + Vite 8 + Supabase meal-tracking app.

**Required reading:**

- `docs/adr/ADR-001-planning-period-save-state.md` — full ADR. Focus on `Action Items → Phase 6` (line 357).
- `src/lib/mealPlanReader.js` — helpers for fetching plans and items.
- `src/pages/BrainstormMode.jsx` — the host page that current exposes Log / Brainstorm / Vault tabs.
- `src/App.jsx` — the bottom-tab nav where you'll add (or embed) the calendar.

**State of the system:**

- Users have a concept of periods with `period_start` / `period_end`, scheduled items with `scheduled_date`, and a finalized vs. not-finalized flag.
- There is currently no way to see multiple periods at a glance. The Brainstorm page shows only the most-recent/active plan.

## Task

Build the **in-app calendar visualization**. It answers two questions the user can't answer today:

1. "What have I planned recently, at a glance?"
2. "Where were my gap days and which periods did I skip finalizing?"

This is a **read-only** surface for now. No mutations, no navigation into edit flows. Tapping a date with a scheduled meal can optionally show a tooltip/popover with the meal name, but do not add an edit path here — that's future work.

## Deliverables

### 1. Extend `src/lib/mealPlanReader.js`

Add a new helper:

```js
/**
 * Fetches all meal_plan_items for a user within a date window, joined with
 * enough meal_plans metadata to render calendar cells.
 *
 * @param {SupabaseClient} supabase
 * @param {string} userId
 * @param {string} fromDate - 'YYYY-MM-DD' inclusive
 * @param {string} toDate   - 'YYYY-MM-DD' inclusive
 * @returns {Promise<Array<{
 *   item_id: string,
 *   scheduled_date: string,
 *   name: string,
 *   cooked: boolean,
 *   meal_plan_id: string,
 *   period_start: string,
 *   period_end: string,
 *   finalized_at: string | null,
 * }>>}
 */
export async function fetchScheduledItemsInRange(supabase, userId, fromDate, toDate) { /* ... */ }
```

Implementation: a single Supabase query that joins `meal_plan_items` to `meal_plans` via `meal_plan_id`, filtered by `user_id = auth.uid()` and `scheduled_date BETWEEN fromDate AND toDate`. RLS does the user scoping automatically, but include `user_id = userId` defensively.

### 2. Create `src/components/CalendarView.jsx` (or `src/pages/`, consistent with prior phases)

A month-grid calendar. Props:

```
{
  userId,
  initialMonth?: Date,   // defaults to current month
}
```

Layout:

- Header: month/year label, prev/next arrows.
- 7-column grid: Sun through Sat.
- Each cell:
  - Date number in the corner.
  - If the date falls inside a period (`scheduled_date` maps back to its plan's `period_start..period_end`): a subtle background tint. Different shades for active vs. finalized vs. any other state you add — pick 2-3 colors that read on mobile.
  - If a scheduled item exists on that date: show a small dot or the first ~10 chars of the meal name (your call based on space). Cooked items get a subdued/strikethrough treatment.
  - Gap days (between the last period_end of one plan and the period_start of the next, with no scheduled items): neutral background, optional subtle "gap" pattern.
  - Today's cell: highlighted ring.
- Below the grid, a small legend explaining the color coding.

Interaction:

- Tap a cell with an item → popover or bottom-sheet showing the meal name(s) on that day, the period's date range, and whether the period was finalized. Dismissible.
- Tap prev/next → change month, refetch (memoize by month to avoid refetch-thrash).
- First render: fetch the current month plus 1 month on either side so prev/next feel instant.

Data fetch:

- On mount and on month change, call `fetchScheduledItemsInRange` with `fromDate = first-visible-date`, `toDate = last-visible-date`. Calendar grids typically show a partial prior-month week and trailing-month week; include those so the visible cells are all populated.
- Show a subtle loading state — don't blank the grid; keep the previous month's data visible while the new fetch is in flight.

Styling: mobile-first, match the existing Tailwind patterns. Do NOT add a calendar library (react-big-calendar, react-calendar, etc.). Hand-roll the month grid with `Date` math; the app's convention is zero-dependency for this kind of thing.

### 3. Wire into `src/App.jsx`

Add a fourth tab to the bottom nav: "Calendar." Icon: use `lucide-react`'s `Calendar` or `CalendarDays`.

Tab order suggestion: Log, Brainstorm, Calendar, Vault — Calendar slots between the active workflow (Brainstorm) and the library (Vault) because it's a "look back/overview" surface.

When the Calendar tab is active, render `<CalendarView userId={userId} />`.

### 4. Tests

Unit tests at `src/lib/__tests__/mealPlanReader.range.test.js`:

1. `fetchScheduledItemsInRange` — mocked supabase returning a joined rowset → returns the flat shape documented in the function contract.
2. Empty range (no scheduled items) → returns `[]`.
3. Error surfaces.

Component tests at `src/components/__tests__/CalendarView.test.jsx`:

1. Renders 35 or 42 cells for the current month (5 or 6 rows, depending on layout).
2. A date with a scheduled item shows the meal preview.
3. A finalized-period date has the finalized color class; an active-period date has the active class.
4. Prev/next buttons change the month header text and trigger a new fetch.
5. Clicking a cell with an item opens the popover; clicking outside closes it.

No E2E needed for Phase 6 — the calendar is read-only, low-risk, and covered by component tests. (Add one later if the tab gets interactive.)

## Acceptance criteria

- `CalendarView` component exists, is tab-accessible from the bottom nav, and passes component tests.
- `fetchScheduledItemsInRange` exists and is tested.
- Navigating between months does not produce duplicate network requests for the same month (memoize by `YYYY-MM`).
- `npm run test:unit -- --run` passes.
- `npm run lint` and `npm run build` succeed.
- Manual smoke test in the PR: open the Calendar tab, see the current month; scheduled items render on their actual dates; tap one to see details; navigate to a prior month with a finalized period — shaded accordingly.

## Out of scope (explicitly)

- Editing plans from the calendar.
- Creating a new period by selecting dates on the calendar (that's Phase 5's date picker).
- Logged meals (the `meals` table) — this view is only about planned items from `meal_plan_items`. Mixing logged-only meals in is a future enhancement.
- Multi-month "year view."
- Dropping deprecated columns (Phase 7).

## Deliverable format

One PR:
- `src/lib/mealPlanReader.js` extended
- `src/lib/__tests__/mealPlanReader.range.test.js` new (or appended)
- `src/components/CalendarView.jsx` + `src/components/__tests__/CalendarView.test.jsx` new
- `src/App.jsx` edited for the new tab
- PR description linking ADR-001 Phase 6, a screenshot of the calendar with some scheduled items, and the manual smoke-test report.

---

## Notes for the human (you)

**Why no calendar library.** Your repo's audit (L3) already flags bleeding-edge dependency versions as a risk surface. A dedicated calendar library adds 30-60KB of JS and a new API to learn. A hand-rolled month grid is ~80 lines of React + a helper that returns the visible date array. For this use case, that's the right call.

**Why tap-to-popover rather than navigate.** A "tap date → go somewhere" pattern forces decisions about where that somewhere is (edit? log? vault?). A popover is neutral and reversible, which matches "Phase 6 is read-only." When the product grows, swap the popover for a link without disrupting anyone's mental model.

**Things to verify after merge:**

1. Open the Calendar tab on a day that is NOT inside any period (a true gap day). The cell should not be shaded as a period.
2. A finalized period's days all share one shade; an active period's days share a different shade.
3. Mark an item cooked in the Brainstorm view, switch to Calendar — that date's visual should reflect cooked (strikethrough or whatever convention you picked).
4. Prev/next buttons are fast after the first load of each month (memoized).
5. On a fresh account with no plans, the calendar renders a blank grid with today's ring highlight. No errors.
