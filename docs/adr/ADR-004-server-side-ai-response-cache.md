# ADR-004: Server-side cache for deterministic AI endpoints

**Status:** Proposed
**Date:** 2026-05-06
**Deciders:** Matt (El Presidente)
**Related:** PRD-004 (`/api/classify-ingredients`); LogMode + Vault add flows (`/api/normalize-meal-name`)

---

## Context

The app makes paid Anthropic API calls from five server endpoints (`/api/analyze-recipe`, `/api/swap-suggestions`, `/api/grocery-list`, `/api/classify-ingredients`, `/api/normalize-meal-name`). Two of these — `classify-ingredients` and `normalize-meal-name` — have an important property: their outputs are deterministic in the input.

`classify-ingredients` is keyed on the pair (recipe name, ingredient name). The system prompt's reasoning is driven by these two strings; the same pair should always classify the same way. (PRD-004's Phase B accuracy work treated this as a stable property — there's a ground-truth fixture, and the prompt is tuned to be deterministic per pair.)

`normalize-meal-name` is keyed on the user's raw input string. Same input → same Title-Cased + spell-corrected output.

Today every request hits Anthropic, even when the same answer was computed for a previous user (or the same user) seconds, hours, or days ago. The cost is small per call but compounding: every recipe save triggers `analyze-recipe`, which internally calls `classify-ingredients` over every ingredient. A vault of 100 recipes ≈ 100 classify rounds, each ~12 ingredients ≈ 1,200 ingredient-classifications, which the AI redoes from scratch every time `re-extract` is invoked or a similar recipe is added by another user.

The user is in the early stages of an evolving cost model and wants to reduce API spend without reducing functionality. After brainstorming alternatives (including community-sourced suggestions, which were ruled out as a cost lever — see chat history), persistence of past AI answers emerged as the highest-ROI change.

### Forces at play

- **Single-household app.** Scale is small. Cross-user contention isn't a concern.
- **Existing Supabase footprint.** RLS is owner-scoped on every existing table. The app has never previously needed a cross-user table.
- **Existing service-role pattern.** `scripts/backfill-*.js` already uses `SUPABASE_SERVICE_ROLE_KEY` for cross-user maintenance. The pattern is established.
- **API server has no Supabase coupling today.** Adding it is meaningful but not unprecedented (the scripts already do).
- **Cache poisoning risk.** Anyone with the public anon key could insert garbage into a writable cache table, corrupting answers for everyone.

---

## Decision

Add **two server-side cross-user shared cache tables**:

- `public.ingredient_classifications_cache` — keyed on `(recipe_name_norm, ingredient_name_norm)`, value is `essentiality`.
- `public.meal_name_normalizations_cache` — keyed on `input_norm`, value is `corrected`.

Both tables:

1. **Cross-user shared.** No `user_id` column; one row serves all users. Maximizes hit rate.
2. **Open SELECT to `authenticated, anon`.** Cache contents are non-sensitive ("salt is essential" isn't private).
3. **No INSERT/UPDATE/DELETE policies.** The deliberate absence is the security boundary. Writes happen only via the `SUPABASE_SERVICE_ROLE_KEY` on the API server, which bypasses RLS. Anon-key holders cannot poison the cache.
4. **First-answer-wins.** UNIQUE constraints on the cache key, plus `INSERT … ON CONFLICT DO NOTHING` semantics in application code. Once an answer is cached, it stays. Stale-answer correction is handled by user override (for ingredient classifications, via PRD-004 Phase D's tap-to-flip UI) or by manual cache invalidation if the prompt is materially changed.
5. **Graceful degrade when env vars are missing.** `api/_lib/supabaseAdmin.js` exports `null` if `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is absent. Cached endpoints fall through to uncached behavior — they still work, they just don't read or write the cache. Forgotten Vercel env config is never user-visible.

### Server-side architecture

`api/_lib/supabaseAdmin.js` exposes a singleton service-role Supabase client + a `normalizeForCache()` helper.

`api/_lib/classifyIngredientsCached.js` wraps `classifyIngredients()` (the underlying pure function in `src/lib/`):

1. Normalize inputs.
2. Look up all `(recipe_name_norm, ingredient_name_norm)` pairs in one query.
3. **Full hit:** return synthesized result, no AI call.
4. **Partial or full miss:** call AI with the **full** original ingredient list (so context-dependent rules — compound names, "with X" patterns, protein-variant rule — still work). Merge: cache wins for hits; AI fills the rest. Write the misses back via upsert with `ignoreDuplicates: true`.
5. Cache read or write errors are logged and swallowed — they must never fail a request.

`api/_lib/normalizeMealNameHandler.js` (also new — extracted from inline routes) does the same dance for its single-string-in / single-string-out shape.

Both wrappers are pass-throughs when `supabaseClient` is null.

---

## Options Considered

### Option A: Cross-user shared cache (chosen)

Already described above. One row per unique (recipe, ingredient) pair, shared across all users.

| Dimension | Assessment |
|---|---|
| Hit rate | Highest (every user benefits from every prior classification across the entire user base) |
| Privacy | No issue (data is not user-specific) |
| Schema cost | One new table per endpoint (2 total) |
| Architectural change | Adds Supabase client to API server — moderate (precedent in scripts) |

### Option B: Per-user owner-scoped cache

Same shape, but with a `user_id` column and RLS matching every other table. Each user accumulates their own classifications.

| Dimension | Assessment |
|---|---|
| Hit rate | Low until a single user has classified many recipes |
| Privacy | Strictly safer, but the data isn't sensitive enough to need it |
| Schema cost | Same |
| RLS complexity | Higher (insert/update policies needed) |
| Architectural change | Same as Option A |

Rejected because the data is non-sensitive. The privacy upside doesn't outweigh the hit-rate downside.

### Option C: Client-side cache

Have the browser look up Supabase before calling `/api/*`, write back after.

| Dimension | Assessment |
|---|---|
| Server-side coupling | None |
| Latency on hit | Lowest (client → Supabase only, no API server hop) |
| Coverage | **Doesn't work for `classify-ingredients`.** That endpoint is never called by the client directly — `analyze-recipe` calls it internally on the server. Client-side caching can't intercept it. |

Rejected because half the value (cost reduction on classify-ingredients, the dominant cost driver) would require a server-side cache anyway. Doing both layers would complicate the design without clear benefit.

### Option D: Hybrid global with per-user override

Global cache by default, plus a per-user override table for users who disagree (e.g. "in MY recipes, cilantro is essential").

| Dimension | Assessment |
|---|---|
| Functionality | Already provided by PRD-004 Phase D's vault-recipe-level override UI; redundant here |
| Complexity | High (two layers, conflict resolution, override propagation) |

Rejected as premature. The global cache + per-recipe-row user overrides (Phase D) already covers this.

### Option E: Time-based expiry (TTL)

Add a `created_at`-based expiry; entries older than N days are ignored.

| Dimension | Assessment |
|---|---|
| Stale-answer recovery | Useful when prompts evolve |
| Complexity | Low (a `WHERE created_at > ...` clause) |
| Hit rate | Lower (gradually decaying) |

Deferred to v2. Ingredient classifications and meal-name normalizations don't drift over time; the prompt rarely changes meaningfully. If the prompt does change, manually `TRUNCATE` the cache table — much simpler than building TTL machinery for a problem that may never arise.

### Option F: prompt_version column

Add a `prompt_version int NOT NULL` column; lookups filter by current version. Bumping the version invalidates all prior entries without TRUNCATE.

| Dimension | Assessment |
|---|---|
| Versioning hygiene | Cleanest |
| Migration overhead | Adds a column + a code constant + discipline to bump |

Deferred to v2 for the same reason as E. If the prompt changes meaningfully, we'll add this column then.

---

## Consequences

### Positive

- **Direct API cost reduction.** Every cache hit is one fewer Haiku call. As the user base grows or the same user re-extracts recipes, hit rate compounds.
- **Lower latency on hits.** A Supabase round-trip is faster than a Haiku round-trip.
- **No user-visible behavior change.** The endpoint contracts are unchanged; only the path-to-the-answer differs.
- **Graceful degrade.** If env vars are missing, AI endpoints still work — they just skip caching. Operators don't have to coordinate the migration apply with the env var add.
- **Foundation for future caches.** The `supabaseAdmin` + cache-wrapper pattern is reusable for `/api/grocery-list`, `/api/swap-suggestions`, etc. if those also turn out to have cacheable shapes (less likely — both have less deterministic inputs).

### Negative

- **API server now has Supabase coupling.** Operationally, two new env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) must be set in Vercel for caching to work in prod.
- **Cache invalidation is manual today.** No TTL, no prompt versioning. If the classifier prompt changes meaningfully, we'll need to decide whether to TRUNCATE.
- **First-answer-wins can lock in early-prompt errors.** If the classifier had a known bug at ingestion time and we cache the wrong answer, that wrong answer persists until manually invalidated. Mitigated by PRD-004 Phase D's per-recipe override (which is per-user, not global), and by the option to TRUNCATE the cache if the wrong answer pattern is widespread.
- **Cross-user data is now in the database.** Prior to this, every table was strictly owner-scoped. The cache tables break that uniformity. Future RLS audits need to know these tables are intentionally open-read.

### Future work

- **Prompt-version column** if we ship a meaningful classifier prompt change.
- **Cache analytics** (hit rate, miss rate per endpoint) — could be a periodic dashboard or a Postgres view.
- **Extend pattern to other endpoints** if their inputs prove deterministic.
- **Per-user override table** if we want users to have their own overrides without modifying the cached entry (e.g. if multi-household sharing ever lands).

---

## Implementation references

- Migration: [`supabase/migrations/20260506000003_ai_response_caches.sql`](../../supabase/migrations/20260506000003_ai_response_caches.sql)
- Verify SQL: [`supabase/migrations/verify_20260506000003_ai_response_caches.sql`](../../supabase/migrations/verify_20260506000003_ai_response_caches.sql)
- Service-role client: `api/_lib/supabaseAdmin.js`
- Cache wrappers: `api/_lib/classifyIngredientsCached.js`, `api/_lib/normalizeMealNameHandler.js`
- Tests: `api/_lib/__tests__/classifyIngredientsCached.test.js`, `api/_lib/__tests__/normalizeMealNameHandler.test.js`
