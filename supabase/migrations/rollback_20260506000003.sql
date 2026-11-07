-- =========================================================================
-- Rollback: 20260506000003_ai_response_caches (ADR-004, PRD-008 D9)
-- Puts the database back exactly as it was before the migration.
--
-- Loses only cached AI answers: the app keeps working without them (every
-- request then asks the AI, as it did before the caches existed).
-- Added 2026-11-07, when the migration was found never to have reached prod.
-- =========================================================================
BEGIN;

DROP TABLE IF EXISTS public.ingredient_classifications_cache;   -- its rules and constraints go with it
DROP TABLE IF EXISTS public.meal_name_normalizations_cache;

COMMIT;

-- Expect one row: both false.
SELECT to_regclass('public.ingredient_classifications_cache') IS NOT NULL AS classify_cache_left,
       to_regclass('public.meal_name_normalizations_cache')   IS NOT NULL AS normalize_cache_left;
