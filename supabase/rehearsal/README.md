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

## PRD-008 phase 2b-1 — which days a week shows (2026-11-02)

Starts from the end of the 2a table (calendar data applied). `fingerprint_public.sql` now also hashes
`household_preferences` rows (this migration adds a column there), so take a fresh step A.

| Step | Run | Expect |
|---|---|---|
| A | `fingerprint_public.sql` | one row — note it |
| 1 | `../migrations/20261102000002_week_days.sql` (twice — idempotent) | "Success" both times |
| 2 | `../migrations/verify_20261102000002.sql` | 15 checks, every `pass` = true |
| 3 | `05_week_days_checks.sql` | 15 scenarios, every `pass` = true (all undone) |
| 4 | `../migrations/rollback_20261102000002.sql` | one row, all false |
| B | `fingerprint_public.sql` | **identical** to step A; 2a's `verify_20261102000001.sql` still 21/21 |
| 5 | steps 1, 2, 3 again | as above |

Dry run 2026-11-02 on a local Postgres 16 built from this kit (0a → 0b → phase 1 + 1b → 2a + copy →
A → 1–5): every step as expected, fingerprint identical after rollback. The preview-project run is in the PR.

## PRD-008 phase 2c — switch-over copy (2026-11-06)

No migration. The prod copy skips any old plan whose dates overlap a week already confirmed on the
new screens (she re-planned Nov 1–7 there; copying the old Nov 1–5 plan would double every night).
Only the skipped plan's **dated** meals are skipped; a Maybe in it still copies. Files, in order:

| Step | Run (prod: SQL Editor; preview: connector) | Expect on prod |
|---|---|---|
| a | `06a_switchover_look.sql` (read-only) | exactly 1 row: the Nov 1 – 5 plan, 5 meals, overlapping Nov 1 – 7 |
| b | `06b_switchover_run.sql` (skip + copy, one script) | meals added 21, confirmations added 9, the rest 0 |
| c | `06c_verify_switchover.sql` (read-only, one SELECT) | 9 checks, every `pass` = true; check 9 = 5 / 5 |
| d | `SELECT public.rr_copy_legacy_plans();` after the deploy | all zeros |

Rehearsed on preview 2026-11-06. The preview had been copied already, so the copy state was reset
(copied rows + `rr_legacy_copied` cleared) and prod's situation simulated: a confirmed week Oct 25–31
plus two new-screen meals in a household whose old plan is Oct 26–30 (2 dated meals + 1 Maybe).
a: 1 row (that plan). b: meals added 4 (incl. the Maybe), confirmations added 3. c: 9/9 pass.
Negative control (rolled back): the same copy without the skip fails checks 2, 7 and 8. d: all zeros.
Then the simulation was removed and the preview restored to its earlier state (planned meals 6,
confirmations 4, `rr_legacy_copied` 10).
