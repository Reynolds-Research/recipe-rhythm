# Recipe Rhythm — North Star

> Ratified by Matt on 2026-10-31 in a facilitated session. This page comes first: it decides which
> specs get written; specs do not change it. Changing the goal, criteria or non-goals is Matt's call —
> agents propose edits, they don't make them. The monthly PRD-drift audit
> (`audits/prompts/11-prd-drift.md`) checks the project against "Signs we're drifting" below.
>
> Every line is tagged. **CONFIRMED** = Matt said it (or relayed it from his wife).
> **INFERRED** = the facilitator's wording or judgment, reviewed by Matt but not his words.

## Who it's for

- The primary user is Matt's wife. She plans the meals nearly every week and leads the shopping. (CONFIRMED)
- Matt is the secondary user: he cooks about two nights a week and adds to her plan; she drives. (CONFIRMED)
- When her needs conflict with what a stranger would need, hers win. (CONFIRMED)
- Other households may use it if they find it valuable, but it is not built for them. (CONFIRMED)
- It is already a decent portfolio piece; the only rule is that building must not make it a worse one. (CONFIRMED)

## The job it does

- She authors the week; Recipe Rhythm checks it and helps her finish it. It is a checker and a
  gap-filler, not a chef. (INFERRED)
- She lays the chosen meals across the week to check it makes sense: no repeats, nothing too
  similar, every day covered. (CONFIRMED)
- The grocery list covers everything on the week's plan, so no dinner arrives unprepared.
  Groceries are ordered for delivery from Whole Foods. (CONFIRMED)
- Recommendations fill the gaps in a partial plan — including Matt's nights — and replace weak
  spots she sees once the week is laid out. (CONFIRMED)
- Tracking is memory for her future planning, not nutrition. (CONFIRMED)
- She used it weekly until it broke and stopped being maintained. Reliability is the price of
  entry. (CONFIRMED)

## Goal

> **Every week she plans is fully covered, varied, and shopped for — and when it isn't,
> Recipe Rhythm helps her close the gaps, including my nights, so the plan never stalls.**

(CONFIRMED — approved by Matt; wording drafted by the facilitator from his phrases.)

What matters most to her, in her order (CONFIRMED):
1. The plan doesn't stall waiting on Matt's contributions.
2. Variety within the week (repeats across weeks matter much less).
3. Never unprepared for a dinner.
4. Lower mental load.
5. Time saved — a result of the others, not a separate goal.

Food waste and eating better were not important to her; she already has healthy eating handled. (CONFIRMED)

Shape: the week checker is the base and matters most; gap-filling is the AI's job; the full
plan → shop → cook → remember loop is the long-term horizon, not the goal. (CONFIRMED)

## Success criteria

Outcomes for her, each checkable by someone other than Matt. Criteria CONFIRMED;
measurement methods and targets INFERRED and approved by Matt.

1. **She plans in the app.** Every non-vacation week has a finalized plan in Recipe Rhythm.
   *Measure:* finalized ("served") weeks ÷ non-vacation weeks, rolling 8 weeks. *Target:* 7 of 8.
2. **Never unprepared.** No planned dinner is missing ingredients from the grocery order.
   *Measure:* a one-tap weekly check-in ("Anything missing this week? Which dinner?") logged in the
   app. *Target:* zero misses per month.
3. **Variety within the week.** No finalized week contains a repeat or near-repeat she didn't
   intend. *Measure:* the app flags repeats/similar meals before she finalizes; an "intended"
   override counts as fine. Count weeks finalized with an unresolved flag. *Target:* zero.
4. **The plan doesn't stall on Matt.** His nights are filled in the app without holding her up,
   and the plan is finalized there, not over text. *Measure:* days from her starting the week to
   Matt's slots filled, plus a monthly yes/no from her: "Did you finalize anything outside the app
   this month?" *Target:* Matt's slots filled within 2 days; her answer is "no."
5. **Lower mental load.** *Measure:* a monthly 1–5 rating from her: "How much did you have to keep
   in your head to plan this month?" *Target:* holds or improves against the first rating.

Some of these need small pieces of tracking that don't exist yet (the check-in, the repeat flag,
the monthly questions). Building those is in scope; the North Star says what to instrument. (INFERRED)

## Principle: every feature earns its keep

A feature ships only if it clearly helps her weekly plan, and stays only while it keeps working.
A feature that breaks or goes unused gets fixed or removed — it doesn't get to linger.
(Intent CONFIRMED; wording INFERRED, approved.)

## Non-goals

1. **No autopilot that plans the whole week.** She authors the week; the AI fills gaps. Protects
   her ownership and keeps suggestions aimed at the real need. (CONFIRMED)
2. **No nutrition or diet coaching.** She already has healthy eating handled. Matt's calorie
   export may come later only if it adds zero logging work for her. Protects her tracking from
   getting heavier. (Non-goal CONFIRMED; zero-cost condition INFERRED.)
3. **No coordination or chat platform.** The app holds the shared plan — including Matt's slots —
   so both can see and finish it there; it does not host the conversation (no chat, threads or
   notification system). Protects against building messaging when the real problem is a
   bottleneck. (CONFIRMED)

## Not now (deferred, not banned)

- Building for other households or for growth. (CONFIRMED)
- A recipe collection or discovery feed built for its own sake. (CONFIRMED)

These come back only after the weekly loop has met the success criteria for 3 straight months. (INFERRED)

## Signs we're drifting (monthly audit)

- She planned a week outside the app. (CONFIRMED)
- A grocery order missed ingredients for a planned dinner. (CONFIRMED)
- We discussed or finalized the plan outside the app instead of within it. (CONFIRMED)
- A bug that blocks planning or the grocery list stayed open more than a week. (INFERRED)
- A week was finalized with an uncovered day or an unintended repeat. (INFERRED)
- Her plan waited on Matt's nights for most of a week. (INFERRED)
- More build time went to new features than to the weekly loop, and she didn't ask for them. (INFERRED)
- A feature shipped in the last 90 days that she hasn't used. (INFERRED)

## How to use this page

- A new spec must name the success criterion it moves. If it moves none, it doesn't get written. (INFERRED)
- When a spec and this page disagree, this page wins until Matt changes it. (INFERRED)
