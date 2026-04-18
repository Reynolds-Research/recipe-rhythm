# Recipe Rhythm — Code & Product Audit

_Generated April 17, 2026_

---

## 1. Perceived Purpose

Recipe Rhythm is a **mobile-first, single-user meal-tracking and weekly meal-planning web app**, presented as a personal gift ("For My Wife" appears in the auth screen, log header, brainstorm header, and grocery list). It has three modes, exposed via a bottom tab bar:

1. **Log** — Low-friction "what did you eat tonight?" capture using voice (Web Speech API) or text. One tap saves to the meals table; an optional "Save to Cookbook" prompt then runs an AI-classified copy into the Vault.
2. **Brainstorm (Prep Table)** — The Sat/Sun planning surface. Shows last week's meals, then generates a Sun–Thu suggested plan from the Vault, blending in AI-suggested wildcards via swap. Plan can be reordered (drag-and-drop), served (locked + persisted), shared (native share sheet), and exported as a categorized grocery list.
3. **Vault (Cookbook)** — The recipe library. Each recipe has rich component metadata (cuisine, flavor, proteins, cooking method, carb base, dietary tags, dairy, vegetables, fruits) auto-filled from name/URL/photo via the Claude API. Custom tags persist per category in localStorage.

**Stack:** React 19 + Vite 8 + Tailwind 3 + Supabase (auth/Postgres/storage) + Anthropic API (called directly from the browser) + @dnd-kit for sortable lists. Tests via Vitest + Testing Library + Playwright. The "anti-rut" recommendation engine in `src/lib/recommendations.js` scores Vault items by recency, frequency, and attribute diversity.

The app's heart is solid: it's a thoughtful, opinionated tool that captures a real workflow (log nightly → plan weekly → shop → repeat) and uses AI as a quiet helper rather than the main attraction.

---

## 2. Gaps & Weaknesses

Findings are grouped by severity. Each item explains _what_, _why it matters_, and _where it lives_.

### 🚨 Critical — Security & Secrets

**C1. Anthropic API key is bundled into the public client JavaScript.**
- Where: `src/lib/analyzeRecipe.js:7`, `src/pages/BrainstormMode.jsx:195`, and confirmed in compiled `dist/assets/index-DYAkvDo5.js`.
- Why it matters: Vite inlines any `VITE_*` env var into the client bundle. Anyone who loads your deployed site can open DevTools, find the key, and run unlimited Claude requests on your bill. The header `anthropic-dangerous-direct-browser-access: 'true'` literally acknowledges this is dangerous.
- Standard fix: proxy AI calls through a server-side function (Supabase Edge Function, Vercel/Cloudflare function) so the key stays on the server.

**C2. `.env.example` contains real Supabase credentials.**
- Where: `.env.example`.
- Why it matters: `.env.example` should hold placeholder values like `VITE_SUPABASE_URL=https://your-project.supabase.co`. Real values get checked into git. The Supabase anon key is _technically_ public-safe **if and only if** Row-Level Security (RLS) is configured on every table — which we can't verify from the repo.

**C3. No evidence of Row-Level Security policies in the repo.**
- Where: nothing under `supabase/`, no `migrations/`, no schema docs.
- Why it matters: The whole security model rests on RLS being correctly configured in Supabase. If a single table (vault, meals, meal_plans, recipe_images bucket) is missing the right policy, any user can read/write any other user's data using the public anon key. The error message in `Vault.jsx:362` ("Please verify that your Supabase 'recipe_images' bucket has a permissive INSERT policy…") suggests the configuration is informal and bug-prone.

### 🟠 High — Documentation & Onboarding

**H1. README is the default Vite template.**
- Where: `README.md`.
- Why it matters: A new contributor (or future you in 6 months) has zero context — no project description, setup steps, env-var list, deployment notes, or screenshots. The README is the single most-read file in any repo; the current one says nothing about Recipe Rhythm.

**H2. `package.json` name is `recipe-app`, not `recipe-rhythm`.**
- Where: `package.json:2`.
- Naming inconsistency that will confuse logs, error reports, and any deploy that uses the package name.

**H3. No database schema documentation.**
- Why it matters: Tables `meals`, `vault`, `meal_plans` and bucket `recipe_images` are referenced in code but never defined in-repo. New environments can only be reproduced by trial-and-error.

### 🟠 High — Testing

**H4. Test coverage is thin and uneven.**
- Tests present: `src/lib/__tests__/analyzeRecipe.test.js`, `src/lib/__tests__/recommendations.test.js`, `src/pages/__tests__/BrainstormMode.test.jsx`, `src/pages/__tests__/Vault.test.jsx`, plus 2 Playwright e2e specs.
- **Untested:** the entire Auth flow, LogMode (the daily-use page), `useSpeech` hook, drag-and-drop reordering, Serve flow, Share, grocery-list generation, and most error paths.
- Why it matters: with critical paths untested, every refactor is a small bet against regressions.

**H5. No CI configuration.**
- Where: no `.github/workflows/` or equivalent.
- Tests won't run on push/PR, so they only catch what the developer remembers to run locally.

### 🟡 Medium — Architecture & Code Quality

**M1. God components.**
- `src/pages/Vault.jsx` is **855 lines**, `src/pages/BrainstormMode.jsx` is **791 lines**.
- Why it matters: Mixing form, list, card, picker, and data-fetching in one file makes review, testing, and reuse harder. Both files would benefit from splitting (e.g., `Vault/`, with `RecipeForm.jsx`, `RecipeCard.jsx`, `ChipPicker.jsx`, `useVault.js`).

**M2. Half-built Spoonacular wildcard feature.**
- Where: `recommendations.js:9` references "Spoonacular wildcards", `BrainstormMode.jsx:295` mentions Spoonacular, `.env` has `VITE_SPOONACULAR_KEY=` (empty), but no fetch is ever made. `getRecommendations(..., wildcards=[])` is always called with an empty array, so the `WILDCARD_RATIO = 0.2` does nothing.
- Either delete the dead code/config or finish the integration.

**M3. Dead/confused code in drag handler.**
- Where: `BrainstormMode.jsx:385-413` (`handleDragEnd`).
- The variables `movedItem` and `targetItem` are computed and never used. A comment ("Actually, dnd-kit usually reorders the entire object") suggests the author iterated mid-edit and didn't clean up. Should be safe but smells unfinished.

**M4. No global state, leading to duplicate fetching.**
- `App.jsx` fetches `recentMeals`, `BrainstormMode.jsx` re-fetches them with a wider window, `Vault.jsx` fetches its own list. A simple Context or query-cache layer (TanStack Query, Zustand) would centralize.

**M5. JavaScript instead of TypeScript.**
- The Vault item has ~12 fields with strict allowed-value enums. TS would catch typos in field names and invalid enum values at compile time, instead of producing silent nulls in the database.

**M6. localStorage usage is unversioned.**
- Keys `brainstorm_plan`, `brainstorm_plan_days`, `vault_extra_*` will silently break (or load garbage) if the schema ever changes. A `version` field + migration helper would protect.

**M7. No React error boundaries.**
- A single render error anywhere in the tree blanks the whole app. An error boundary at the page level (or per route) would let one mode fail gracefully.

**M8. Inconsistent feedback patterns.**
- Some success/errors use `alert()` (janky on mobile, blocks the UI thread), others use inline banners, others use console errors only.

### 🟡 Medium — UX & Functional Gaps

**U1. No password-reset, no email-verification flow.**
- Auth.jsx supports sign-in and sign-up only. Forgotten-password is a basic table-stakes flow.

**U2. Recommendation engine is non-deterministic.**
- `recommendations.js:113` adds `Math.random() * 15` to scores. That makes "Regenerate" feel fresh but also makes testing brittle and behavior surprising. Worth seeding the randomness or making it user-controllable.

**U3. Last-week mapping ignores week boundaries.**
- `BrainstormMode.jsx:323` (`buildLastWeekSlots`) finds the first meal whose weekday matches a label. If the recent-meals window contains two Tuesdays, you get the most-recent — but a meal eaten 6 days ago could still appear under a label that visually implies "this Monday."

**U4. Grocery list is just a Set of ingredient names.**
- No quantities, no units, no consolidation across meals. Useful as a checklist, not as an actual shopping list.

**U5. Mobile-only layout (`max-w-sm`) looks broken on desktop.**
- The whole app is constrained to ~384px wide regardless of viewport. Fine for the intended use, but worth a responsive note in docs.

**U6. Hardcoded option lists.**
- All cuisines, proteins, methods, etc. live in `Vault.jsx`. Adding a new cuisine type means editing code (and remembering to update the AI prompt in `analyzeRecipe.js` too).

**U7. No multi-user / family sharing.**
- Single-user model only. If the wife and partner both want to edit the same plan, they can't.

**U8. Timezone-naive date handling.**
- `eaten_on` uses `new Date().toISOString().split('T')[0]` (UTC date), but display uses local time. Logging at 11pm Pacific writes "tomorrow's date" in UTC.

### 🟢 Low — Polish & Accessibility

**L1. Icon-only buttons missing accessible labels.**
- Sign-out button (`App.jsx:54`), mic toggle, feedback mailto. They have `title` tooltips but no `aria-label`, so screen readers may announce nothing useful.

**L2. Drag-and-drop has no keyboard alternative.**
- @dnd-kit supports keyboard sensors; none are configured.

**L3. Bleeding-edge dependency versions.**
- React 19.2, Vite 8, lucide-react 1.7, eslint-plugin-react-hooks 7 are all very recent. Pinning major versions and watching for breaking releases is fine; just be aware upstream churn is more likely than on LTS.

**L4. No PWA manifest / offline support.**
- App is mobile-first but won't install as an app or work offline. The `apple-touch-icon.png` is the only nod to mobile installability.

**L5. Decorative `.DS_Store` files committed in places.**
- Filesystem-level minor noise.

---

## 3. What's Working Well (Worth Keeping)

To balance the criticism — these are notably strong:

- The **recommendation engine** in `recommendations.js` is well-commented, well-structured, and reflects real product thinking (recency penalty + diversity bonus + frequency reward + randomness).
- The **Save-to-Cookbook prompt** after logging is a clever, friction-free way to grow the Vault organically.
- **Voice-first logging** is the right input modality for the use case (one hand free, dinner table).
- The **Serve / lock state** for plans is a nice ritual cue and prevents accidental edits to a shipped plan.
- Code is generally **readable and consistently styled** — Tailwind classes are tidy, function/variable names are descriptive, and there are useful inline comments throughout.

---

## 4. Suggested Priority Order

If you want to act on this:

1. **Move the Anthropic API key off the client** (C1) — actively losing money risk.
2. **Verify and document RLS policies** on every Supabase table and the storage bucket (C3, H3).
3. **Replace `.env.example` with placeholders** (C2).
4. **Write a real README** with setup, env vars, schema, and deploy steps (H1).
5. **Add CI** to run unit + e2e tests on every push (H5).
6. **Either finish or remove Spoonacular wildcards** (M2).
7. Everything else is incremental.

---

_End of audit._
