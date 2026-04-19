# Architecture

## Runtime shape

```
                ┌────────────────────┐
                │  Browser (client)  │
                │  React + Vite app  │
                └─────────┬──────────┘
                          │
         fetch('/api/..') │   (proxied by Vite in dev)
                          │
                ┌─────────▼──────────┐
                │   api-server.mjs   │
                │  Express on :3001  │
                │  holds the key     │
                └─────────┬──────────┘
                          │
            Anthropic SDK │  (ANTHROPIC_API_KEY, server-only)
                          │
                ┌─────────▼──────────┐
                │   api.anthropic    │
                │       .com         │
                └────────────────────┘
```

Supabase (auth + Postgres + storage) is called directly from the client
using the public anon key; that's a separate trust boundary secured by
RLS and is not proxied.

## Why the proxy exists

Vite inlines any `VITE_*`-prefixed env var into the public client
bundle. Shipping `VITE_ANTHROPIC_API_KEY` meant anyone who opened the
deployed site could extract the key from DevTools and spend the
Anthropic budget (see `AUDIT.md` C1).

The fix: move every Anthropic call server-side. The client never sees
the key — it only calls `/api/analyze-recipe` and `/api/swap-suggestions`
on the same origin. The server (`api-server.mjs`) reads
`ANTHROPIC_API_KEY` (no `VITE_` prefix, not shipped to the browser) at
startup and forwards requests to Anthropic on behalf of the client.

A Vitest check in `src/__tests__/no-anthropic-sdk-in-client.test.js`
fails the build if any client source file re-introduces the SDK, the
`api.anthropic.com` URL, the `anthropic-dangerous-direct-browser-access`
header, or the `VITE_ANTHROPIC_API_KEY` env var name.

## Endpoints

| Method | Path                      | Purpose                                          |
|--------|---------------------------|--------------------------------------------------|
| GET    | `/health`                 | Liveness probe. Returns `{ status: 'ok' }`.      |
| POST   | `/api/analyze-recipe`     | Extracts component metadata for a recipe.        |
| POST   | `/api/swap-suggestions`   | Returns 3 AI-suggested dinner recipe names.      |

Both `/api/*` endpoints return `503 { error: 'api_key_missing' }` when
`ANTHROPIC_API_KEY` is unset and `502 { error: 'upstream_failed' }` or
`{ error: 'parse_failed' }` on upstream issues.

## Running locally

1. Copy `.env.example` to `.env` and fill in values.
2. `npm install`
3. `npm run dev`

`npm run dev` runs Vite (`:5173`) and `api-server.mjs` (`:3001`)
concurrently via `concurrently`. Vite's dev server proxies `/api/*`
to `:3001` (see `vite.config.js`), so the client just calls relative
paths like `fetch('/api/analyze-recipe')`.

Individual processes:
- `npm run dev:client` — Vite only
- `npm run dev:api` — api-server only
- `npm run start:server` — alias for running the server in production

## Deployment (TODO)

The proxy is a standalone Node process; production is out of scope for
the initial change. Reasonable options:

- **Render / Fly.io / Railway** — run `node api-server.mjs` as a
  long-lived service; set `ANTHROPIC_API_KEY` and `CORS_ORIGIN` as
  secrets; point the client at the service's origin (or co-locate).
- **Vercel / Netlify / Cloudflare Functions** — port each route to a
  serverless function. The handlers are thin on purpose so this is
  mostly copy/paste.

Either way:
1. Set `ANTHROPIC_API_KEY` (no `VITE_` prefix) as a server-only secret.
2. Tighten `CORS_ORIGIN` from the dev default (`http://localhost:5173`)
   to the deployed client origin.
3. Add rate limiting and auth before exposing publicly — see follow-up
   below.

## Known follow-ups

- **Rate limiting**: `/api/*` is currently open. Anyone who can reach
  the server can spend the Anthropic budget. Before public deploy, add
  `express-rate-limit` and verify a Supabase JWT per request.
- **Unified request validation**: request bodies are currently trusted.
  A lightweight schema (zod/valibot) would reject malformed payloads
  before they reach Anthropic.
