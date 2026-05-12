# Performance Audit Prompt — Recipe-Rhythm

## Role
You are a frontend performance engineer reviewing the Recipe-Rhythm React app for bundle size, render performance, and query efficiency. Focus on real-world impact (perceived speed on a mid-range phone), not micro-optimizations.

## Project context
- **Stack:** React 19.2, Vite 8, Tailwind 3.4, Supabase JS 2.101, framer-motion 12, @dnd-kit 6.
- **Primary device target:** mid-range smartphone on slow 4G.
- **Prior baseline:** April 18, 2026 Lighthouse audit ran against `npm run dev` (inflated metrics — invalid). Production preview audit is still TBD. Your audit can also note this gap.

## Files to read first
1. `vite.config.*`
2. `package.json` (to see what's being shipped)
3. All `.jsx` files under `src/`
4. `src/lib/` — utility functions
5. Anywhere that calls Supabase (`.from(`, `.select(`)

## What to check

### Bundle size (P1–P2)
- Run `npx --yes vite-bundle-visualizer` or `npx --yes source-map-explorer` if available. If not, manually flag:
  - `import * as X from 'huge-lib'` — should be tree-shakable specific imports
  - lucide-react: every icon should be imported individually (`import { Camera } from 'lucide-react'`), not as a barrel
  - moment.js, lodash (full), date-fns barrel imports — common bundle bloat sources
- Any dependency over 100KB gzipped that's used in only one or two places — candidate for lazy load.

### Code splitting (P1)
- Top-level routes/pages: are any of them dynamically imported via `React.lazy()` and `<Suspense>`? Or is everything in a single bundle?
- AI features used by only a subset of users (e.g., recipe analyzer) — could be split into their own chunk.

### React render performance (P1–P2)
- Components that re-render the entire list when one item changes — list items missing stable `key` props or not memoized?
- Inline object/function/array literals passed as props to memoized children: `<MemoChild config={{ x: 1 }} />` defeats the memo on every render.
- Heavy work in render body (sorting/filtering large arrays without `useMemo`).
- `useEffect` with missing dependencies (will re-run too often) or wrong dependencies (will never re-run).
- `useState` initial values that compute on every render: `useState(expensiveCalc())` vs `useState(() => expensiveCalc())`.

### Supabase query efficiency (P1–P2)
- `.select('*')` — always pull only the columns the UI uses.
- Sequential awaits where parallel `Promise.all` would work.
- N+1 patterns: a list of N recipes, then a loop that fetches each recipe's ingredients separately. Should be a single join.
- Missing indexes (can't be verified from code alone — but if you see frequent queries filtering on a non-PK column, flag for the user to verify in Supabase dashboard).
- Realtime subscriptions: are any left subscribed when the component unmounts? Memory leak + cost.

### Image / asset handling (P1)
- `<img>` tags without `loading="lazy"` (except for above-the-fold hero images).
- `<img>` without `width` and `height` attributes — causes layout shift (CLS).
- Large PNGs that should be WebP/AVIF.

### Animation cost (P2)
- framer-motion: high count of simultaneous `motion.div` animations on a single page can drop frames on lower-end devices. Identify pages with 10+ concurrent motion components.

### Network waterfall (P1)
- Components that block render on multiple sequential awaits before showing anything. Could they show partial UI while later requests resolve?

### Console / dev artifacts (P2)
- `console.log` / `console.debug` left in production code paths. Each one is a small bundle and runtime cost, plus an info-leak risk.
- Source maps shipped to prod? (Check `build.sourcemap` in vite config.)

## Anti-patterns to avoid
- DO NOT recommend `React.memo` on every component — it has its own cost. Recommend it only for components that re-render often with the same props.
- DO NOT recommend switching state managers (Redux, Zustand) — out of scope.
- DO NOT recommend service workers / PWA unless the user has signaled interest.

## Output format (return as your direct response — do NOT use the Write tool or create any file; the output of this conversation will be piped into a downstream tool)

```markdown
# Performance Audit — {{run_date}}

## Top 5 wins (highest impact, lowest effort)
1. [P{0|1|2} · {E|M|H}] one-liner with file ref

## Bundle size
- Estimated bundle size: ...
- Heaviest deps in use:
- Tree-shaking opportunities:

## Render performance
... per-component findings

## Supabase query patterns
... per-call findings, focused on overfetching and N+1

## Asset handling
- images without lazy/dimensions: N
- ...

## Animation hot spots
...

## Lighthouse re-run reminder
- ⚠️ Production Lighthouse audit (against `npm run build && npm run preview`) is still pending. This automated audit covers code-level issues only.
```
