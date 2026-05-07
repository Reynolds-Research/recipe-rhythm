-- AI Response Cache: ingredient_classifications_cache + meal_name_normalizations_cache
--
-- Cross-cutting infrastructure (not tied to a PRD). See:
--   docs/adr/ADR-004-server-side-ai-response-cache.md
--
-- Goal: reduce Anthropic API spend by remembering past answers from two
-- deterministic-by-input AI endpoints. Same input → same answer ⇒ cache it.
--
-- Two tables, identical RLS shape:
--
--   1. ingredient_classifications_cache — keyed on (recipe_name_norm,
--      ingredient_name_norm). Backs /api/classify-ingredients (called by
--      /api/analyze-recipe internally + admin scripts). On a partial cache
--      hit the server still calls Anthropic for the misses, passing the FULL
--      ingredient list as context so AI reasoning stays accurate; only the
--      misses are written back.
--
--   2. meal_name_normalizations_cache — keyed on input_norm. Backs
--      /api/normalize-meal-name. Trivial 1:1 mapping; full hit OR full miss.
--
-- Key design decisions:
--
--   - Cross-user shared cache. The data is non-sensitive ("salt is essential"
--     isn't private), so a single global table maximizes hit rate vs. one
--     cache per user. ADR-004 §2.
--
--   - SELECT granted to both authenticated AND anon. Read-side RLS is open
--     by design — any client with the anon key can read cache entries. There
--     is no privacy boundary to enforce (no user_id, no recipe_id, just
--     normalized strings → classifications/corrections).
--
--   - No INSERT/UPDATE/DELETE policies. Writes only happen via the
--     service-role key on the API server (which bypasses RLS). This prevents
--     any anon-key-holder from poisoning the cache with incorrect entries.
--     If we later want client-side writes (e.g. offline-first), a follow-up
--     migration can add an authenticated INSERT policy with a name-shape
--     CHECK.
--
--   - First-answer-wins on conflict. The UNIQUE constraint on the cache key
--     is enforced by the DB; the application uses INSERT ... ON CONFLICT DO
--     NOTHING semantics so a re-classification never overwrites a prior
--     answer. This matches the user-confirmed policy in the planning chat.
--
--   - Normalized columns are the cache KEY (lowercased + trimmed), and
--     they're the only thing we store for the input. We don't preserve the
--     verbatim user input — the cache contract is "normalized in, answer
--     out" and verbatim input has no use after lookup.
--
--   - No created_by / user_id column. The cache is anonymous (which keeps
--     the table small and avoids any RLS coupling on writes). If we ever
--     need attribution for analytics, add it in a follow-up migration.
--
--   - No prompt_version column in v1. If the upstream prompt is changed in a
--     way that meaningfully alters classifications, manually TRUNCATE the
--     relevant cache table or add prompt_version in a follow-up migration.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, DROP
-- POLICY IF EXISTS before CREATE POLICY. Safe to re-run.
--
-- Reversibility (manual rollback, if ever needed):
--   DROP TABLE IF EXISTS public.ingredient_classifications_cache;
--   DROP TABLE IF EXISTS public.meal_name_normalizations_cache;


-- =========================================================================
-- 1. ingredient_classifications_cache table
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.ingredient_classifications_cache (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Lowercased + whitespace-trimmed recipe name. Cache lookups normalize the
  -- input the same way before querying. Examples: "Chicken Saag",
  -- " chicken saag " → "chicken saag".
  recipe_name_norm      text        NOT NULL,
  -- Lowercased + whitespace-trimmed ingredient name as it was submitted to
  -- the classifier. The classifier preserves compound forms like
  -- "onion/garlic" verbatim (see SYSTEM_PROMPT in src/lib/classifyIngredients.js)
  -- and we cache them the same way.
  ingredient_name_norm  text        NOT NULL,
  essentiality          text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ingredient_classifications_cache_essentiality_valid
    CHECK (essentiality IN ('essential', 'omittable')),

  -- The cache key. UNIQUE supports first-answer-wins via INSERT ... ON
  -- CONFLICT DO NOTHING in the application layer.
  CONSTRAINT ingredient_classifications_cache_key_unique
    UNIQUE (recipe_name_norm, ingredient_name_norm)
);

COMMENT ON TABLE public.ingredient_classifications_cache IS
  'Cross-user shared cache of /api/classify-ingredients answers. Keyed on (recipe_name_norm, ingredient_name_norm). First-answer-wins (ON CONFLICT DO NOTHING). Read by anon + authenticated; written only by the service-role key on the API server. Does not store user attribution. See ADR-004.';

COMMENT ON COLUMN public.ingredient_classifications_cache.recipe_name_norm IS
  'Lowercased + whitespace-trimmed recipe name. Cache lookups normalize input the same way. Pairs with ingredient_name_norm to form the lookup key.';

COMMENT ON COLUMN public.ingredient_classifications_cache.ingredient_name_norm IS
  'Lowercased + whitespace-trimmed ingredient name as classified. Compound forms like "onion/garlic" are preserved verbatim per the classifier prompt — they are NOT split on the slash.';

COMMENT ON COLUMN public.ingredient_classifications_cache.essentiality IS
  'AI classification per ADR-002: essential (cannot be removed without changing the dish identity) or omittable (substitutable / accent / garnish).';


-- =========================================================================
-- 2. Indexes on ingredient_classifications_cache
-- =========================================================================
--
-- Primary access pattern: "for recipe X, look up classifications for
-- ingredients [a, b, c, ...]". The UNIQUE constraint above already creates
-- a btree index on (recipe_name_norm, ingredient_name_norm), which Postgres
-- uses for both the equality on recipe_name_norm and the IN/= on
-- ingredient_name_norm. No additional index needed.


-- =========================================================================
-- 3. RLS on ingredient_classifications_cache
-- =========================================================================

ALTER TABLE public.ingredient_classifications_cache ENABLE ROW LEVEL SECURITY;

-- --- read policy: open to anon + authenticated ---
-- Cache entries are non-sensitive. There is no per-user data here, no
-- privacy boundary, and the lookup space is bounded by what users have
-- already classified. Open SELECT is intentional.

DROP POLICY IF EXISTS ingredient_classifications_cache_select_all
  ON public.ingredient_classifications_cache;
CREATE POLICY ingredient_classifications_cache_select_all
  ON public.ingredient_classifications_cache
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- --- write policies: NONE ---
-- Writes only happen via the service-role key on the API server, which
-- bypasses RLS. We intentionally do NOT grant INSERT/UPDATE/DELETE to
-- authenticated or anon — that would let any anon-key-holder poison the
-- cache. Service-role is the trust boundary.


-- =========================================================================
-- 4. meal_name_normalizations_cache table
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.meal_name_normalizations_cache (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Lowercased + whitespace-trimmed user input. The cache key.
  input_norm  text        NOT NULL UNIQUE,
  -- The normalized / spell-corrected / title-cased output as returned by
  -- /api/normalize-meal-name. Stored verbatim — Title Case preserved.
  corrected   text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.meal_name_normalizations_cache IS
  'Cross-user shared cache of /api/normalize-meal-name answers. Keyed on input_norm (lowercased + trimmed user input). corrected stores the AI-returned Title-Cased output verbatim. First-answer-wins (ON CONFLICT DO NOTHING). Read by anon + authenticated; written only by the service-role key on the API server. See ADR-004.';

COMMENT ON COLUMN public.meal_name_normalizations_cache.input_norm IS
  'Lowercased + whitespace-trimmed user input. The cache key. UNIQUE.';

COMMENT ON COLUMN public.meal_name_normalizations_cache.corrected IS
  'Title-cased + spell-corrected output from /api/normalize-meal-name. Stored verbatim with capitalization preserved.';


-- =========================================================================
-- 5. RLS on meal_name_normalizations_cache
-- =========================================================================

ALTER TABLE public.meal_name_normalizations_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meal_name_normalizations_cache_select_all
  ON public.meal_name_normalizations_cache;
CREATE POLICY meal_name_normalizations_cache_select_all
  ON public.meal_name_normalizations_cache
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- No write policies — same rationale as ingredient_classifications_cache.
