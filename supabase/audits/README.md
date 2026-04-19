# Supabase Audits

Dashboard-runnable SQL for verifying and hardening the Supabase project that
backs Recipe Rhythm. Nothing in this directory requires the `supabase` CLI —
everything is designed to be copy-pasted into **Supabase Dashboard → SQL
Editor**.

## Files

| File | Purpose | Side effects |
|---|---|---|
| [`c3_rls_verification.sql`](./c3_rls_verification.sql) | Reports which tables have RLS on, lists every policy, checks coverage per operation, and dumps storage-bucket config. | **None.** Pure `SELECT`. |
| [`c3_rls_remediation_templates.sql`](./c3_rls_remediation_templates.sql) | Template DDL for enabling RLS and creating standard per-user policies on tables and the `recipe_images` bucket. | **⚠️ Modifies schema.** Read before running. |

## Current inventory (as of the audit)

Tables referenced by the app (via `.from('<table>')` in `src/`):

- `public.meals`
- `public.vault`
- `public.meal_plans`

Storage buckets referenced by the app (via `supabase.storage.from('<bucket>')`):

- `recipe_images`

`meal_plan_items` is mentioned in the audit as a future table from ADR-001
Phase 1; it does not yet exist in the codebase, so it is not part of the
verification coverage check. Add it to the `expected_tables` CTE in
`c3_rls_verification.sql` once that phase lands.

## Runbook — AUDIT C3 RLS verification

### 1. Run the verification queries

1. Open the Supabase dashboard for the project.
2. Go to **SQL Editor → New query**.
3. Open [`c3_rls_verification.sql`](./c3_rls_verification.sql), copy the
   whole file, paste into the editor, and run each of the four numbered
   sections in turn (they are separated by comment headers). Running them
   all at once also works — you will get four result sets.
4. Keep the browser tab open — you will reference the output below.

### 2. Interpret the results

**Query 1 — "which tables have RLS enabled".**
Any row where `rls_enabled = false` for a table your app writes to
(`meals`, `vault`, `meal_plans`) is a **P0 finding**. With RLS off, the
public anon key grants every user full read/write access to every other
user's rows.

**Query 2 — "list every RLS policy".**
Scan the output for each expected table. You are looking for four policies
per table (or one `ALL` policy): one `SELECT`, one `INSERT`, one `UPDATE`,
one `DELETE`. Each should include `auth.uid() = user_id` (or your
project's equivalent) in its `using_clause` and/or `with_check_clause`.
A policy whose `qual`/`with_check` is `true` or `NULL` is effectively
"allow everyone" — that is also a finding.

**Query 3 — "coverage check".**
This table directly calls out tables where one or more of the four
operations has no policy. Any row where `missing_operations` is not empty
means some operations will be either fully allowed (if RLS is off) or
fully denied (if RLS is on but no matching policy exists).

**Query 4 — "storage buckets".**
- The `storage.buckets` row for `recipe_images` tells you whether the
  bucket is marked `public = true` (public URLs work without auth) or
  `public = false` (URLs are signed / RLS-scoped).
- The `pg_policies` results on `storage.objects` show every policy that
  could apply to the bucket. Look for policies that reference
  `bucket_id = 'recipe_images'`.

### 3. Record the findings

Open [`docs/schema.md`](../../docs/schema.md) and fill in the TBDs in the
**Row Level Security Status** tables with what you observed. Update the
_Last verified_ date at the top of the section.

### 4. Apply remediation (only if gaps were found)

For any gap, open
[`c3_rls_remediation_templates.sql`](./c3_rls_remediation_templates.sql),
read the header, copy the relevant template into a fresh SQL Editor tab,
replace every `<PLACEHOLDER>`, and run the statements one at a time.

Re-run the verification queries afterwards to confirm the gap is closed,
and update `docs/schema.md` again.

### 5. Report back

Share the Query 1 and Query 3 results with whoever is driving the audit so
remediation priorities can be agreed before running the DDL templates.
