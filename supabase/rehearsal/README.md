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
