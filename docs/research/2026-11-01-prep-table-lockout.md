# Prep Table lockout investigation — 2026-11-01

**Why:** Matt's wife stopped using the app in June after getting locked out of planning. Nobody
remembered the exact steps, so instead of trusting memory we mapped the flow from the code and
drove the real UI through every path with Playwright.

**How:** `e2e/lockout-explorer.spec.js` runs the app against a stateful in-memory fake of
Supabase (`e2e/support/fakeSupabase.js`), which remembers writes across reloads and enforces the
no-overlapping-weeks rule. Each scenario steps through simulated days and, at every step, asks
"can she plan the date she wants from here?" Results: `e2e-results/lockout/*.json` plus a
screenshot per step. Rerun with:

    npx playwright test e2e/lockout-explorer.spec.js --reporter=line

**Limits:** a fake database (not Supabase); AI suggestions off; 6 paths, not every permutation;
a desktop viewport, not a phone.

## The flow today

```mermaid
stateDiagram-v2
    direction TB
    [*] --> Brainstorm : first time ever
    state "1 Brainstorm (draft, the only editable stage)" as Brainstorm
    state "2 Served (locked)" as Active
    state "3 Week ended, not locked in" as Ended
    state "4 Gap day (one button)" as Gap
    state "Date-range calendar" as Range
    Brainstorm --> Active : Serve This Plan
    Active --> Ended : last day passes
    Active --> Gap : Reset plan (older week exists)
    Active --> Brainstorm : Reset plan (no older week)
    Ended --> Gap : Lock in as-is
    Gap --> Range : Start new planning period
    Range --> Active : Confirm (new week starts already locked)
```

After week one, nothing leads back to Brainstorm.

## Findings (all observed in the test run)

1. **Can't plan next week until this one is over and locked in** (scenario A). Served Sun–Thu;
   on Sun, Wed and Thu there was no control to plan other dates. On Friday: "lock in last week first."
2. **Planning ahead locks out the rest of this week** (scenario B). On Wednesday she served next
   week from the strip; Thu–Sat of this week then couldn't be planned until next week ended.
   The only escape is "Reset this plan", which deletes next week's plan.
3. **The suggested-week view is unreachable after week one** (scenarios A, C, D). Every week
   started via "Start new planning period" begins locked: no date strip, Regenerate disabled,
   only "+" one day at a time.
4. **"Lock in as-is" moves the whole week forward and erases it** (scenario A). With nothing
   marked cooked, every meal counts as a leftover and the leftover picker pre-selects all of
   them. Week 1 ended with 0 meals in its history; week 2 was an exact copy of week 1.
   Production's plan history shows weeks with 0–3 meals each, consistent with this (inferred,
   not traced row by row).
5. **Minor:** the calendar refuses any range touching last week (correct rule, terse message,
   scenario E); "Reset this plan" doesn't appear right after serving until a reload
   (scenarios A, B); returning after weeks away forces a "lock in the old week" step first (scenario D).

No crashes or error screens on any path; the fake database logged no unsupported queries.

## What this feeds

The shared-household spec (`docs/prds/`, in progress) treats findings 1–4 as problems to
solve. Direction under discussion: Serve becomes a checkpoint ("Confirm the week"), nothing
locks, every meal is its own row from the first tap, and uncooked meals never silently move
or vanish from history. Rerun this explorer after that work; findings 1–4 should no longer
reproduce.

## Rerun on the new Prep Table — 2026-11-06 (PRD-008 2c)

`e2e/lockout-explorer-new.spec.js` walks the same situations through the new week screens
(`VITE_NEW_PREP_TABLE=true`), on the same stateful fake database (now with `planned_meals`,
`week_confirmations`, `week_days` and the "changed since confirmed" trigger), and **asserts** instead
of recording. All four pass:

1. **Plan next week while this one is open** — Wednesday, this week unconfirmed: Next week → "+ add"
   on Sunday saves the meal; nothing had to be confirmed or locked first.
2. **Planning ahead doesn't lock this week** — Wednesday: next week confirmed, then Thursday of this
   week still takes a meal; next week's plan is untouched.
3. **Suggestions reachable after week one** — week 3 Monday: "Suggest the empty days" is enabled and ✨
   on a day proposes a recipe that ✓ saves; five weeks later (time away) the same, with no step first.
4. **Nothing moves or vanishes** — a confirmed week with nothing ticked cooked: next Monday, week 2 is
   empty (not a copy), all five meals are still on their own days in week 1, and "Didn't get to these"
   shows 5.

Run: `VITE_NEW_PREP_TABLE=true npx playwright test e2e/lockout-explorer-new.spec.js` (screenshots in
`e2e-results/lockout-new/`). The original explorer is skipped when the switch is on (it drives the old
screens).
