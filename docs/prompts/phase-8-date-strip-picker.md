# Claude Code prompt — ADR-001 Phase 8: date-strip picker for Brainstorm tab

_Hand the block between the two `---` markers to Claude Code._

**Dependencies:** ADR-001 Phases 2-6 must be merged. Phase 7 (legacy-column drop) MUST NOT have run yet.

**Why this phase exists:** The original ADR promised "user picks a start AND end date for each period." Phase 5 delivered that for the gap-day new-period flow via a calendar picker. But the Brainstorm tab — the everyday meal-planning surface — still uses a weekday-chip picker with no way to choose WHICH week or to plan beyond a 7-day cadence. This phase replaces the weekday-chip UI with a **date-strip picker that shows 7 days by default and extends to 14 days on demand**, so plans can be any set of dates (1-14), contiguous or with gaps, chosen directly on a mobile-friendly date grid. The one-week default keeps the visual load light for the common "plan next week" case; the extend option covers longer stretches without cluttering the everyday surface. The calendar picker in the gap-day flow and the read-only Calendar tab are unchanged.

---

## Context

You are working on **Recipe Rhythm**, a React 19 + Vite 8 + Supabase meal-tracking app.

**Required reading:**

- `docs/adr/ADR-001-planning-period-save-state.md` — full ADR. Item 1 in `Context → What we want to change` ("user-defined planning periods") is what this phase finally satisfies for the Brainstorm tab.
- `src/pages/BrainstormMode.jsx` — especially the chip day-picker (search for `showDayPicker`, `pendingDays`, `applyDays`, `planDays`), `loadData`, and `handleServe`.
- `src/lib/mealPlanWriter.js` — `createServedPlan`, `derivePlanDates`, `checkPeriodOverlap`. Two of these change meaningfully this phase.
- `src/lib/mealPlanReader.js` — `fetchMostRecentPlan`, `classifyPlanState`.
- `src/components/DateRangePicker.jsx` — Phase 5's calendar picker. **Do not modify.** It stays reserved for the gap-day new-period flow.
- `src/components/CalendarView.jsx` — Phase 6's read-only calendar tab. **Do not modify.**

**Current behavior this phase replaces:**

- On the Brainstorm tab, a row of weekday chips (Sun Mon Tue…) drives plan creation. The user picks weekdays; `derivePlanDates(planDays, new Date())` maps each chip to "the next occurrence of that weekday." The target week is always "this/next week."
- Plans are architecturally capped at 7 days. No way to plan a 10-day stretch or a cross-week pattern like "this Tue and next Tue."
- `plan` state items have a `day: string` weekday field. `meal_plan_items.scheduled_date` is the real DB field, but it's derived at write time, not chosen by the user.

**Desired behavior after this phase:**

- The chip picker is gone. In its place, a **date-strip picker** renders today through today+6 (one week) as tappable cells by default. A "Show another 7 days" affordance extends the visible grid to today+13 (two weeks). Collapsing back is allowed; selections already made in the second week persist even while the second row is hidden. Any subset of 1-14 dates is a valid plan.
- Dates that fall inside an existing period (active, past, or future-scheduled) render as visually disabled and are not tappable.
- `plan` state items carry `scheduled_date: 'YYYY-MM-DD'` instead of `day`. The "week" concept is gone from the Brainstorm tab's data model.
- `createServedPlan` accepts an explicit array of dates (derived from the plan items) rather than weekday strings. `derivePlanDates` is removed.
- Default selection on first load: **mimic the user's prior habit.** If localStorage has a stored weekday pattern (legacy `brainstorm_plan_days`) or a stored date list (new `brainstorm_plan_dates`), use that to seed the initial selection. Otherwise default to the next 5 non-overlapping upcoming weekdays that match a Sun-Thu shape.

## Task

Build the date-strip picker, swap it into the Brainstorm tab, and update the writer/reader/state to carry `scheduled_date` instead of weekday strings. The gap-day flow (Phase 5) and Calendar tab (Phase 6) are untouched.

## Deliverables

### 1. Create `src/components/DateStripPicker.jsx`

A compact date picker for the Brainstorm tab.

```
Props:
  selectedDates:   string[]              // 'YYYY-MM-DD' array, controlled by parent
  disabledDates:   Set<string>           // dates that fall inside an existing period
  onToggle:        (date: string) => void
  // No horizonDays prop — the visible horizon is managed internally (7 default, 14 max)
  //                     via a component-local `expanded` boolean.

Internal state:
  expanded: boolean — starts false (shows 7 cells). Flipped true by the "Show another
                      7 days" button or by auto-expansion (see below).

Renders:
  - A single row of 7 cells (today, today+1, ... today+6) by default.
  - When expanded, a second row appears below showing today+7 ... today+13.
  - Each cell shows the weekday abbreviation ("Sun") above the day-of-month number ("26").
  - Visual states:
      default         → neutral border
      selected        → brand-color background, white text
      disabled        → muted background, reduced opacity, strikethrough or slash icon,
                         aria-label "Already planned in another period"
      today highlight → ring around the cell (same convention as CalendarView)
  - Tapping a default cell toggles selection (calls onToggle with the date).
  - Tapping a disabled cell does nothing (also no pointer cursor).
  - Below the grid:
      • A count line: "X of N days selected · Apr 26 – May 2" where N reflects the
        currently visible horizon (7 when collapsed, 14 when expanded). The range
        uses the min–max of `selectedDates` — and if a selection extends beyond the
        visible rows (selected date on day 7-13 while collapsed), show it in the
        range and auto-expand (see below).
      • A "Show another 7 days" button when expanded === false. Tapping it flips
        expanded to true.
      • When expanded === true, replace the button with "Hide second week" (a
        quieter, text-only link, not a primary button).

Auto-expansion rule:
  On mount, if any date in selectedDates falls in the today+7..today+13 range,
  set expanded = true immediately. This prevents the user from having a selection
  they can't see just because they reloaded the page. The reverse is NOT true —
  deselecting all second-week dates does not auto-collapse. Collapsing is only
  manual (the "Hide second week" link).

Selection persistence across collapse:
  Collapsing the second week does NOT deselect dates in it. The parent's
  selectedDates state is the source of truth; the picker is purely presentational
  about which cells are visible. The count-line range line makes offscreen
  selections obvious.
```

Acceptable layout alternative: a single horizontally-scrollable row that starts
showing ~7 cells and scrolls to reveal more. Default to the two-row
collapsed/expanded approach above unless that doesn't read well in the existing
Tailwind design language — match Vault.jsx / LogMode.jsx for tone if in doubt.

Mobile-first, no new dependencies. All date math uses local-calendar components
(`new Date(y, m, d)`, `.getFullYear()`, etc.) — never `toISOString()` for the display
formatting or cell generation. Format dates to `YYYY-MM-DD` with a small local helper.

### 2. Rework `src/lib/mealPlanWriter.js`

**Delete** `derivePlanDates` — it's dead weight once the UI hands dates directly.

**Change** the `createServedPlan` signature:

```js
/**
 * Creates a new served meal plan from an explicit list of scheduled items.
 * Writes to the new normalized schema only.
 *
 * period_start = min(item.scheduled_date); period_end = max(item.scheduled_date).
 * Gaps between scheduled dates are normal — not every date in [start, end] needs
 * an item. The EXCLUDE constraint on meal_plans enforces non-overlap at the DB level.
 *
 * @param {SupabaseClient} supabase
 * @param {string} userId
 * @param {Array<{
 *   scheduled_date: string,   // 'YYYY-MM-DD'
 *   name: string,
 *   id: string | null,        // vault_id (null for wildcards / missing)
 *   is_wildcard: boolean,
 *   source_url: string | null,
 * }>} items
 * @returns {Promise<{ id, served_at, period_start, period_end }>}
 * @throws {Error} with `.code` in {'period_overlap','plan_insert_failed','items_insert_failed'}.
 */
export async function createServedPlan(supabase, userId, items) { /* ... */ }
```

Internal logic:
- Guard against empty `items` (throw a clear error; UI shouldn't ever reach this).
- `period_start = items.reduce(min by scheduled_date)`, `period_end = items.reduce(max)`.
- Insert `meal_plans` row with `{ user_id, period_start, period_end }`. Same overlap detection + error mapping as today.
- Insert `meal_plan_items` rows — one per item — with `{ user_id, meal_plan_id, scheduled_date, position: 0, vault_id: toVaultId(item.id), name, is_wildcard, source_url }`.
- Same compensating delete on items-insert failure as today.

Keep `setItemCooked`, `finalizePlan`, `checkPeriodOverlap`, and `startNewPeriod` untouched.

### 3. Add `listUserPeriods` to `src/lib/mealPlanReader.js`

Small new helper, used by the Brainstorm tab to compute the `disabledDates` set for the DateStripPicker:

```js
/**
 * Returns all meal_plans period ranges for a user. The UI expands these into
 * a concrete set of disabled dates for the date-strip picker.
 *
 * @returns {Promise<Array<{ period_start: string, period_end: string }>>}
 *          Rows with NULL period bounds are excluded.
 */
export async function listUserPeriods(supabase, userId) { /* ... */ }
```

One select against `meal_plans`, filtered by `user_id`, `.not('period_start','is',null).not('period_end','is',null)`. Throw on error.

### 4. Update `src/lib/mealPlanReader.js` — items carry `scheduled_date`

`fetchMostRecentPlan` currently returns items with a `day` weekday string. Update it so every item has a `scheduled_date: 'YYYY-MM-DD'` field instead. Rules:

- **New-schema path** (`meal_plan_items` rows exist): `scheduled_date` is copied directly from the row. No change needed under the hood — just make sure the field is present in the returned shape.
- **Legacy fallback path** (plan has `items` jsonb but no `meal_plan_items` rows): compute `scheduled_date` by mapping the item's `day` weekday → the date in the week of `plan.served_at` that matches that weekday. (The current `buildServedMealsForEngine` in `BrainstormMode.jsx` already does this mapping — extract/reuse the logic.) When the mapping is impossible (missing `served_at` or malformed `day`), omit the item rather than emit an invalid date.
- Keep the `days` array on the plan return value but derive it as `[...new Set(items.map(i => i.scheduled_date))].sort()` — it's now a sorted list of `YYYY-MM-DD` strings, not weekday abbreviations. Rename the field to `scheduledDates` to avoid silently breaking consumers that still expect weekday strings. (If any consumer still reads `days`, make them explicit.)

### 5. Rework `src/pages/BrainstormMode.jsx`

This file changes materially. Aim to minimize scope creep — only the parts that touch planDays/chips/handleServe/localStorage need editing.

- **State:** replace `planDays: string[]` (weekday abbreviations) with `selectedDates: string[]` (`YYYY-MM-DD` array, sorted). Replace `pendingDays` with `pendingSelectedDates` (used during chip-picker editing — under the new model, editing happens inline on the strip so `pending*` may no longer be needed; delete if so).
- **Plan item shape:** items now use `scheduled_date` instead of `day`. Everywhere the UI reads `slot.day`, change to `slot.scheduled_date`. For display purposes, derive a weekday label on the fly: `new Date(Date.UTC(y,m-1,d)).toLocaleDateString(undefined, { weekday: 'short' })` where `y/m/d` come from `scheduled_date.split('-')`.
- **Initial selection (loadData):**
  1. Call `listUserPeriods` to build the `disabledDates` Set (expand each `period_start..period_end` range into individual dates, skipping the currently-loaded plan's own dates if it's active).
  2. If localStorage has `brainstorm_plan_dates` (new key), use that. Filter out any dates that are now in the past or in `disabledDates`.
  3. Else if localStorage has `brainstorm_plan_days` (legacy key), migrate: map each stored weekday to the next upcoming non-disabled date within the horizon, collect into `brainstorm_plan_dates`, write to the new key, clear the old. Seamless one-time migration.
  4. Else (no stored preference): select the next 5 Sun-Thu-shaped dates that fall in the horizon and aren't disabled. This matches the legacy default.
- **DateStripPicker render:** only show when `planState` is one of `no_plan`, `active` (current plan restoration overrides this), or `finalized`. For `gap`, keep Phase 5's flow (GapDayView + DateRangePicker). For `ended_unfinalized`, keep Phase 4's review prompt.
- **Chip UI removal:** delete the chip-picker render block, `showDayPicker`/`pendingDays` state, `applyDays` helper, and the "Select days to plan" text. The `ALL_DAYS` constant and related weekday math (`DEFAULT_PLAN_DAYS`, `buildWeekLabel`-like helpers) become dead code — remove.
- **Serve enablement:** `canServe` now = `selectedDates.length > 0 && plan.every(slot => hasRealMeal(slot))`. No overlap gate needed in the button because the picker already prevents selecting into existing periods.
- **handleServe:** call `createServedPlan(supabase, userId, items)` where `items` is `plan.map(slot => ({ scheduled_date: slot.scheduled_date, name: slot.name, id: slot.id, is_wildcard: slot.is_wildcard, source_url: slot.source_url }))`. Error handling stays the same.
- **Drag-and-drop reorder:** the existing @dnd-kit logic reorders meals across slots. It should still work — just update the `arrayMove`/key lookups to use `scheduled_date` as the slot identity instead of `day`. Keep the behavior "dates stay fixed in chronological order; meals swap positions."
- **handleShare / download list:** currently formats `${slot.day}: ${slot.name}`. Change to `${formatDateShort(slot.scheduled_date)}: ${slot.name}` where `formatDateShort` is a small local helper (e.g., "Sun Apr 26: Spaghetti").
- **buildServedMealsForEngine:** this helper was mapping legacy items to dates for the recommendation engine. Under the new model, `plan.items` already has `scheduled_date`, so `buildServedMealsForEngine` becomes a pass-through (or trivial) — simplify or inline.
- **localStorage keys:**
  - New: `brainstorm_plan` (shape updated — items use `scheduled_date`)
  - New: `brainstorm_plan_dates` (`string[]` of `'YYYY-MM-DD'`)
  - Legacy: `brainstorm_plan_days` — read once for migration, then cleared
- **Recommendation engine integration:** `getRecommendations(vault, recentMeals, wildcards, n, ...)` is called with `n = selectedDates.length`. Unchanged logic, different source for `n`.

### 6. Tests

Unit tests:
- `src/components/__tests__/DateStripPicker.test.jsx`
  - Renders 7 cells by default (today through today+6).
  - Tapping the "Show another 7 days" button reveals 7 more cells (today+7 through today+13).
  - Tapping the "Hide second week" link (after expansion) collapses back to 7 cells.
  - Auto-expansion: mounting with a `selectedDates` that includes a day in today+7..today+13 starts expanded.
  - Collapsing while a second-week date is selected KEEPS the selection in parent state (verify via onToggle history — no spurious toggle fires) and shows that date in the count-line range.
  - Tapping a default cell calls `onToggle` with that date.
  - Disabled cells do not fire `onToggle`; have the expected aria-label.
  - Selection count + range line render correctly for various selection sets, including cross-week selections while collapsed.
- `src/lib/__tests__/mealPlanWriter.createServedPlan.test.js` (update existing)
  - Happy path with an arbitrary date list (non-contiguous is fine).
  - `period_start`/`period_end` are derived from min/max of `scheduled_date`.
  - Empty items → throws.
  - Overlap / items-insert failure error mapping unchanged.
- `src/lib/__tests__/mealPlanWriter.derivePlanDates.test.js` — **delete.** The function is gone.
- `src/lib/__tests__/mealPlanReader.test.js` (update)
  - New-schema items carry `scheduled_date`.
  - Legacy fallback: items with `day: 'Mon'` and a known `served_at` produce the correct `scheduled_date`.
  - Malformed legacy rows are dropped, not returned with invalid dates.
- `src/lib/__tests__/mealPlanReader.listUserPeriods.test.js` (new)
  - Returns rows with both bounds set; excludes NULL-bound rows; surfaces errors.
- `src/pages/__tests__/BrainstormMode.test.jsx` (update)
  - On mount with no localStorage: default selection is next 5 non-disabled Sun-Thu.
  - With legacy `brainstorm_plan_days` in localStorage: migrated to `brainstorm_plan_dates` after load; old key cleared.
  - Serving calls `createServedPlan` with the correct `items` array.
  - `planState === 'gap'` still routes to `GapDayView` (regression guard).

### 7. Zombie-row cleanup

Same SQL as the prior Phase 8 draft — embed in the PR description, don't commit it:

```sql
-- Zombie row from a pre-Phase-3 stale-JS serve. No meal_plan_items children.
-- Delete after this PR deploys and you've hard-refreshed + re-served once.
DELETE FROM meal_plans WHERE id = '69bfdc44-0ee2-46cd-ae7f-3b69a8065e7d';
```

## Acceptance criteria

- `DateStripPicker` exists, renders a 14-day grid, handles selection and disabled dates, is covered by component tests.
- `createServedPlan` accepts an explicit items array; `derivePlanDates` deleted.
- `fetchMostRecentPlan` returns items with `scheduled_date` (new and legacy paths).
- `BrainstormMode.jsx` no longer has chip UI, `planDays`, `applyDays`, or any weekday-only state.
- Serving a plan with dates spanning two calendar weeks writes a single `meal_plans` row with `period_start`/`period_end` covering both weeks and N `meal_plan_items` rows on the correct dates.
- Reloading after serve restores the plan from the DB identically (same dates, same meals).
- Gap-day flow (Phase 5) and Calendar tab (Phase 6) still work — covered by existing regression tests.
- `npm run test:unit -- --run`, `npm run test:e2e`, `npm run lint`, `npm run build` all pass.
- PR description includes a manual smoke test: serve a 3-day plan with a gap day in the middle → verify DB shape; serve a 10-day plan → verify; attempt to overlap an existing period → verify the date cells render disabled.

## Out of scope (explicitly)

- Dropping the deprecated `week_label`/`days`/`items` columns (Phase 7 — resume after this deploys and stabilizes).
- Touching `DateRangePicker.jsx` or the gap-day flow.
- Touching `CalendarView.jsx` or the Calendar tab.
- Horizon > 14 days. The 14-day cap is intentional for mobile-first ergonomics.
- Multi-meals-per-day (`position > 0`).
- Partner collab / shared periods.
- Cross-period reordering (dragging a meal from last week into next week).

## Deliverable format

One PR:
- `src/components/DateStripPicker.jsx` (new)
- `src/components/__tests__/DateStripPicker.test.jsx` (new)
- `src/lib/mealPlanReader.js` (extended + updated item shape)
- `src/lib/mealPlanWriter.js` (refactored `createServedPlan`; `derivePlanDates` deleted)
- `src/lib/__tests__/*` — updated per the tests list above; delete the `derivePlanDates` test file
- `src/pages/BrainstormMode.jsx` (rewritten state + chip removal)
- `src/pages/__tests__/BrainstormMode.test.jsx` (updated)
- PR description linking ADR-001 Phase 8, summarizing the model shift (week-oriented → date-set-oriented), and including the zombie-row cleanup SQL.

---

## Notes for the human (you)

**What this phase actually costs in code.** Bigger than Phases 2-6 individually. The touchpoints are spread across the reader, writer, and the page component. But each touchpoint is small — no algorithmic cleverness, no new libraries, no schema migration. Think of it as "rename `day` to `scheduled_date` everywhere, plus a new picker component." If Claude Code reports back with >600 lines of diff, something's off and it should be pushed to scope down.

**Why 7 default, 14 max, with an extend affordance.** A single row of 7 cells matches the way most people mentally plan (a week at a time) and keeps the Brainstorm tab visually light on load. The second week is there when needed — a trip, a cross-week pattern, a heavy-prep run — but it doesn't overwhelm the 90% case. 14 is the hard cap because it still fits cleanly on a mobile screen as two rows; anything longer starts to want a different UI (a calendar grid, scroll, etc.). If users frequently need more than 14 days, lift the cap in a follow-up — don't preemptively build for it.

**Auto-expand is one-way on purpose.** If you reload the app with a selection that spans both weeks, the picker expands so nothing is hidden. But we never auto-collapse based on user deselection — collapsing is a deliberate "make this simpler to look at" action, not something the UI does behind the user's back. Keeps the control predictable.

**Why the `day` → `scheduled_date` rename matters conceptually.** As long as the data model speaks in weekday strings, the app will always accidentally nudge users toward weekly cadence even when the DB could support anything. Moving the in-memory plan to `scheduled_date` closes that loop: the UI, the writer, and the reader all speak the same language as the DB. It also unblocks Phase 7 — once the UI no longer needs `day` or `week_label`, the deprecated columns truly have zero readers.

**Sequencing after merge:**

1. Deploy Phase 8.
2. On every device you use, hard-refresh to ditch any cached JS.
3. Serve a test plan. Inspect the DB row — `period_start`/`period_end` populated, `week_label`/`days`/`items` NULL.
4. Run the zombie-row DELETE from the PR description.
5. Re-run Phase 7 step-1 verification (the query that caught your issue earlier). Expect 0.
6. Resume Phase 7 whenever you're satisfied with stability — no rush; the legacy columns sitting idle cost nothing.
