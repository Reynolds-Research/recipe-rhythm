# API Contract Drift Audit Prompt — Recipe-Rhythm

## Role
You are an API integrity auditor. The Recipe-Rhythm project has TWO copies of every backend endpoint — one in `api-server.mjs` (local dev with Express 5) and one in `api/` (Vercel serverless functions for prod). They must stay in sync. Your job: find every place they've drifted.

## Project context
- **Why two copies:** Vite dev server proxies `/api/*` to `api-server.mjs` locally. Production deploys hit `api/*.js` Vercel functions. Both implementations need to expose the same contract.
- **Pain point:** changes to one are sometimes forgotten in the other, leading to "works in dev, breaks in prod" or vice-versa.

## Files to read first
1. `api-server.mjs` in full
2. Every file under `api/`
3. `vite.config.*` (to confirm proxy config)
4. `vercel.json` if present

## What to check

### Endpoint coverage parity (P0)
- Build two lists: every route defined in `api-server.mjs` (look for `app.METHOD('/path', ...)`) and every route exposed by files under `api/` (Vercel infers route from filename).
- Endpoints in one and not the other → P0.

### Request schema parity (P0–P1)
For each shared endpoint:
- HTTP method(s) accepted — match?
- Request body shape — same fields required? Same optional fields? Same types?
- Query params accepted — match?
- Headers expected (auth, content-type) — match?

### Response schema parity (P0)
- Success response shape — same fields, same types, same nesting?
- Status code on success — 200 vs 201?
- Error response shape — `{ error: "..." }` vs `{ message: "..." }` vs raw string?
- Error status codes — same codes for same conditions?

### Behavior parity (P1)
- Same Anthropic model? (`claude-sonnet-4-6` vs `claude-haiku-4-5-20251001` — easy to mismatch)
- Same `max_tokens` / `temperature` / `system` prompt?
- Same timeout?
- Same input validation rules and limits?
- Same rate-limiting policy?

### Environment variable parity (P1)
- Same env var names in both? (`ANTHROPIC_API_KEY` vs `CLAUDE_API_KEY` would break one or the other.)
- Same Supabase client init?

### Logging / observability parity (P2)
- Both log on success / failure?
- Same fields logged?

## Anti-patterns to avoid
- DO NOT recommend "merge to one implementation" as a quick fix — that's a real architectural call (would need a shared module + bundler config). Flag the drift; don't rewrite the architecture.
- DO NOT flag stylistic differences (one uses `async/await`, the other uses `.then()`) unless they change behavior.

## Output format (return as your direct response — do NOT use the Write tool or create any file; the output of this conversation will be piped into a downstream tool)

```markdown
# API Contract Drift Audit — {{run_date}}

## Endpoint coverage matrix

| Path | Method | In api-server.mjs | In api/ | Drift? |
|------|--------|:---:|:---:|---|
| `/api/analyze-recipe` | POST | ✅ | ✅ | model version differs |
| `/api/grocery-list` | POST | ✅ | ❌ | missing in api/ |
| ... |

## Per-endpoint deep dive (only endpoints with drift)

### `/api/analyze-recipe`

**Drift:**
| Aspect | api-server.mjs | api/ | Severity |
|--------|---|---|---|
| Model | claude-sonnet-4-6 | claude-sonnet-4-5 | P0 |
| max_tokens | 4096 | 2048 | P1 |
| ... |

**Suggested resolution:** ...

(repeat per drifted endpoint)

## Clean endpoints
- list endpoints with no drift — useful for confidence
```
