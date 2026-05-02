# Claude Code Prompt — PRD-005 Mobile UX: Phase-by-Phase Loop

**For:** Claude Code (executor)
**Authored by:** Claude.ai (planning surface) on 2026-04-28
**Linked PRD:** [`docs/prds/PRD-005-mobile-ux-spacing-typography.md`](../prds/PRD-005-mobile-ux-spacing-typography.md)

---

## How this prompt works (read this first)

This prompt is **re-runnable** — the user invokes it once per phase. Each invocation:

1. Auto-detects which PRD-005 phase to work on next (based on git history).
2. Branches off latest `main`, implements **only that phase**, opens a PR, and **STOPS**.
3. The user reviews the PR, eyeballs the Vercel preview on a phone, merges via the GitHub UI.
4. The user runs this prompt again. You detect the next pending phase and repeat.

**Critical:** never start the next phase in the same session. Each phase gets its own PR, its own preview deployment, and its own visual review. That is the whole point — incremental, verifiable mobile UX changes the user can sanity-check on a phone before committing.

---

## ⚠ Pre-flight: confirm you're in the right place

Same pattern as PRD-001 prompts. Run these checks FIRST.

```bash
# 1) Canonical repo root
EXPECTED="/Users/Matt/Desktop/Current Projects/recipe-rhythm"
ACTUAL="$(git rev-parse --show-toplevel 2>/dev/null)"
echo "expected: $EXPECTED"
echo "actual:   $ACTUAL"
[ "$ACTUAL" = "$EXPECTED" ] || { echo "ABORT: not in the recipe-rhythm repo root"; exit 1; }

# 2) This prompt file must exist at the expected path
PROMPT="docs/prompts/prd-005-mobile-ux-phase-loop.md"
test -f "$PROMPT" || { echo "ABORT: $PROMPT not found"; exit 1; }

# 3) Show all worktrees so we can spot stale ones
git worktree list

# 4) If we're inside .claude/worktrees/<something>, switch to the canonical clone
case "$ACTUAL" in
  *".claude/worktrees/"*) echo "ABORT: running inside a Claude worktree — switch to $EXPECTED first"; exit 1 ;;
esac

# 5) Confirm we're on a clean main, ready to branch
git fetch origin --quiet
git checkout main
git pull --ff-only origin main
git status --porcelain | grep -q . && { echo "ABORT: working tree is dirty — commit, stash, or discard before continuing"; exit 1; }
```

If anything aborts: tell the user exactly which check failed and ask. Don't proceed on a guess.

---

## Step 0 — Auto-detect the next phase

Read the phase table from `docs/prds/PRD-005-mobile-ux-spacing-typography.md` §8 and map it to branch names below:

| Phase | Requirements | Branch name | Description |
|---|---|---|---|
| 1 | P0.1–P0.4 | `feat/ui-foundation` | Documentation + design-system primitives in `src/index.css`. The one CODE change here is updating `.btn-primary` to `bg-brand-600`. |
| 2 | P0.5 | `feat/ui-app-shell` | App.jsx shell — bottom nav re-style + Vault `+`/Sign Out collision fix. |
| 3 | P0.6 | `feat/ui-vault` | Vault page primitive adoption. |
| 4 | P0.7 | `feat/ui-brainstorm` | BrainstormMode primitive adoption. **Biggest PR.** |
| 5 | P0.8 | `feat/ui-logmode` | LogMode primitive adoption + dead-space fix + mystery-icon decision. |
| 6 | P0.9 | `feat/ui-calendar` | Calendar primitive adoption + tap-to-expand decision (OQ.C). |
| 7 | P0.10–P0.11 | `feat/ui-shared` | Settings header pattern + remaining shared components. May split into `feat/ui-settings` + `feat/ui-shared-components` if too big. |
| 8 | P0.12 | `feat/ui-lint-guardrail` | CI guardrail. Final phase. |

To detect the next phase:

```bash
git log --oneline --first-parent main -100 | grep -E "PRD-005 Phase ([0-9]+)" -o | sort -u
```

This returns the set of phases already merged. The next phase is **the lowest-numbered phase NOT in that set.**

If the output is empty → start with Phase 1.
If you see Phase 1 → next is Phase 2.
If you see Phases 1, 2, 3 → next is Phase 4. And so on.

If you can't tell unambiguously (e.g., commit messages don't follow the convention, or phases have been merged out of order), **stop and ask the user**. Show them what you found in git history. Do not guess.

Once you know the phase, **announce it to the user** in a one-line message: *"Detected next phase: Phase {N} ({short description}) on branch `{branch-name}`. Starting now."*

Then:

```bash
git checkout -b <branch-name>
```

Also, while you're here, clean up any stale local branches from previous phases:

```bash
git worktree prune
git branch --merged main | grep -vE '^\*|main' | xargs -r git branch -d
```

---

## Step 1 — Read the PRD section relevant to this phase

For every phase, **read the PRD before editing anything**:

1. PRD-005 §6 (Requirements table) — find the P0.X rows for this phase.
2. PRD-005 §7 (Spacing & Typography System) — these are the rules every phase must conform to.
3. PRD-005 §10 (Open Questions) — your phase may need a recommendation noted here.
4. `CLAUDE.md` — branch lifecycle, gotchas (especially the `react-modal-sheet` named-import).

If the PRD says one thing and the codebase says something different, **stop and ask the user** rather than guessing.

---

## Step 2 — Implement the phase

Below are the per-phase implementation notes. Implement ONLY the phase you detected in Step 0. Do not pull work forward from other phases. Do not start the next phase in the same session.

### Phase 1 — `feat/ui-foundation` (P0.1–P0.4)

This is mostly documentation and CSS — low risk. Touch:

- `tailwind.config.js`: add a top-of-file comment block listing the 7 sanctioned spacing values per PRD §7.1 and the 6 sanctioned typography sizes per §7.2. **No code change** to the config object — comment only.
- `docs/architecture.md`: add a "Design system rules" section with the spacing scale, typography scale, contrast rules, and touch-target rules (verbatim from PRD §7.1–§7.4). If `docs/architecture.md` doesn't exist, create it with a short top section then the rules.
- `src/index.css`: this is the main work. Inside the existing `@layer components` block:
  - **Update** `.btn-primary` to use `bg-brand-600` (currently `bg-brand-500`). This fixes the white-on-brand contrast fail (3.47:1 → 4.41:1, AA-pass at the existing `text-base font-semibold`).
  - **Decide** about `.btn-ghost` — currently 0 uses. Either delete it or restore it for genuine secondary-action cases. PRD §6 P0.4 says either is acceptable; recommend **delete** unless you find a use case during a later phase. Note the decision in the commit message.
  - **Add** the new primitives below. Each gets a doc comment. Use the existing `.btn-primary` / `.input-base` / `.card` style as the template:

```css
/* Secondary button — white bg, brand-700 outline + text. Pair with .btn-primary
   for cancel/secondary actions. */
.btn-secondary { @apply w-full py-3.5 rounded-2xl bg-white text-brand-700 font-semibold text-base border-2 border-brand-700 active:scale-95 transition-all hover:bg-brand-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200 disabled:cursor-not-allowed; }

/* Icon-only button — 44x44 round, neutral or brand variants. Use for top-bar
   actions like Sign Out, the Vault add (+), modal close X, etc. Always meets
   the 44px touch target rule. */
.btn-icon { @apply w-11 h-11 rounded-full flex items-center justify-center bg-white border border-cream-200 text-gray-700 shadow-sm active:scale-95 transition-all hover:bg-cream-50; }
.btn-icon-brand { @apply w-11 h-11 rounded-full flex items-center justify-center bg-brand-600 text-white shadow-md active:scale-95 transition-all hover:bg-brand-700; }

/* Inline text-action button — for "+ ADD ANOTHER MEAL" and similar. Uses brand-700
   for AA contrast; min-height 44px to meet the touch target rule. */
.btn-text { @apply inline-flex items-center gap-1.5 text-brand-700 font-semibold text-sm tracking-wide uppercase py-3 active:opacity-70 transition-opacity; }

/* Chip — selectable pill. 44px hit area via vertical padding. Default unselected
   appearance; selected state is composed by the caller (add bg-brand-600 + text-white). */
.chip { @apply inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 rounded-full bg-white border border-cream-200 text-sm text-gray-700 font-medium transition-all active:scale-95; }
.chip-selected { @apply bg-brand-600 text-white border-brand-600; }

/* Section heading — uppercase tracking + correct contrast. Use instead of
   ad-hoc text-[11px] font-bold text-gray-400 patterns. */
.section-heading { @apply text-sm font-bold text-gray-700 tracking-widest uppercase; }

/* Body text — 16px gray-700 default. Use anywhere body copy renders, replacing
   the prevalent text-xs / text-sm gray-400 anti-pattern. */
.body-text { @apply text-base text-gray-700 leading-6; }

/* Helper / supporting text — 14px gray-700, optional italic for tone. Use under
   form fields, in empty states, etc. */
.helper-text { @apply text-sm text-gray-700 leading-5; }
```

Verify the CSS compiles and Vite serves the new classes:

```bash
npm run build
```

No tests needed for CSS-only changes, but run:

```bash
npm run test:unit
npm run lint
```

These should all pass since you haven't touched any JSX yet (other than `.btn-primary`'s background which any consuming component picks up automatically).

**Commits (suggest 3):**

1. `docs(prd-005): document spacing/typography/contrast rules in architecture.md (P0.1–P0.3)`
2. `style(prd-005): expand index.css design-system primitives (P0.4)`
3. `style(prd-005): switch .btn-primary to bg-brand-600 for AA contrast (P0.4)`

**Out of scope this phase:** any JSX file. Don't touch `src/pages/` or `src/components/`. The point of Phase 1 is to lay the groundwork; pages adopt the primitives in later phases.

---

### Phase 2 — `feat/ui-app-shell` (P0.5)

Touch only:

- `src/App.jsx`
- `src/pages/Vault/index.jsx` (only to relocate the `+` button — no other changes)

The work:

1. **Bottom nav labels** in `App.jsx`: change `text-[11px] font-medium` to `text-xs font-medium`. Inactive color: `text-gray-700`. Active: `text-brand-700`. Update the existing conditional on lines ~97–98 to match.
2. **Sign Out button** in `App.jsx` (currently lines 57–64): replace the ad-hoc absolute-positioned styling with `<button className="btn-icon">…</button>`. Keep the absolute positioning logic (`top-[max(20px,env(...))] right-[max(20px,...)]`) but the visual styling moves to the primitive.
3. **Vault `+` button collision fix**: in `Vault/index.jsx`, the `+` button currently lives inside an absolute-positioned wrapper at lines 132–148. Move it OUT of the absolute wrapper and INTO the header content as inline flex content alongside the logo + "FOR MY WIFE" + recipe count. Use `.btn-icon-brand` for its style. Result: no two absolutely-positioned buttons in the top-right corner.
4. The `<X>` close icon (when `showForm` is true): use `.btn-icon` (not `.btn-icon-brand`) so the affordance reads as "close this open thing" rather than "primary action."

Verify:

```bash
npm run test:unit                       # existing tests must pass
npm run lint
npm run dev                              # eyeball at 375px viewport
```

Visual check: open the app at iPhone-SE viewport (375px). Confirm:

- Bottom nav labels are clearly readable, not faint.
- Active page label is brand-orange.
- The Sign Out button is 44×44.
- The Vault page no longer has two buttons stacked in the top-right corner.

**Commits (suggest 2):**

1. `feat(app): use btn-icon primitive for sign-out + bump nav contrast (PRD-005 Phase 2 / P0.5)`
2. `feat(vault): move + button into header content to fix top-right collision (PRD-005 Phase 2 / P0.5)`

---

### Phase 3 — `feat/ui-vault` (P0.6)

Touch only:

- `src/pages/Vault/index.jsx`
- `src/pages/Vault/RecipeForm.jsx`
- `src/pages/Vault/RecipeCard.jsx`
- `src/pages/Vault/ChipPicker.jsx`

**Do NOT touch** `src/pages/Vault/useVault.js` — this phase is presentation only.

The work:

1. **Buttons** — replace ad-hoc styled buttons with `.btn-primary`, `.btn-secondary`, `.btn-icon`, `.btn-text` as appropriate.
2. **Chips** — the suggestion chips in `index.jsx` (currently `flex items-center gap-1.5 bg-white border border-cream-200 rounded-full px-3.5 py-1.5 text-sm text-gray-600 font-medium ...`) become `.chip`. The chip-picker's chips in `ChipPicker.jsx` likewise.
3. **Section headings** ("NEED A HEAD START?") become `.section-heading`.
4. **Body / helper text** — the empty-state copy ("Your vault is empty" / "Tap + to add your first recipe") moves from `text-gray-400 text-sm` + `text-gray-300 text-xs` to `.body-text` and `.helper-text`. The "Tap any meal to add it to your vault…" line ditto.
5. **Remove banned classes** — grep this branch for `text-gray-400`, `text-gray-300`, `text-[11px]`, `p-0.5`, `p-1.5`, `p-2.5`, `p-3.5` inside the four files you're touching. Replace each instance.

Verify all existing tests in `src/pages/Vault/__tests__/*.test.jsx` continue to pass. They mostly assert on text content and behavior, not on class names, so they should — but watch for any test that's selecting by a class that you're removing.

**Commits (suggest 1–4):** at least one commit per file touched, more if helpful for review. Each commit message should reference `PRD-005 Phase 3 / P0.6`.

---

### Phase 4 — `feat/ui-brainstorm` (P0.7)

The biggest PR. Plan to do this in two sittings if needed.

Touch only:

- `src/pages/BrainstormMode.jsx`
- `src/components/Brainstorm/DayPicker.jsx`

**Do NOT decompose `BrainstormMode.jsx`.** It's 1,572 lines. Decomposition is P1.1 and is OUT of scope for this PRD. Yes, the file is hard to refactor in place. That's why this is the biggest PR — accept it.

The work:

1. **Section headings** ("LAST WEEK'S MEALS", "YOUR MEAL PLAN", "REGENERATE") → `.section-heading` (or `.btn-text` for REGENERATE since it's interactive).
2. **Day rows** — currently `flex items-center gap-4 py-3 bg-white` in the `SortableMealItem` (around line 186). Wrap in a `.day-row` primitive — but if you don't have one yet, create it now in `src/index.css` as part of this phase (or extract from this file's pattern). Alternative: since it's only used once, leave the inline classes but make sure they conform to the spacing scale (`gap-4`, `py-3` are both fine — these are sanctioned values).
3. **Drag handle**: the `<GripVertical size={18}>` inside `p-2.5 -ml-1.5` has a small effective tap area (~32px). Bump the icon to `size={20}` (or `size={24}`) and ensure the wrapper provides at least a 44×44 grab zone. The `text-gray-300` color (for the served/disabled state) is contrast-failing — switch to `text-gray-500`.
4. **COOKED checkbox** — currently uses the OS-default blue. Add `accent-color: #D74520;` (brand-600) to the checkbox style, either inline via the `style` prop or as a class. This is a one-liner CSS fix; verify on Safari mobile too (per PRD §10 OQ.B).
5. **Recipe-name text** — when active: `text-base text-gray-900` (16px primary). When struck-through (cooked state): `text-base text-gray-500` (not gray-400; gray-500 is the contrast minimum per PRD §7.3). Truncation: where vertical room allows, use 2-line `line-clamp-2` instead of single-line ellipsis. The `Grilled Salmon with…` truncation is the bug.
6. **`+ ADD ANOTHER MEAL`** → `.btn-text`.
7. **Action buttons at the bottom** — "Share plan via text" stays `.btn-primary`. "Groceries" → `.btn-secondary`. "Reset this plan" → keep its destructive treatment (red-tinted bg, brand red text), but route through a new primitive if you find a clean fit. If unclear, leave the destructive button styling inline for now and note as a follow-up.
8. **Remove banned classes** in the file: `text-[11px]`, `text-gray-400` for text, `text-gray-300` for text. Sweep every text element.

This phase has the most surface area. After implementing, run a focused contrast audit on the Brainstorm page (the script in §"Verification gate" below). Goal: 0 issues.

**Commits (suggest 4–6):** group by area — section headings, day-row + drag handle, COOKED checkbox + recipe-name styling, action buttons, banned-class sweep, line-clamp.

---

### Phase 5 — `feat/ui-logmode` (P0.8)

Touch only:

- `src/pages/LogMode.jsx`

The work:

1. **Vertical rhythm** — replace any ad-hoc `mt-N` / `mb-N` inside the body with `space-y-6` (or `space-y-4`) on the parent container. Eliminate the 30–40% empty-space gap on tall phones by either filling it (with the recents shelf if not already present) or constraining the layout to flex-col-justify-start with explicit gaps, not implicit dead space.
2. **Mystery decorative icon** left of the mic — the `<MessageSquare>` import is in the file (top of LogMode.jsx). Run `git blame` on the line that renders this icon to see what feature it was meant for. **If it has no associated click handler or label, remove it.** Document the removal in the commit message. If it does have a handler, ask the user before changing.
3. **Mic FAB** — keep the size (it's already ~80px and feels FAB-y, which is good), but use `.btn-icon-brand` if it composes cleanly. If not, leave inline but verify it conforms to the spacing scale.
4. **Save button** — `.btn-primary`. The disabled state must have visible text — change disabled `text-gray-400` to `text-gray-500` minimum (per PRD §7.3).
5. **Header** — already matches the rest of the app pattern; don't touch.
6. **Remove banned classes** in this file.

**Commits (suggest 2–3):**

1. `feat(logmode): remove decorative mystery icon (PRD-005 Phase 5 / P0.8)` — assuming it gets removed.
2. `feat(logmode): tighten vertical rhythm + adopt primitives (PRD-005 Phase 5 / P0.8)`

---

### Phase 6 — `feat/ui-calendar` (P0.9)

Touch only:

- `src/components/CalendarView.jsx`

The recommendation per PRD §10 OQ.C is **tap-to-expand at all viewports** — calendar cells render a single dot/dash/today-ring, tapping opens a sheet with the full meal info.

If implementing tap-to-expand:

1. Each cell renders just the date number + a status indicator (●  for "has-planned-meal", small dot color-coded by state per the existing legend; today gets the brand ring).
2. Tap on a cell opens a `react-modal-sheet` `<Sheet>` (use the named-export form per CLAUDE.md gotcha) showing the day's meal name, recipe link, and any quick actions.
3. The legend at the bottom remains; adjust copy to "Tap any day for details."

If this is too big a behavioral change to land alongside the styling pass, you can split this phase into two:

- `feat/ui-calendar-styling` — styling-only (better contrast, larger chevrons, day-of-week → gray-700, dropping cropped meal names is OK in favor of just dots, but no tap-to-expand yet).
- `feat/ui-calendar-tap-to-expand` — the interactive change.

If splitting, the styling-only PR ships as Phase 6 and the tap-to-expand version becomes a P1 follow-up. **Ask the user** which they prefer once you've scoped it.

Don't forget the chevrons — they need `.btn-icon` and 44×44.

**Commits:** scope-dependent. At minimum one for "Calendar styling" and one for "Calendar tap-to-expand" if both ship.

---

### Phase 7 — `feat/ui-shared` (P0.10–P0.11)

Touch in this order:

1. `src/components/Preferences/index.jsx` (P0.10) — the Settings header outlier. Switch to the centered logo + "FOR MY WIFE" small caps + italic-serif page subtitle pattern. Body text → `.body-text`. Chips → `.chip`. Active chip → add `.chip-selected`.
2. `src/components/Auth.jsx` — primitive adoption.
3. `src/components/VaultMatchSheet.jsx` — primitive adoption inside the sheet.
4. `src/components/LeftoverPicker.jsx` — primitive adoption.
5. `src/components/GapDayView.jsx` — primitive adoption.
6. `src/components/DateStripPicker.jsx` — primitive adoption + verify chips meet 44×44.
7. `src/components/Brainstorm/DayPicker.jsx` — already touched lightly in Phase 4; finish here if anything was deferred.
8. `src/pages/PeriodReview.jsx` — primitive adoption.

If the PR is getting unwieldy (>20 files changed), **split it** into `feat/ui-settings` (P0.10 only) and `feat/ui-shared-components` (P0.11). Each becomes its own PR. Ask the user before splitting if unsure.

**Commits:** one per file touched is reasonable. Each commit references `PRD-005 Phase 7 / P0.{10|11}`.

---

### Phase 8 — `feat/ui-lint-guardrail` (P0.12)

Touch only:

- `.github/workflows/design-system-lint.yml` (new)
- `package.json` (optional, to add a script)
- Optionally: `eslint.config.js` if you find a clean way to express the rules in ESLint.

The work:

A simple grep-based GitHub Actions workflow that fails the build on any of these patterns appearing in `src/**/*.{jsx,js,css}`:

```bash
# Banned font-size arbitrary values < 14px
grep -rn 'text-\[1[0-3]px\]' src/ --include='*.jsx' --include='*.js' && echo 'BAN: arbitrary font-size <14px'

# Banned text colors
grep -rnE 'text-gray-(200|300|400)' src/ --include='*.jsx' --include='*.js' && echo 'BAN: low-contrast gray text'

# Banned half-step padding values
grep -rnE '\b(p|px|py|pt|pb|pl|pr)-[0-9]+\.5' src/ --include='*.jsx' --include='*.js' && echo 'BAN: half-step padding'

# (Optional) hex colors in JSX — should use brand tokens
# grep -rnE '#[0-9a-fA-F]{3,8}' src/ --include='*.jsx' && echo 'WARN: hex color in JSX'
```

If any of these returns a match, the workflow fails. Document the rules in `docs/architecture.md` so future-Matt can find the rationale.

The workflow file should be ~30 lines, run on every PR, and fail fast. Don't overengineer this — a custom ESLint plugin is welcome but optional.

**Commits (suggest 1):**

1. `chore(ci): add design-system lint guardrail (PRD-005 Phase 8 / P0.12)`

---

## Step 3 — Verification gate (every phase)

Every phase must pass these gates before opening a PR:

### 3a. Local checks

```bash
npm run lint
npm run test:unit
npm run build
```

All three must be green. The build check matters because Vite production-build edge cases (especially around `react-modal-sheet`) can hide in dev.

### 3b. Contrast audit

Open `npm run dev` in Chrome, navigate to each page touched by this phase, set DevTools to mobile emulation at iPhone-SE 375×667. Open the JS console and paste:

```js
(() => {
  const lum = ([r,g,b]) => { const f = c => { c/=255; return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4); }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const cont = (c1,c2) => { const l1=lum(c1),l2=lum(c2); const [a,b]=l1>l2?[l1,l2]:[l2,l1]; return (a+0.05)/(b+0.05); };
  const parse = s => { const m=s.match(/rgba?\(([^)]+)\)/); if(!m)return null; const [r,g,b]=m[1].split(',').map(s=>parseFloat(s.trim())); return [r,g,b]; };
  const eb = el => { let c=el; while(c){const bg=getComputedStyle(c).backgroundColor; const p=parse(bg); if(p&&!bg.includes('rgba(0, 0, 0, 0)')) return p.slice(0,3); c=c.parentElement;} return [255,255,255]; };
  const issues = [];
  document.querySelectorAll('p,span,button,label,h1,h2,h3,h4,a,div').forEach(el=>{
    const t=(el.childNodes.length===1&&el.firstChild.nodeType===3)?el.firstChild.textContent.trim():'';
    if(!t||t.length<2||el.offsetParent===null)return;
    const cs=getComputedStyle(el); const px=parseFloat(cs.fontSize);
    const fg=parse(cs.color); const bg=eb(el); const r=fg&&bg?cont(fg,bg):99;
    const tooSmall=px<14, lowContrast=(px<18&&r<4.5)||(px>=18&&r<3);
    if(tooSmall||lowContrast) issues.push({sample:t.slice(0,30),px:cs.fontSize,r:r.toFixed(2)});
  });
  console.table(issues);
  return issues.length;
})()
```

The return value is the number of failing elements. **Goal: 0 on the pages this phase touched.** If non-zero, fix before pushing. (Other pages may still have failures — those get fixed in their own phases.)

### 3c. Touch-target spot-check

In DevTools, hover over each `<button>` on the affected pages and read its computed dimensions. Goal: every button is ≥44px in both dimensions. Document any exceptions in the PR description.

### 3d. Visual check on a real phone (or simulator)

Recommended: open the dev URL on Matt's phone (or iOS Simulator). The Vercel preview will give a sharable URL after pushing. Do NOT skip this — mobile-only audits caught issues that desktop-emulator missed during the original PRD-005 audit.

---

## Step 4 — Commit, push, open PR

PR title format: `PRD-005 Phase N: <short description>`

Examples:
- `PRD-005 Phase 1: design-system primitives + contrast docs`
- `PRD-005 Phase 4: BrainstormMode primitive adoption + COOKED checkbox color`

PR description should include:

1. **Which P0.X requirements this PR ships** (reference the PRD-005 §6 row).
2. **Before/after screenshots** of every page touched, mobile viewport. Use the iPhone SE 375px viewport for consistency.
3. **Contrast audit output** — paste the `console.table(issues)` from Step 3b. Should show 0 rows.
4. **Vercel preview URL** once the deployment completes. Use the Vercel MCP to fetch this rather than guessing.
5. **Smoke-test result** — run the steps in `.claude/test-credentials.md` against the preview URL. Confirm the affected pages still work end-to-end.
6. **Any decisions deferred to the user** — e.g., the LogMode mystery icon (Phase 5), Calendar tap-to-expand (Phase 6), unclear color choices.
7. **Follow-ups noted but not done** — anything you spotted that's out of scope for this phase.
8. **One-line footer:** *"Run `prd-005-mobile-ux-phase-loop.md` again after merge to start the next phase."*

Push to origin:

```bash
git push -u origin <branch-name>
```

Open the PR via `gh pr create` or the GitHub UI.

---

## Step 5 — Verify the deployment via MCPs

Per CLAUDE.md, use the MCPs proactively:

- **Vercel MCP:** check the PR's preview deployment status (`mcp__47a45af7-…__list_deployments` filtered to the branch). If it failed, read build logs (`mcp__47a45af7-…__get_deployment_build_logs`) and try to fix in the PR before pinging the user.
- **Supabase MCP:** N/A for this PRD — no DB migrations. If you find yourself touching `supabase/migrations/`, you've gone out of scope.
- Once preview is green, pull runtime logs (`mcp__47a45af7-…__get_runtime_logs`) and check for any console errors triggered by the changes.

If a Vercel build fails for an obvious reason (lint, type, build-time React error) and you can fix it in 1–2 commits without expanding scope, do so. If it fails for a non-obvious reason, surface to the user.

---

## Step 6 — STOP

When the PR is open, the preview is green, and the audit is clean: **STOP and report.**

DO NOT in this session:

- Merge the PR yourself.
- Start the next phase.
- Touch other phases' files.
- Auto-resolve linter or test failures unrelated to this phase (note them in the PR description as follow-ups, don't fix).

Final message to the user should be concise:

> **Phase {N} complete.**
>
> - PR: {URL}
> - Preview: {Vercel URL}
> - Contrast audit: {N} issues
> - Decisions to confirm: {list, or "none"}
>
> Re-run this prompt after merge to start Phase {N+1}.

---

## Acceptance criteria (per phase)

- [ ] Branch named per the table in Step 0
- [ ] Pre-flight checks pass (Step 0)
- [ ] Only the files listed for this phase are touched (no scope creep)
- [ ] `npm run lint` green
- [ ] `npm run test:unit` green
- [ ] `npm run build` green
- [ ] Contrast audit returns 0 issues on affected pages
- [ ] Touch-target spot-check passes on affected pages
- [ ] Vercel preview deployment is green
- [ ] PR description includes before/after screenshots, audit output, smoke-test result
- [ ] PR is open but NOT merged
- [ ] Final report sent to user with the format above

---

## Constraints (every phase)

- **No new features.** PRD-005 is hygiene. If you find yourself adding a feature, you've gone out of scope.
- **No new dependencies.** Use what's in `package.json`. (`react-modal-sheet` is already there if you need a sheet for Phase 6.)
- **No DB migrations.** This PRD has none. If you write SQL, you've gone out of scope.
- **No partner-collab assumptions.** Single-user `auth.uid() = user_id` model stays.
- **Don't decompose `BrainstormMode.jsx`** in Phase 4. P1.1 is OUT of scope.
- **Don't fix unrelated lint or test errors.** Note them in the PR description as follow-ups; don't expand scope.
- **`react-modal-sheet` named-import** (per CLAUDE.md): if any phase touches a Sheet, use `import { Sheet } from 'react-modal-sheet'`. Default-import breaks production builds + tests.

---

## Out of scope (do NOT pull forward)

- BrainstormMode decomposition (P1.1) — defer.
- Skeleton loaders (P1.4) — defer.
- Empty-state illustrations (P1.5) — defer.
- WCAG AAA contrast (P2.1) — defer.
- Dark mode (P2.2) — defer.
- Anything in PRD-002, PRD-003, PRD-004.
- Brand-palette tweaks beyond the documented `brand-500 → brand-600` swap on `.btn-primary`.
- Adding Storybook or `/dev/styleguide` route (P1.2) — defer.

---

## Common gotchas (from CLAUDE.md, repeated for emphasis)

- **`react-modal-sheet`:** `import { Sheet } from 'react-modal-sheet'` — NAMED export. Default-import breaks prod + tests.
- **Timezone-naive dates:** if any phase happens to touch date logic, prefer the centralized `formatLocalDate()` helper if it exists by then. Don't introduce new `new Date().toISOString().split('T')[0]` patterns.
- **Don't run migrations on prod.** This PRD has no migrations, but if you somehow introduce one, the user applies it manually via Supabase SQL Editor — never auto-apply.
- **The Claude.ai master prompt may say React 18 / Vite 6.** Trust the codebase: React 19.2 + Vite 8.

---

## When you finish ALL phases (Phase 8 merged)

After Phase 8 is merged to `main`:

1. Run the contrast audit one more time across **every** page (Vault, Brainstorm, LogMode, Calendar, Preferences, PeriodReview, Auth). Goal: 0 issues anywhere.
2. Update PRD-005's §Revision History with a v1.0 entry summarizing what shipped, mirroring the PRD-001 v1.0 entry style.
3. Tell the user the PRD is complete and suggest closing it.
