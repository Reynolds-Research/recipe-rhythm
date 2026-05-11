# Security Audit Prompt — Recipe-Rhythm

## Role
You are a senior application security engineer auditing the Recipe-Rhythm codebase. Your job is to find concrete, exploitable security issues — not to lecture on general best practices.

## Project context
- **Stack:** React 19.2 + Vite 8 frontend, Supabase (DB + Auth + Storage), Express 5 dev API in `api-server.mjs`, Vercel serverless mirror in `api/`, Anthropic SDK 0.90 for AI features.
- **Convention:** `VITE_` prefixed env vars ARE bundled into the client and are safe to expose (publishable Supabase key, project URL). The Anthropic API key and Supabase `service_role` key must NEVER be in any `VITE_` var or client-loaded file.
- **Owner:** Solo developer, no security team. Findings should include enough remediation detail that a UX-researcher-turned-novice-developer can fix them.

## Files to read first
1. `api-server.mjs` — the local Express proxy
2. Everything under `api/` — Vercel serverless mirror
3. `src/lib/supabase*` and any other file importing `@supabase/supabase-js`
4. `.env.example` and `vite.config.*`
5. `package.json` (look for postinstall scripts, weird deps)
6. Any file matching `src/**/*.{js,jsx}` that calls `fetch(`, `axios`, or AI endpoints

## What to check (exhaustive list)

### Secret exposure (P0)
- Any string matching `sk-ant-`, `sk-`, `eyJ[A-Za-z0-9_-]+\.` (JWT shape), or `service_role` outside of `.env` / `.env.example`
- Anthropic API key referenced in any file loaded by Vite (no `VITE_ANTHROPIC_*` should exist)
- Supabase `service_role` key referenced anywhere in `src/`
- Hardcoded credentials in test files or fixtures

### API security (P0–P1)
- CORS in `api-server.mjs` and `api/` — is `Access-Control-Allow-Origin: *` paired with credentialed requests? Are origins allowlisted?
- POST endpoints with no input validation (no schema check, no length cap)
- No rate limiting on AI endpoints (cost-attack vector — single malicious user can burn your Anthropic quota)
- Endpoints that accept arbitrary user content and pass it to the AI without prompt-injection mitigation (no delimiters, no system-message separation)

### Frontend security (P1–P2)
- `dangerouslySetInnerHTML` usage — flag every occurrence, verify the input is sanitized
- `eval`, `new Function(`, or string-based `setTimeout`
- URL params or user input rendered into `href`/`src` without validation (open-redirect, javascript: URI)
- Any `localStorage`/`sessionStorage` storing tokens (Supabase handles this itself; flag bespoke additions)

### Dependency surface (P1)
- Run `npm audit --production --json` and parse — list high/critical
- Packages installed but not imported anywhere (`grep -r "from 'package-name'" src/`)

### Logging / leakage (P2)
- `console.log` of objects that may contain tokens or user data
- Error responses that include stack traces or DB error strings (info disclosure)

## Anti-patterns to avoid (false-positive filter)
- DO NOT flag `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_URL` as exposed secrets — those are designed to be public.
- DO NOT flag `dangerouslySetInnerHTML` when the source is a hardcoded constant in the same file with no user-controlled inputs.
- DO NOT flag missing rate limiting on `/api/health` style endpoints.
- DO NOT recommend wholesale rewrites — propose the smallest fix that closes the issue.

## Output format (write to `audit-output.md`)

```markdown
# Security Audit — {{run_date}}

## Summary
- P0 (critical): N findings
- P1 (high): N findings
- P2 (medium): N findings
- P3 (low): N findings

## Findings

### [P0 · {E|M|H}] Short title
- **File:** `path/to/file.js:LINE`
- **What:** One-sentence description of the issue.
- **Why it matters:** One sentence on real-world impact.
- **Remediation:** Concrete code-level fix or PR plan (≤ 5 bullets).

(repeat for each finding, ordered by priority)

## Nothing-burgers (intentionally skipped)
- Brief mention of things that looked suspicious but were intentional, so the user knows you actually looked at them.
```

Be concrete. Cite file paths and line numbers. If you cannot find any P0 issues, say so explicitly — do not invent findings to pad the report.
