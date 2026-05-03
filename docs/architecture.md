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

## Design system rules

Recipe-Rhythm has a small enforced design system, captured in PRD-005. The
sanctioned scales below are the only spacing/typography/color values new code
should use. CI guardrail (PRD-005 P0.12) fails the build on banned patterns.

### Spacing scale

| Token | Tailwind | Px | Use |
|---|---|---|---|
| 1 | `p-1` / `gap-1` | 4 | tight (icon padding) |
| 2 | `p-2` / `gap-2` | 8 | default tight (chip internals) |
| 3 | `p-3` / `gap-3` | 12 | inputs, buttons (vertical) |
| 4 | `p-4` / `gap-4` | 16 | card-internal default |
| 6 | `p-6` / `gap-6` | 24 | section gap, page horizontal padding |
| 8 | `p-8` / `gap-8` | 32 | major break |
| 12 | `p-12` / `gap-12` | 48 | hero / extra emphasis |

**Banned for new code:** `p-0.5`, `p-1.5`, `p-2.5`, `p-3.5`, `p-5`, `p-7`,
`p-9`, `p-10`, `p-11`, and any arbitrary `p-[Npx]`. The half-step values are a
sign of visual tweaking rather than a system. Existing `pb-28` / `pb-safe` for
the safe-area bottom-nav clearance is allowed; document in code where used.

### Typography scale

| Token | Tailwind | Px / line-height | Use |
|---|---|---|---|
| metadata | `text-xs leading-4` | 12 / 16 | timestamps, tertiary tags ONLY (never body) |
| secondary | `text-sm leading-5` | 14 / 20 | secondary text, button labels, chips |
| body | `text-base leading-6` | **16 / 24** | **default for all body copy** |
| heading-sm | `text-lg leading-7 font-bold` | 18 / 28 | section headings |
| heading-md | `text-xl leading-7 font-bold` | 20 / 28 | page titles |
| heading-lg | `text-2xl leading-8 font-serif italic` | 24 / 32 | hero / page subtitle |

**Banned:** `text-[11px]` and any other `text-[Npx]` arbitrary value below 14px.

### Color / contrast rules

| Use | Class | Contrast on cream-50 |
|---|---|---|
| Primary text | `text-gray-900` | 16.85:1 |
| Secondary text | `text-gray-700` | 9.79:1 |
| Tertiary / metadata | `text-gray-600` | 7.18:1 |
| Disabled / placeholder | `text-gray-500` (MINIMUM) | 4.59:1 (just clears AA) |
| Brand text on cream/white | `text-brand-700` (NOT 600 or 500) | 7.76:1 |
| White text on brand bg | only on `bg-brand-600` (4.41:1, OK at ≥18px bold) or `bg-brand-700` (8.17:1, safe at any size) | varies |

**Banned for any text:** `text-gray-400`, `text-gray-300`, `text-gray-200`. May
still be used for decorative (non-text) borders/dividers.

### Touch target rules

- All `<button>`, `<a>`, and tappable `<div>` elements: minimum 44×44px tap area.
- Icon-only buttons → `.btn-icon` (44×44 round; brand variant `.btn-icon-brand`).
- Chips → `.chip` primitive (`min-h-[44px]` with padded content).
- Inline text-action buttons ("+ ADD ANOTHER MEAL") → `.btn-text` with at least `py-3` to reach 44px.
- The bottom-nav each tap region is 1/5th of viewport × 64px — already passes; just fix the label styling.

### CI guardrail (`.github/workflows/design-system-lint.yml`)

Every PR targeting `main` runs a diff-based banned-pattern check against
any changed `src/**/*.{jsx,js}` files. The workflow fails if it finds:

| Pattern | Reason banned |
|---|---|
| `text-[10px]` … `text-[13px]` (arbitrary font-size <14px) | Sub-14px text fails WCAG AA at normal weight |
| `text-gray-200`, `text-gray-300`, `text-gray-400` | Low-contrast text — use `gray-500` minimum for UI copy |
| `(p\|px\|py\|…)-N.5` (half-step padding, e.g. `py-2.5`) | Off-scale values; use the sanctioned spacing scale only |

The check is PR-diff-scoped (not a full-repo scan) so pre-existing
violations in `DateRangePicker.jsx` and `MealNameConfirmSheet.jsx` don't
block ongoing work — but those files are tracked tech debt to fix.

Run `npm run lint:ds` locally for a full scan of `src/`.

### Primitives in `src/index.css`

The `@layer components` block in `src/index.css` is the canonical set of
building blocks. New buttons / inputs / cards / chips compose these rather
than reinventing the styling:

- `.mobile-screen` — page shell with safe-area top, `pb-16` bottom nav clearance.
- `.btn-primary` — full-width primary action; white-on-`brand-600`.
- `.btn-secondary` — full-width secondary action; `brand-700` outline + text on white.
- `.btn-icon` / `.btn-icon-brand` — 44×44 round icon buttons (neutral / brand).
- `.btn-text` — inline text-action with brand-700; meets 44px touch target via `py-3`.
- `.input-base` — text inputs.
- `.card` — content card.
- `.chip` / `.chip-selected` — selectable pill, 44px hit area.
- `.section-heading` — uppercase tracking section header (`gray-700`).
- `.body-text` — 16px body copy (`gray-700`).
- `.helper-text` — 14px helper / supporting copy (`gray-700`).

## Known follow-ups

- **Rate limiting**: `/api/*` is currently open. Anyone who can reach
  the server can spend the Anthropic budget. Before public deploy, add
  `express-rate-limit` and verify a Supabase JWT per request.
- **Unified request validation**: request bodies are currently trusted.
  A lightweight schema (zod/valibot) would reject malformed payloads
  before they reach Anthropic.
