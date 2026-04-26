# Claude Code Project Memory — Recipe-Rhythm

> Read this file first at the start of every session. It tells you what this codebase is, how it's organized, and the conventions to follow. If a user-supplied prompt in `docs/prompts/` references files or patterns you don't recognize, **start here**, then read the prompt.

## What this app is

Recipe-Rhythm is a mobile-first meal-planning, grocery-tracking, and recipe-storage app for a single household. Partner collaboration is a future ADR — assume single-user (`auth.uid() = user_id`) for now.

The app has three primary user-facing surfaces:
- **Vault** (`src/pages/Vault.jsx`) — the recipe library; chip-picker categorical tagging, AI-suggest, image upload
- **LogMode** (`src/pages/LogMode.jsx`) — the daily voice-first "what did you eat" journal
- **BrainstormMode** (`src/pages/BrainstormMode.jsx`) — the meal-planning surface; drag-and-drop, recommendations, period-based planning per ADR-001

## Tech stack (verified against `package.json`)

- **Frontend:** React 19.2, Vite 8, Tailwind CSS 3.4, lucide-react, framer-motion, react-modal-sheet, @dnd-kit/core + @dnd-kit/sortable
- **Backend:** Supabase (DB + Auth + Storage) with owner-scoped RLS on every table; local Express proxy at `api-server.mjs`; Vercel serverless mirror at `api/` (keep both in sync)
- **AI:** `@anthropic-ai/sdk` 0.90 — Sonnet 4.6 for `/api/analyze-recipe`, Haiku 4.5 for `/api/swap-suggestions` (PRD-003 will add `/api/grocery-list`)
- **Testing:** Vitest 4 + React Testing Library + `@testing-library/user-event` (unit/integration); Playwright (e2e)
- **Routing:** None today. `App.jsx` uses `page` state + conditional rendering. `react-router-dom` is planned in PRD-003 P0.11.
- **No TypeScript.** JS only.

## Repo layout

- `src/pages/` — top-level surfaces: Vault, LogMode, BrainstormMode, PeriodReview
- `src/components/` — shared UI: CalendarView, DateRangePicker, DateStripPicker, GapDayView, LeftoverPicker, VaultMatchSheet, Auth, Logo, ChefKnife
- `src/lib/` — non-UI utilities: `supabase.js` (client), `recommendations.js`, `mealPlanReader.js`, `mealPlanWriter.js`, `analyzeRecipe.js`, `vaultMatch.js`
- `src/hooks/` — custom hooks: `useSpeech.js`, `useHaptics.js`
- `src/lib/__tests__/` and `src/pages/__tests__/` and `src/components/__tests__/` — Vitest tests, colocated next to what they test
- `e2e/` — Playwright end-to-end tests
- `supabase/migrations/` — timestamp-prefixed SQL migrations + a `verify_<timestamp>.sql` alongside each
- `supabase/audits/` — RLS verification + remediation SQL
- `docs/prds/` — Product Requirements Documents (the source of truth for product scope)
- `docs/adr/` — Architecture Decision Records
- `docs/prompts/` — Claude Code prompts authored by Claude.ai for specific phases of work
- `docs/schema.md` — running schema reference; update with every migration
- `docs/architecture.md` — high-level architecture overview
- `api-server.mjs` — local-dev Express proxy holding the Anthropic key
- `api/` — Vercel serverless port of the proxy (keep in sync with `api-server.mjs`)
- `RECIPE_TODOS.md` — does NOT live in the repo; it's in the user's Claude.ai project knowledge folder. Don't try to read or write it from inside the repo.

## PRDs (the source of truth for what to build)

When working on a feature, **read the relevant PRD first**. Do not invent requirements that aren't in the PRD.

1. **PRD-001 — Recipe Vault & Cooking Record** — [`docs/prds/PRD-001-recipe-vault-and-cooking-record.md`](docs/prds/PRD-001-recipe-vault-and-cooking-record.md). Restores the meals→vault link, soft-deletes vault recipes, centralizes enums. Dependency root for the other two PRDs.
2. **PRD-002 — Meal Planning** — [`docs/prds/PRD-002-meal-planning.md`](docs/prds/PRD-002-meal-planning.md). Brainstorm UX upgrade, household preferences (hard filter), `prep_time_minutes`, "maybe" / shortlist state. **Hard-blocked on PRD-001 Phase 1 + P1.1.**
3. **PRD-003 — Grocery Tracking** — [`docs/prds/PRD-003-grocery-tracking.md`](docs/prds/PRD-003-grocery-tracking.md). AI-generated lists (Hybrid approach), pantry staples lite, the share-link primitive (token + public route + react-router).

ADRs:
- **ADR-001 — Planning Period Save State** — [`docs/adr/ADR-001-planning-period-save-state.md`](docs/adr/ADR-001-planning-period-save-state.md). Schema decisions for date-ranged planning periods, leftovers, end-of-period review.

## Workflow conventions

This repo uses a **two-surface workflow**:
- **Claude.ai** (planning surface) authors PRDs, ADRs, and prompts. Outputs land in `docs/prds/`, `docs/adr/`, `docs/prompts/`.
- **Claude Code** (executor — that's you) reads a prompt from `docs/prompts/`, produces commits + tests + migrations, opens a PR.

When given a prompt file, follow it literally. If something in the prompt doesn't match the codebase, **stop and ask the user** rather than guessing or improvising.

## Branch lifecycle

1. **Each phase of a PRD goes on its own branch.** Common naming: `feat/<short-name>`, `fix/<short-name>`, or the auto-generated `claude/<random-name>` Claude Code uses for worktrees.
2. **Open a PR.** Let CI and Supabase Preview Branch (if configured) run. Merge via GitHub UI.
3. **Migrations apply to live Supabase manually**, by the user, via the Supabase SQL Editor. Claude Code does NOT have access to the live database. When a prompt asks for migration application, that's a hand-off — print clear instructions and wait.
4. **After merge, clean up immediately:** delete the branch locally and remotely, run `git worktree prune`. The next session should start from a clean `main`.

## Cross-branch / cross-worktree reading

When you need to read content from a different branch or a worktree, **do not try to access worktree paths directly** (`.claude/worktrees/<name>/...`). Worktrees frequently end up in a "prunable" state and behave inconsistently across sessions. Instead, use git history:

```
git show <branch-or-ref>:<path-from-repo-root>
```

For example: `git show origin/feat/phase-2-data-hygiene:supabase/migrations/20260426000001_vault_soft_delete.sql`. This works regardless of worktree state and never requires checking out a different branch.

To compare branches: `git diff main..other-branch -- <path>`.

## Migration etiquette

- **Idempotent always.** Use `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`. Re-running a migration must be a no-op.
- **`CREATE OR REPLACE FUNCTION` does NOT replace if the signature changes.** If you're modifying a function's `RETURNS TABLE` columns or parameter list, prepend `DROP FUNCTION IF EXISTS <name>(<param-types>);` before the CREATE.
- **Pair every migration with a verify SQL file** in the same directory: `verify_<timestamp>.sql`. Read-only checks that confirm the migration applied correctly.
- **Document every column / table change in `docs/schema.md`** — update column reference tables and the migrations log table at the bottom.
- **RLS for every new table.** Owner-scoped policies on `user_id`, mirroring the existing `meals` / `vault` / `meal_plan_items` patterns. Never ship a table without RLS.

## Test conventions

- Tests live next to what they test: `src/lib/foo.js` → `src/lib/__tests__/foo.test.js`; `src/pages/Foo.jsx` → `src/pages/__tests__/Foo.test.jsx`.
- Use Vitest + React Testing Library + `@testing-library/user-event`.
- Mock Supabase using the existing patterns (see `src/lib/__tests__/recommendations.test.js` for the canonical example).
- `react-modal-sheet` is mocked globally in `src/setupTests.js` — `Sheet` is exported as a NAMED export (`{ Sheet }`), not default.
- Don't introduce new test frameworks or assertion libraries.

## Common gotchas (real ones we've hit)

- **`react-modal-sheet` import shape.** Use `import { Sheet } from 'react-modal-sheet'`, not `import Sheet from 'react-modal-sheet'`. The default-import form may work in dev but breaks in production builds and tests.
- **Timezone-naive dates.** `new Date().toISOString().split('T')[0]` writes UTC, even when the user's local time is the previous day (audit U8). PRD-002 P0.11 introduces a centralized `formatLocalDate()` helper — until that lands, be aware.
- **`pg_trgm` `RETURNS TABLE` ambiguity.** Naming OUT params `id`, `name`, `image_url` collides with `vault.id`/`vault.name` inside a `LANGUAGE sql` function body. Postgres flags this in some contexts (notably fresh DBs / Supabase Preview Branches). Fix: use prefixed OUT names (`match_id`, `match_name`, `match_image_url`) and qualify the SELECT (`vault.id AS match_id, ...`). See `vault_fuzzy_match` in the Phase 1 migration.
- **The Claude.ai project's master prompt may be stale.** It may list older versions of the stack (React 18, Vite 6, Vanilla CSS, Phosphor Icons). The truth is in `package.json`. If there's a conflict, **trust the codebase**.
- **Don't fix unrelated lint or test errors** while doing focused work. Note them in the PR description as follow-ups; don't expand scope unless the prompt explicitly asks.

## When in doubt

1. Read the PRD for the feature you're working on (`docs/prds/`)
2. Read the prompt for your phase (`docs/prompts/`) if one exists
3. Read `docs/schema.md` and `docs/architecture.md` for system context
4. Run `git log --oneline -20` to see recent activity for context on what just shipped
5. **Ask the user before guessing.** A short clarifying question is always better than a wrong assumption.
