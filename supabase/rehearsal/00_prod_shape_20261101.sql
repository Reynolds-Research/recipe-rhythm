-- =========================================================================
-- Rehearsal step 0a — rebuild PROD's kitchen schema on the PREVIEW project.
-- PREVIEW ONLY. Refuses to run on any project with a real (non-@example.test) account.
--
-- Built 2026-11-01 from prod's live catalog (read-only queries), not from the
-- repo's migration files: prod has drifted from them (e.g. ai_response_caches
-- was never applied there). Tables, columns, defaults, constraints, indexes,
-- trigger functions, triggers, the current_leftovers view, the RLS rules and
-- vault_fuzzy_match match prod exactly. Drops and rebuilds the kitchen tables,
-- so it can be re-run to start a rehearsal over.
-- =========================================================================
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email NOT LIKE '%@example.test') THEN
    RAISE EXCEPTION 'Refusing: this project has real accounts. Rehearsal scripts are for the preview project only.';
  END IF;
END $$;

-- Start clean (preview only — guarded above).
DROP TRIGGER IF EXISTS on_auth_user_created_household ON auth.users;
DROP VIEW  IF EXISTS public.current_leftovers;
DROP TABLE IF EXISTS public.grocery_list_items, public.grocery_lists, public.meal_plan_items, public.meal_plans,
  public.meals, public.vault_options, public.vault, public.household_preferences, public.plan_drafts,
  public.profiles, public.household_members, public.households CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user_household(), public.is_household_member(uuid), public.current_household_id();
DELETE FROM auth.users WHERE email LIKE '%@example.test';

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm    WITH SCHEMA public;

CREATE TABLE public.profiles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  email text NOT NULL,
  display_name text,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.vault (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid,
  name text NOT NULL,
  cuisine_type text,
  flavor_profile text,
  source_url text,
  notes text,
  is_wildcard boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  search_vector tsvector,
  proteins text[] DEFAULT '{}'::text[],
  cooking_method text,
  main_carb text,
  dietary_tags text[] DEFAULT '{}'::text[],
  dairy_components text[] DEFAULT '{}'::text[],
  produce text[] DEFAULT '{}'::text[],
  vegetables text[] DEFAULT '{}'::text[],
  fruits text[] DEFAULT '{}'::text[],
  auto_completed boolean DEFAULT false,
  recipe_url text,
  user_id uuid,
  image_url text,
  deleted_at timestamp with time zone,
  family_rating smallint,
  prep_time_minutes integer,
  ingredients_classified jsonb,
  ingredients_structured jsonb,
  servings integer
);
CREATE TABLE public.vault_options (
  user_id uuid NOT NULL,
  category text NOT NULL,
  value text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.meals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  profile_id uuid,
  vault_id uuid,
  name text NOT NULL,
  cuisine_type text,
  flavor_profile text,
  notes text,
  eaten_on date DEFAULT CURRENT_DATE,
  created_at timestamp with time zone DEFAULT now(),
  search_vector tsvector,
  user_id uuid
);
CREATE TABLE public.meal_plans (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  week_label text,
  days text[],
  items jsonb,
  served_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  period_start date,
  period_end date,
  finalized_at timestamp with time zone,
  served_feedback text
);
CREATE TABLE public.meal_plan_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  meal_plan_id uuid NOT NULL,
  scheduled_date date,
  "position" integer DEFAULT 0 NOT NULL,
  vault_id uuid,
  name text NOT NULL,
  is_wildcard boolean DEFAULT false NOT NULL,
  source_url text,
  cooked boolean DEFAULT false NOT NULL,
  cooked_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  is_shortlisted boolean DEFAULT false NOT NULL
);
CREATE TABLE public.grocery_lists (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  meal_plan_id uuid,
  share_token text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.grocery_list_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  list_id uuid NOT NULL,
  name text NOT NULL,
  quantity text,
  section text DEFAULT 'Other'::text NOT NULL,
  is_bought boolean DEFAULT false NOT NULL,
  is_adhoc boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.household_preferences (
  user_id uuid NOT NULL,
  dietary_restrictions text[] DEFAULT '{}'::text[] NOT NULL,
  excluded_ingredients text[] DEFAULT '{}'::text[] NOT NULL,
  excluded_cuisines text[] DEFAULT '{}'::text[] NOT NULL,
  max_prep_time_minutes integer,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  pantry_staples text[] DEFAULT '{}'::text[] NOT NULL,
  adults integer DEFAULT 2 NOT NULL,
  children integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.plan_drafts (
  user_id uuid NOT NULL,
  plan jsonb DEFAULT '[]'::jsonb NOT NULL,
  selected_dates jsonb DEFAULT '[]'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Constraints (verbatim from pg_get_constraintdef on prod)
ALTER TABLE public.grocery_list_items ADD CONSTRAINT grocery_list_items_pkey PRIMARY KEY (id);
ALTER TABLE public.grocery_list_items ADD CONSTRAINT grocery_list_items_section_valid CHECK ((section = ANY (ARRAY['Produce'::text, 'Meat & Seafood'::text, 'Dairy'::text, 'Pantry'::text, 'Frozen'::text, 'Bakery'::text, 'Beverages'::text, 'Other'::text])));
ALTER TABLE public.grocery_lists ADD CONSTRAINT grocery_lists_pkey PRIMARY KEY (id);
ALTER TABLE public.grocery_lists ADD CONSTRAINT grocery_lists_share_token_key UNIQUE (share_token);
ALTER TABLE public.household_preferences ADD CONSTRAINT household_preferences_max_prep_time_minutes_check CHECK (((max_prep_time_minutes IS NULL) OR (max_prep_time_minutes > 0)));
ALTER TABLE public.household_preferences ADD CONSTRAINT household_preferences_pkey PRIMARY KEY (user_id);
ALTER TABLE public.household_preferences ADD CONSTRAINT household_prefs_eater_counts_chk CHECK (((adults >= 1) AND (children >= 0)));
ALTER TABLE public.meal_plan_items ADD CONSTRAINT meal_plan_items_pkey PRIMARY KEY (id);
ALTER TABLE public.meal_plan_items ADD CONSTRAINT meal_plan_items_scheduled_xor_shortlisted CHECK (((scheduled_date IS NULL) = is_shortlisted));
ALTER TABLE public.meal_plan_items ADD CONSTRAINT meal_plan_items_shortlist_no_date CHECK ((NOT (is_shortlisted AND (scheduled_date IS NOT NULL))));
ALTER TABLE public.meal_plans ADD CONSTRAINT meal_plans_no_period_overlap EXCLUDE USING gist (user_id WITH =, daterange(period_start, period_end, '[]'::text) WITH &&) WHERE (((period_start IS NOT NULL) AND (period_end IS NOT NULL)));
ALTER TABLE public.meal_plans ADD CONSTRAINT meal_plans_pkey PRIMARY KEY (id);
ALTER TABLE public.meal_plans ADD CONSTRAINT meal_plans_served_feedback_check CHECK ((served_feedback = ANY (ARRAY['positive'::text, 'negative'::text])));
ALTER TABLE public.meals ADD CONSTRAINT meals_pkey PRIMARY KEY (id);
ALTER TABLE public.plan_drafts ADD CONSTRAINT plan_drafts_pkey PRIMARY KEY (user_id);
ALTER TABLE public.plan_drafts ADD CONSTRAINT plan_drafts_plan_is_array CHECK ((jsonb_typeof(plan) = 'array'::text));
ALTER TABLE public.plan_drafts ADD CONSTRAINT plan_drafts_selected_dates_is_array CHECK ((jsonb_typeof(selected_dates) = 'array'::text));
ALTER TABLE public.profiles ADD CONSTRAINT profiles_email_key UNIQUE (email);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.vault ADD CONSTRAINT vault_family_rating_check CHECK (((family_rating IS NULL) OR ((family_rating >= 1) AND (family_rating <= 5))));
ALTER TABLE public.vault ADD CONSTRAINT vault_pkey PRIMARY KEY (id);
ALTER TABLE public.vault ADD CONSTRAINT vault_prep_time_minutes_check CHECK (((prep_time_minutes IS NULL) OR (prep_time_minutes > 0)));
ALTER TABLE public.vault_options ADD CONSTRAINT vault_options_pkey PRIMARY KEY (user_id, category, value);

ALTER TABLE public.grocery_list_items ADD CONSTRAINT grocery_list_items_list_id_fkey FOREIGN KEY (list_id) REFERENCES grocery_lists(id) ON DELETE CASCADE;
ALTER TABLE public.grocery_lists ADD CONSTRAINT grocery_lists_meal_plan_id_fkey FOREIGN KEY (meal_plan_id) REFERENCES meal_plans(id) ON DELETE SET NULL;
ALTER TABLE public.grocery_lists ADD CONSTRAINT grocery_lists_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.household_preferences ADD CONSTRAINT household_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.meal_plan_items ADD CONSTRAINT meal_plan_items_meal_plan_id_fkey FOREIGN KEY (meal_plan_id) REFERENCES meal_plans(id) ON DELETE CASCADE;
ALTER TABLE public.meal_plan_items ADD CONSTRAINT meal_plan_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.meal_plan_items ADD CONSTRAINT meal_plan_items_vault_id_fkey FOREIGN KEY (vault_id) REFERENCES vault(id) ON DELETE SET NULL;
ALTER TABLE public.meal_plans ADD CONSTRAINT meal_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
ALTER TABLE public.meals ADD CONSTRAINT meals_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.meals ADD CONSTRAINT meals_vault_id_fkey FOREIGN KEY (vault_id) REFERENCES vault(id) ON DELETE SET NULL;
ALTER TABLE public.plan_drafts ADD CONSTRAINT plan_drafts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.vault ADD CONSTRAINT vault_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.vault_options ADD CONSTRAINT vault_options_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX grocery_list_items_list_idx ON public.grocery_list_items USING btree (list_id);
CREATE INDEX grocery_lists_user_idx ON public.grocery_lists USING btree (user_id);
CREATE UNIQUE INDEX grocery_lists_user_plan_idx ON public.grocery_lists USING btree (user_id, meal_plan_id) WHERE (meal_plan_id IS NOT NULL);
CREATE INDEX meal_plan_items_meal_plan_id_idx ON public.meal_plan_items USING btree (meal_plan_id);
CREATE INDEX meal_plan_items_user_cooked_idx ON public.meal_plan_items USING btree (user_id, cooked);
CREATE INDEX meal_plan_items_user_scheduled_idx ON public.meal_plan_items USING btree (user_id, scheduled_date);
CREATE INDEX meal_plan_items_user_shortlist_idx ON public.meal_plan_items USING btree (user_id, meal_plan_id) WHERE (is_shortlisted = true);
CREATE INDEX meal_plans_user_served ON public.meal_plans USING btree (user_id, served_at DESC);
CREATE INDEX meals_user_vault_idx ON public.meals USING btree (user_id, vault_id);
CREATE INDEX vault_user_active_idx ON public.vault USING btree (user_id) WHERE (deleted_at IS NULL);

-- Trigger functions + triggers
CREATE OR REPLACE FUNCTION public.grocery_lists_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.household_preferences_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.update_meal_search_vector() RETURNS trigger LANGUAGE plpgsql AS $function$
begin
  new.search_vector :=
    to_tsvector('english', coalesce(new.name, '') || ' ' || coalesce(new.notes, ''));
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.update_vault_search_vector() RETURNS trigger LANGUAGE plpgsql AS $function$
begin
  new.search_vector :=
    to_tsvector('english', coalesce(new.name, '') || ' ' || coalesce(new.notes, ''));
  return new;
end;
$function$;
CREATE TRIGGER meal_search_vector_update BEFORE INSERT OR UPDATE ON public.meals FOR EACH ROW EXECUTE FUNCTION update_meal_search_vector();
CREATE TRIGGER vault_search_vector_update BEFORE INSERT OR UPDATE ON public.vault FOR EACH ROW EXECUTE FUNCTION update_vault_search_vector();
CREATE TRIGGER household_preferences_set_updated_at BEFORE UPDATE ON public.household_preferences FOR EACH ROW EXECUTE FUNCTION household_preferences_set_updated_at();
CREATE TRIGGER grocery_lists_set_updated_at BEFORE UPDATE ON public.grocery_lists FOR EACH ROW EXECUTE FUNCTION grocery_lists_set_updated_at();

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

-- Grants as on prod (Supabase defaults), then RLS + the original rules
GRANT ALL ON public.profiles, public.vault, public.vault_options, public.meals, public.meal_plans, public.meal_plan_items,
  public.grocery_lists, public.grocery_list_items, public.household_preferences, public.plan_drafts, public.current_leftovers
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vault_fuzzy_match(uuid, text, real) TO anon, authenticated, service_role;

ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_options         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meals                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_plans            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_plan_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grocery_lists         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grocery_list_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_drafts           ENABLE ROW LEVEL SECURITY;

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
CREATE POLICY grocery_lists_public_share ON public.grocery_lists AS PERMISSIVE FOR SELECT TO anon USING ((share_token IS NOT NULL));
CREATE POLICY grocery_lists_select_own ON public.grocery_lists AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY grocery_lists_update_own ON public.grocery_lists AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY vault_options_delete_own ON public.vault_options AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY vault_options_insert_own ON public.vault_options AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY vault_options_select_own ON public.vault_options AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY vault_options_update_own ON public.vault_options AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY grocery_list_items_delete_own ON public.grocery_list_items AS PERMISSIVE FOR DELETE TO authenticated USING ((list_id IN ( SELECT grocery_lists.id FROM grocery_lists WHERE (grocery_lists.user_id = auth.uid()))));
CREATE POLICY grocery_list_items_insert_own ON public.grocery_list_items AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((list_id IN ( SELECT grocery_lists.id FROM grocery_lists WHERE (grocery_lists.user_id = auth.uid()))));
CREATE POLICY grocery_list_items_public_share ON public.grocery_list_items AS PERMISSIVE FOR SELECT TO anon USING ((list_id IN ( SELECT grocery_lists.id FROM grocery_lists WHERE (grocery_lists.share_token IS NOT NULL))));
CREATE POLICY grocery_list_items_select_own ON public.grocery_list_items AS PERMISSIVE FOR SELECT TO authenticated USING ((list_id IN ( SELECT grocery_lists.id FROM grocery_lists WHERE (grocery_lists.user_id = auth.uid()))));
CREATE POLICY grocery_list_items_update_own ON public.grocery_list_items AS PERMISSIVE FOR UPDATE TO authenticated USING ((list_id IN ( SELECT grocery_lists.id FROM grocery_lists WHERE (grocery_lists.user_id = auth.uid())))) WITH CHECK ((list_id IN ( SELECT grocery_lists.id FROM grocery_lists WHERE (grocery_lists.user_id = auth.uid()))));
CREATE POLICY plan_drafts_delete_own ON public.plan_drafts AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY plan_drafts_insert_own ON public.plan_drafts AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));
CREATE POLICY plan_drafts_select_own ON public.plan_drafts AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY plan_drafts_update_own ON public.plan_drafts AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

COMMIT;
