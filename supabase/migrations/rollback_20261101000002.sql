-- =========================================================================
-- Rollback: 20261101000002_household_security_rules
-- Restores, exactly as they were on prod 2026-11-01: the owner-only security
-- rules on every kitchen table, the original current_leftovers view (owner's
-- rights, anon grant) and the original vault_fuzzy_match body.
-- Run this BEFORE rollback_20261101000001.sql. Safe to re-run.
--
-- After this runs, each person sees only rows whose user_id is theirs again:
-- anything one partner added to the shared household is hidden from the other.
-- =========================================================================
BEGIN;

DO $$
DECLARE
  t text;
  p text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vault','vault_options','meals','meal_plans','meal_plan_items',
                           'grocery_lists','household_preferences','plan_drafts','grocery_list_items']
  LOOP
    FOREACH p IN ARRAY ARRAY['_select_household','_insert_household','_update_household','_delete_household']
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || p, t);
    END LOOP;
    FOREACH p IN ARRAY ARRAY['_select_own','_insert_own','_update_own','_delete_own']
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || p, t);
    END LOOP;
  END LOOP;
END $$;
DROP POLICY IF EXISTS "Users can manage own meal plans" ON public.meal_plans;

-- Original rules, verbatim from pg_policies on prod (note the mixed TO roles).
CREATE POLICY meals_delete_own ON public.meals AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY meals_insert_own ON public.meals AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));
CREATE POLICY meals_select_own ON public.meals AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY meals_update_own ON public.meals AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY vault_delete_own ON public.vault AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY vault_insert_own ON public.vault AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));
CREATE POLICY vault_select_own ON public.vault AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY vault_update_own ON public.vault AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can manage own meal plans" ON public.meal_plans AS PERMISSIVE FOR ALL TO public USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY household_preferences_delete_own ON public.household_preferences AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY household_preferences_insert_own ON public.household_preferences AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));
CREATE POLICY household_preferences_select_own ON public.household_preferences AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY household_preferences_update_own ON public.household_preferences AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY meal_plan_items_delete_own ON public.meal_plan_items AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY meal_plan_items_insert_own ON public.meal_plan_items AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY meal_plan_items_select_own ON public.meal_plan_items AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY meal_plan_items_update_own ON public.meal_plan_items AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY grocery_lists_delete_own ON public.grocery_lists AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY grocery_lists_insert_own ON public.grocery_lists AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));
CREATE POLICY grocery_lists_select_own ON public.grocery_lists AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY grocery_lists_update_own ON public.grocery_lists AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY vault_options_delete_own ON public.vault_options AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY vault_options_insert_own ON public.vault_options AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY vault_options_select_own ON public.vault_options AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY vault_options_update_own ON public.vault_options AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY grocery_list_items_delete_own ON public.grocery_list_items AS PERMISSIVE FOR DELETE TO authenticated USING ((list_id IN ( SELECT grocery_lists.id FROM grocery_lists WHERE (grocery_lists.user_id = auth.uid()))));
CREATE POLICY grocery_list_items_insert_own ON public.grocery_list_items AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((list_id IN ( SELECT grocery_lists.id FROM grocery_lists WHERE (grocery_lists.user_id = auth.uid()))));
CREATE POLICY grocery_list_items_select_own ON public.grocery_list_items AS PERMISSIVE FOR SELECT TO authenticated USING ((list_id IN ( SELECT grocery_lists.id FROM grocery_lists WHERE (grocery_lists.user_id = auth.uid()))));
CREATE POLICY grocery_list_items_update_own ON public.grocery_list_items AS PERMISSIVE FOR UPDATE TO authenticated USING ((list_id IN ( SELECT grocery_lists.id FROM grocery_lists WHERE (grocery_lists.user_id = auth.uid())))) WITH CHECK ((list_id IN ( SELECT grocery_lists.id FROM grocery_lists WHERE (grocery_lists.user_id = auth.uid()))));
CREATE POLICY plan_drafts_delete_own ON public.plan_drafts AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY plan_drafts_insert_own ON public.plan_drafts AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));
CREATE POLICY plan_drafts_select_own ON public.plan_drafts AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY plan_drafts_update_own ON public.plan_drafts AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
-- (grocery_lists_public_share and grocery_list_items_public_share were never touched.)

-- current_leftovers: drop (the household_id column can't be removed in place) and recreate as it was.
DROP VIEW IF EXISTS public.current_leftovers;
CREATE VIEW public.current_leftovers AS
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
    mp.finalized_at AS source_finalized_at
   FROM (meal_plan_items mpi
     JOIN meal_plans mp ON ((mpi.meal_plan_id = mp.id)))
  WHERE ((mpi.cooked = false) AND (mpi.is_shortlisted = false) AND (mp.finalized_at IS NOT NULL)
    AND (mp.period_end < CURRENT_DATE) AND (mp.period_end >= (CURRENT_DATE - '14 days'::interval)));
GRANT ALL ON public.current_leftovers TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.vault_fuzzy_match(p_user_id uuid, p_query text, p_threshold real DEFAULT 0.6)
 RETURNS TABLE(match_id uuid, match_name text, image_url text, similarity real)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT v.id, v.name, v.image_url, similarity(v.name, p_query)
  FROM public.vault v
  WHERE v.user_id = p_user_id
    AND v.deleted_at IS NULL
    AND similarity(v.name, p_query) >= p_threshold
  ORDER BY similarity(v.name, p_query) DESC
  LIMIT 5;
$function$;

COMMIT;
