# PRD-008: Shared Household & Calendar Planning

**Status:** Draft v0.7
**Author:** Matt (with Cowork)
**Date:** 2026-11-01
**North Star criteria moved:** "The plan doesn't stall on Matt" and "She plans in the app"
(primary); "Never unprepared" and "Variety within the week" (supporting)
**Evidence:** [docs/research/2026-11-01-prep-table-lockout.md](../research/2026-11-01-prep-table-lockout.md) (PR #201)
**Supersedes:** the "partner collaboration" deferrals in Recipe Vault & Cooking Record
(PRD-001), Meal Planning (PRD-002) and Grocery Tracking (PRD-003); the period model of
the planning-period decision record (ADR-001).

Lines tagged CONFIRMED = Matt decided it; INFERRED = facilitator's design, for Matt to review.
Account emails are never written in this repo (it's public). The setup statement Matt pastes
into the SQL Editor is the only place they appear.

---

## 1. Problem

1. **She stopped using the app after getting locked out.** The lockout explorer (PR #201)
   reproduced four traps, all caused by plans being locked "period" boxes:
   - She can't plan next week until this week is over and locked in.
   - Planning ahead locks out the rest of this week; the only escape deletes next week.
   - The suggested-week view is unreachable after week one.
   - "Lock in as-is" moves every uncooked meal into next week, which empties the old
     week's history and makes the new week a copy of the last.

   (CONFIRMED by test; matches her real history: weeks of 0–3 meals, last plan June 14.)
2. **Matt can't see or fill the plan.** Separate accounts, and every table is locked to one
   owner. Her top pain point is her plan stalling on his late answers. (CONFIRMED)

## 2. Goals

1. **Nothing locks.** She can plan any upcoming date at any time. (CONFIRMED: option A)
2. **Her week, her way.** Prep Table shows a week grid, Sun–Thu by default, with Fri and
   Sat available whenever they cook on a weekend, and ← / → to move between weeks.
   (CONFIRMED: "We generally cook Sun–Thu but occasionally … Friday or Saturday")
3. **She has the final say.** "Confirm the week" is her sign-off and triggers the grocery
   list. It is a stamp, not a lock: later edits are allowed and prompt "update the grocery
   list?" (CONFIRMED)
4. **One household owns all kitchen data:** recipes, meals, the meal log, grocery lists,
   preferences. (CONFIRMED)
5. **Both edit everything; she leads by habit, not permission.** (CONFIRMED)
6. **Matt's nights:** she marks days as his; he sees the whole week, including her nights,
   and fills his. Suggestions for his nights avoid repeating or echoing hers. (CONFIRMED)
7. **History stays true from here on.** Uncooked meals stay on their dates as "planned,
   not cooked" and come back as "Didn't get to these" suggestions. Nothing moves on its
   own. (CONFIRMED)

## 3. Non-goals

1. **No invite flow.** One-time setup by migration. (CONFIRMED)
2. **No notifications, chat or in-app nudges.** She texts him; the app holds the plan.
   (CONFIRMED: handoff option 1)
3. **No roles or permissions.** (CONFIRMED)
4. **No live sync.** Changes appear on refresh or next open. (INFERRED)
5. **No per-person preferences or nutrition tracking.** (INFERRED; North Star non-goal)
6. **Matt's existing recipes are not merged in.** The shared cookbook starts as hers.
   (CONFIRMED)
7. **No recovering history the old flow already erased.** Meals that "Lock in as-is"
   rolled forward out of past weeks can't be put back; her pre-migration history will look
   thinner than what was actually cooked. (INFERRED; a consequence of finding 4)

## 4. How a week works (user view)

1. Prep Table opens on **this week**, showing her usual days (Sun–Thu at first); the day
   buttons at the top add or hide days for that week (D8). Past days show as history (cooked /
   not cooked). Empty upcoming days offer **+ add** or **✨ suggest**. "Suggest" fills the
   empty days of the visible week, avoiding repeats within it. (INFERRED UI)
2. She taps a day → **"Matt's night"** to hand it to him. She texts him. (CONFIRMED)
3. Matt opens the app on his own account and sees the same week. His nights show
   "pick something" with suggestions that account for her nights. (CONFIRMED need)
4. She taps **Confirm the week**: the grocery list generates for that week. If any of
   Matt's nights are still empty, she's told, and can confirm anyway (the list skips
   them) or wait. Never blocked. (INFERRED)
5. Any later edit marks the week "changed since you confirmed" and offers to update the
   grocery list. (CONFIRMED)
6. → shows next week, any time. (CONFIRMED)
7. Uncooked meals from the last two weeks appear in a **Didn't get to these** tray;
   tapping one puts it on a day. (CONFIRMED behavior; INFERRED two-week window)

## 5. Decisions

- **D1 — Meals sit on dates; periods are retired.** (CONFIRMED: option A) A new
  `planned_meals` table: one row per meal, with a date. A week is just a range of dates
  on screen. This retires the overlap rule, the gap-day screen, lock-in, end-of-period
  review and the leftovers picker.
- **D2 — Every meal is its own row from the first tap.** Two people editing different
  days never overwrite each other. This retires the plan-drafts table from PR #200, which
  stays useful only until the new Prep Table ships. (INFERRED)
- **D3 — Suggestions aren't saved until accepted.** "✨ Suggest" shows proposals on empty
  days; tapping ✓ saves them. That way the history only holds what she chose. This changes
  her current habit (today the planner auto-fills a week). (CONFIRMED: she's fine with it)
- **D4 — Confirmations are stamps.** A `week_confirmations` row (household, start, end,
  confirmed_by, confirmed_at) links to its grocery list. "Changed since confirmed" means
  a meal in that range was edited after confirmed_at. (INFERRED)
- **D5 — Ownership moves to the household; `user_id` stays as "who added it".** (INFERRED)
- **D6 — Security rules check household membership**, through one helper function that
  runs with elevated rights so the membership table's own rule doesn't block the check.
  (INFERRED)
- **D7 — Every account gets a household.** Solo households for test and demo accounts,
  one shared household for Matt and his wife, and a trigger that gives each new sign-up
  a solo household. (INFERRED)
- **D8 — Weeks run Sunday to Saturday; she picks which days each week shows** (option B,
  CONFIRMED by Matt 2026-11-02 after the week-shape mockup). A row of day buttons (Su–Sa) at
  the top of the week, like today's date strip: tap to show or hide a day. Hidden days
  disappear from the list. A day with a meal on it can't be hidden. A new week starts with
  the days of the last week she changed ("usual days"); the first default is Sun–Thu.
  (CONFIRMED need: "view the meals over days of the week … include more or less days to fit
  a changing schedule". Considered and not chosen: slim weekend rows (no way to show fewer
  days); every day listed with a "Not cooking" mark. Known trade-off: Matt can't tell a
  hidden day from an unplanned one; revisit in phase 3 if it bites.)
  _Superseded v0.4 text: "Sun–Thu always show, Fri and Sat show as slim '+ weekend' rows …
  No setting needed."_
- **D9 — Every schema or security migration ships with a tested undo.** A paired
  `rollback_<timestamp>.sql` restores the previous state exactly (tables, columns,
  policies). It is run on preview — apply, verify, roll back, verify the old state, apply
  again — before Matt applies the migration to production. Production rollback is Matt's
  call, pasted the same way. (INFERRED; added after review — the household security
  rewrite is the riskiest step in this spec)

## 6. Requirements

### P0 — Must have
- **P0.1 Household schema + setup.** `households`, `household_members`; `household_id` on
  every kitchen table; one setup migration (solo households, the shared household, backfill).
  Emails only in the uncommitted setup statement.
  (INFERRED, phase 1 build: child tables such as `grocery_list_items` inherit the household through
  their parent instead of a second copy; `plan_drafts` stays one per person and LogMode's back-link
  of the meal just logged stays on `user_id`, so one partner never overwrites or relinks the other's.)
- **P0.2 Membership security rules** on every kitchen table, and a verify query proving
  that an outsider sees 0 rows.
- **P0.3 Calendar data.** `planned_meals` (household_id, date, position, name, vault_id,
  is_wildcard, source_url, cooked, cooked_at, assigned_to, assigned_at, added_by,
  updated_at) and `week_confirmations`. Copy every existing plan item to a dated meal;
  old served periods become confirmations. Everything currently in the database is carried
  over; meals the old flow already erased are not recoverable (non-goal 7). Maybe/shortlist
  items become a household Maybe list.
  (Phase 2a build, 2026-11-02 — CONFIRMED by Matt: the Maybe list is `planned_meals` rows with no date,
  so moving a Maybe onto a day only fills in the date; re-running the copy at switch-over mirrors the
  old tables — adds, updates and removes — but never touches a meal edited on the new screens.
  INFERRED: `date` is `planned_on`; `added_by` / `confirmed_by` are `user_id`, the "who added it"
  column every kitchen table already has; "changed since confirmed" is a `changed_at` stamp set by a
  trigger, so removing a meal counts too, and ticking cooked / reordering / assigning doesn't.)
- **P0.4 New Prep Table.** Week grid with ← / →, day buttons per week (D8), + add, ✨ suggest,
  the Maybe tab, the "Didn't get to these" tray, and Confirm the week.
  (Phase 2b-1 build, 2026-11-02 — CONFIRMED by Matt: the off switch for the new screens is a build
  setting, `VITE_NEW_PREP_TABLE`, on for preview deploys and off in production until 2c. Days are stored
  as `household_preferences.usual_days` plus a `week_days` row for each week she changed; a day with a
  meal always shows and is never stored. INFERRED: emptying a week (vacation) is allowed and doesn't
  change the usual days; picking from "Didn't get to these" adds a new meal and leaves the old one on its
  date as history; the tray shows one per recipe, newest first, the 14 days before today, and drops
  anything already planned from today on.)
- **P0.5 Matt's nights.** Assign a day; "pick something" state; suggestions that exclude
  the week's meals and penalize same-cuisine / same-protein picks.
- **P0.6 Grocery list per confirmed week**, with "changed since confirmed → update".
- **P0.7 Retire the old flow:** periods, the gap-day screen, lock-in, period review, the
  leftovers picker, plan drafts, the overlap constraint. Remove their code and tests.
- **P0.8 Rerun the lockout explorer**, updated for the new screens: all four traps must
  be gone.
- **P0.9 Rollback scripts** (D9) for P0.1, P0.2 and P0.3, each rehearsed on preview.

### P1 — Nice to have
- **P1.1 Handoff timing:** a monthly query of days from assigned to filled (North Star
  criterion 4).
- **P1.2 "Added by" label** on meals and log entries.

### P2 — Future (not now)
- Invite flow; send-link button (handoff option 1+); live sync; per-person preferences.

## 7. Success metrics
- **The lockout explorer reproduces none of the four traps.** (INFERRED; checkable by anyone)
- **She plans in the app 7 of 8 non-vacation weeks.** (North Star, CONFIRMED)
- **Matt's nights filled within 2 days of being assigned.** (North Star, CONFIRMED)
- **An outsider sees 0 rows on every kitchen table.** (INFERRED)

## 8. Open questions
- ~~**OQ1 — Her week shape.**~~ Answered 2026-11-01: Sun–Thu, Fri/Sat when needed (D8).
- **OQ2 — Should ✨ suggest fill Matt's nights too, or leave them for him?** (Non-blocking;
  proposed: leave them.)
- **OQ3 — Should meals she logs in the meal log mark the planned meal "cooked"
  automatically?** (Non-blocking; proposed: yes, matched by date and name. Note the log
  has barely been used — 1 entry — so this is low priority.)
- ~~**OQ4 — Interim stopgap?**~~ Answered 2026-11-01: yes. PR #205 opens an ended week
  straight into the suggested-week view (fixes traps 3 and 4 and the lock-in half of
  trap 1). Removed in phase 4.

## 9. Phasing
Each phase is one or more sessions; the whole spec is several weeks of work.

1. **Household** (P0.1, P0.2, P0.9 for both). The riskiest SQL. Rehearsed on preview with
   its rollback, then applied by Matt.
2. **Calendar data + new Prep Table, together** (P0.3, P0.4, P0.6, P0.9 for P0.3). One
   switch-over: the data copy runs as part of the same release that turns on the new
   screens, so nothing she plans on the old screens in between gets left behind. If the
   copy has to run earlier for testing, it runs again at switch-over. (INFERRED; merged
   after review — separate phases would have left a window of unmigrated plans)
3. **Matt's nights** (P0.5).
4. **Retire the old flow + rerun the explorer** (P0.7, P0.8).
5. **Measurement** (P1).

## 10. Testing
- **Vitest:** week-range helpers (including weekend rows appearing when used); suggestion scoring
  for a week and for assigned nights; "changed since confirmed"; the "Didn't get to these"
  query; household-scoped data helpers.
- **Verify SQL** (one combined query per migration, so the SQL Editor shows every result):
  membership per table, outsider sees 0 rows, every row has a household, every old plan
  item migrated.
- **Rollback rehearsal** on preview for every migration (D9): apply → verify → roll back →
  verify old state → apply again.
- **Playwright:** the lockout explorer, rewritten for the new screens; a two-account
  handoff (she assigns, he fills, she confirms, groceries generate).
- **Manual:** two phones, two accounts, one real week.

## Revision history
- **v0.7 (2026-11-02):** 2b-1 build notes under P0.4 (switch = `VITE_NEW_PREP_TABLE`; how the days are
  stored; tray rule).
- **v0.6 (2026-11-02):** D8 rewritten for option B (she picks the week's days with day
  buttons; next week starts with the same days). P0.4's "week-shape setting" = those buttons.
- **v0.5 (2026-11-02):** phase 2 split into 2a data / 2b screens / 2c switch-over (TASKS.md); P0.3 build
  notes (Maybe = no date, mirroring re-run). Open for the 2b mockup: Matt wants her to be able to show
  *fewer* days as well as more ("include more or less days to fit a changing schedule"); P0.4's
  "week-shape setting" vs D8's "no setting" is decided there.
- **v0.4 (2026-11-01):** her answers: Sun–Thu default with Fri/Sat on demand (D8, no
  setting); D3 confirmed; stopgap approved (OQ4 → PR #205).
- **v0.3 (2026-11-01):** added tested rollback scripts (D9, P0.9); corrected "nothing is
  lost" to "nothing more is lost" (non-goal 7, P0.3); merged calendar data and the new
  Prep Table into one phase to avoid a window of unmigrated plans.
- **v0.2 (2026-11-01):** switched to calendar planning (option A) after the lockout explorer;
  handoff before Confirm; uncooked meals stay + are suggested; Matt's recipes left out.
- **v0.1 (2026-11-01):** first draft (household only; handoff after Serve — withdrawn).
