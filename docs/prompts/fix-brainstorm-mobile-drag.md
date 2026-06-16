# Claude Code Prompt — Fix BrainstormMode mobile drag (no PRD)

**For:** Claude Code (executor)
**Authored by:** Cowork (planning surface) on 2026-05-30
**Type:** Bug fix, not a PRD phase. Will NOT update `docs/STATUS.md`.
**Linked discussion:** Cowork session 2026-05-30 with user feedback on three features; drag was confirmed as a regression on mobile (user reports "drag doesn't seem to do anything on my device"). Git archaeology shows the code IS wired up (see "What we already know" below) — this is a runtime / sensor configuration issue, not missing functionality.

---

## ⚠ Pre-flight: confirm you're in the right place

```bash
EXPECTED="/Users/Matt/projects/recipe-rhythm"
ACTUAL="$(git rev-parse --show-toplevel 2>/dev/null)"
echo "expected: $EXPECTED"
echo "actual:   $ACTUAL"
[ "$ACTUAL" = "$EXPECTED" ] || { echo "ABORT: not in the recipe-rhythm repo root"; exit 1; }

PROMPT="docs/prompts/fix-brainstorm-mobile-drag.md"
test -f "$PROMPT" || { echo "ABORT: $PROMPT not found in this working tree"; exit 1; }

git fetch origin
git status   # working tree should be clean
git log --oneline -5
```

If working tree isn't clean, stop and surface to the user.

---

## What we already know (from the Cowork planning session)

Don't reinvestigate; this is the starting point.

1. **The drag code exists and is wired up.** Per `git log --all -- src/pages/BrainstormMode*`, there has never been a commit removing drag. Current call sites:
   - `src/pages/BrainstormMode/useBrainstorm.js:654-686` — `handleDragEnd` uses `arrayMove` to swap meals between dates; keyed by `scheduled_date`.
   - `src/pages/BrainstormMode/MealPlanCard.jsx:111-140` — wraps a `DndContext` with `SortableContext` + `verticalListSortingStrategy`; passes `onDragEnd={onDragEnd}`.
   - `src/pages/BrainstormMode/SortableMealItem.jsx:21` — `useSortable({ id: slot.scheduled_date })`.
   - `src/pages/BrainstormMode/index.jsx:278` — `<MealPlanCard onDragEnd={handleDragEnd} ... />`.

2. **The user is on mobile.** Symptom is "drag doesn't seem to do anything on my device" — touch input, not pointer.

3. **Sensor config is likely the culprit.** Check `useBrainstorm.js` for the sensor setup. In particular look at whether `TouchSensor` is configured at all and whether its `activationConstraint` (delay + tolerance) is set. A common `@dnd-kit` failure mode on mobile: only `PointerSensor` is configured, which doesn't reliably trigger from touch events on iOS Safari without specific activation distance configuration.

4. **Plans are local-state until Serve.** `handleDragEnd` calls `setPlan(items => ...)` — never writes to DB. That means even if drag *does* fire on a served plan, the early-return `if (isServed) return` prevents it from doing anything. **Make sure your repro is on an UNSERVED plan.**

---

## Step 1: Reproduce on the preview deployment

This is a mobile-specific bug; reproducing in JSDOM-based Vitest tests won't catch it. Use the Vercel MCP to drive the live preview.

1. Check that the current `main` deploys cleanly on Vercel:
   ```
   Use Vercel MCP: list_deployments for project prj_OhbZ2aF7RhBz2PwIt6Yj1kgPFu2m, look at the most recent main deployment.
   ```
2. If you need a fresh preview, push a no-op commit to a `fix/brainstorm-mobile-drag` branch and wait for Vercel to build it.
3. Use the test credentials in `.claude/test-credentials.md` (gitignored) to log into the preview URL.
4. Open BrainstormMode with an UNSERVED active plan that has at least 2 meals scheduled. If none exists, create one.
5. **On a mobile-emulating viewport** (Chrome DevTools device toolbar → iPhone 12 Pro, or similar), try to drag a meal from one day to another. Observe whether drag fires.

If you can't reproduce in DevTools mobile emulation, ask the user to reproduce on their actual device and report the iOS version + browser. iOS Safari has unique pointer/touch event quirks that desktop browsers don't replicate even in mobile-emulation mode.

---

## Step 2: Investigate sensor configuration

Read `src/pages/BrainstormMode/useBrainstorm.js` around the imports (top of file) and around the `useSensors` call. Confirm:

- Is `TouchSensor` imported? (`import { TouchSensor, ... } from '@dnd-kit/core'`)
- Is `TouchSensor` instantiated in `useSensors`? (`useSensor(TouchSensor, { activationConstraint: ... })`)
- What's the `PointerSensor` activation constraint?

The historical commit `66b332d refactor(brainstorm): lift data layer into useBrainstorm hook` references both `PointerSensor` and `TouchSensor` in its imports. Confirm both are still present and properly configured.

Common fix patterns (apply only if applicable):

```js
import { PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'

const sensors = useSensors(
  useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },  // small distance, fires on intentional drag, ignores click
  }),
  useSensor(TouchSensor, {
    activationConstraint: { delay: 250, tolerance: 5 },  // delay-based: avoids triggering on scroll gestures
  }),
)
```

The `delay + tolerance` pattern for `TouchSensor` is the standard mobile-safe configuration: it requires the user to long-press for 250ms before drag starts, which disambiguates from a scroll. Without this, touch-start usually gets consumed by the page scroll handler.

---

## Step 3: Check the drag handle hit-area

If sensor config looks correct, the next likely culprit is hit-area. Read `src/pages/BrainstormMode/SortableMealItem.jsx`:

- Is the `listeners` prop from `useSortable` spread onto the entire meal card, or only a small drag-handle icon?
- If the whole card is the handle, that's fine.
- If it's only a small icon, that icon needs ≥ 44px tap target (PRD-005 §P0.4) and clear visual affordance.

PRD-005 P0.7 (Phase 4) touched BrainstormMode primitives — confirm the drag handle didn't get inadvertently shrunk or hidden in that pass.

---

## Step 4: Implement the fix

Based on Steps 2–3 findings, make the minimal change. Likely scenarios:

- **Scenario A — `TouchSensor` missing or misconfigured.** Add or fix the sensor config in `useBrainstorm.js`. This is probably the fix.
- **Scenario B — Hit-area too small.** Add or enlarge the drag handle in `SortableMealItem.jsx`. May need to bump the visual affordance too (e.g., a `GripVertical` icon from `lucide-react`).
- **Scenario C — Some new CSS rule on the meal card is intercepting touch events.** Look for `touch-action: none` or `pointer-events: none` rules that might have been introduced during PRD-005 primitive adoption.

Whatever the fix, keep the diff minimal. Do NOT take this opportunity to refactor unrelated code.

---

## Step 5: Add a regression test

Vitest can't reproduce the touch-sensor bug directly (JSDOM doesn't simulate touch events realistically), but you can add a smoke test that confirms the sensor config exists. Add to `src/pages/BrainstormMode/__tests__/BrainstormMode.test.jsx`:

```js
it('configures both PointerSensor and TouchSensor for mobile compatibility', async () => {
  // ... render BrainstormMode, then assert that the dnd-kit DndContext has
  // both sensors registered. The exact assertion depends on how the test
  // currently mocks @dnd-kit/core (see existing mocks around line 70).
  // Goal: if someone removes TouchSensor in a future refactor, this test fails.
})
```

If the existing dnd-kit mock makes this hard to assert, leave a comment in the test file pointing to this prompt and the discussion of why TouchSensor must remain.

---

## Step 6: Verify the fix on the preview deployment

1. Push the fix branch to GitHub.
2. Wait for Vercel preview to build (check via Vercel MCP).
3. Re-run the Step 1 repro on the new preview URL. Drag should now work.
4. **Test on real iOS Safari** if possible — even DevTools mobile emulation can pass while real iOS fails. If you cannot, hand off to the user with clear "please test on your phone" instructions in the PR description.
5. Pull runtime logs from the preview deployment via Vercel MCP to confirm no client-side errors fired.

---

## Acceptance criteria

- [ ] Drag-and-drop works on mobile Safari for an active (unserved) plan with ≥ 2 meals.
- [ ] Drag does NOT trigger on a served plan (existing `isServed` guard still in place).
- [ ] Page still scrolls normally — drag does not trigger on accidental swipes.
- [ ] Existing tests pass; one new test asserts sensor config is present.
- [ ] PR description includes: a screenshot or GIF of the working drag, the root cause finding from Step 2/3, and a note about which scenario (A/B/C) matched.
- [ ] No changes outside `src/pages/BrainstormMode/` unless absolutely required.
- [ ] No changes to `docs/STATUS.md` (this is a bug fix, not a PRD phase).

---

## If something doesn't match this prompt

Stop and ask the user. Specifically:
- If Step 1 repro doesn't actually fail (drag works in your test environment), confirm with the user before changing anything — the bug may be device-specific.
- If sensor config already looks correct AND hit-area is fine, you're in unknown territory; bring back logs + console output and ask before guessing further.

Branch suggestion: `fix/brainstorm-mobile-drag`. PR title: "fix(brainstorm): restore drag on mobile (sensor config)".
