# PRD-007: Mid-Period Leftovers (Plan-Time Intent + Cook-Time Correction)

**Status:** Draft v0.1
**Author:** Matt (with Cowork planning assist)
**Date:** 2026-05-30
**Sibling PRDs:** [PRD-002](./PRD-002-meal-planning.md) — Meal Planning (provides `meal_plan_items` + Maybe-shortlist primitive); [PRD-003](./PRD-003-grocery-tracking.md) — Grocery Tracking (consumes the dedup behavior introduced here); [PRD-006](./PRD-006-structured-ingredients-and-household-scaling.md) — provides `vault.servings` and `household_preferences.adults/children` used for scaling math.
**Related ADRs:** [ADR-001](../adr/ADR-001-planning-period-save-state.md) — period model that already includes the existing `LeftoverPicker` for period-boundary leftovers.

---

## 1. Problem Statement

Today the app handles leftovers at exactly one moment: the boundary between two planning periods, via `LeftoverPicker`, which asks "what didn't you cook from last period?" before starting a new period. Inside a period — which is when most leftover behavior actually happens — the app is silent.

Three real-world behaviors go unmodeled:

1. **Planned leftovers (proactive intent).** "I'll cook a big chili Monday, we'll eat it again Wednesday." The household *intends* to cook once and eat twice. Today there's no way to express this; you'd have to schedule the same recipe on both days and accept that grocery list will double-buy ingredients.
2. **Cook-time correction (reactive).** "We made way more than expected — there's two more dinners' worth in the fridge." Discovered at the stove. Today there's no way to log this and have it influence the rest of the week.
3. **Opportunistic (the fridge tells you).** "There's half a pan of lasagna staring at me — let's call Thursday lasagna night." Same shape as #2 but decoupled from the moment of cooking.

The downstream consequence: the **grocery list double-buys** ingredients for any household that's planning around leftovers, because every scheduled meal is treated as a fresh cook. PRD-006's household-scaling math gets the per-meal portions right, but it doesn't know two scheduled meals are actually one batch.

The user-visible goal: leftovers should be a first-class concept in the plan, expressible at plan-time *and* cook-time, with the grocery list and the calendar honoring them automatically.

## 2. Current State (As Built)

| Surface | Status | Notes |
|---|---|---|
| `LeftoverPicker.jsx` | Shipped | Period-boundary only. Fires when `newPeriodStep === 'pick-leftovers'`. Asks the user to confirm which uncooked items from the prior period carry forward. Uses its own data shape (TBD — confirm during impl). |
| `meal_plan_items` table | Shipped | One row per `(scheduled_date, meal_plan_id)` slot. No concept of "this slot points to another slot." `is_shortlisted` (PRD-002 P0.6) covers the Maybe state. |
| `vault.servings` + `servings_inferred` | Shipped (PRD-006 P0.1) | Recipe yield, with AI inference fallback to 4 when unknown. Foundation for scaling. |
| `household_preferences.adults` + `children` | Shipped (PRD-006 P0.1) | Household size, used today to scale grocery quantities. Foundation for "how many servings does my household need per meal?" |
| Grocery list generation | Shipped (PRD-003 P0.3, PRD-006 P0.7) | `/api/grocery-list` already accepts per-recipe `servings` + `householdSize`. Scales quantities up/down per recipe. **Does not deduplicate across "this is the same batch."** |
| `LogMode.jsx` | Shipped | Voice-first daily log. The natural place to ask "any leftovers?" after a meal is logged. No such prompt today. |
| `BrainstormMode/MealPlanCard.jsx` | Shipped | Per-date meal slots. No affordance to express "this meal stretches to N nights." |
| Served-plan immutability | Shipped | `if (isServed) return` in `handleDragEnd` (and elsewhere) enforces that served plans can't be modified. **This rule will need a narrow exception for cook-time ghost-slot inserts** — see §6 P0.5. |

## 3. Goals

1. **Make planned leftovers a first-class concept.** "Cook for N nights" should be a one-tap affordance at plan-time, with auto-scaling of the source recipe and auto-creation of leftover-slot placeholders.
2. **Capture leftovers at the moment of cooking.** After logging a meal in LogMode, prompt "Any leftovers?" — a single-step path from observation to plan update.
3. **Make the grocery list honor leftovers automatically.** Zero duplicate ingredient purchases for planned-leftover days.
4. **Unify the period-boundary leftover concept with mid-period leftovers.** One data model, one mental model.
5. **Preserve served-plan immutability except for the narrow case of cook-time ghost-slot inserts.** A served plan is still locked for swaps, deletes, reorders — but cook-time correction is *allowed* to add ghost slots.

## 4. Non-Goals

1. **Leftover-of-leftover (3+ night chains) in v1.** Schema supports the FK chain, but the "Stretch to N nights" UI is capped at 3 and doesn't expose chained semantics. P1 if usage justifies.
2. **Multi-day expressive UI ("eat leftovers OR cook fresh, decide at dinner").** Households often pivot at dinnertime, but expressing both options on a single day adds a lot of UI complexity. v1 commits to one or the other; switching is a swap action. P2.
3. **Leftover quality tracking ("was the leftover any good?").** Out of scope. Per-meal notes (PRD-001 P1.2) can carry this when shipped.
4. **Cross-household leftover coordination.** Single-household scope, same as every other PRD.
5. **Predictive "this recipe always makes leftovers" learning.** No ML over time. v1 is explicit-user-action only.
6. **Replacing the existing recommendations or scoring logic.** Ghost-slot days are simply skipped by the recommender (they already have a meal); no change to scoring.

## 5. Target Users & User Stories

**The Planner (primary):** Sets up the week. Wants to express "make extra Monday" without manually duplicating recipes or fighting the grocery list.

**The Cook (primary):** Realizes mid-cook that there's extra food. Wants a frictionless way to say "save this for Wednesday."

### Stories (priority order)

1. *As the Planner, when I'm scheduling Monday's chili, I want a "cook for 2 nights" affordance that auto-fills the next open day with a leftover slot, so I don't have to schedule the same recipe twice manually.*
2. *As the Planner, when I plan leftovers, I want the grocery list to scale the source recipe and skip the leftover day, so I don't buy ingredients twice.*
3. *As the Cook, after I log Monday's dinner in LogMode, I want a one-tap prompt "Any leftovers?" with day picker, so capturing leftovers is part of the same flow as logging.*
4. *As the Planner, when I look at the week, I want leftover days to render visually distinct from fresh-cook days, so I know what's actually happening that night without reading carefully.*
5. *As the Planner, when I tap a leftover slot, I want to see what it's linked to and have the option to "swap to fresh cook" if our plan changes.*
6. *As the Planner, when starting a new period, I want the existing leftover-picker flow to keep working — but built on the same primitive as mid-period leftovers, so the two concepts behave consistently.*
7. *As the Cook, when I declare leftovers for a day that already has a meal scheduled, I want the existing meal moved to Maybe (not silently overwritten), so I never lose planning work.*

### Edge cases

- **Stretch to N nights when there aren't N open days.** UI should disable counts that would exceed open days, or warn ("Wednesday and Thursday are full — leftovers will bump those meals to Maybe").
- **Cook-time leftover prompt on a served plan.** The plan is locked; the ghost-slot insert is the *only* allowed mutation. Schema/policy must permit this narrow case.
- **User declares "leftovers for Wednesday" but Wednesday is already a ghost slot from another source.** Two leftover sources competing for one day. v1: collision rule (bump existing to Maybe) still applies; the new ghost slot wins. Edge case worth surfacing in QA.
- **The source meal is deleted after a ghost slot is created.** Must cascade or convert. Recommend `ON DELETE CASCADE` on the FK — deleting the source removes the ghost. UI should warn before delete.
- **Migrating existing `LeftoverPicker` data.** Confirm the current data shape during implementation; one-shot migration converts existing leftover rows to ghost-slot rows.
- **Recipe with `servings_inferred = true` and unknown true yield.** "Cook for 2 nights" math assumes the inferred 4. If the user later corrects servings, ghost slots stay valid but scaling re-runs on next grocery generation.

## 6. Requirements

### Hard prerequisites (block this PRD)

| # | Requirement | Why |
|---|---|---|
| Pre-A | PRD-002 P0.6 shipped (`is_shortlisted` + Maybe primitive). | The collision rule "bump existing meal to Maybe" requires the Maybe primitive. Already shipped. |
| Pre-B | PRD-006 P0.1 + P0.7 shipped (`vault.servings`, `household_preferences.adults/children`, grocery-list scaling). | The plan-time scaling math depends on these. P0.1 shipped; P0.7 shipped. |
| Pre-C | PRD-003 P0.5 shipped (grocery-list generate/regenerate flow). | Dedup logic lives at grocery-list generation time. Already shipped. |

All prerequisites are met as of 2026-05-30 per `docs/STATUS.md`.

### P0 — Must have

| # | Requirement | Acceptance criteria |
|---|---|---|
| P0.1 | **Schema: `leftover_source_id` FK on `meal_plan_items`** | Migration adds `meal_plan_items.leftover_source_id uuid REFERENCES meal_plan_items(id) ON DELETE CASCADE`, nullable. Index on `(meal_plan_id, leftover_source_id) WHERE leftover_source_id IS NOT NULL`. CHECK constraint: a ghost slot (`leftover_source_id IS NOT NULL`) must have `vault_id IS NULL` (the source has the vault link; the ghost just points to source). Or alternatively, ghost slots inherit `vault_id` for query convenience — decide during impl (see OQ.A). Verify SQL pairs with migration. RLS unchanged (owner-scoped on `user_id` still holds). Document in `docs/schema.md`. |
| P0.2 | **Plan-time "Stretch to N nights" picker on meal cards** | In `BrainstormMode/MealPlanCard.jsx` (or a sub-component), each assigned meal slot gains a small "Stretch to [1] [2] [3] nights" control (or a tap-to-open mini-sheet). Default = 1 (no stretch). Selecting N > 1 creates `(N - 1)` ghost slots on the next `(N - 1)` open days, scales the source recipe (no DB write to `vault`; scaling lives in the grocery prompt math), and refreshes the card. Disabled state when fewer than `(N - 1)` open days remain. |
| P0.3 | **Cook-time "Any leftovers?" prompt in LogMode** | After successfully logging a meal in LogMode, a follow-up sheet appears: "Any leftovers from [meal name]?" with options: `No` (dismisses, no further action), `Yes` (reveals: N servings input + day picker showing the active plan's days with empty days highlighted). Confirming creates a ghost slot on the chosen day with `leftover_source_id` pointing to the just-logged meal's `meal_plan_items.id` (if it exists) or its `meals.id`. Sheet is skippable (one-time "Don't ask again" toggle stored in `user_preferences` or localStorage — decide during impl). |
| P0.4 | **Visual differentiation for ghost slots on the calendar/plan** | Ghost slots render distinctly: faded card, smaller font, prefix label "← Leftovers: [Source Meal Name] (from [day])". Tap → expands to show source meal's notes/rating/source URL. Includes a "Swap to fresh cook" action that converts the ghost slot back to a regular slot (clears `leftover_source_id`, opens the standard day-picker for a new recipe). |
| P0.5 | **Served-plan exception: allow ghost-slot inserts on served plans** | The current `if (isServed) return` guard in `handleDragEnd` / equivalent stays in place for *all other mutations*. Cook-time ghost-slot inserts (via P0.3 prompt) bypass this guard. Implementation: a dedicated `createGhostSlot(supabase, userId, sourceId, targetDate)` writer in `mealPlanWriter.js` that does NOT check `isServed`. Document the policy in a comment block on the writer. |
| P0.6 | **Day collision: ghost-slot insert bumps existing meal to Maybe** | If the target day for a new ghost slot already has a meal, the existing `meal_plan_items` row gets `is_shortlisted = true` + `scheduled_date = null` (the existing Maybe primitive from PRD-002 P0.6) and the new ghost slot is inserted. No confirmation dialog — silent + reversible. User can promote back from Maybe if they change their mind. Behavior matches the search-to-plan collision rule from PRD-002 v0.3 §P0.18. |
| P0.7 | **Grocery list dedup: skip ghost-slot rows; scale source by N nights** | `/api/grocery-list` prompt builder: when assembling the recipe list, skip rows where `leftover_source_id IS NOT NULL`, and for each remaining row compute `n_nights = 1 + count(ghost slots where leftover_source_id = row.id)`. Pass `n_nights` to the prompt; the existing PRD-006 P0.7 scaling math multiplies `(householdSize / servings) * n_nights`. Acceptance: a plan with chili Mon + leftovers Wed generates a list with chili ingredients sized for 2 nights and no second chili entry. |
| P0.8 | **Unify `LeftoverPicker` to use the ghost-slot primitive** | `LeftoverPicker` rewritten so that confirming a carry-over leftover at period boundary creates a ghost slot in the *new* period's first open day, with `leftover_source_id` pointing to the source slot in the *prior* period. The picker UI may stay largely unchanged; what changes is the data shape it produces. One-shot migration script `scripts/migrate-existing-leftovers-to-ghost-slots.mjs` converts existing leftover data to the new shape (see OQ.B for current shape). Old `LeftoverPicker`-specific tables/columns deprecated; cleanup in a follow-up. |

### P1 — Nice to have

- **P1.1 Smart-stretch suggestion banner.** When the user assigns a meal whose `vault.servings × estimated household serving size` clearly exceeds one night's needs (e.g., recipe serves 6, household = 3), show a soft prompt: "This recipe serves 6 — stretch to 2 nights?" One-tap confirm; no banner if dismissed.
- **P1.2 Leftover-of-leftover chains (3+ nights).** Allow N = 4, 5 in "Stretch to N nights" picker. FK chain already supports it; v1 UI just doesn't expose it.
- **P1.3 Leftover history on the source meal.** When viewing a vault recipe, show "Cooked in batches X times" / "Average leftovers: N servings" — derived insight from ghost-slot history.
- **P1.4 Cook-time prompt opt-out per-recipe.** "Don't ask about leftovers for [Mac & Cheese]" — recipes that never leave leftovers in this household.
- **P1.5 Opportunistic standalone surface.** A "Got leftovers?" button on the Prep Table for the fridge-surprise case (#3 in §1) — same data path as the cook-time prompt, just decoupled from the LogMode flow.
- **P1.6 "Eat leftovers OR cook fresh" coexistence on a single day.** A day can hold both a ghost slot and a regular meal, marked as alternatives. Pick at dinnertime. (Pulled forward from §4 Non-Goals if usage data suggests demand.)

### P2 — Future considerations

- **P2.1** Predictive leftover suggestions from cooking-batch history (ML over time).
- **P2.2** Quality-of-leftover tracking (was the reheated version any good?). Could fold into per-meal notes (PRD-001 P1.2).
- **P2.3** Leftover freshness countdown ("This leftover slot is 4 days from cook date — eat soon").
- **P2.4** Multi-source ghost slots (one day combines leftovers from two different sources).
- **P2.5** Pantry-integrated leftover tracking — when PRD-003 evolves to track pantry inventory, leftover slots become a special inventory category with countdown.

## 7. Data Model Changes Summary

One migration; small and idempotent.

```sql
-- Migration: meal_plan_items.leftover_source_id
ALTER TABLE meal_plan_items
  ADD COLUMN IF NOT EXISTS leftover_source_id uuid
    REFERENCES meal_plan_items(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS meal_plan_items_leftover_source_idx
  ON meal_plan_items (meal_plan_id, leftover_source_id)
  WHERE leftover_source_id IS NOT NULL;

-- Optional CHECK (decide during impl per OQ.A):
-- ALTER TABLE meal_plan_items
--   ADD CONSTRAINT meal_plan_items_ghost_slot_no_vault
--     CHECK (leftover_source_id IS NULL OR vault_id IS NULL);
```

Document in `docs/schema.md`. Add `verify_<timestamp>.sql` confirming:
1. Column exists, nullable, with FK + cascade.
2. Index exists.
3. RLS unchanged on the table.
4. Inserting a ghost slot with a non-existent `leftover_source_id` fails the FK.
5. Deleting a source row cascades to its ghosts.

## 8. Behavior Changes Summary

### `mealPlanWriter.js`

- New: `createGhostSlot(supabase, userId, sourceId, targetDate)` — inserts a ghost row pointing to `sourceId`; does NOT check `isServed`; handles the Maybe-bump collision rule.
- New: `convertGhostSlotToFresh(supabase, userId, ghostId)` — clears `leftover_source_id`, opens the slot for a new vault assignment.
- Modified: `deleteMealPlanItem` — when called on a source slot with dependent ghost slots, the FK cascade handles it automatically; UI should warn first.

### `mealPlanReader.js`

- Modified: query that builds the per-day plan view now joins on `leftover_source_id` to fetch source metadata for display in ghost slots.

### `/api/grocery-list` (and `api-server.mjs` mirror)

- Modified prompt builder: skip ghost-slot rows in the recipe list; compute `n_nights` for each surviving row; pass to prompt. The existing PRD-006 P0.7 scaling formula multiplies through naturally.

### `BrainstormMode/MealPlanCard.jsx` + new `StretchPicker.jsx`

- New sub-component handles the "Stretch to N nights" UI.
- Modified card rendering: ghost slots get a distinct visual treatment.

### `LogMode.jsx`

- After a successful log, surface the leftover-prompt sheet conditionally (skip if user has dismissed for that meal or globally).

### `LeftoverPicker.jsx`

- Rewritten to write ghost-slot rows in the new period instead of whatever data shape it uses today.

## 9. Success Metrics

### Leading indicators (1–2 weeks post-launch)

- **Plan-time stretch adoption** — % of brainstorm sessions where the Planner used "Stretch to N nights" at least once. Target: ≥ 30%.
- **Cook-time prompt acceptance** — % of LogMode "Any leftovers?" prompts that result in a ghost slot (vs. dismissed). Target: ≥ 25%.
- **Grocery dedup correctness** — Zero double-buy incidents in grocery lists generated from plans containing ghost slots. Target: 100% (measured by manual spot-check + automated test).
- **LeftoverPicker continuity** — Period-boundary leftover flow works identically from the user's POV after the rewrite (no regression complaints).

### Lagging indicators (1–3 months)

- **Reduction in "I forgot we had leftovers" cooking** — Qualitative; check in casually with wife.
- **Grocery spend impact** — Quantitative if trackable elsewhere; otherwise qualitative ("noticeably less food waste").
- **Period-boundary smoothness** — End-of-period review (PRD-002 / ADR-001) shows fewer "uncooked" items that were actually leftover-eaten.

## 10. Open Questions

| # | Question | Owner |
|---|---|---|
| OQ.A | Should ghost slots carry `vault_id` (inherited from source for query convenience) or `NULL` (source is the single source of truth)? Recommend `NULL` + a view/RPC that joins source for display. | Engineering — decide during impl |
| OQ.B | What is the current data shape of `LeftoverPicker`-produced leftover rows? Need to audit before writing migration script. | Engineering — first step of impl |
| OQ.C | When a user dismisses the cook-time prompt with "Don't ask again," is that global or per-recipe? Recommend two separate toggles (global = settings, per-recipe = checkbox in the prompt sheet). | Product — confirm |
| OQ.D | Should "Stretch to N nights" auto-pick the next open day, or always require the user to pick? Recommend auto-pick with one-tap override (faster path; user can always adjust). | Product — confirm |
| OQ.E | Should grocery-list regeneration auto-trigger when a ghost slot is added/removed, or rely on the user to regen manually? PRD-003 has auto-regen as a P1; this PRD may bump that into a dependency. | Cross-PRD — decide with PRD-003 P1 |
| OQ.F | What happens to a ghost slot if its source meal is moved to a different day (swap)? Recommend: the ghost slot follows the source's date math (e.g., always "source date + 2 days"), OR the ghost slot becomes orphaned and prompts the user. Latter is safer but more interruptive. | Product — confirm |
| OQ.G | Cook-time prompt: what if the meal logged in LogMode is *not* on the active meal plan (ad-hoc cook)? Recommend: skip the prompt (no plan to add a ghost slot to), OR allow ghost slot creation in the active plan even without a source row. Latter is more flexible. | Product — confirm |

## 11. Phasing & Timeline

PRD-007 is conceptually bigger than search but mechanically simpler. Four phases, each independently shippable.

- **Phase 1 (P0.1, P0.8 schema half + migration script):** Schema migration + audit-and-migrate existing `LeftoverPicker` data. **Single PR, behind a feature flag.** Validates the data model before any UI changes.
- **Phase 2 (P0.2, P0.4, P0.6):** Plan-time "Stretch to N nights" picker + ghost-slot rendering on calendar/plan + collision-to-Maybe behavior. Most visible UX work. Includes the cross-PRD collision rule consistency with PRD-002 v0.3 §P0.18.
- **Phase 3 (P0.3, P0.5):** Cook-time prompt in LogMode + served-plan exception writer. Smaller surface area; touches LogMode + writer only.
- **Phase 4 (P0.7, P0.8 UI half):** Grocery-list dedup wiring + `LeftoverPicker` UI rewrite (using the now-stable ghost-slot primitive). The dedup is critical for the user-visible value of the whole feature.

**Block on PRD-003 P1?** P0.7 dedup works on whatever the next grocery generation is — the user has to regen manually unless PRD-003 P1 (auto-regenerate prompt) ships. Recommend including a small "Regenerate grocery list?" nudge whenever a ghost slot is created/removed, as a tactical bridge before PRD-003 P1 lands.

## 12. Testing Plan (Vitest + Playwright)

| Requirement | Test file | Test cases |
|---|---|---|
| P0.1 schema | `supabase/migrations/verify_<timestamp>_leftover_source_id.sql` | Column exists with FK + cascade; insert ghost slot succeeds; insert with bad source_id fails FK; deleting source cascades to ghost. |
| P0.2 stretch picker | `src/pages/BrainstormMode/__tests__/StretchPicker.test.jsx` (new) | Tapping "Stretch to 2" creates one ghost slot on next open day; disabled when no open days; correct number of ghost slots created for N=3. |
| P0.3 cook-time prompt | `src/pages/__tests__/LogMode.leftoverPrompt.test.jsx` (new) | After successful log, prompt sheet appears; "No" dismisses; "Yes" + day pick creates ghost slot; "Don't ask again" stores preference. |
| P0.4 ghost-slot rendering | extend `src/pages/BrainstormMode/__tests__/BrainstormMode.test.jsx` | Ghost slots render with distinct styling; tap expands; "Swap to fresh cook" converts. |
| P0.5 served-plan exception | `src/lib/__tests__/mealPlanWriter.ghostSlot.test.js` (new) | `createGhostSlot` writes to a served plan successfully; `handleDragEnd` still blocked on served plan. |
| P0.6 collision-to-Maybe | extend `mealPlanWriter.ghostSlot.test.js` | Ghost-slot insert on filled day bumps existing meal to Maybe (`is_shortlisted = true`, `scheduled_date = null`); ghost slot occupies the date. |
| P0.7 grocery dedup | `src/lib/__tests__/groceryListPrompt.test.js` (extend or new) | Plan with chili Mon + leftovers Wed produces prompt with chili line annotated `n_nights = 2`; second chili row absent; quantity scales correctly via PRD-006 P0.7 math. |
| P0.8 LeftoverPicker rewrite | extend `src/components/__tests__/LeftoverPicker.test.jsx` | Carry-over creates ghost slot in new period with FK to old period source; UI behavior unchanged from user POV. |
| Migration script | `scripts/__tests__/migrate-existing-leftovers-to-ghost-slots.test.js` (new) | Mock old data shape; run migration; assert ghost-slot rows produced; idempotent re-run is a no-op. |

Playwright e2e: "plan chili Monday → stretch to 2 nights → verify Wednesday shows ghost slot → generate grocery list → verify single chili entry sized for 2 nights."

---

## Revision History

| Version | Date | Notes |
|---|---|---|
| v0.1 | 2026-05-30 | Initial draft. Authored in Cowork planning session after feature feedback on (1) search-to-plan, (2) drag regression, (3) mid-period leftovers. Captures three real-world leftover behaviors (planned, cook-time correction, opportunistic) into a unified data primitive (ghost slot with FK to source). Unifies the existing period-boundary `LeftoverPicker` with the new mid-period flows. Hard prerequisites on PRD-002 P0.6 (Maybe primitive) and PRD-006 P0.1 + P0.7 (servings + household-scaling math) — all shipped per `docs/STATUS.md` as of authoring. |
