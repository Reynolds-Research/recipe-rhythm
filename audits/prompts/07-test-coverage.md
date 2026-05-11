# Test Coverage Gap Audit Prompt — Recipe-Rhythm

## Role
You are a testing-focused engineer identifying the highest-risk untested code in the Recipe-Rhythm app. The goal isn't 100% coverage — it's confidence that the critical paths won't silently regress.

## Project context
- **Testing stack:** Vitest 4 + @testing-library/react 16 + @testing-library/user-event 14 + jsdom 29 for unit/integration; Playwright 1.59 for e2e.
- **Known coverage gaps from memory:** PRD-002 Phase 1 (U3 + U8 date handling) shipped without smoke tests; PRD-003 Bite B (`/api/grocery-list`) has only mocked unit tests, no real-data smoke. These are *known* gaps — your job is to find the rest.
- **Critical user flows** (must have e2e coverage):
  1. Sign up / log in
  2. Save a recipe (manual entry + AI-parsed paste)
  3. Plan a week of meals (drag-and-drop)
  4. Generate a grocery list
  5. Swap a meal via AI suggestion

## Files to read first
1. `vitest.config.*`
2. `playwright.config.*`
3. All `**/*.test.{js,jsx}` and `**/*.spec.{js,jsx}`
4. `src/components/` and `src/pages/` — the surface to compare against
5. `api-server.mjs` and `api/` — list every endpoint
6. Recent commit history (`git log --since="30 days ago" --name-only`) — were tests added alongside recent feature work?

## What to check

### Component coverage gaps (P1–P2)
- For every `.jsx` file in `src/components/` or `src/pages/`, check whether a matching `.test.jsx` file exists.
- High-priority components (anything in a critical user flow above) without tests → P1.
- Leaf components (presentational, no logic) without tests → P3, ignore unless the file has conditionals.

### API endpoint coverage gaps (P0–P1)
- Enumerate every endpoint in `api-server.mjs` and `api/`. For each, is there at least one test?
- AI endpoints (`/api/analyze-recipe`, `/api/swap-suggestions`, `/api/grocery-list`): are there tests that mock the Anthropic call? Are there ANY tests that hit real data (smoke tests)?
- The grocery-list endpoint is a known smoke-test gap — confirm it's still untested with real-shaped data.

### Critical flow e2e coverage (P0)
- For each of the 5 critical flows, search `playwright/` or `e2e/` for a test file matching that flow. Flag every flow without an e2e test as P0 if it's a flow that has shipped.
- For flows with e2e tests, do they cover the unhappy path (auth failure, AI failure, empty state) or only the happy path?

### Branch coverage in `lib/` (P2)
- Functions in `src/lib/` (or wherever pure helpers live) with branching logic (`if`, `switch`, ternary) — are all branches exercised by tests? Look for tests that hit one branch but not the others.
- Date helpers (`formatLocalDate`, week-boundary helpers) are highest priority given the U3/U8 history.

### Recent commit hygiene (P2)
- Run `git log --since="30 days ago" --pretty=format:"%h %s" --name-only` and group commits by feature.
- For each non-trivial feature commit, was a test file added or modified in the same commit (or a follow-up PR)? If not, flag.

### Test quality smells (P3)
- Tests that only assert "renders without crashing" but no behavior.
- Tests that mock the entire module being tested.
- `expect(...).toBeTruthy()` on something that isn't actually checked.
- `it.skip` / `describe.skip` left in code.
- TODOs in test files.

## Anti-patterns to avoid
- DO NOT recommend "add a test for X" without specifying what assertion the test should make.
- DO NOT recommend chasing % coverage targets. Always tie a recommendation to risk.
- DO NOT flag missing tests for pure styling components.

## Output format (write to `audit-output.md`)

```markdown
# Test Coverage Gap Audit — {{run_date}}

## Headline numbers
- Components: M of N have a test file
- API endpoints: M of N have at least one test
- Critical flows with e2e: M of 5
- Smoke tests for AI endpoints: M of 3

## P0 — Critical flow gaps
| Flow | Status | Recommended test |
| Sign up / log in | ❌ no e2e | Add `auth.spec.js` covering happy + invalid creds |
| ... |

## P1 — High-risk untested code
- per-file table with the recommended test name and one-line scenario

## P2 — Test quality issues
- skipped tests, weak assertions, mock-the-thing-you-test patterns

## What's well-covered
- callouts where coverage is genuinely good — useful for confidence
```

If recent commits look well-tested, say so. The point is calibration, not pessimism.
