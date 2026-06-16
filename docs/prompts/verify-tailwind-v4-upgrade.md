# Claude Code Prompt — Verify the Tailwind v4 + React 19.2.6 upgrade (no PRD)

**For:** Claude Code (executor)
**Authored by:** Cowork (planning surface) on 2026-06-16
**Type:** Verification + doc sync, not a PRD phase. Will NOT move `docs/STATUS.md` phase lines (but DOES update `CLAUDE.md`).
**Roadmap item:** Sprint 1, item 1.6 (`docs/ROADMAP.md`).
**Context:** Dependabot merged React 19.2.4 → 19.2.6 (PR #118) and **Tailwind CSS v3.4 → v4** (PR #119, with `312a361 "resolve Tailwind CSS v3 → v4 breaking changes"`). A major CSS-framework version jump merged automatically; this task confirms nothing regressed and syncs the docs.

---

## ⚠ Pre-flight

```bash
EXPECTED="/Users/Matt/projects/recipe-rhythm"
ACTUAL="$(git rev-parse --show-toplevel 2>/dev/null)"
[ "$ACTUAL" = "$EXPECTED" ] || { echo "ABORT: not in recipe-rhythm repo root"; exit 1; }
git fetch origin
git switch -c chore/verify-tailwind-v4 origin/main   # verify the UPGRADED main, not an old branch
npm ci
node -e "console.log('tailwind:', require('./node_modules/tailwindcss/package.json').version)"  # confirm v4.x
```

> Do this on a branch off **latest `origin/main`** — older branches (e.g. `chore/prd-002-p26-...`) predate the bump and still pin Tailwind 3.4.19.

---

## What to check

This is mostly **verification**; only fix what's actually broken. Keep any fixes minimal.

### 1. Build + tests green
- `npm run build` (or the project build command) completes without errors.
- `npm test` passes. Pay attention to component tests that assert on classnames or computed styles — Tailwind v4 changed some defaults.
- Run the **design-system lint guardrail** (PRD-005 P0.12, shipped PR #70). Confirm it still runs under v4 and reports no new violations. If the guardrail itself broke on the toolchain change, fixing it is in scope (it's a CI gate).

### 2. Known Tailwind v3 → v4 breaking-change hotspots
PR #119's commit `312a361` already addressed some. Re-confirm none slipped through. Common v4 breakages to grep for:
- **Config format.** v4 prefers CSS-first config (`@theme` in CSS) over `tailwind.config.js`; confirm the project's config style is internally consistent and actually being picked up. Check `index.css` / the PostCSS pipeline.
- **Renamed/removed utilities.** e.g. `shadow-sm`→`shadow-xs` semantics, `bg-opacity-*`/`text-opacity-*` deprecated in favor of slash opacity (`bg-black/50`), `flex-grow`→`grow`. Grep the codebase for deprecated forms.
- **Default color palette / ring / border-color defaults** changed in v4 — eyeball that brand colors and AA-contrast buttons (`.btn-primary` → `bg-brand-600`, per PRD-005) still render correctly.
- **PostCSS plugin** — v4 uses `@tailwindcss/postcss`; confirm it's installed and wired, not the old inline plugin.

### 3. Visual smoke test (preview deployment)
- Push the branch; let Vercel build a preview. Check status + build logs via the **Vercel MCP**.
- Using the test credentials in `.claude/test-credentials.md`, eyeball the four core surfaces on the preview: **Log, Prep Table, Calendar, Cookbook** — plus the Settings sheet and the grocery bottom sheet. Look for broken spacing, missing colors, collapsed layouts, invisible buttons.
- Capture a screenshot or two for the PR.

### 4. Doc sync (the one required content change)
- Update `CLAUDE.md`: the tech-stack line says **"Tailwind CSS 3.4"** — change to the actual installed v4.x version. Also scan `docs/architecture.md` for stale "3.4"/v3 references (PRD-005 documented spacing/typography rules there) and update any that name the version.
- If `tailwind.config.js` was removed/replaced by CSS-first config, note that in `CLAUDE.md`'s stack section too.

---

## Acceptance criteria

- [ ] `npm run build` + `npm test` + the design-system lint guardrail all pass under Tailwind v4.
- [ ] No deprecated v3 utility classes remain that render incorrectly (grep + visual check).
- [ ] The four core surfaces render correctly on the Vercel preview (screenshots in PR).
- [ ] `CLAUDE.md` (and `docs/architecture.md` if needed) reflect Tailwind v4 instead of 3.4.
- [ ] Any code fixes are minimal and scoped to v4 compatibility — no opportunistic refactors.
- [ ] If everything was already clean, the PR may be **docs-only** (just the version sync) — that's a fine outcome; say so in the PR description.

Branch: `chore/verify-tailwind-v4`. PR title: `chore(deps): verify Tailwind v4 upgrade + sync docs`.

## If something doesn't match

If you find a substantive visual regression that needs more than a trivial fix, **stop and report it to the user** with screenshots before doing a large remediation — it may warrant its own scoped task rather than ballooning this verification.
