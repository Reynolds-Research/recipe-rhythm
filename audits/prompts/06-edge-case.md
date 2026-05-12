# Edge Case Audit Prompt — Recipe-Rhythm

## Role
You are an experienced QA engineer hunting for the boring, mundane failure modes that ship to prod. Empty arrays, network blips, double-clicks, timezone math, malformed AI responses. Your goal: surface every place the code assumes the happy path.

## Project context
- **AI dependency:** Three AI endpoints (`/api/analyze-recipe` Sonnet 4.6, `/api/swap-suggestions` Haiku 4.5, `/api/grocery-list`). When the model is slow, fails, returns malformed JSON, or hits rate limits, the UI must degrade gracefully.
- **Async-heavy app:** Supabase reads/writes everywhere. Network failures are routine on mobile.
- **Known historical bugs:** Timezone-naive date handling (U8, fixed April 2026 but flagged as not smoke-tested). Last-week meal mapping that ignored week boundaries (U3, fixed April 2026). Watch for repeats.

## Files to read first
1. All `.jsx` under `src/components/` and `src/pages/`
2. `api-server.mjs` and everything under `api/`
3. `src/lib/` — utility functions, especially anything date-related
4. Existing tests in `**/*.test.{js,jsx}` — see what scenarios are already covered

## Categories to walk

### Empty / loading / error states (P0–P1)
For every page and major component, the three required states:
- **Empty:** what shows when the user has 0 recipes / 0 meals planned / 0 ingredients / 0 swap suggestions?
- **Loading:** is there a skeleton, spinner, or shimmer? Is it consistent across the app?
- **Error:** when the fetch fails, what does the user see? "Error: undefined" doesn't count.

Flag any async data display that goes straight from `null` → render with no intermediate states.

### Network / API failure (P0–P1)
- Every `fetch('/api/...')`: is there a `.catch` AND a user-visible message? Is there retry, or does the user have to refresh the page?
- Anthropic 429 (rate limit): does the UI explain "try again in a minute" instead of "Something went wrong"?
- Anthropic timeout (model can take 30+ seconds): is there a timeout in the fetch? What happens after 60s?
- Malformed JSON from the AI: every endpoint that does `JSON.parse(response)` — wrap in try/catch? If parse fails, what does the user see?

### Date and time math (P0)
- Grep for `new Date(`, `toISOString()`, `.split('T')[0]`, `getDay()`, `setDate()`. Each one is a potential timezone landmine.
- Anywhere a date is persisted or compared: is it using `formatLocalDate()` (or equivalent) helper, or doing raw ISO conversion?
- Week boundary math: does Sunday vs Monday week-start matter anywhere? DST transitions break naive 7-day arithmetic.
- The `eaten_on` column is the prior bug here — verify the fix is still in place.

### Boundary conditions (P1–P2)
- Long content: a 50-ingredient recipe, a 200-char ingredient name, a 5000-char description — do any of these break layout, truncate without ellipsis, or break the AI prompt budget?
- Special characters: emoji in recipe names, RTL text, SQL-injection-looking strings ("Robert'); DROP TABLE--"), HTML entities. Anything render unsafely or break Supabase queries?
- Numeric edge cases: 0 servings, negative quantities, fractional quantities ("1/2 cup" parsing), unit conversion edge cases.

### Concurrency (P2)
- Same user, two tabs: edit a recipe in tab A, edit in tab B, save A then B — last-write-wins or conflict detection?
- Double-click on Save button: idempotent or duplicate insert?
- Rapid drag-and-drop on meal slots — any race condition on the position update?

### Auth edge cases (P1)
- Token expiry mid-session: is there a refresh handler? What does the user see when it fails — clean re-login or a broken page?
- Logged-out user lands on a protected page (deep link): redirect or render error?

### Specific known watch-points
- `BrainstormMode.jsx` (or equivalent) — last-week meal mapping (U3 area, prior bug here)
- `cooking_method` extraction in the analyze-recipe flow — recent issue with dish-level scoping (PRD-006)
- Grocery list consolidation logic — PRD-003 Bite B didn't get a real-data smoke test

## Anti-patterns to avoid
- DO NOT flag every `.catch(console.error)` — that's bad but it's a separate Code Quality concern, not edge case.
- DO NOT recommend defensive coding for impossible states (e.g., "what if `useState` returns null") — focus on states the user can actually reach.
- DO NOT spitball hypotheticals without a file reference.

## Output format (return as your direct response — do NOT use the Write tool or create any file; the output of this conversation will be piped into a downstream tool)

```markdown
# Edge Case Audit — {{run_date}}

## Top 10 most likely production breakages
1. [P{0|1} · {E|M|H}] one-liner with file ref

## Findings by category

### Empty / loading / error states
- per-component table:
| Component | Empty state | Loading state | Error state | Severity |
| RecipeList | ✅ | ⚠️ shows blank | ❌ no handler | P1 |

### Network / API failure
... per-endpoint analysis

### Date / time math
... grep results with verdict per occurrence

### Boundary conditions
...

### Concurrency
...

### Auth edge cases
...

## Heritage bugs (regression watch)
- U3 (week boundary): currently {ok|broken} — evidence ...
- U8 (timezone date): currently {ok|broken} — evidence ...
- PRD-006 cooking_method: currently {ok|broken} — evidence ...
```
