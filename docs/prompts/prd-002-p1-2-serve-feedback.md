# Claude Code Prompt — PRD-002 P1.2: lock-in feedback after Serve

**For:** Claude Code (executor)
**Authored by:** Cowork (planning surface) on 2026-05-05
**Linked PRD:** [`docs/prds/PRD-002-meal-planning.md`](../prds/PRD-002-meal-planning.md) §P1.2
**Depends on:**
- PRD-002 P0 shipped — `meal_plans` + `meal_plan_items` schema + `createServedPlan` writer in place. We add one column and one optional parameter; nothing existing breaks.
- ADR-001 Phase 1 shipped — `meal_plans.served_at` is the timestamp this PR's confirmation flow celebrates.

---

## Why this exists

Today the Serve action is fire-and-forget: tap "Serve This Plan" → `createServedPlan` writes to the DB → the UI flips to "Served on May 5." There's no moment between intent and commit, and no way to capture how the user felt about the plan they just locked in. If the recommender served you a plan that's 70% "fine" and 30% "ugh, not really," you have no affordance to say so — you either commit silently and live with it, or scroll back and edit before tapping Serve.

P1.2 adds a small confirmation step that does two things at once:

1. **Safety net** — a moment to second-guess before committing. The user can bail back to edit mode without writing the plan to the DB.
2. **Qualitative signal capture** — a thumbs-up or thumbs-down that persists to a new `meal_plans.served_feedback` column. Down the road, this is the leading indicator for "is the recommender actually serving good plans?" — a metric you can't get from completion rate alone.

UX shape: tapping Serve opens a bottom sheet with three buttons:
- 👍 **Looks great** → commits + records `served_feedback='positive'`
- 👎 **Lock in anyway** → commits + records `served_feedback='negative'`
- ✏️ **Let me adjust** → dismisses the sheet without committing

The sheet shows a compact plan summary (one line per scheduled day) so the thumbs-up/down isn't blind.

Branch suggestion: `feat/prd-002-serve-feedback`.

---

## ⚠ Pre-flight: confirm you're in the right place

```bash
EXPECTED="/Users/Matt/Desktop/Current Projects/recipe-rhythm"
ACTUAL="$(git rev-parse --show-toplevel 2>/dev/null)"
echo "expected: $EXPECTED"
echo "actual:   $ACTUAL"
[ "$ACTUAL" = "$EXPECTED" ] || { echo "ABORT: not in the recipe-rhythm repo root"; exit 1; }

PROMPT="docs/prompts/prd-002-p1-2-serve-feedback.md"
test -f "$PROMPT" || { echo "ABORT: $PROMPT not found in this working tree"; exit 1; }

git fetch origin
git status   # working tree should be clean
git log --oneline -5

# Confirm STATUS.md still lists P1.2 as pending.
grep -A 1 "P1\.2" docs/STATUS.md | grep -i "Lock-in" || \
  echo "(Look at the PRD-002 'Pending' block in docs/STATUS.md by hand if grep is too narrow.)"
```

If working tree isn't clean or P1.2 is already shipped, stop and surface to the user.

---

## Hard prerequisites — verify before writing any code

```bash
# 1. meal_plans table exists with the expected shape.
#    Run via Supabase MCP (read-only):
#      SELECT column_name, data_type
#      FROM information_schema.columns
#      WHERE table_schema='public' AND table_name='meal_plans'
#      ORDER BY ordinal_position;
#    Expected columns include: id, user_id, period_start, period_end,
#    finalized_at, served_at, week_label, days, items, created_at.
#    served_feedback should NOT be in the list yet.

# 2. createServedPlan exists and currently has the (supabase, userId, items)
#    signature.
grep -n "export async function createServedPlan" src/lib/mealPlanWriter.js
# Expected: 1 match around line 66 with that exact signature.

# 3. handleServe in BrainstormMode currently calls createServedPlan directly
#    and flips to served state immediately.
grep -n "createServedPlan(supabase" src/pages/BrainstormMode.jsx
# Expected: 1 match around line 977.

# 4. react-modal-sheet is in deps (we'll use it for the confirmation sheet).
grep -n "react-modal-sheet" package.json
# Expected: 1 match in dependencies.
```

If any of these fail, **stop and ask the user**.

---

## Architectural decisions to lock in upfront

1. **One small migration, not zero.** The PRD says "capture qualitative signal" — that means persist. A new `meal_plans.served_feedback text` column with a CHECK enum is the right shape. The alternative ("just use the sheet as a UX moment, don't store anything") would technically deliver the safety-net half but leaves the qualitative-signal half on the floor. Worth the migration.
2. **Enum via CHECK, not via a new lookup table.** Two values (`positive`, `negative`) plus NULL. CHECK constraint enforces the vocabulary; no separate table needed. Mirrors `grocery_list_items.section`'s app-side-validation + DB-CHECK-as-backstop pattern.
3. **`feedback` as an optional 4th parameter to `createServedPlan`.** Default `null`. Existing callers pass nothing → existing behavior preserved → no breaking change in the writer's contract.
4. **Don't restructure the whole `handleServe`.** Split out a new `commitServe(feedback)` helper that does the actual writes. The existing `handleServe` becomes "open the sheet"; the sheet's button handlers call `commitServe` with the appropriate feedback value. This keeps the diff focused.
5. **`react-modal-sheet` for the confirmation UI.** Already in deps, already used by the share sheet from the just-merged PR. Same `Sheet.Container` / `Sheet.Header` / `Sheet.Content` pattern.
6. **The sheet shows a plan summary.** One line per scheduled day, name truncated. The user is about to commit; reminding them of what they're committing to is the whole point. No fancy chips or images — just a compact list.
7. **Cancellation is non-destructive.** Backdrop tap, X button, or "Let me adjust" all dismiss without committing. The `plan` state stays untouched so the user can edit and re-tap Serve.
8. **No haptic on dismiss.** `useHaptics` already triggers `'success'` on the existing `handleServe`. Move that haptic call into `commitServe` so it fires only when the user actually commits (👍 or 👎), not when they cancel.

---

## Implementation plan

Eight files change: a migration + verify SQL pair, the writer, the BrainstormMode page, schema docs, STATUS.md, and tests for the writer + the page.

### Step 1 — Migration + verify SQL

#### File: `supabase/migrations/20260506000002_meal_plans_served_feedback.sql` (new)

```sql
-- PRD-002 P1.2: meal_plans.served_feedback
--
-- See: docs/prds/PRD-002-meal-planning.md §P1.2
--
-- Adds an optional qualitative signal captured at Serve time. The Serve
-- confirmation sheet (BrainstormMode.jsx) writes 'positive' on thumbs-up
-- or 'negative' on thumbs-down. Existing rows + future "no feedback given"
-- rows stay NULL.
--
-- Shape:
--   text NULL — no DEFAULT (NULL is the absence-of-signal value).
--   CHECK enum mirrors the JS-side vocabulary; mirrors the
--   grocery_list_items.section pattern (app validates first, DB is the
--   defense-in-depth backstop).
--
-- No new RLS work — existing owner-scoped policies on meal_plans cover
-- the new column.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + DO-block around constraint add.
--
-- Reversibility (manual rollback, if ever needed):
--   ALTER TABLE public.meal_plans
--     DROP CONSTRAINT IF EXISTS meal_plans_served_feedback_valid;
--   ALTER TABLE public.meal_plans
--     DROP COLUMN     IF EXISTS served_feedback;


-- =========================================================================
-- 1. Column add
-- =========================================================================

ALTER TABLE public.meal_plans
  ADD COLUMN IF NOT EXISTS served_feedback text;

COMMENT ON COLUMN public.meal_plans.served_feedback IS
  'PRD-002 P1.2: optional qualitative signal captured by the Serve confirmation sheet in BrainstormMode. ''positive'' = thumbs-up, ''negative'' = thumbs-down, NULL = no feedback given (covers existing rows + any flow that bypasses the sheet, e.g. an automated test). CHECK constraint mirrors the JS vocabulary as a defense-in-depth backstop.';


-- =========================================================================
-- 2. Vocabulary CHECK
-- =========================================================================
--
-- Wrapped in a DO-block so re-running the migration after the constraint
-- already exists is a no-op rather than an error.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname  = 'meal_plans_served_feedback_valid'
      AND conrelid = 'public.meal_plans'::regclass
  ) THEN
    ALTER TABLE public.meal_plans
      ADD CONSTRAINT meal_plans_served_feedback_valid
      CHECK (served_feedback IS NULL OR served_feedback IN ('positive', 'negative'));
  END IF;
END $$;
```

#### File: `supabase/migrations/verify_20260506_meal_plans_served_feedback.sql` (new)

```sql
-- Verification queries for 20260506000002_meal_plans_served_feedback.sql
--
-- Run AFTER the main migration. Structural checks confirm the new column
-- and constraint exist with the expected shape. The smoke check confirms
-- existing rows are NULL (the column has no DEFAULT).
--
-- Run the full file, or sections individually, in the Supabase SQL Editor
-- (or via Supabase MCP against a preview branch).


-- =========================================================================
-- 1. served_feedback column exists, text, NULLABLE, no default
-- =========================================================================
-- Expected: 1 row | data_type='text' | is_nullable='YES' | column_default IS NULL

SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'meal_plans'
  AND  column_name  = 'served_feedback';


-- =========================================================================
-- 2. CHECK constraint exists with the expected vocabulary
-- =========================================================================
-- Expected: 1 row, definition contains both 'positive' and 'negative'.

SELECT conname,
       pg_get_constraintdef(c.oid) AS definition
FROM   pg_constraint c
WHERE  conrelid = 'public.meal_plans'::regclass
  AND  conname  = 'meal_plans_served_feedback_valid';


-- =========================================================================
-- 3. Existing rows are all NULL (no DEFAULT was set)
-- =========================================================================
-- Expected: bad_default = 0; total_rows matches the row count of meal_plans.

SELECT
  COUNT(*) FILTER (WHERE served_feedback IS NULL)        AS got_null,
  COUNT(*) FILTER (WHERE served_feedback IS NOT NULL)    AS bad_default,
  COUNT(*)                                                AS total_rows
FROM public.meal_plans;


-- =========================================================================
-- 4. CHECK rejects an invalid value (negative test, run inside a transaction)
-- =========================================================================
-- Expected: ERROR violating constraint meal_plans_served_feedback_valid.
-- Wrap in BEGIN/ROLLBACK so it doesn't actually mutate.
--
--   BEGIN;
--   UPDATE public.meal_plans SET served_feedback = 'mystery' WHERE id IN (
--     SELECT id FROM public.meal_plans LIMIT 1
--   );
--   ROLLBACK;
```

#### Apply via Supabase MCP

Per `CLAUDE.md`'s "MCP-powered verification" workflow:

1. Create a Supabase preview branch.
2. Apply this migration.
3. Run the verify SQL — confirm queries 1–3 return expected results.
4. Run query 4 in a `BEGIN/ROLLBACK` to confirm the CHECK rejects invalid values.
5. Hand off to the user with prod-apply instructions only after preview verification passes.

#### Update `docs/schema.md`

Add a new row to the `meal_plans` column reference table (after line 124's `created_at` row):

```
| `served_feedback` | `text` nullable | **Added 2026-05-06** via [PRD-002 P1.2 migration](../supabase/migrations/20260506000002_meal_plans_served_feedback.sql). Optional qualitative signal captured by the Serve confirmation sheet in BrainstormMode (`'positive'` = thumbs-up, `'negative'` = thumbs-down, `NULL` = no feedback given). CHECK constraint `meal_plans_served_feedback_valid` enforces the vocabulary as defense-in-depth. Existing rows are NULL (no DEFAULT). |
```

Append to the migrations log table at the bottom of `docs/schema.md`:

```
| [`20260506000002_meal_plans_served_feedback.sql`](../supabase/migrations/20260506000002_meal_plans_served_feedback.sql) | 2026-05-06 | PRD-002 P1.2: adds `meal_plans.served_feedback text` (NULLABLE) + `meal_plans_served_feedback_valid` CHECK constraint. |
| [`verify_20260506_meal_plans_served_feedback.sql`](../supabase/migrations/verify_20260506_meal_plans_served_feedback.sql) | 2026-05-06 | Read-only verification queries: column shape, CHECK definition, existing-rows-are-NULL smoke check, plus a negative-test snippet. |
```

### Step 2 — Extend `createServedPlan` to accept feedback

#### File: `src/lib/mealPlanWriter.js`

Find the existing function signature (around line 66):

```js
export async function createServedPlan(supabase, userId, items) {
```

Replace with:

```js
/**
 * @param {SupabaseClient} supabase
 * @param {string}         userId
 * @param {object[]}       items
 * @param {object}         [opts]
 * @param {'positive'|'negative'|null} [opts.feedback=null]
 *   PRD-002 P1.2: optional qualitative signal captured by the Serve
 *   confirmation sheet. Persists to meal_plans.served_feedback. Existing
 *   callers (or any code path that bypasses the sheet) leave this null.
 */
export async function createServedPlan(supabase, userId, items, opts = {}) {
  const { feedback = null } = opts
  if (feedback !== null && feedback !== 'positive' && feedback !== 'negative') {
    throw new Error(
      `createServedPlan: opts.feedback must be 'positive', 'negative', or null (got ${JSON.stringify(feedback)})`,
    )
  }
```

Then in the meal_plans insert (around line 84), pass the feedback through:

```js
const { data: planRow, error: planError } = await supabase
  .from('meal_plans')
  .insert({
    user_id: userId,
    period_start,
    period_end,
    served_feedback: feedback,   // ← new; stays NULL when not provided
  })
  .select('id, served_at, period_start, period_end')
  .single()
```

> **Why an `opts` object instead of a positional 4th argument?** Future-proofing. P1.2 introduces `feedback`; if a future PRD wants to capture (say) a "satisfaction note" or an "AI confidence acknowledgment," a positional signature breaks every call site. Keeping room for `opts.notes`, `opts.source`, etc. is essentially free now.

> **Don't change the SELECT to also pull `served_feedback` back.** The caller already knows what it just wrote. No need to round-trip the value.

#### File: `src/lib/__tests__/mealPlanWriter.test.js`

Read the existing test file. The handwritten supabase fake records call payloads on `client.calls` so tests assert ordering + payload shape — perfect for a "did the new column appear in the insert?" check.

Add cases inside the existing `createServedPlan` describe block:

```js
it('passes feedback="positive" through to the meal_plans insert payload', async () => {
  const supabase = makeSupabase()
  await createServedPlan(supabase, 'u-1', [
    { id: 'r-1', name: 'Pad Thai', scheduled_date: '2026-05-05', is_wildcard: false },
  ], { feedback: 'positive' })

  const planInsert = supabase.calls.find(c => c.table === 'meal_plans' && c.op === 'insert')
  expect(planInsert.payload.served_feedback).toBe('positive')
})

it('passes feedback="negative" through to the meal_plans insert payload', async () => {
  const supabase = makeSupabase()
  await createServedPlan(supabase, 'u-1', [
    { id: 'r-1', name: 'Pad Thai', scheduled_date: '2026-05-05', is_wildcard: false },
  ], { feedback: 'negative' })

  const planInsert = supabase.calls.find(c => c.table === 'meal_plans' && c.op === 'insert')
  expect(planInsert.payload.served_feedback).toBe('negative')
})

it('writes served_feedback=null when opts.feedback is omitted (existing-caller compatibility)', async () => {
  const supabase = makeSupabase()
  await createServedPlan(supabase, 'u-1', [
    { id: 'r-1', name: 'Pad Thai', scheduled_date: '2026-05-05', is_wildcard: false },
  ])

  const planInsert = supabase.calls.find(c => c.table === 'meal_plans' && c.op === 'insert')
  expect(planInsert.payload.served_feedback).toBeNull()
})

it('throws when opts.feedback is an unknown string', async () => {
  const supabase = makeSupabase()
  await expect(
    createServedPlan(supabase, 'u-1', [
      { id: 'r-1', name: 'Pad Thai', scheduled_date: '2026-05-05', is_wildcard: false },
    ], { feedback: 'mystery' })
  ).rejects.toThrow(/feedback must be/)
})
```

### Step 3 — Refactor `handleServe` to use a confirmation sheet

#### File: `src/pages/BrainstormMode.jsx`

This is the bulk of the user-visible work. Three changes: split `handleServe` into "open sheet" + "commit," add the new state, render the sheet.

#### 3a. New state next to the existing serve state

Find the existing serve-state block (around line 407–412):

```jsx
// Serve state
const [isServed, setIsServed]     = useState(false)
const [servedAt, setServedAt]     = useState(null)
const [servingPlan, setServingPlan] = useState(false)
const [serveError, setServeError] = useState(null)
const [justServed, setJustServed] = useState(false)
```

Add:

```jsx
// PRD-002 P1.2: confirmation sheet state.
const [serveSheetOpen, setServeSheetOpen] = useState(false)
```

#### 3b. Split `handleServe` into open-sheet + commit

Find the existing `handleServe` (around line 964). The current function does two things: build the items list AND call `createServedPlan`. Split them:

```jsx
// PRD-002 P1.2: opens the confirmation sheet. The actual commit happens
// in commitServe(feedback) when the user picks 👍 or 👎. The "Let me
// adjust" affordance dismisses the sheet without committing.
const handleServe = () => {
  if (isServed || servingPlan || !canServe) return
  setServeError(null)
  setServeSheetOpen(true)
}

// PRD-002 P1.2: the actual write path, parameterized by feedback. Called
// by the sheet's 👍 (feedback='positive') and 👎 (feedback='negative')
// buttons. The haptic now fires here so it only triggers on real commit,
// not on sheet open.
const commitServe = async (feedback) => {
  if (isServed || servingPlan || !canServe) return
  trigger('success')
  setServingPlan(true)

  try {
    const items = plan.map((slot) => ({
      scheduled_date: slot.scheduled_date,
      name: slot.name,
      id: slot.id,
      is_wildcard: slot.is_wildcard,
      source_url: slot.source_url,
    }))
    const { served_at } = await createServedPlan(supabase, userId, items, { feedback })
    setServedAt(served_at)
    setIsServed(true)
    setJustServed(true)
    setServeSheetOpen(false)
    localStorage.removeItem('brainstorm_plan')
    try {
      const periods = await listUserPeriods(supabase, userId)
      setDisabledDates(expandPeriodDates(periods))
    } catch {
      // best-effort
    }
  } catch (err) {
    if (err?.code === 'period_overlap') {
      setServeError('These dates overlap with a plan you already served. Pick different dates.')
    } else {
      setServeError('Could not save plan. Try again.')
    }
    // Leave the sheet open so the user can retry without re-opening it.
  } finally {
    setServingPlan(false)
  }
}
```

The original `handleServe` body (the items map + `createServedPlan` call + the success/error handling) moves into `commitServe`. The new `handleServe` is just "open the sheet."

> **Don't pass `feedback` through `handleServe`.** The split is intentional: `handleServe` is the "request to serve" entry point (button click); `commitServe` is the "actually do the write" worker. The sheet's buttons call `commitServe` directly.

#### 3c. Render the confirmation sheet

Add the import at the top of the file:

```jsx
import { Sheet } from 'react-modal-sheet'
import { ThumbsUp, ThumbsDown, Pencil } from 'lucide-react'   // Pencil already imported elsewhere — verify before adding
```

> **Verify the lucide imports** — `ThumbsUp` / `ThumbsDown` may need to be added; `Pencil` is already imported in `App.jsx` but check this file's existing imports. The existing imports near the top of `BrainstormMode.jsx` likely already include some of these.

Just before the closing `</div>` of the main returned JSX (find the end of the main component's `return (...)`), add the sheet:

```jsx
<Sheet
  isOpen={serveSheetOpen}
  onClose={() => setServeSheetOpen(false)}
  detent="content-height"
>
  <Sheet.Container>
    <Sheet.Header />
    <Sheet.Content>
      <div className="px-5 pb-8 space-y-4">
        <p className="section-heading">How does this plan feel?</p>
        <p className="helper-text">
          You're about to lock in {plan.length} {plan.length === 1 ? 'meal' : 'meals'} for this period.
        </p>

        {/* Compact plan summary — one line per scheduled day */}
        <ul className="space-y-1 max-h-48 overflow-y-auto pr-2">
          {plan.map((slot) => (
            <li key={slot.scheduled_date + ':' + slot.name} className="flex justify-between text-sm">
              <span className="text-gray-700 truncate flex-1">{slot.name}</span>
              <span className="helper-text shrink-0 ml-3">
                {new Date(slot.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
            </li>
          ))}
        </ul>

        {serveError && (
          <p className="text-xs text-red-600">{serveError}</p>
        )}

        <div className="space-y-2 pt-2">
          <button
            type="button"
            onClick={() => commitServe('positive')}
            disabled={servingPlan}
            className="btn-primary flex items-center justify-center gap-2 w-full"
          >
            {servingPlan
              ? <><Loader2 size={16} className="animate-spin" /> Saving…</>
              : <><ThumbsUp size={16} /> Looks great</>
            }
          </button>
          <button
            type="button"
            onClick={() => commitServe('negative')}
            disabled={servingPlan}
            className="btn-secondary flex items-center justify-center gap-2 w-full"
          >
            <ThumbsDown size={16} /> Lock in anyway
          </button>
          <button
            type="button"
            onClick={() => setServeSheetOpen(false)}
            disabled={servingPlan}
            className="btn-text flex items-center justify-center gap-2 w-full"
          >
            <Pencil size={14} /> Let me adjust
          </button>
        </div>
      </div>
    </Sheet.Content>
  </Sheet.Container>
  <Sheet.Backdrop onTap={() => !servingPlan && setServeSheetOpen(false)} />
</Sheet>
```

Notes on the JSX:

- **Three buttons in a vertical stack**, primary first. Mobile-first; bottom sheet is narrow.
- **`servingPlan` disables every button** so a slow network can't double-fire.
- **`Sheet.Backdrop` only dismisses when `servingPlan` is false.** Don't let a user tap-away mid-write.
- **`max-h-48 overflow-y-auto`** caps the plan summary at ~6 rows visible before it scrolls — for long periods.
- **The error stays visible inside the sheet** when a commit fails so the user can retry without losing the sheet.

> **Don't auto-close the sheet on error.** Keep it open so the user sees the error message and can hit the same button again. The `serveError` already renders inline.

> **Don't haptic on dismiss.** `trigger('success')` only fires inside `commitServe`, not in `handleServe` (sheet open) or in the "Let me adjust" handler.

#### 3d. Don't change the existing Serve button JSX

The button's `onClick={handleServe}` (around line 1320) still works — `handleServe` now just opens the sheet instead of committing. The button's loading/disabled props (`servingPlan`, `canServe`) all still apply since `commitServe` keeps the same `servingPlan` lifecycle.

The existing post-serve UI (the green "Served on..." banner, the "Generate grocery list →" CTA from `justServed`) is unchanged and renders the same way.

### Step 4 — Tests

Three test files change.

#### `src/lib/__tests__/mealPlanWriter.test.js`

Already covered in Step 2.

#### `src/pages/__tests__/BrainstormMode.test.jsx`

Read the existing file first to match its mocking style. The page tests likely already mock `mealPlanWriter` and `react-modal-sheet`. Extend with a new `describe` block:

```jsx
describe('BrainstormMode — Serve confirmation sheet (PRD-002 P1.2)', () => {
  // Setup helper: render a BrainstormMode in a state where canServe is true
  // and plan has at least one slot. Implementation depends on the existing
  // test fixtures — copy whatever pattern the existing 'serves a plan' test
  // (if any) uses, OR build from scratch using the writer mock.

  it('tapping Serve opens the confirmation sheet (does NOT commit)', async () => {
    // Mock createServedPlan; assert it's NOT called after the Serve tap.
    // The sheet should be visible (look for "How does this plan feel?").
  })

  it('tapping "Looks great" calls createServedPlan with feedback="positive"', async () => {
    // Open sheet → click 👍. Assert createServedPlan was called with
    // opts.feedback = 'positive'. Assert sheet closes after commit.
  })

  it('tapping "Lock in anyway" calls createServedPlan with feedback="negative"', async () => {
    // Open sheet → click 👎. Assert opts.feedback = 'negative'.
  })

  it('tapping "Let me adjust" closes the sheet without calling createServedPlan', async () => {
    // Open sheet → click "Let me adjust". Assert createServedPlan NOT called.
    // Sheet should be closed; plan state untouched.
  })

  it('keeps the sheet open and shows the error when commit fails', async () => {
    // Mock createServedPlan to reject with code='period_overlap'. Open sheet,
    // click 👍. Assert sheet stays open; error text visible inside sheet.
  })
})
```

> **The existing tests' mock for `react-modal-sheet`** likely lives in `src/setupTests.js` (per CLAUDE.md). It exports `Sheet` as a named export with stub `Sheet.Container` / `Sheet.Header` / `Sheet.Content` / `Sheet.Backdrop` subcomponents. Reuse the existing mock; don't introduce a new one.

> **If `BrainstormMode.test.jsx` doesn't yet have a 'serves a plan' integration test you can crib from**, the cleanest approach is to add fewer but more focused tests at the writer layer (Step 2 already does this) and unit-test the sheet's button handlers via a smaller component test if needed. Don't sink the PR into a 500-line page test rebuild.

---

## Step 5 — STATUS.md update

In the same PR, update `docs/STATUS.md`:

1. **Top of file:** bump the `**Last verified:**` line to today's date and the latest commit hash on `main` (post-merge).
2. **At-a-glance table** (PRD-002 row): "Next thing to plan" — drop P1.2: change `P1 nice-to-haves` line if it specifically lists P1.2, otherwise leave the generic phrasing. Confirm by reading the row.
3. **PRD-002 section:** move P1.2 from "Pending" to "Shipped":
   ```
   - [x] **P1.2** (PR #<your-PR>, commit `<hash>`): Lock-in feedback after Serve. Tapping Serve now opens a confirmation sheet showing a compact plan summary and three buttons — 👍 commits with `served_feedback='positive'`, 👎 commits with `'negative'`, "Let me adjust" dismisses without committing. New `meal_plans.served_feedback text` column with CHECK enum stores the signal.
   ```

---

## Step 6 — Branch + commit + PR

```bash
git fetch origin
git checkout -b feat/prd-002-serve-feedback origin/main

# Make the edits in Steps 1–5.

# Apply the migration to a Supabase preview branch via MCP and run the
# verify SQL. Report results in the PR description.

npm run test:unit
npm run lint
npm run lint:ds

git add supabase/migrations/20260506000002_meal_plans_served_feedback.sql \
        supabase/migrations/verify_20260506_meal_plans_served_feedback.sql \
        docs/schema.md \
        src/lib/mealPlanWriter.js \
        src/lib/__tests__/mealPlanWriter.test.js \
        src/pages/BrainstormMode.jsx \
        src/pages/__tests__/BrainstormMode.test.jsx \
        docs/STATUS.md

git commit
git push -u origin feat/prd-002-serve-feedback
```

### Suggested commit message

```
feat(prd-002): lock-in feedback after Serve (P1.2)

Adds a confirmation sheet between the Serve tap and the actual commit.
Captures qualitative signal (positive / negative) on the recommender's
plan quality at the point where the user is most able to react.

- supabase/migrations/20260506000002_meal_plans_served_feedback.sql:
  ALTER TABLE meal_plans ADD COLUMN served_feedback text NULL +
  CHECK constraint meal_plans_served_feedback_valid (positive |
  negative). NULL is the absence-of-signal value; existing rows stay
  NULL (no DEFAULT).

- src/lib/mealPlanWriter.js: createServedPlan accepts an optional
  4th argument { feedback }. Throws on unknown values; null when
  omitted (existing callers unchanged).

- src/pages/BrainstormMode.jsx: handleServe now opens a confirmation
  bottom sheet instead of committing immediately. The sheet shows a
  compact plan summary + three buttons:
    - 👍 Looks great           → commitServe('positive')
    - 👎 Lock in anyway        → commitServe('negative')
    - ✏️ Let me adjust         → dismiss, no commit
  commitServe(feedback) is the actual write path; haptic moved here
  so it only fires on real commit, not on sheet open.

Schema docs + migrations log + STATUS.md updated.
```

### Suggested PR description

```markdown
## Why

The Serve action has been fire-and-forget since day one — tap, plan is committed, no chance to second-guess and no signal captured about how the user felt. P1.2 wedges a small confirmation sheet between intent and commit. Two wins:

1. **Safety net:** "Let me adjust" returns the user to plan-edit mode without writing to the DB.
2. **Qualitative signal:** 👍 / 👎 persists to a new `meal_plans.served_feedback` column. Future leading indicator for "is the recommender actually serving good plans?"

## What

- **Migration** (`20260506000002_meal_plans_served_feedback.sql`): adds `meal_plans.served_feedback text` with `meal_plans_served_feedback_valid` CHECK enum (`positive` / `negative`). Existing rows stay NULL (no DEFAULT).
- **`src/lib/mealPlanWriter.js`:** `createServedPlan` accepts an optional `opts.feedback` parameter. Validates against the enum; throws on unknown values; defaults to `null` so existing callers are unchanged.
- **`src/pages/BrainstormMode.jsx`:** new `serveSheetOpen` state. `handleServe` now just opens the sheet; `commitServe(feedback)` is the actual write path. Sheet shows a compact plan summary + three buttons. Haptic moved into `commitServe` so it only fires on real commit.

## Schema docs

`docs/schema.md` — new row on the `meal_plans` table for `served_feedback`; new entry in the migrations log.

## What's NOT in this PR

- **Free-text "tell us more" field.** Out of scope for P1; the binary is the qualitative signal we asked for.
- **Surfacing feedback history in any UI** (e.g. "you've thumbs-down'd 4 plans this month"). Pure data-collection PR; surfacing is later work.
- **Editing feedback after commit.** Once you pick 👍 or 👎, the row is written. The Serve flow is the only point where feedback is captured. Changing this would need an "edit served plan" UX that doesn't exist.
- **Recommender consuming the signal.** PRD-002 P1.6 (AI suggestion novelty dial) is the natural place to start consuming `served_feedback` for recommender tuning. Not yet wired.

## MCP verification

- **Supabase MCP (preview branch):**
  - Created preview branch off `main`.
  - Applied `20260506000002_meal_plans_served_feedback.sql`.
  - Ran `verify_20260506_meal_plans_served_feedback.sql`:
    - Q1: column shape correct (text, NULLABLE, no default). ✅
    - Q2: CHECK constraint definition includes both `positive` and `negative`. ✅
    - Q3: every existing row is NULL; bad_default = 0. ✅
    - Q4 (negative test): UPDATE with `served_feedback = 'mystery'` errored as expected with constraint violation; ROLLBACK applied. ✅
- **Vercel MCP:** preview deploy URL `<paste here>`. Smoke test below.

## Smoke test

1. Sign in as the test user. Open Prep Table → build a plan that's not yet served.
2. Tap **Serve This Plan**. Confirm the bottom sheet opens with the plan summary + three buttons. Confirm the meal_plans table has NOT changed (`SELECT count(*) FROM meal_plans WHERE served_feedback IS NOT NULL` returns 0 from this user).
3. Tap **Let me adjust**. Sheet closes. Re-tap Serve — sheet re-opens; plan state preserved.
4. Tap **👍 Looks great**. Sheet closes; UI flips to "Served on …" banner. Confirm `meal_plans.served_feedback = 'positive'` for the new row.
5. (If you have another plan to commit) repeat with **👎 Lock in anyway** → confirm `served_feedback = 'negative'`.
6. Force a period-overlap error (e.g., overlap dates with the just-served plan) → confirm the sheet stays open and shows the error.
7. Pull runtime logs from the preview deploy via MCP. No `[BrainstormMode]` errors expected.
```

---

## Smoke test (post preview deploy)

The 7-step list above. The four things to verify visually:

1. **Sheet opens on Serve** without committing — confirm via DB row count.
2. **Three buttons route correctly** — 👍/👎 commit with the right `served_feedback` value; "Let me adjust" doesn't commit.
3. **Error path keeps the sheet open** — period-overlap is the easiest to reproduce.
4. **Existing post-serve UI** (green banner + "Generate grocery list →" CTA) still works after the new sheet path.

Report findings in the PR description before requesting review.

---

## Known gotchas

1. **Migration etiquette per CLAUDE.md:** `ADD COLUMN IF NOT EXISTS` for the column; DO-block guard for the CHECK constraint (`CREATE OR REPLACE CONSTRAINT` doesn't exist; you have to check `pg_constraint` first). Both make the migration idempotent. Pair with the verify file in the same directory.

2. **`react-modal-sheet` import shape.** Use `import { Sheet } from 'react-modal-sheet'` — NAMED, not default. CLAUDE.md gotcha #1 calls this out. The `setupTests.js` global mock exports `Sheet` as named — the page test will work fine if you stick to named imports.

3. **Haptic placement matters.** Move `trigger('success')` from `handleServe` (sheet open) into `commitServe` (real commit). If you leave it on sheet open, the user gets a "success" haptic for *opening* a sheet, which is wrong feedback.

4. **Don't make `feedback` a positional 4th arg.** The `opts` object pattern leaves room for future fields without breaking every call site. Future you will appreciate this.

5. **The `opts.feedback` validation in `createServedPlan` should throw, not silently coerce.** A typo'd value (`'positive '` with a trailing space, etc.) should fail loudly during dev rather than silently writing NULL.

6. **The CHECK constraint in the migration uses `IS NULL OR IN (...)`.** That `IS NULL` clause is load-bearing — without it, the constraint would reject every existing row when applied because they're all NULL. PostgreSQL CHECK constraints treat NULL as "passes" only when the comparison expression itself returns NULL, which `served_feedback IN ('positive', 'negative')` does — but writing it explicitly makes the intent unambiguous.

7. **Don't change the existing Serve button JSX.** The button still calls `handleServe`; only `handleServe`'s body changes. Any visual changes to the button itself (label, icon, loading state) are out of scope.

8. **Don't touch the post-serve UI.** Green banner, "Generate grocery list →" CTA, share/groceries row — all unchanged. The new sheet inserts upstream of all of that.

9. **Sheet is dismissible during `servingPlan === false` only.** When the write is in flight, prevent backdrop tap and button presses. Otherwise the user could double-commit or close the sheet while a write is racing.

10. **Don't fix unrelated lint or test errors while doing this work.** Note them as follow-ups in the PR description.

---

## When done

Report back with:

- The PR URL.
- Supabase MCP verify-SQL results (the 4 queries from `verify_20260506_meal_plans_served_feedback.sql`).
- Vercel preview deploy URL + status.
- Smoke-test findings (the 7-step list above — pay particular attention to step 2's "did NOT commit" check and step 4's row inspection).
- Confirmation that STATUS.md and `docs/schema.md` both got updated in the same PR.

If anything in the prompt doesn't match the codebase (a renamed file, a different existing pattern, the column already in place, react-modal-sheet's API changed), stop and ask the user. The CLAUDE.md "When in doubt" rule applies.
