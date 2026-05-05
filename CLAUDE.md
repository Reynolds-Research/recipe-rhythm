# Claude Code Project Memory — Recipe-Rhythm

> Read this file first at the start of every session. It tells you what this codebase is, how it's organized, and the conventions to follow. If a user-supplied prompt in `docs/prompts/` references files or patterns you don't recognize, **start here**, then read the prompt.

## What this app is

Recipe-Rhythm is a mobile-first meal-planning, grocery-tracking, and recipe-storage app for a single household. Partner collaboration is a future ADR — assume single-user (`auth.uid() = user_id`) for now.

The app has three primary user-facing surfaces:
- **Vault** (`src/pages/Vault/`) — the recipe library; chip-picker categorical tagging, AI-suggest, image upload. Decomposed in PRD-001 P0.9 into `index.jsx` (page shell), `RecipeForm.jsx` (add/edit form), `RecipeCard.jsx` (list row), `ChipPicker.jsx` (the picker), `useVault.js` (data hook + Supabase calls). `App.jsx` imports the default export from `./pages/Vault` — Vite resolves to `Vault/index.jsx`.
- **LogMode** (`src/pages/LogMode.jsx`) — the daily voice-first "what did you eat" journal
- **BrainstormMode** (`src/pages/BrainstormMode.jsx`) — the meal-planning surface; drag-and-drop, recommendations, period-based planning per ADR-001

## Tech stack (verified against `package.json`)

- **Frontend:** React 19.2, Vite 8, Tailwind CSS 4.3, lucide-react, framer-motion, react-modal-sheet, @dnd-kit/core + @dnd-kit/sortable
- **Backend:** Supabase (DB + Auth + Storage) with owner-scoped RLS on every table; local Express proxy at `api-server.mjs`; Vercel serverless mirror at `api/` (keep both in sync)
- **AI:** `@anthropic-ai/sdk` 0.93. Endpoints: `/api/analyze-recipe` (Sonnet 4.6) for recipe parsing; `/api/swap-suggestions`, `/api/grocery-list`, `/api/classify-ingredients`, `/api/normalize-meal-name` (all Haiku 4.5). Each Express route in `api-server.mjs` has a Vercel mirror in `api/` — keep both in sync.
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
- `scripts/` — one-off and admin Node scripts: backfill jobs (`backfill-structured-ingredients.mjs`, `backfill-ingredients-classification.js`), classification eval tooling (`build-classification-truth-set.js`, `eval-classification-accuracy.js`), and git-hooks installation (`install-git-hooks.sh`). Some are wired up as npm scripts in `package.json` (e.g. `npm run backfill:structured-ingredients`).
- `docs/STATUS.md` — the canonical "where are we?" document. Single source of truth for which PRD phases have shipped vs. are pending. **Read this immediately after CLAUDE.md at the start of every session.** Updated as part of every PR that completes a PRD phase (see "Status etiquette" below). Replaces the legacy `RECIPE_TODOS.md`, which has been retired and should not be referenced.

## PRDs (the source of truth for what to build)

When working on a feature, **read the relevant PRD first**. Do not invent requirements that aren't in the PRD. Always cross-reference against `docs/STATUS.md` to know which phases of each PRD have already shipped.

1. **PRD-001 — Recipe Vault & Cooking Record** — [`docs/prds/PRD-001-recipe-vault-and-cooking-record.md`](docs/prds/PRD-001-recipe-vault-and-cooking-record.md). Restores the meals→vault link, soft-deletes vault recipes, centralizes enums. Dependency root for PRD-002 and PRD-003.
2. **PRD-002 — Meal Planning** — [`docs/prds/PRD-002-meal-planning.md`](docs/prds/PRD-002-meal-planning.md). Brainstorm UX upgrade, household preferences (hard filter), `prep_time_minutes`, "maybe" / shortlist state. **Was hard-blocked on PRD-001 Phase 1 + P1.1; both shipped.**
3. **PRD-003 — Grocery Tracking** — [`docs/prds/PRD-003-grocery-tracking.md`](docs/prds/PRD-003-grocery-tracking.md). AI-generated lists (Hybrid approach), pantry staples lite, the share-link primitive (token + public route + react-router).
4. **PRD-004 — Smarter Ingredient Filtering** — [`docs/prds/PRD-004-smarter-ingredient-filtering.md`](docs/prds/PRD-004-smarter-ingredient-filtering.md). AI classifies vault ingredients as `essential` vs. `omittable`; preference filter gates only on essentials. Builds on PRD-002 P0.3. Paired with [ADR-002](docs/adr/ADR-002-ingredient-classification.md) and [ADR-003](docs/adr/ADR-003-implied-meat-dish-name-filter.md).
5. **PRD-005 — Mobile UX, Spacing & Typography** — [`docs/prds/PRD-005-mobile-ux-spacing-typography.md`](docs/prds/PRD-005-mobile-ux-spacing-typography.md). Hygiene-only audit: spacing scale, typography scale, WCAG AA contrast, 44px touch targets, design-system primitive adoption, CI lint guardrail. Independent of feature PRDs.
6. **PRD-006 — Structured Ingredients & Household Scaling** — [`docs/prds/PRD-006-structured-ingredients-and-household-scaling.md`](docs/prds/PRD-006-structured-ingredients-and-household-scaling.md). Adds `vault.ingredients_structured jsonb`, `vault.servings`, `household_preferences.adults` / `.children`, a backfill script, chip-grounded re-extraction (Path D1), and an explicit truth-hierarchy prompt. P0.1–P0.6 shipped; P0.7 (Bite γ — re-parse on edit + grocery-list household scaling) pending.

ADRs:
- **ADR-001 — Planning Period Save State** — [`docs/adr/ADR-001-planning-period-save-state.md`](docs/adr/ADR-001-planning-period-save-state.md). Schema decisions for date-ranged planning periods, leftovers, end-of-period review.
- **ADR-002 — Ingredient Classification** — [`docs/adr/ADR-002-ingredient-classification.md`](docs/adr/ADR-002-ingredient-classification.md). Rationale for the AI-classifier approach in PRD-004.
- **ADR-003 — Implied-Meat Dish-Name Filter** — [`docs/adr/ADR-003-implied-meat-dish-name-filter.md`](docs/adr/ADR-003-implied-meat-dish-name-filter.md). App-layer dish-name keyword filter for vegetarian/vegan/pescatarian preferences; companion to PRD-004's essentiality classifier.
- **ADR-004 — Server-side AI Response Cache** — [`docs/adr/ADR-004-server-side-ai-response-cache.md`](docs/adr/ADR-004-server-side-ai-response-cache.md). Two cross-user shared cache tables (`ingredient_classifications_cache`, `meal_name_normalizations_cache`) backing `/api/classify-ingredients` and `/api/normalize-meal-name`. First-answer-wins; SELECT open to anon+authenticated; writes service-role-only. Adds Supabase coupling to the API server (new env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — same vars already used by backfill scripts).

## Workflow conventions

This repo uses a **two-surface workflow**:
- **Claude.ai** (planning surface) authors PRDs, ADRs, and prompts. Outputs land in `docs/prds/`, `docs/adr/`, `docs/prompts/`.
- **Claude Code** (executor — that's you) reads a prompt from `docs/prompts/`, produces commits + tests + migrations, opens a PR.

When given a prompt file, follow it literally. If something in the prompt doesn't match the codebase, **stop and ask the user** rather than guessing or improvising.

## Branch lifecycle

1. **Each phase of a PRD goes on its own branch.** Common naming: `feat/<short-name>`, `fix/<short-name>`, or the auto-generated `claude/<random-name>` Claude Code uses for worktrees.
2. **Open a PR.** Let CI and Supabase Preview Branch (if configured) run. Merge via GitHub UI.
3. **Migrations apply to live Supabase manually**, by the user, via the Supabase SQL Editor. Claude Code does NOT have access to the live (prod) database, but **does** have Supabase MCP access for **preview branches** — use it for verification before the prod hand-off (see "MCP-powered verification" below). When a prompt reaches the prod-application step, that's a hand-off — print clear instructions and wait.
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

## Status etiquette

- **Every PR that completes a PRD phase or a P-numbered requirement MUST update `docs/STATUS.md`** in the same PR. Move the relevant line from "Pending" to "Shipped" in the right PRD section, note the PR number and commit hash, and bump the "Last verified" line at the top.
- **Outdated `docs/STATUS.md` is a release blocker** — treat it the same as outdated `docs/schema.md`. If a reviewer notices drift between the file and what actually shipped, the PR doesn't merge until both are reconciled.
- **At the start of every session, read `docs/STATUS.md` immediately after this file**, then run `git log --oneline -20` to spot-check that the file matches reality. If they don't match, reconciling is the first task — not the work that was originally requested.
- **Bug-fix or refactor PRs that don't complete a PRD phase do not need to touch STATUS.md** — only phase-completing or P-numbered work.

## MCP-powered verification (preview branches & deployments)

This repo is configured with two MCP connectors that Claude Code SHOULD reach for proactively as part of the standard workflow — not wait to be asked.

**Supabase MCP** — for **preview branches only**. Claude can:
- Create a Supabase preview branch off the current schema.
- Apply pending migrations to the preview branch.
- Run the paired `verify_<timestamp>.sql` against the preview and report results.
- Run read-only `SELECT` queries to spot-check RLS policies (e.g. confirm a query as user A can't see user B's rows).
- Pull logs to diagnose Edge Function or query errors.

Claude does NOT apply migrations to the live (prod) database. That hand-off stays with the user via the Supabase SQL Editor.

**Vercel MCP** — for preview deployments. Claude can:
- Check the status of the PR's preview deployment.
- Read **build logs** when a deploy fails — try to fix the build before pinging the user.
- Read **runtime logs** to diagnose API errors against the preview URL.

### Project identifiers & smoke-test setup

When calling Supabase or Vercel MCP tools, use these IDs (the names don't always match the repo name):

- **Supabase project:** `recipe-app` — id `mbhgornybnedsloqzdhz`. Note: the project is named `recipe-app`, not `recipe-rhythm`.
- **Vercel project:** `recipe-rhythm` — id `prj_OhbZ2aF7RhBz2PwIt6Yj1kgPFu2m`, team `Reynolds-Family-Projects` (id `team_7XvRfk9YMr0q7AbaNMkgJRdr`).
- **Production URL:** https://recipe-rhythm.vercel.app
- **Preview URLs:** generated per-PR by Vercel; fetch via the Vercel MCP rather than guessing the URL.

For end-to-end smoke testing (logging into the app, clicking through the UI), a dedicated test user exists. Credentials are stored in `.claude/test-credentials.md` (gitignored, local only). If that file is missing, ask the user.

### Standard workflow for any DB-touching change

1. Write the migration + paired verify SQL.
2. Create a Supabase preview branch via MCP.
3. Apply the migration to the preview branch.
4. Run the verify SQL and report the output.
5. If verify passes: hand off to the user with clear "apply to prod" instructions.
6. If verify fails: diagnose, fix the migration, repeat from step 2.

### Standard workflow for any frontend / API change

1. Push the branch; let Vercel build a preview deployment.
2. Check deploy status via Vercel MCP. Read build logs if it failed and attempt a fix before pinging the user.
3. If verifying behavior or an error was reported, pull runtime logs from the preview deployment.
4. Report MCP findings (preview URL, deploy status, any log excerpts) in the PR description before declaring the work done.

If either MCP errors or appears unreachable, **ask the user** — don't silently fall back to the manual workflow. The MCP being unavailable is itself useful information.

## Test conventions

- Tests live next to what they test: `src/lib/foo.js` → `src/lib/__tests__/foo.test.js`; `src/pages/Foo.jsx` → `src/pages/__tests__/Foo.test.jsx`.
- Use Vitest + React Testing Library + `@testing-library/user-event`.
- Mock Supabase using the existing patterns (see `src/lib/__tests__/recommendations.test.js` for the canonical example).
- `react-modal-sheet` is mocked globally in `src/setupTests.js` — `Sheet` is exported as a NAMED export (`{ Sheet }`), not default.
- Don't introduce new test frameworks or assertion libraries.

## Common gotchas (real ones we've hit)

- **`react-modal-sheet` import shape.** Use `import { Sheet } from 'react-modal-sheet'`, not `import Sheet from 'react-modal-sheet'`. The default-import form may work in dev but breaks in production builds and tests.
- **Timezone-naive dates.** `new Date().toISOString().split('T')[0]` writes UTC, even when the user's local time is the previous day (audit U8). Use the centralized `formatLocalDate()` helper in `src/lib/dateUtils.js` (shipped via PRD-002 P0.11) for any `eaten_on` / `scheduled_date` write. Don't reintroduce raw `toISOString().split('T')[0]`.
- **`pg_trgm` `RETURNS TABLE` ambiguity.** Naming OUT params `id`, `name`, `image_url` collides with `vault.id`/`vault.name` inside a `LANGUAGE sql` function body. Postgres flags this in some contexts (notably fresh DBs / Supabase Preview Branches). Fix: use prefixed OUT names (`match_id`, `match_name`, `match_image_url`) and qualify the SELECT (`vault.id AS match_id, ...`). See `vault_fuzzy_match` in the Phase 1 migration.
- **The Claude.ai project's master prompt may be stale.** It may list older versions of the stack (React 18, Vite 6, Vanilla CSS, Phosphor Icons). The truth is in `package.json`. If there's a conflict, **trust the codebase**.
- **`lint:ds-allow` markers.** The `lint:ds` npm script is a grep-based design-system guardrail that occasionally produces false positives on decorative icons or intentional aesthetic reverts. To silence a specific hit, add an inline comment containing `lint:ds-allow: <reason>` on the same line. Inside JSX, use `{/* lint:ds-allow: ... */}` between elements; inside a template-literal expression, use `/* lint:ds-allow: ... */`. **`App.jsx`'s bottom-nav uses `text-gray-400` for inactive labels intentionally** — see commit `54d0e66 revert(design): restore nav to lighter gray-400/brand-500 colors`. This is a known revert from PRD-005's stricter contrast rule. Don't "fix" it without an explicit decision to undo that revert.
- **Don't fix unrelated lint or test errors** while doing focused work. Note them in the PR description as follow-ups; don't expand scope unless the prompt explicitly asks.

## When in doubt

1. Read `docs/STATUS.md` to see which PRD phases have shipped vs. are pending
2. Read the PRD for the feature you're working on (`docs/prds/`)
3. Read the prompt for your phase (`docs/prompts/`) if one exists
4. Read `docs/schema.md` and `docs/architecture.md` for system context
5. Run `git log --oneline -20` to see recent activity for context on what just shipped
6. **Ask the user before guessing.** A short clarifying question is always better than a wrong assumption.
