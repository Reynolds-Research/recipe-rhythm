# Claude Code Prompt — PRD-005 P1.1: Decompose BrainstormMode.jsx

**For:** Claude Code (executor)
**Authored by:** Cowork (planning surface) on 2026-05-09
**Linked PRD:** [`docs/prds/PRD-005-mobile-ux-spacing-typography.md`](../prds/PRD-005-mobile-ux-spacing-typography.md) §P1.1
**Reference pattern:** PRD-001 P0.9 Vault decomposition (already shipped — see `src/pages/Vault/`)
**Depends on:**
- All of PRD-005 P0 shipped (the design-system primitives `.btn-primary`, `.btn-secondary`, `.btn-icon`, `.chip`, `.section-heading`, etc. are in place — those are referenced inside BrainstormMode and must continue to render the same after decomposition).
- PRD-002 P0.7 shipped (the `DayPicker` child component already lives at `src/components/Brainstorm/DayPicker.jsx` and is imported into BrainstormMode — leave it alone).
- PRD-002 P1.2 shipped (the Serve confirmation sheet exists at the bottom of BrainstormMode.jsx and must keep working).

---

## Why this exists

`src/pages/BrainstormMode.jsx` is currently 1,634 lines. PRD-005 §P1.1 calls it out by name:

> **P1.1** Decompose `BrainstormMode.jsx` into smaller files (it's 1,572 lines now). Mirrors the PRD-001 P0.9 pattern. Easier *after* P0.7 because the new primitives reduce per-file complexity. Estimated split: `BrainstormMode/index.jsx`, `LastWeekCard.jsx`, `MealPlanCard.jsx`, `SortableMealItem.jsx`, `MaybeShortlist.jsx`, plus a `useBrainstorm.js` data hook.

The file has grown another ~60 lines since the PRD was authored (P1.2 added the Serve confirmation sheet). The decomposition becomes more, not less, valuable. We are doing the split called for in the PRD — no scope creep.

This is a **pure refactor**: zero behavior changes, zero visual changes, zero schema changes. The user-facing `BrainstormMode` page should be byte-identical for any given state. The only artifact a user could detect is potentially faster re-renders when only one child component's props change, but we are not optimizing for that — it's a side benefit, not the goal.

Branch suggestion: `feat/decompose-brainstorm-mode` (already created in the user's working tree as of session handoff).

---

## ⚠ Pre-flight: confirm you're in the right place

```bash
EXPECTED="/Users/Matt/Desktop/Current Projects/recipe-rhythm"
ACTUAL="$(git rev-parse --show-toplevel 2>/dev/null)"
echo "expected: $EXPECTED"
echo "actual:   $ACTUAL"
[ "$ACTUAL" = "$EXPECTED" ] || { echo "ABORT: not in the recipe-rhythm repo root"; exit 1; }

PROMPT="docs/prompts/prd-005-p1-1-decompose-brainstorm-mode.md"
test -f "$PROMPT" || { echo "ABORT: $PROMPT not found in this working tree"; exit 1; }

# Branch state expected at handoff:
#   - On branch feat/decompose-brainstorm-mode (or willing to switch to it)
#   - origin/main HEAD is 0436f08 (PR #96 merge) or newer
#   - Working tree has TWO untracked prompt files left over from earlier sessions:
#       docs/prompts/prd-001-p1-3-last-cooked-badge.md
#       docs/prompts/prd-002-p1-2-serve-feedback.md
#     These will be folded into commit 1 of this PR.

git fetch origin
git status
git log --oneline -5
git log --oneline origin/main..HEAD   # should be empty — no work yet on this branch
git log --oneline HEAD..origin/main   # ideally empty — branch is at origin/main
```

If your branch is behind `origin/main`, fast-forward it before doing any work:

```bash
git reset --hard origin/main
```

This is safe — there is no unique work on the branch. Untracked files (the two prompt docs) survive a `--hard` reset; only tracked-file changes are touched.

If the branch has unique commits already, **stop and surface to the user** — that means earlier decomposition work exists and should be inspected first.

---

## Hard prerequisites — verify before writing any code

```bash
# 1. The file we are decomposing exists at the expected path and is roughly the
#    expected size. If it has been moved or shrunk drastically, something has
#    already changed since this prompt was authored — stop and ask.
test -f src/pages/BrainstormMode.jsx
wc -l src/pages/BrainstormMode.jsx
# Expected: ~1634 lines (give or take 20).

# 2. The Vault decomposition reference pattern is in place. We will mirror its
#    folder layout and hook conventions.
test -d src/pages/Vault
test -f src/pages/Vault/index.jsx
test -f src/pages/Vault/useVault.js
test -f src/pages/Vault/RecipeForm.jsx
test -f src/pages/Vault/RecipeCard.jsx
test -f src/pages/Vault/ChipPicker.jsx

# 3. The existing test file is at the expected legacy path. We will move it.
test -f src/pages/__tests__/BrainstormMode.test.jsx

# 4. App.jsx imports BrainstormMode by directory path (no extension), so Vite
#    resolution to BrainstormMode/index.jsx will Just Work after we move the file.
grep -n "from './pages/BrainstormMode'" src/App.jsx
# Expected: exactly 1 match. If the import has '.jsx' on it, App.jsx must be edited.

# 5. The DayPicker sibling component is already extracted (PRD-002 P0.7) and we
#    are NOT touching it.
test -f src/components/Brainstorm/DayPicker.jsx

# 6. Tests can run.
npm test -- BrainstormMode 2>&1 | tail -20
# Expected: all tests pass against the un-decomposed file.
```

If any of these fail, **stop and ask the user**. The decomposition assumes a known starting state.

---

## Architectural decisions to lock in upfront

These were finalized with the user during the planning conversation. Do not re-litigate.

1. **Six files exactly, mirroring the PRD's named split.** No extra files. `DayCell` (currently a sub-component inside BrainstormMode.jsx) stays as a local helper inside `MealPlanCard.jsx` — it's only used there and isn't on the PRD's list. The Reset confirmation sheet and Serve confirmation sheet stay inline in `index.jsx` — they're paired with action buttons in the page shell and the PRD does not call them out.
2. **Folder name matches the import path.** `src/pages/BrainstormMode/index.jsx` — Vite resolves the existing `import BrainstormMode from './pages/BrainstormMode'` in App.jsx automatically. **Do NOT touch App.jsx.**
3. **The `useBrainstorm` hook lives next to its consumer**, at `src/pages/BrainstormMode/useBrainstorm.js`. It does NOT go into `src/hooks/` — that folder is for shared hooks (`useHaptics`, `useSpeech`). This mirrors `useVault` at `src/pages/Vault/useVault.js`.
4. **The hook returns a single flat object.** Same shape as `useVault`. No nested `state` / `handlers` / `memos` namespaces. Examples: `{ plan, isServed, lastWeek, handleServe, handleToggleDate, dayGridDates, ... }`.
5. **`MaybeShortlist.jsx` owns both the tab content and the Schedule-from-Maybe sheet.** They share `scheduleSheetItem` state and belong together. Single default export. The parent (`index.jsx`) renders it once and passes everything through props.
6. **Local date helpers stay local.** `formatLocalYmd`, `parseYmd`, `addDays`, `shortWeekday`, `shortDateLabel`, `expandPeriodDates`, `pickDefaultDates`, `migrateLegacyWeekdayDates`, the constants `PLAN_HORIZON_MAX_DAYS` / `DEFAULT_SELECTION_COUNT` / `DEFAULT_WEEKDAY_PREFERENCE` / `WEEKDAY_INDEX` — all move into `useBrainstorm.js` (above the hook function, module-level). Do NOT consolidate into `src/lib/dateUtils.js` even though `formatLocalDate` already exists there. That's a separate cleanup, out of scope.
7. **`useHaptics` lives in `useBrainstorm.js`.** Haptics fire on data mutations (serve, reset, schedule), so they belong with the data layer. The exception: any haptic call that's purely a UI affordance (none today, but watch for it) would stay in `index.jsx`.
8. **`handleShare` lives in `index.jsx`.** It uses `navigator.share` / `navigator.clipboard` — those are DOM concerns, not data concerns. It reads `plan` from the hook's return value.
9. **`sensors` (from `useSensors(...)`) goes in the hook.** It's pure config; the hook can construct it and return it for `MealPlanCard` to consume.
10. **Test invariants.** The DOM after decomposition must be byte-identical for any given state. Specifically: every `data-testid`, every `role`, every `aria-label`, every visible text string in `src/pages/__tests__/BrainstormMode.test.jsx` must continue to match exactly. The test file moves but its assertions do not change. (See "Test invariants" section below for the full list.)

---

## Target file layout

```
src/pages/BrainstormMode/
├── index.jsx                ~280 lines  — page shell, render branches, JSX layout
├── useBrainstorm.js         ~650 lines  — data hook (state, effects, helpers, handlers, memos)
├── LastWeekCard.jsx         ~30 lines   — "Last week's meals" card (presentational)
├── MealPlanCard.jsx         ~150 lines  — date strip + day grid + DnD wrapper (+ DayCell local)
├── SortableMealItem.jsx     ~110 lines  — single draggable meal row
├── MaybeShortlist.jsx       ~140 lines  — Maybe tab content + Schedule-from-Maybe sheet
└── __tests__/
    └── BrainstormMode.test.jsx          — moved from src/pages/__tests__/ (only import path changes)
```

The legacy `src/pages/BrainstormMode.jsx` is **deleted** as part of commit 1.
The legacy `src/pages/__tests__/BrainstormMode.test.jsx` is **deleted** as part of commit 1.

---

## Hook return interface (locked in)

`useBrainstorm(userId)` returns a single flat object. List below is exhaustive — if the hook ends up returning something not on this list, surface it for review before merging.

**Data state:**
- `loading` (boolean)
- `vault` (array)
- `lastWeek` (array of `{ day, name }` slots)
- `plan` (array of slot objects)
- `selectedDates` (sorted array of YMD strings)
- `disabledDates` (Set of YMD strings)
- `loadedPlan` (object | null — the active or most-recent plan)
- `planState` (`'no_plan' | 'active' | 'ended_unfinalized' | 'finalized' | 'gap'`)
- `shortlist` (array of shortlisted items from active plan)
- `preferences` (object | null — household preferences)

**UI state:**
- `isServed` (boolean)
- `servedAt` (ISO string | null)
- `servingPlan` (boolean — in-flight)
- `serveError` (string | null)
- `justServed` (boolean — controls grocery CTA visibility)
- `serveSheetOpen` (boolean)
- `groceriesOpen` (boolean), `setGroceriesOpen` (setter)
- `showReview` (boolean), `setShowReview` (setter)
- `lockingIn` (boolean)
- `periodError` (string | null)
- `newPeriodStep` (`'idle' | 'pick-dates' | 'pick-leftovers'`)
- `pendingRange` (object | null)
- `pendingLeftovers` (array)
- `startingPeriod` (boolean)
- `startPeriodError` (string | null)
- `sharing` (boolean), `setSharing` (setter — used by handleShare in index.jsx)
- `activeTab` (`'thisWeek' | 'maybe'`), `setActiveTab` (setter)
- `scheduleSheetItem` (object | null), `setScheduleSheetItem` (setter)
- `shortlistError` (string | null)
- `pickerDate` (YMD string | null), `setPickerDate` (setter)
- `showResetConfirm` (boolean), `setShowResetConfirm` (setter)
- `resetting` (boolean)
- `resetError` (string | null), `setResetError` (setter — needed before opening the sheet)

**Memoized values:**
- `canServe` (boolean)
- `dayGridDates` (sorted YMD array)
- `itemsByDate` (Map<YMD, item[]>)
- `canResetPlan` (boolean)

**Configuration:**
- `sensors` (return value of `useSensors(...)` — for `<DndContext>`)

**Action handlers:**
- `loadData(forceRegenerate?)` — refetch everything
- `handleToggleCooked(itemId, nextCooked)`
- `handleScheduleFromShortlist(item, date)`
- `handleRemoveShortlist(item)`
- `handleMoveToMaybe(itemId)`
- `handleLockInAsIs()`
- `handleReviewFinalized()`
- `handleResetPlan()`
- `handleToggleDate(ymd)`
- `handleOpenPicker(date)`
- `handlePickerScheduled(preServeItem)`
- `handleDragEnd(event)`
- `handleServe()`
- `commitServe(feedback)`
- `openNewPeriodFlow()`
- `handleDateRangeConfirm({ periodStart, periodEnd })`
- `handleDateRangeCancel()`
- `handleLeftoverBack()`
- `handleLeftoverConfirm(selectedIds)`

That's intentionally a lot — the hook absorbs the whole data layer. `index.jsx` should look thin afterward.

---

## Child component prop interfaces

### `<LastWeekCard items />`

```jsx
LastWeekCard.propTypes = {
  items: arrayOf({ day: string, name: string|null })  // not enforced; just for reference
}
```

Pure presentational. No callbacks, no state. Renders the existing "Last week's meals" card markup verbatim.

### `<SortableMealItem slot isServed onToggleCooked onMoveToMaybe />`

Same prop signature as today's in-file `SortableMealItem`. Lift verbatim.

### `<MealPlanCard ... />`

```jsx
<MealPlanCard
  isServed={isServed}
  selectedDates={selectedDates}
  disabledDates={disabledDates}
  dayGridDates={dayGridDates}
  itemsByDate={itemsByDate}
  plan={plan}
  sensors={sensors}
  onToggleDate={handleToggleDate}
  onRegenerate={() => loadData(true)}
  onDragEnd={handleDragEnd}
  onOpenPicker={handleOpenPicker}
  onToggleCooked={handleToggleCooked}
  onMoveToMaybe={handleMoveToMaybe}
/>
```

Owns the section heading, the Regenerate button, the `<DateStripPicker>`, the `<DndContext>` + `<SortableContext>` wrappers, and the loop that renders one `<DayCell>` per `dayGridDates` entry. `DayCell` is a local helper inside this file (NOT a separate file).

### `<MaybeShortlist ... />`

```jsx
<MaybeShortlist
  visible={activeTab === 'maybe'}
  items={shortlist}
  isServed={isServed}
  loadedPlan={loadedPlan}                  // for period dates inside the schedule sheet
  scheduleSheetItem={scheduleSheetItem}
  onOpenSheet={(item) => setScheduleSheetItem(item)}
  onCloseSheet={() => setScheduleSheetItem(null)}
  onSchedule={handleScheduleFromShortlist}
  onRemove={handleRemoveShortlist}
  error={shortlistError}
/>
```

Renders the tab content only when `visible` is true (so the `activeTab !== 'maybe'` case shows nothing). Renders the Schedule-from-Maybe `<Sheet>` inside the same component, controlled by `scheduleSheetItem`. Note: `shortlistError` rendering currently happens in `index.jsx` above the tabs — keep it there OR move it inside MaybeShortlist (your call; pick whichever produces a smaller diff and document the choice in the commit message).

---

## Test invariants (do not break these)

The existing test file at `src/pages/__tests__/BrainstormMode.test.jsx` will move to `src/pages/BrainstormMode/__tests__/BrainstormMode.test.jsx`. The only edit allowed in the test file is the import line:

```js
// Before
import BrainstormMode from '../BrainstormMode'
// After
import BrainstormMode from '../'
```

Everything else in the test file stays byte-identical. That means the following must continue to work after every commit:

**Visible text the tests assert on:**
- `Building your plan…`
- `Roast`, `Tacos`, `Ramen`, `Curry`, `Pizza` (mock recipe names)
- `Sushi`, `Pasta`, `Soup`, `Sandwich`, `Salad` (regenerate mock names)
- `Saved For Later` (shortlist mock name)
- `Tasty Wildcard` (AI candidate mock name)
- `Lock in this plan?` (Serve sheet heading)
- `Looks great`, `Lock in anyway`, `Let me adjust` (Serve sheet button labels)
- `Nothing shortlisted yet` (Maybe empty state)
- `Could not reset plan` (reset error message)
- `From Your Cookbook` and `AI Suggestions` — these must NOT appear (legacy guard)

**Roles / ARIA the tests assert on:**
- `role="tab"` with names `This Week` and `Maybe`
- `aria-label="Add to Maybe"` (DayPicker bookmark — out of scope, but keep working)
- `aria-label="Move to Maybe"` (SortableMealItem)
- `aria-label="Schedule a meal for ..."` (DayCell empty state)
- `aria-label="Add another meal to ..."` (DayCell "+ add another")
- `role="list"` with name `Days in period` (Schedule-from-Maybe sheet)
- Buttons matched by name: `Serve This Plan`, `Reset this plan`, `Reset plan`, `Regenerate`, `Groceries`, `Schedule Saved For Later`

**Test IDs the tests assert on:**
- `date-strip-cell-${YMD}` (DateStripPicker — out of scope)
- `date-strip-picker` (DateStripPicker root — out of scope)
- `day-picker` (DayPicker — out of scope)
- `grocery-list-sheet` (mocked GroceryListSheet)
- `mock-sheet-container` (mocked Sheet — see `src/setupTests.js`)
- `shortlist-item-${id}`

If a commit breaks any of these, **stop and fix before proceeding.** Every commit in this PR ends with a green test run.

---

## Commit sequence

Seven commits on `feat/decompose-brainstorm-mode`. Each commit must end with `npm test -- BrainstormMode` passing.

### Commit 1 — Move-only + housekeeping

**Goal:** create the folder, move the file, move the test, fold in untracked prompt docs. No logic changes.

Steps:

```bash
mkdir -p src/pages/BrainstormMode/__tests__
git mv src/pages/BrainstormMode.jsx src/pages/BrainstormMode/index.jsx
git mv src/pages/__tests__/BrainstormMode.test.jsx src/pages/BrainstormMode/__tests__/BrainstormMode.test.jsx
```

Then edit `src/pages/BrainstormMode/__tests__/BrainstormMode.test.jsx` — change exactly one line:

```js
import BrainstormMode from '../BrainstormMode'   // before
import BrainstormMode from '../'                 // after
```

Add the two pre-existing untracked prompt files. They're docs for already-shipped PRs; they belong in `docs/prompts/`:

```bash
git add docs/prompts/prd-001-p1-3-last-cooked-badge.md
git add docs/prompts/prd-002-p1-2-serve-feedback.md
git add docs/prompts/prd-005-p1-1-decompose-brainstorm-mode.md   # this prompt itself
```

Run tests:

```bash
npm test -- BrainstormMode
```

Commit:

```bash
git commit -m "refactor(brainstorm): move BrainstormMode into a folder (PRD-005 P1.1 step 1/7)

Pure file move + housekeeping. Decomposition begins in step 2.

- src/pages/BrainstormMode.jsx → src/pages/BrainstormMode/index.jsx
- src/pages/__tests__/BrainstormMode.test.jsx → src/pages/BrainstormMode/__tests__/BrainstormMode.test.jsx
- Update test import path: '../BrainstormMode' → '../'
- Commit two prompt docs that were untracked at session handoff
  (PRD-001 P1.3 and PRD-002 P1.2 were shipped without their prompts being
  added; folding them in here as adjacent housekeeping)
- Commit this PR's own prompt doc

App.jsx import is unchanged — Vite resolves './pages/BrainstormMode' to
the new folder's index.jsx automatically.

PRD-005 P1.1, step 1 of 7."
```

### Commit 2 — Lift `SortableMealItem`

**Goal:** move the in-file `SortableMealItem` function (currently lines 167–262) into its own file. Pure lift, no logic changes.

Create `src/pages/BrainstormMode/SortableMealItem.jsx` with:
- The function body verbatim
- Imports for what it needs: `lucide-react` icons (`GripVertical`, `Sparkles`, `ExternalLink`, `BookmarkPlus`), `useSortable` and `CSS` from `@dnd-kit/sortable` and `@dnd-kit/utilities`

Edit `src/pages/BrainstormMode/index.jsx`:
- Add `import SortableMealItem from './SortableMealItem'` at the top
- Delete the in-file `SortableMealItem` function definition
- Drop the now-unused imports (`GripVertical`, `Sparkles`, `ExternalLink` if not used elsewhere — `BookmarkPlus` is also used by the Maybe tab so it stays)

Run tests, commit:

```
refactor(brainstorm): lift SortableMealItem to its own file (PRD-005 P1.1 step 2/7)
```

### Commit 3 — Lift `LastWeekCard`

**Goal:** extract the inline "Last week's meals" card (currently lines 1259–1272) into a new component.

Create `src/pages/BrainstormMode/LastWeekCard.jsx`:

```jsx
export default function LastWeekCard({ items }) {
  return (
    <div>
      <p className="section-heading mb-3">Last week's meals</p>
      <div className="bg-white border border-cream-100 rounded-2xl px-5 divide-y divide-cream-50 shadow-sm">
        {items.map(({ day, name }) => (
          <div key={day} className="flex items-center gap-3 py-3">
            <span className="text-sm font-bold text-gray-700 w-8 flex-shrink-0 uppercase tracking-wider">
              {day.toUpperCase()}
            </span>
            <span className={`text-base flex-1 ${name ? 'text-gray-900' : 'text-gray-500 italic'}`}>
              {name || '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

Edit `index.jsx`: replace the inline JSX block with `<LastWeekCard items={lastWeek} />`.

Run tests, commit:

```
refactor(brainstorm): lift LastWeekCard (PRD-005 P1.1 step 3/7)
```

### Commit 4 — Lift `MealPlanCard` (with `DayCell` inside it)

**Goal:** extract the entire "Date strip + plan" section (currently lines 1274–1328) plus the `DayCell` sub-component (currently lines 269–332) into a single new file.

Create `src/pages/BrainstormMode/MealPlanCard.jsx`:
- Imports: `RefreshCw`, `Plus` from `lucide-react`; `DndContext`, `closestCenter` from `@dnd-kit/core`; `SortableContext`, `verticalListSortingStrategy` from `@dnd-kit/sortable`; `DateStripPicker` from `'../../components/DateStripPicker'`; `SortableMealItem` from `./SortableMealItem`; `shortWeekday`, `shortDateLabel` from `./useBrainstorm` (these will be exported by the hook file as named exports — see commit 6)
  - **Caveat:** since `useBrainstorm.js` doesn't exist yet at this point in the sequence, define `shortWeekday` and `shortDateLabel` locally inside `MealPlanCard.jsx` for now (small, copy-pasted from BrainstormMode/index.jsx). Commit 6 will consolidate them.
- A local `DayCell` function (verbatim from current lines 269–332)
- The default-exported `MealPlanCard` function with the prop interface from "Child component prop interfaces" above

Edit `index.jsx`:
- Add `import MealPlanCard from './MealPlanCard'`
- Replace the inline section (Regenerate button, DateStripPicker, DndContext + SortableContext + DayCell loop) with the `<MealPlanCard ... />` render
- Delete the in-file `DayCell` function definition
- Drop now-unused imports (`RefreshCw`, `Plus`, `DndContext`, `closestCenter`, `SortableContext`, `verticalListSortingStrategy`, `DateStripPicker`)

Run tests, commit:

```
refactor(brainstorm): lift MealPlanCard with DayCell inside (PRD-005 P1.1 step 4/7)
```

### Commit 5 — Lift `MaybeShortlist`

**Goal:** combine the existing in-file `ShortlistTab` component (currently lines 337–379) and the Schedule-from-Maybe `<Sheet>` block (currently lines 1445–1516) into a single new file.

Create `src/pages/BrainstormMode/MaybeShortlist.jsx`:
- Imports: `Bookmark`, `Trash2` from `lucide-react`; `Sheet` (named import) from `'react-modal-sheet'`; `parseYmd`, `addDays`, `formatLocalYmd`, `shortDateLabel` (locally defined for now — same caveat as commit 4)
- Default export: `MaybeShortlist({ visible, items, isServed, loadedPlan, scheduleSheetItem, onOpenSheet, onCloseSheet, onSchedule, onRemove, error })`
- Renders both pieces:
  - The tab content only when `visible` is true (empty/list view)
  - The Sheet always (controlled by `!!scheduleSheetItem`)

Edit `index.jsx`:
- Add `import MaybeShortlist from './MaybeShortlist'`
- Replace the `{activeTab === 'maybe' && <ShortlistTab ... />}` block with the new `<MaybeShortlist visible={activeTab === 'maybe'} ... />` render
- Replace the bottom-of-page Schedule-from-Maybe Sheet block with NOTHING (it's now inside `<MaybeShortlist>`)
- Delete the in-file `ShortlistTab` function definition
- Drop now-unused imports if any

Run tests, commit:

```
refactor(brainstorm): lift MaybeShortlist with schedule sheet (PRD-005 P1.1 step 5/7)
```

### Commit 6 — Lift `useBrainstorm.js` data hook

**Goal:** the big one. Extract all state, effects, helpers, handlers, and memos into a custom hook. `index.jsx` shrinks dramatically.

Create `src/pages/BrainstormMode/useBrainstorm.js`:
- Module-level constants: `PLAN_HORIZON_MAX_DAYS`, `DEFAULT_SELECTION_COUNT`, `DEFAULT_WEEKDAY_PREFERENCE`, `WEEKDAY_INDEX`
- Module-level helpers (also exported as named exports so MealPlanCard / MaybeShortlist can import them): `formatLocalYmd`, `parseYmd`, `addDays`, `shortWeekday`, `shortDateLabel`, `expandPeriodDates`, `pickDefaultDates`, `migrateLegacyWeekdayDates`, `buildPlan`, `hasRealMeal`
- The `useBrainstorm(userId)` hook itself: all state, the three useEffects, `fetchSwapSuggestions`, `loadData`, all handlers, all memos, the `sensors` config, and `useHaptics` setup
- Returns the flat object documented in "Hook return interface" above

Edit `MealPlanCard.jsx` and `MaybeShortlist.jsx`: replace local copies of the date helpers with named imports from `'./useBrainstorm'`. Now the helpers exist in exactly one place.

Edit `index.jsx`:
- Add `import { useBrainstorm } from './useBrainstorm'`
- Destructure everything the page needs from `useBrainstorm(userId)`
- Delete every state declaration, every useEffect, every handler, every helper, every memo from index.jsx
- Keep: imports, the `handleShare` function (UI/DOM concern), the four render branches (loading / showReview / planState === 'gap' / main), the JSX layout, and the two inline sheets (Reset confirm + Serve confirm)

Run tests, commit:

```
refactor(brainstorm): lift data layer into useBrainstorm hook (PRD-005 P1.1 step 6/7)
```

### Commit 7 — Update STATUS.md

**Goal:** mark P1.1 shipped per CLAUDE.md "Status etiquette".

Edit `docs/STATUS.md`:
- In the "PRD-005 — Mobile UX, Spacing & Typography" section, move the `P1.1 — Decompose BrainstormMode.jsx` line from "Pending" to "Shipped (P1.x)" with a new bullet referencing this PR's number and lead commit hash.
- Update the "At a glance" row for PRD-005 — change the "Next thing to plan" cell from `P1 nice-to-haves (BrainstormMode decomposition is the big one)` to `P1.2–P1.5 nice-to-haves (P1.1 shipped)`.
- Bump the "Last verified" line at the top to today's date and the new tip commit hash.

Commit:

```
chore(status): mark PRD-005 P1.1 shipped (PRD-005 P1.1 step 7/7)
```

---

## Verification

After commit 7, before opening the PR:

```bash
# 1. Full test suite passes (not just BrainstormMode tests).
npm test

# 2. Build succeeds locally.
npm run build

# 3. Lint passes (the design-system lint guardrail from PRD-005 P0.12 must
#    not regress on the new files).
npm run lint || true   # if a lint script exists

# 4. Inspect the final folder shape.
find src/pages/BrainstormMode -type f | sort
# Expected:
#   src/pages/BrainstormMode/LastWeekCard.jsx
#   src/pages/BrainstormMode/MaybeShortlist.jsx
#   src/pages/BrainstormMode/MealPlanCard.jsx
#   src/pages/BrainstormMode/SortableMealItem.jsx
#   src/pages/BrainstormMode/__tests__/BrainstormMode.test.jsx
#   src/pages/BrainstormMode/index.jsx
#   src/pages/BrainstormMode/useBrainstorm.js

# 5. Sanity-check file sizes — they should be roughly the targets.
wc -l src/pages/BrainstormMode/*.{js,jsx}
# Expected:
#   ~280  index.jsx
#   ~650  useBrainstorm.js
#   ~30   LastWeekCard.jsx
#   ~150  MealPlanCard.jsx
#   ~110  SortableMealItem.jsx
#   ~140  MaybeShortlist.jsx
# If any file is dramatically off (50%+), reconsider whether something
# was misclassified.

# 6. The legacy file is gone.
test ! -f src/pages/BrainstormMode.jsx && echo "✓ legacy file removed"
test ! -f src/pages/__tests__/BrainstormMode.test.jsx && echo "✓ legacy test removed"
```

Then push and open a PR. Per CLAUDE.md "MCP-powered verification":

- Use the **Vercel MCP** to confirm the preview deployment builds successfully. Read build logs if it fails. Try to fix the build before pinging the user.
- No DB-touching changes in this PR, so the **Supabase MCP** isn't needed.
- Include the preview URL and a "tests pass / lint pass / build pass" line in the PR description.

---

## Out of scope — do not do

1. **Do not consolidate `formatLocalYmd` / `parseYmd` / `addDays` into `src/lib/dateUtils.js`.** They overlap with `formatLocalDate` already there, but consolidation is a separate cleanup. Keep them local to `useBrainstorm.js`.
2. **Do not split the Reset confirm sheet or Serve confirm sheet into their own files.** PRD-005 doesn't list them; they stay inline in `index.jsx`.
3. **Do not change any visible text, ARIA label, role, or test ID.** A user looking at the screen, or a test reading the DOM, must not be able to tell decomposition happened.
4. **Do not change `App.jsx`** beyond what's strictly required (and nothing should be required — Vite resolves the directory import automatically). If you find yourself editing App.jsx, stop and ask.
5. **Do not change Supabase schema, RLS, or migrations.** This is a frontend refactor. Zero DB changes.
6. **Do not change `DayPicker`, `GroceryListSheet`, `PeriodReview`, `GapDayView`, `DateRangePicker`, `LeftoverPicker`, or `DateStripPicker`.** They stay where they are; we only adjust their import paths if needed.
7. **Do not "improve" the markup.** Don't reorder Tailwind classes, don't rename variables, don't refactor inline conditionals into named helpers, don't switch from `&&` rendering to ternaries (or vice versa). The diff should be lift-only on every component move. The only real *new* code is the prop drilling in `index.jsx`.
8. **Do not fix unrelated issues you notice.** If you find a bug, an accessibility miss, a performance smell, or a stale comment, note it in the PR description as a follow-up. Do not expand scope.

---

## Gotchas (real ones we've hit on this codebase)

- **`react-modal-sheet` import shape.** Use `import { Sheet } from 'react-modal-sheet'`, not `import Sheet from 'react-modal-sheet'`. The default-import form may work in dev but breaks in production builds and tests. The current BrainstormMode.jsx uses the named import correctly — preserve it in `MaybeShortlist.jsx`.
- **Globally mocked `react-modal-sheet` in tests.** `src/setupTests.js` already mocks the Sheet to render a `data-testid="mock-sheet-container"` wrapper. Tests in `BrainstormMode.test.jsx` rely on this. Don't touch the global mock.
- **Vite directory import resolution.** `import BrainstormMode from './pages/BrainstormMode'` is resolved by Vite to `./pages/BrainstormMode/index.jsx` (default). This is why App.jsx doesn't change. Confirm at build time — if `npm run build` errors with "Cannot resolve './pages/BrainstormMode'", something went wrong with the index.jsx file.
- **`useEffect` dependency arrays.** When you move `loadData` into the hook, the existing mount-time `useEffect(() => { loadData(false) }, [])` has an `eslint-disable-next-line react-hooks/exhaustive-deps`. Preserve that comment — fixing the dep array is a real change that's out of scope here.
- **`localStorage` writes happen synchronously inside two effects.** Make sure both effects move into the hook intact (one for `brainstorm_plan`, one for `brainstorm_plan_dates`). The keys must match exactly — they're tested.

---

## Done criteria

- [ ] All 7 commits land on `feat/decompose-brainstorm-mode`.
- [ ] After commit 6, the file shape matches the "Target file layout" section.
- [ ] `npm test -- BrainstormMode` passes after every commit.
- [ ] `npm test` (full suite) passes after commit 7.
- [ ] `npm run build` passes after commit 7.
- [ ] `docs/STATUS.md` reflects P1.1 as shipped.
- [ ] PR description includes preview URL, test/build/lint status, and a one-paragraph summary of what changed and what didn't.
- [ ] No new files outside `src/pages/BrainstormMode/`.
- [ ] No edits to `App.jsx`, `package.json`, any migration, any other page, any other component, or any other test file.

---

## When in doubt

The pattern to mirror is `src/pages/Vault/`. Read those files first if any prop interface, hook return shape, or file boundary feels ambiguous. If still unsure, **stop and ask the user** rather than guess.
