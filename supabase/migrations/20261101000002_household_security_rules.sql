-- =========================================================================
-- Migration: 20261101000002_household_security_rules
-- PRD-008 phase 1 — Membership security rules (P0.2). Part 2 of 2.
-- Requires 20261101000001_households. Undo: rollback_20261101000002.sql
-- =========================================================================
--
-- Mental model: every kitchen table's rule changes from "is this row yours?"
-- (auth.uid() = user_id) to "are you a member of this row's household?"
-- (public.is_household_member(household_id)). Both members can read and edit
-- everything (D5, non-goal 3: no roles). New rows must be stamped with the
-- adder's own user_id ("who added it") and one of their households.
--
-- Also:
--   * grocery_list_items checks its parent list's household.
--   * The anon share-link rules on grocery lists are unchanged.
--   * current_leftovers becomes security_invoker. It previously ran with the
--     owner's rights, so it skipped every table rule and was readable with the
--     public anon key (CONFIRMED 2026-11-01). It also gains household_id.
--   * vault_fuzzy_match searches the caller's household, not just their rows.
--
-- Idempotent: DROP POLICY IF EXISTS before every CREATE POLICY.

DO $$
DECLARE
  t   text;
  old text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vault','vault_options','meals','meal_plans','meal_plan_items',
                           'grocery_lists','household_preferences','plan_drafts']
  LOOP
    -- Old owner-only rules (names as they exist on prod 2026-11-01).
    FOREACH old IN ARRAY ARRAY[t || '_select_own', t || '_insert_own', t || '_update_own', t || '_delete_own']
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', old, t);
    END LOOP;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_household', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
                    USING (public.is_household_member(household_id))', t || '_select_household', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert_household', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
                    WITH CHECK (public.is_household_member(household_id) AND user_id = (SELECT auth.uid()))',
                   t || '_insert_household', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update_household', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
                    USING (public.is_household_member(household_id))
                    WITH CHECK (public.is_household_member(household_id))', t || '_update_household', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete_household', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
                    USING (public.is_household_member(household_id))', t || '_delete_household', t);
  END LOOP;
END $$;

-- meal_plans had one catch-all rule under a different name.
DROP POLICY IF EXISTS "Users can manage own meal plans" ON public.meal_plans;

-- grocery_list_items: through the parent list.
DROP POLICY IF EXISTS grocery_list_items_select_own ON public.grocery_list_items;
DROP POLICY IF EXISTS grocery_list_items_insert_own ON public.grocery_list_items;
DROP POLICY IF EXISTS grocery_list_items_update_own ON public.grocery_list_items;
DROP POLICY IF EXISTS grocery_list_items_delete_own ON public.grocery_list_items;

DROP POLICY IF EXISTS grocery_list_items_select_household ON public.grocery_list_items;
CREATE POLICY grocery_list_items_select_household ON public.grocery_list_items
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.grocery_lists l
    WHERE l.id = grocery_list_items.list_id AND public.is_household_member(l.household_id)));

DROP POLICY IF EXISTS grocery_list_items_insert_household ON public.grocery_list_items;
CREATE POLICY grocery_list_items_insert_household ON public.grocery_list_items
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.grocery_lists l
    WHERE l.id = grocery_list_items.list_id AND public.is_household_member(l.household_id)));

DROP POLICY IF EXISTS grocery_list_items_update_household ON public.grocery_list_items;
CREATE POLICY grocery_list_items_update_household ON public.grocery_list_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.grocery_lists l
    WHERE l.id = grocery_list_items.list_id AND public.is_household_member(l.household_id)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.grocery_lists l
    WHERE l.id = grocery_list_items.list_id AND public.is_household_member(l.household_id)));

DROP POLICY IF EXISTS grocery_list_items_delete_household ON public.grocery_list_items;
CREATE POLICY grocery_list_items_delete_household ON public.grocery_list_items
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.grocery_lists l
    WHERE l.id = grocery_list_items.list_id AND public.is_household_member(l.household_id)));

-- current_leftovers: same columns as before plus household_id (appended, so
-- CREATE OR REPLACE is allowed), and now evaluated with the caller's rights.
CREATE OR REPLACE VIEW public.current_leftovers AS
 SELECT mpi.id,
    mpi.user_id,
    mpi.meal_plan_id,
    mpi.scheduled_date,
    mpi."position",
    mpi.vault_id,
    mpi.name,
    mpi.is_wildcard,
    mpi.source_url,
    mpi.cooked,
    mpi.cooked_at,
    mpi.created_at,
    mp.period_start AS source_period_start,
    mp.period_end AS source_period_end,
    mp.finalized_at AS source_finalized_at,
    mpi.household_id
   FROM (meal_plan_items mpi
     JOIN meal_plans mp ON ((mpi.meal_plan_id = mp.id)))
  WHERE ((mpi.cooked = false) AND (mpi.is_shortlisted = false) AND (mp.finalized_at IS NOT NULL)
    AND (mp.period_end < CURRENT_DATE) AND (mp.period_end >= (CURRENT_DATE - '14 days'::interval)));
ALTER VIEW public.current_leftovers SET (security_invoker = true);
REVOKE ALL ON public.current_leftovers FROM anon;

-- vault_fuzzy_match: same signature (the app keeps passing its user id);
-- searches that user's household. Runs with the caller's rights, so the
-- table rules still apply on top.
CREATE OR REPLACE FUNCTION public.vault_fuzzy_match(p_user_id uuid, p_query text, p_threshold real DEFAULT 0.6)
 RETURNS TABLE(match_id uuid, match_name text, image_url text, similarity real)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT v.id, v.name, v.image_url, similarity(v.name, p_query)
  FROM public.vault v
  WHERE v.household_id = (SELECT m.household_id FROM public.household_members m WHERE m.user_id = p_user_id)
    AND v.deleted_at IS NULL
    AND similarity(v.name, p_query) >= p_threshold
  ORDER BY similarity(v.name, p_query) DESC
  LIMIT 5;
$function$;
