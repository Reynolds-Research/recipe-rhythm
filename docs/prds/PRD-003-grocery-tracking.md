# PRD-003: Grocery Tracking

**Status:** Draft v0.1
**Author:** Matt
**Date:** 2026-04-25
**Sibling PRDs:** [PRD-001](./PRD-001-recipe-vault-and-cooking-record.md) — Recipe Vault & Cooking Record; [PRD-002](./PRD-002-meal-planning.md) — Meal Planning
**Related ADRs:** [ADR-001](../adr/ADR-001-planning-period-save-state.md) — Planning period save state schema (PRD-003 reads from this)

---

## 1. Problem Statement

Recipe-Rhythm's current "grocery list" is a 40-line block inside `BrainstormMode.jsx` that aggregates the planned recipes' categorical tags (Proteins, Carbohydrates, Vegetables, Dairy, Fruits) into Sets and downloads them as a `.txt` file. There are no quantities, no consolidation across recipes ("garlic" appearing in three meals lists three garlics, not one), no in-app interaction, no persistence, and no way to share the list with a spouse who's at the store. As a result, the planning flow ends at a dead end: the Planner serves the plan, gets a flat text dump, and the actual shopping happens entirely outside the app.

The user-visible goal: once a plan is served, generating a real grocery list should take one tap, the list should be a usable in-app document (checkable, editable, sectioned by store layout), and sharing it with a spouse should be one more tap producing a read-only link.

## 2. Current State (As Built)

| Surface | Status | Notes |
|---|---|---|
| In-component grocery export | `BrainstormMode.jsx:760-799` | Aggregates planned vault items' categorical arrays; deduplicates via `Set`; downloads as `GroceryList.txt`. No quantities, no consolidation logic, no persistence. |
| "Share plan via text" button | `BrainstormMode.jsx:728-741` | Uses `navigator.share()` for the native OS share sheet. Sends a raw text dump. No token, no URL, no read-only view. |
| AI proxy endpoints | `api-server.mjs` + `api/` (Vercel) | Two endpoints exist: `/api/analyze-recipe` (Sonnet 4.6), `/api/swap-suggestions` (Haiku 4.5). PRD-003 adds a third: `/api/grocery-list`. |
| Routing | `App.jsx` | `page` state + conditional rendering. **No React Router despite project instructions claiming v7 is in the stack.** Adding the first share-link route is a real architectural choice — see OQ.F. |
| Pantry staples / preferences | **Does not exist** | Will live in `household_preferences` table from PRD-002 (extending it with a `pantry_staples text[]` column). |
| Quantitative ingredients on vault | **Does not exist** | PRD-001 and PRD-002 explicitly deferred this to PRD-003. **PRD-003 v1 does NOT introduce them either** — Hybrid approach (Option D) treats AI as the consolidation engine; structured ingredients earn their way in over time as a P2 future. |
| Friend-sharing infrastructure | Decided 2026-04-18 (link-based, read-only, no login) | **Decided but never implemented.** PRD-003 is the first concrete consumer; the share-token / public-route pattern lands here and becomes reusable for Recipe and Plan sharing later. |

## 3. Goals

1. **Make grocery generation a one-tap experience** that produces a real, consolidated, sectioned list — not a categorical text dump.
2. **Make the list a first-class in-app document:** persistent, editable, checkable, with ad-hoc additions, scoped to a planning period.
3. **Make sharing trivial:** a read-only public URL the spouse can open in any browser, no login required.
4. **Honor pantry staples** so the user isn't told to buy salt every week.
5. **Group items by typical grocery section** (Produce, Meat & Seafood, Dairy, Pantry, Frozen, Other) for store-aisle navigation.
6. **Land the share-link pattern** as a reusable primitive so future Recipe-share and Plan-share features can plug in without re-inventing.

## 4. Non-Goals

1. **Structured per-recipe ingredients (`{name, quantity, unit}` arrays).** Hybrid approach (D): AI does the consolidation work; structured ingredients are a P2 future migration.
2. **Full pantry tracking with quantities.** Lite mode only — a simple "always have these, skip them" list. Real pantry tracking is P2.
3. **Real-time multi-user editing of the grocery list.** Spouse view is read-only in v1; collaborative editing is P2 (and depends on partner-collab ADR).
4. **Cost estimation / store-price lookups.** Out of scope.
5. **Store API integrations** (Instacart, AnyList, Mealime export). Out of scope.
6. **Subset-of-plan generation** ("just Tuesday and Wednesday's groceries"). Out of scope per intake — list mirrors the active period.
7. **Carry-over of unbought items into the next period's list.** Out of scope per intake. Items are list-scoped; ending a period archives the list as-is.

## 5. Target Users & User Stories

**The Planner (primary):** Just served the week's plan. Wants a list in 1 tap, with the spouse able to open it at the store.

**The Spouse (secondary, read-only):** Receives a link via text. Opens it on their phone at the store. Checks items off as they shop. *(In v1, "checking off" only persists for them locally — not synced to the Planner. Real sync is a P2 future.)*

**The Cook (cameo):** May edit the list ad-hoc ("we ran out of olive oil") between generation and shopping.

### Stories (priority order)

1. *As the Planner, after serving a plan, I want one tap to generate a consolidated grocery list grouped by store section, so shopping isn't a translation exercise.*
2. *As the Planner, I want my pantry staples (olive oil, salt, rice, etc.) skipped automatically, so I'm not nagged about things I always have.*
3. *As the Planner, I want to add ad-hoc items ("milk," "kid's breakfast bars"), so the list isn't strictly recipe-driven.*
4. *As either user, I want to check items off as I shop, so I can see what's left.*
5. *As the Planner, I want to share the list as a read-only URL, so my spouse can open it at the store without an account.*
6. *As the Spouse, I want to open the share link in any mobile browser, see a clean read-only list grouped by section, and tap items off locally as I shop.*
7. *As the Planner, I want to edit individual items if the AI got something wrong (e.g., "2 chicken breasts" → "4"), so I can correct without regenerating.*
8. *As either user, I want to revoke a share link, so I can stop a stale list from being viewable.*

### Edge cases

- Plan changes mid-period after the list has been generated and partially checked off. Recommendation: notify ("plan changed; regenerate?") rather than auto-blow-away. See OQ.B.
- AI returns a quantity in an unusual format ("a generous handful of basil"). Recommendation: store as a free-text quantity string in v1; structured units are a P2 concern.
- Spouse opens a share link after it's been revoked. Show a clean "this list was closed; ask the planner for a new link" state.
- User edits pantry staples mid-period. Recommendation: don't retroactively remove already-listed items — only affects future generations.
- Same item arrives via two recipes with different units ("1 cup flour" + "200g flour"). The AI should consolidate when possible, otherwise list both. See OQ.A.
- User regenerates the list — preserves their checkmarks where item names match? Recommendation: yes, best-effort match. See OQ.C.

## 6. Requirements

### Hard prerequisites (block this PRD)

| # | Requirement | Why |
|---|---|---|
| Pre-A | Active meal plan periods exist with `meal_plan_items.scheduled_date` populated. | Already shipped via ADR-001 Phase 1. |
| Pre-B | PRD-002 P0.1 (`household_preferences` table) shipped, **OR** PRD-003 creates a standalone `pantry_staples` table if PRD-002 hasn't shipped yet. | The cleanest home for `pantry_staples` is the existing preferences table. If we ship PRD-003 first, we either branch the schema (and merge later) or accept a tiny duplicate. |
| Pre-C | PRD-001 P0.6 (centralized constants in `src/lib/constants.js`) shipped. | The grocery-section enum lives there, used both by the AI prompt and the UI. |

### P0 — Must have

| # | Requirement | Acceptance criteria |
|---|---|---|
| P0.1 | **`grocery_lists` + `grocery_list_items` schema** | New tables (see §7). Owner-scoped RLS. `grocery_lists.share_token` is a unique nullable text column; null until the user shares. `meal_plan_id` FK with `ON DELETE SET NULL` so the list survives plan deletion. |
| P0.2 | **`pantry_staples text[]` field** on `household_preferences` (or a standalone table if Pre-B forces it) | Migration adds the column, default `'{}'`. Settings UI extended with a chip-list: "Always have these; skip on grocery list" — type-to-add pattern, free-text. |
| P0.3 | **`/api/grocery-list` LLM endpoint** | Accepts `{ recipe_names: string[], pantry_staples: string[], context: string }`. Prompt instructs the model to consolidate identical/similar items across recipes, group into the section enum, exclude any pantry staple, and return a JSON array of `{name, quantity, section, source_recipes[]}`. Uses Haiku 4.5 (cheap, fast). Vercel serverless mirror at `api/grocery-list.js`. Same security TODO as the other endpoints (see PRD-001 P1.6). |
| P0.4 | **GroceryList.jsx page (in-app)** | New page accessible from BrainstormMode after Serve, and from the bottom nav. Renders sections in canonical order; each section lists items with quantity badge; tap to toggle bought; ad-hoc-add input pinned at bottom. |
| P0.5 | **"Generate" / "Regenerate" action** | Calls `/api/grocery-list` with the active plan's recipe names + the user's pantry staples. On success, persists the response as a new `grocery_lists` row + items rows. Loading and error states. |
| P0.6 | **Section grouping + canonical section enum** | Sections defined in `src/lib/constants.js`: `['Produce', 'Meat & Seafood', 'Dairy', 'Pantry', 'Frozen', 'Bakery', 'Beverages', 'Other']`. AI prompt asked to map every item to one. Items with `section = 'Other'` rendered last. |
| P0.7 | **Ad-hoc add** | Text input ("Add an item…"). On submit, inserts a row with `is_adhoc=true`, `section='Other'` by default (or AI-suggested if we run a tiny one-shot — defer to P1). |
| P0.8 | **Mark item bought (toggle)** | Tap an item → `is_bought = true`, struck-through render. Tap again → unchecked. Persists immediately. |
| P0.9 | **Share-link infrastructure (NEW; reusable)** | Generate a `share_token` (32+ random chars, `gen_random_uuid()` or crypto-random) on first share request; persist on `grocery_lists.share_token`; expose at a public route `/share/grocery/:token`. Public route reads the list by token, renders the same section-grouped view in read-only mode (taps mark items bought *only in localStorage* on the spouse's device — no server write). |
| P0.10 | **Revoke share link** | "Revoke link" action sets `share_token = null`. Public route returns a "this list was closed" view when token is missing/invalid. |
| P0.11 | **Routing decision implemented** | Either: (a) add `react-router-dom` + introduce minimal route table (`/` for app, `/share/grocery/:token` for public read-only); (b) handle via URL query params on the existing single-page App.jsx. **Recommended: (a)** — earns its way in the moment we add the first public route. See OQ.F. |
| P0.12 | **Generated lists are scoped to a meal plan** | One active list per `meal_plan_id`. Regenerating updates the existing list (preserves checkmarks where names match — see OQ.C) instead of creating a duplicate. Listing-by-period uses `grocery_lists.meal_plan_id` for joins. |

### P1 — Nice to have

- **P1.1 Auto-prompt to regenerate when the plan changes mid-period.** Detect plan diff vs. list's `generated_at`; show inline banner: "Plan changed. Regenerate list?" Don't auto-blow-away.
- **P1.2 Edit individual items.** Tap → small inline editor for `name`, `quantity`, `section`. Useful when AI hallucinates ("2 lbs chicken breasts" when the recipe was 1 lb).
- **P1.3 Plain-text export.** Preserve the existing download-as-`.txt` for users who print or paste into other apps. Should be derived from the new structured list — formatted by section, not category.
- **P1.4 Custom section order per user.** Drag-to-reorder section headers; persisted in `household_preferences`. Mirrors the user's local store layout.
- **P1.5 Show source recipe per item.** A small "from: Pasta Carbonara, Caesar Salad" caption under each item. Helps the spouse understand context.
- **P1.6 "Re-add staple" override.** Even though olive oil is a staple, if it's running low, let the user manually add it back to this list with one tap. Doesn't change the global pantry staples list.

### P2 — Future considerations

- **P2.1 Structured per-recipe ingredients.** `vault.ingredients jsonb` with `{name, quantity, unit}` arrays. Migration off the AI generator onto a deterministic consolidation algorithm. Significant work; only do it once the Hybrid approach has shown which recipes get edited often enough to deserve it.
- **P2.2 Full pantry tracking.** A real pantry table with quantities, expiry dates, replenishment hints. The Lite mode is the on-ramp.
- **P2.3 Real-time spouse collaboration.** Spouse's checkmarks sync live to Planner via Supabase Realtime. Depends on partner-collab ADR.
- **P2.4 Cost estimation / receipt scanning / store-price lookup.** Adjacent territory; deserves its own ADR if pursued.
- **P2.5 Store integrations** (Instacart export, AnyList sync). External APIs; out of scope for the foreseeable future.
- **P2.6 Recipe-share + Plan-share use the same token pattern** introduced by P0.9. Once proven, refactor into a generic `share_tokens` table or polymorphic pattern.

## 7. Data Model Changes Summary

```sql
-- Migration A: grocery_lists
CREATE TABLE IF NOT EXISTS grocery_lists (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meal_plan_id    uuid        REFERENCES meal_plans(id) ON DELETE SET NULL,
  share_token     text        UNIQUE,
  generated_by    text        NOT NULL CHECK (generated_by IN ('ai','manual')) DEFAULT 'ai',
  generated_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grocery_lists_user_idx ON grocery_lists(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS grocery_lists_user_plan_idx
  ON grocery_lists(user_id, meal_plan_id) WHERE meal_plan_id IS NOT NULL;
ALTER TABLE grocery_lists ENABLE ROW LEVEL SECURITY;
-- Standard four owner-scoped policies on user_id, PLUS:
-- A public SELECT policy when share_token IS NOT NULL and matches the request:
CREATE POLICY grocery_lists_public_share ON grocery_lists
  FOR SELECT USING (share_token IS NOT NULL);
-- (Public route validates token in the query; RLS allows the read.)

-- Migration B: grocery_list_items
CREATE TABLE IF NOT EXISTS grocery_list_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grocery_list_id uuid        NOT NULL REFERENCES grocery_lists(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  quantity        text,                        -- free-text; AI output ("2 lbs", "1 bunch")
  section         text        NOT NULL DEFAULT 'Other',
  source_recipes  text[]      NOT NULL DEFAULT '{}',
  is_bought       boolean     NOT NULL DEFAULT false,
  is_adhoc        boolean     NOT NULL DEFAULT false,
  position        int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grocery_list_items_list_idx ON grocery_list_items(grocery_list_id);
ALTER TABLE grocery_list_items ENABLE ROW LEVEL SECURITY;
-- Owner-scoped policies + a public SELECT-via-list-token policy:
CREATE POLICY grocery_list_items_public_share ON grocery_list_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM grocery_lists l
      WHERE l.id = grocery_list_items.grocery_list_id
        AND l.share_token IS NOT NULL
    )
  );

-- Migration C: pantry staples on household_preferences
ALTER TABLE household_preferences
  ADD COLUMN IF NOT EXISTS pantry_staples text[] NOT NULL DEFAULT '{}';
```

Document each in `docs/schema.md`. Add a verification SQL file in `supabase/migrations/`.

**Section enum** lives in `src/lib/constants.js`:
```js
export const GROCERY_SECTIONS = [
  'Produce', 'Meat & Seafood', 'Dairy', 'Pantry',
  'Frozen', 'Bakery', 'Beverages', 'Other',
]
```
The `/api/grocery-list` prompt interpolates this list so the LLM can't return out-of-vocabulary sections.

## 8. AI Endpoint Design (`/api/grocery-list`)

**Request:**
```json
{
  "recipe_names": ["Pasta Carbonara", "Caesar Salad", "..."],
  "recipe_metadata": [{"name":"…","cuisine_type":"…","proteins":["…"]}, "..."],
  "pantry_staples": ["olive oil", "salt", "pepper", "rice"],
  "context": "5 dinners for a family of 4, week of 2026-04-26"
}
```

**Prompt skeleton:**
> Generate a consolidated grocery list for the recipes below. Group identical or near-identical items across recipes into a single line item. Estimate reasonable quantities for a family of 4. Group items by grocery store section, choosing exactly one of: [Produce | Meat & Seafood | Dairy | Pantry | Frozen | Bakery | Beverages | Other]. **Exclude these pantry staples entirely:** {staples}. Return ONLY a JSON array, no markdown, with this shape: `[{"name": str, "quantity": str, "section": str, "source_recipes": [str]}]`.

**Model:** Haiku 4.5 (fast, cheap, sufficient for this structured task).

**Failure mode:** if the model returns invalid JSON or a section outside the enum, the proxy returns a 502 and the UI shows a "couldn't generate; try again" state. No silent fallback to the old categorical-tag method.

## 9. Success Metrics

### Leading indicators (1–2 weeks post-launch)

- **List-generation completion rate** — % of "Generate" taps that produce a parseable list. Target: ≥ 95%.
- **In-app vs. text-export use** — % of generated lists that are *opened in-app at least once* (vs. a one-shot generate-and-forget). Target: ≥ 80%.
- **Share rate** — % of generated lists that get a share link generated. Target: ≥ 50% (proxy for "the spouse actually shops with this").
- **Pantry-staple adoption** — % of users with at least 3 staples set. Target: 100% (you, the test user) within first session.

### Lagging indicators (1–3 months)

- **Edit rate per list** — % of items edited or deleted post-generation. Target: low (< 15%) — high edit rate means the AI's quality is poor enough that a structured-ingredient migration deserves prioritization.
- **Spouse-side checkmark coverage** — anecdotal feedback from your wife: did she actually use the share link at the store, was it useful, what's missing.
- **Friction reduction** — Median time from "Serve plan" to "list shared with spouse" stays under 30 seconds.

## 10. Open Questions

| # | Question | Owner |
|---|---|---|
| OQ.A | Quantity field as free-text (LLM output verbatim) or structured `{value, unit}`? **Recommend:** free-text in v1 — moves the structured-ingredient migration to P2.1 where it can earn its way in. | Engineering |
| OQ.B | When the underlying meal plan changes mid-period, should we auto-regenerate the grocery list? **Recommend:** notify only ("plan changed — regenerate?"), don't auto-blow-away the user's checkmarks. | Product |
| OQ.C | When the user manually regenerates, do we preserve `is_bought` checkmarks for items whose `name` matches across versions? **Recommend:** yes, best-effort name-match — anything matched stays checked, anything unmatched defaults to unchecked. | Engineering |
| OQ.D | Share-token lifetime: never-expire (revoke-only), 7-day TTL, or 30-day TTL? **Recommend:** revoke-only for v1 (matches the TODOs decision). | Product |
| OQ.E | Do ad-hoc additions get sent to the LLM for section auto-categorization, or default to `'Other'`? Sending = +1 LLM call per add. **Recommend:** default to `'Other'` and let the user re-categorize via P1.2 edit. | Product |
| OQ.F | React Router or query-params-on-single-page? **Recommend:** add `react-router-dom`. The first share route is the ideal forcing function; defer-and-retrofit is more painful than add-now. | Engineering |
| OQ.G | When a planning period ends, what happens to its grocery list — soft-delete, archive flag, or just untouched? Today's schema leaves it untouched. **Recommend:** untouched + add an `is_archived boolean` in P1 if/when we build a list history view. | Product |
| OQ.H | Should the share-link pattern extend to meal plans next (a `/share/plan/:token` route + `meal_plans.share_token` column)? Cross-references P2.6. **Recommend:** defer until 30 days of real grocery-share use. The pattern proves itself (or doesn't) with the most-needed surface first; committing to plan-share before that is premature. Revisit when planning post-PRD-003 work. | Product |
| OQ.I | Should spouse-side check-offs sync back to the planner's view in real time (Supabase Realtime)? Currently localStorage-only on the spouse's device per the v1 simplification. Cross-references P2.3. **Recommend:** defer until the partner-collab ADR exists. Two-way sync needs an identity / auth model for the spouse, which the link-based no-login design intentionally avoids. The local-only model also has a usability upside (planner regenerating the list mid-shop doesn't blow away the spouse's progress). | Product |
| OQ.J | Should the public spouse view support ad-hoc additions, edits, or deletions — i.e., turn the share token into a write capability, not just a read capability? Adjacent to but distinct from P2.3. **Recommend:** defer with OQ.I — same partner-collab dependency, same anon-role-permissions security expansion (currently only SELECT is granted to the anon role on `grocery_lists` / `grocery_list_items`; adding INSERT/UPDATE for token-holders is a meaningful surface change). If shipped, do it together with OQ.I rather than as a piecemeal write capability. | Product |

## 11. Phasing & Timeline

PRD-003 is more contained than PRD-002 because it's greenfield (less schema-coexistence risk).

- **Phase 1 (P0.1, P0.3, P0.4, P0.5, P0.6, P0.8, P0.12):** Generate + render + check-off. Ships the core in-app experience without sharing. Earliest useful state.
- **Phase 2 (P0.2, P0.7, P0.10):** Pantry staples + ad-hoc additions. Local quality-of-life.
- **Phase 3 (P0.9, P0.11):** Share-link infrastructure + routing decision. **Net-new architectural work** — also unlocks future Recipe and Plan sharing.
- **Phase 4 (P1):** Polish (auto-regenerate prompt, individual-item edit, plain-text export, custom section order, source-recipe captions, staple override). Pick by demand.

**No hard cross-PRD blocker:** PRD-003 Phase 1 can ship even if PRD-002 hasn't shipped, by creating a standalone `pantry_staples` table (Pre-B variant). The clean path is to follow PRD-002, but PRD-003 can run independently if needed.

## 12. Testing Plan (Vitest + Playwright)

| Requirement | Test file | Test cases |
|---|---|---|
| P0.1 | `src/lib/__tests__/groceryListSchema.test.js` (new) | RLS: owner can SELECT own list; non-owner cannot; public route can SELECT when `share_token IS NOT NULL`. |
| P0.3 | `src/lib/__tests__/groceryListGenerator.test.js` (new) | Mocked LLM returns valid JSON → items inserted; invalid JSON → error state; staples excluded; out-of-vocab section → error. |
| P0.4 / P0.6 | `src/pages/__tests__/GroceryList.test.jsx` (new) | Section ordering matches enum; items grouped correctly; empty section hidden; loading/error states render. |
| P0.7 | extend GroceryList tests | Ad-hoc add inserts row with `is_adhoc=true`, default section `'Other'`. |
| P0.8 | extend GroceryList tests | Tap toggles `is_bought`; persists; UI strikes through. |
| P0.9 | `src/pages/__tests__/SharedGroceryList.test.jsx` (new) | Public route renders read-only view by valid token; invalid token shows "list closed" state; revoked token same. |
| P0.10 | extend share tests | Revoke action nulls `share_token`; subsequent public access fails gracefully. |
| P0.11 | `src/__tests__/routing.test.jsx` (new) | `/` renders auth/main app; `/share/grocery/:token` renders SharedGroceryList; bad token handled. |
| P0.12 | extend GroceryList tests | Regenerate updates existing list (same `meal_plan_id`); checkmarks preserved on name match. |

Add Playwright e2e: "Serve a plan → tap Generate → list appears with sections → tap Share → copy link → open link in incognito tab → list renders read-only → tap an item → checkmark only persists locally."

---

## Revision History

| Version | Date | Notes |
|---|---|---|
| v0.1 | 2026-04-25 | Initial draft, grounded in PRD-001 + PRD-002 + code review of `BrainstormMode.jsx` lines 728-799 (existing share + grocery code), `api-server.mjs`, `App.jsx`, and `package.json`. **Hybrid (D) approach confirmed** — AI generates the list; structured ingredients deferred to P2.1. **PRD-003 is the first concrete consumer of the share-link pattern** decided in TODOs but never built; lays the share-token primitive that future Recipe-share and Plan-share PRDs can reuse. **First introduction of `react-router-dom` is recommended (P0.11)** — the first public route is the right forcing function. |
| v0.2 | 2026-05-05 | Added OQ.H (extend share pattern to meal plans), OQ.I (sync spouse check-offs to planner via Realtime), OQ.J (allow spouse-side ad-hoc adds / edits) during P0.11 + P0.9 + P0.10 prompt review. All three were considered as candidate scope expansions of the share-link bundle and explicitly deferred — captured here so the next planning session revisits them rather than relying on conversational memory. Cross-references existing P2.3 + P2.6. |
