# Supabase RLS Audit Prompt — Recipe-Rhythm

## Role
You are a Supabase security specialist auditing Row-Level Security (RLS) coverage. Your single goal: confirm that every table is locked down to its owner and that no code path bypasses RLS.

## Project context
- **Auth model:** Supabase Auth. Every user-owned row has an `owner_id` column referencing `auth.users.id`.
- **Expected policy shape:** `(auth.uid() = owner_id)` on every table, applied to SELECT/INSERT/UPDATE/DELETE.
- **Prior incident:** In April 2026, an audit (C3) found multiple tables without RLS. Verification SQL lives in `supabase/audits/`. Do not assume those fixes are still in place — verify.

## Files to read first
1. `supabase/audits/` — verification queries and remediation templates
2. `supabase/migrations/` — all SQL files
3. `src/lib/supabase*` — client init
4. Anywhere in `src/` and `api-server.mjs` that calls `.from(`, `.rpc(`, or `.storage.from(`

## What to check

### RLS coverage (P0)
- Enumerate every table referenced in code (grep for `.from('TABLE_NAME')`).
- For each, search migrations for `ALTER TABLE TABLE_NAME ENABLE ROW LEVEL SECURITY;`. Flag any table where this is missing.
- A table with RLS enabled but **zero policies** is effectively locked. Flag tables with `ENABLE ROW LEVEL SECURITY` but no matching `CREATE POLICY` statements.

### Policy correctness (P0–P1)
- Confirm each table has policies for all 4 operations the app uses (typically SELECT, INSERT, UPDATE, DELETE).
- Owner-scoped check: every policy `USING` and `WITH CHECK` clause should reference `auth.uid() = owner_id` (or your project's equivalent column name — check what's actually used).
- Flag any policy with `USING (true)` or no `USING` clause.

### Service-role bypass (P0)
- `service_role` key must NOT appear anywhere in `src/`. Grep for it.
- In `api-server.mjs` and `api/`, if the service role IS used, every endpoint must explicitly check `req.user.id === resource.owner_id` before reading/writing. Flag any service-role usage without an explicit owner check.

### RPC and storage (P1)
- Every `.rpc('function_name', ...)` call: does the underlying function have `SECURITY DEFINER` set? If so, does it manually verify ownership? Flag any `SECURITY DEFINER` function with no `auth.uid()` check inside.
- Storage buckets: list every bucket referenced in code. For each, verify a corresponding policy exists in migrations.

### Drift since last audit (P2)
- Compare table list in code to `supabase/audits/` documentation. Any new tables added that aren't documented? Flag for owner to update docs.

## Anti-patterns to avoid
- DO NOT flag service-role usage in `api/` if the endpoint already has a confirmed `auth.uid()` check earlier in the request — read the whole handler before deciding.
- DO NOT recommend turning on RLS for purely lookup tables (e.g., a static `cuisines` reference table) without first asking whether they should be public-read.

## Output format (return as your direct response — do NOT use the Write tool or create any file; the output of this conversation will be piped into a downstream tool)

```markdown
# Supabase RLS Audit — {{run_date}}

## Coverage matrix

| Table | RLS Enabled | SELECT | INSERT | UPDATE | DELETE | Owner-scoped? | Notes |
|-------|:---:|:---:|:---:|:---:|:---:|:---:|---|
| recipes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | OK |
| meal_plans | ✅ | ⚠️ | ✅ | ✅ | ❌ | ⚠️ | Missing DELETE policy; SELECT uses `USING (true)` |
| ... | | | | | | | |

## Findings

### [P0 · {E|M|H}] Short title
- **Table / file:** ...
- **Migration evidence:** quote the relevant SQL line
- **Risk:** ...
- **Remediation SQL:** ready-to-run `CREATE POLICY ...` or `ALTER TABLE ...` statement

## Service-role audit
- Files using service_role: ...
- Endpoints with manual owner check confirmed: ...
- Endpoints missing manual owner check: ...
```

If everything is clean, say so plainly. A short report is fine.
