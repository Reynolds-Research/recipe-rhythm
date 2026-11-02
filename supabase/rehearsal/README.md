# Rehearsal kit (preview project only)

PRD-008 D9: every schema or security migration is rehearsed on the **preview** project before
prod — apply → verify → roll back → verify the old state → apply again. Every script here refuses
to run on a project that has any account outside `@example.test`.

The preview project starts nearly empty and prod has drifted from `supabase/migrations/`, so the kit
rebuilds prod's shape from prod's live catalog instead of replaying old migration files.

| Step | Paste into the preview SQL Editor | Expect |
|---|---|---|
| 0a | `00_prod_shape_20261101.sql` | "Success" (rebuilds the kitchen tables; re-runnable to start over) |
| 0b | `01_seed_fake_accounts.sql` | one row: users 4, vault 9, options 4, meals 6, plans 4, items 6, lists 2, list items 3, prefs 3, drafts 2, leftovers 3 |
| 1 | `../migrations/20261101000001_households.sql` as committed | NOTICE "Shared household skipped" |
| 1b | the shared-household block with `her@example.test` / `matt@example.test` | NOTICE "Shared household ready: 2 members." |
| 2 | `../migrations/20261101000002_household_security_rules.sql` | "Success" |
| 3 | `../migrations/verify_20261101000001.sql`, then `verify_20261101000002.sql` | every `pass` = true |
| 4 | `03_write_checks.sql` | every `pass` = true (writes are rolled back) |
| 5 | `../migrations/rollback_20261101000002.sql`, then `rollback_20261101000001.sql` | "Success"; schema + data fingerprint matches step 0b |
| 6 | steps 1, 1b, 2 again, then step 3 | every `pass` = true |

The fingerprint in step 5 is checked read-only through the Supabase connector (a hash of every
column, constraint, index, rule, function body, view, grant and row owner).

## PRD-008 phase 2a — calendar data (2026-11-02)

Starts from the end of the table above (phase 1 applied). `fingerprint_public.sql` hashes the whole
`public` schema (tables, columns, constraints, indexes, rules, function bodies + grants, triggers, views,
table grants) and the kitchen rows; it is read-only and can be pasted in the SQL Editor.

| Step | Run | Expect |
|---|---|---|
| A | `fingerprint_public.sql` | one row — note it |
| 1 | `../migrations/20261102000001_calendar_data.sql` | "Success" |
| 2 | `SELECT public.rr_copy_legacy_plans();` | seed: meals added 6, confirmations added 4 |
| 3 | `../migrations/verify_20261102000001.sql` | 21 checks, every `pass` = true |
| 4 | `04_calendar_checks.sql` | 27 scenarios, every `pass` = true (all undone) |
| 5 | `../migrations/rollback_20261102000001.sql` | one row, all false |
| B | `fingerprint_public.sql` | **identical** to step A; phase 1's `verify_20261101000002.sql` still 37/37 |
| 6 | steps 1 (twice — idempotent), 2, 2 again (all zeros), 3, 4 | as above |

Rehearsed 2026-11-02 from a fresh rebuild (0a → phase 1 → A → 1–6), after the reviewer's fixes: see the PR.
