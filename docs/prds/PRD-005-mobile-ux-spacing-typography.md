# PRD-005: Mobile UX, Spacing & Typography Audit

**Status:** Draft v0.1
**Author:** Matt (El Presidente)
**Date:** 2026-04-28
**Type:** UX/quality remediation (no new features)
**Related:** Builds on PRD-001 P0.9 (component decomposition pattern). Independent of PRD-002, PRD-003, PRD-004 — can ship in parallel with all of them.

---

## 1. Problem Statement

Recipe-Rhythm's mobile spacing, typography, and visual hierarchy have drifted into a poor state. The codebase has accumulated **17 distinct padding values**, **6 distinct font-size choices** with heavy use of 11–12px text, **no enforced color-contrast scale**, and **almost no adoption** of the design-system primitives that already exist in `src/index.css`. Most buttons and chips reinvent their styling ad hoc, and inconsistencies have compounded as features have shipped.

The visible consequences are concrete and measurable:

- **The "FOR MY WIFE" header itself fails WCAG AA contrast (3.84:1)** — and it appears on every page.
- **The bottom-nav inactive labels are 11px at 2.41:1 contrast** — well below the 3:1 floor for *large* text, let alone the 4.5:1 floor for body text at this size.
- **`text-gray-400`** (≈3.4:1 on white) is used **47 times** for actual text — a recurring contrast failure.
- **The Vault `+` button overlaps the global Sign Out button** in the top-right corner of the page (both are absolutely positioned).
- **Calendar cells crop recipe names** ("Grilled Salmon with…") with strikethrough at 12px gray — effectively illegible.
- **Touch targets are below the 44px Apple-HIG / Material floor** in multiple places: the Vault add button (40×40), suggestion chips (~36px), drag handles (~20px tap area).

The cost of not solving this: the app feels janky to use weekly, the Planner (wife) disengages from the brainstorm before the recommendation engine even matters, and every new feature shipped on top of these foundations inherits and compounds the mess.

## 2. Current State (As Built — 2026-04-28)

A faithful snapshot from a three-layer audit of `main`:

1. **Layer 3 (codebase design-system inventory):** grep across `src/` for spacing, typography, and color-utility classes.
2. **Layer 1 (production visual audit):** logged into `recipe-rhythm.vercel.app` as the test user, walked every page in the 448px content column, captured screenshots and per-page findings.
3. **Layer 2 (computed-typography pass):** ran a JS audit on the live page measuring computed font-size, line-height, color, effective background, and WCAG-style contrast ratios for every visible text leaf.

### 2.1 Design-system primitives are barely adopted

`src/index.css` already defines a small component layer:

| Primitive | Defined | Actual `src/` usage | Notes |
|---|---|---|---|
| `.btn-primary` | yes | 12 sites | 70 `<button>` elements exist across pages — most reinvent styling |
| `.btn-ghost` | yes | **0 sites** | dead code |
| `.input-base` | yes | 13 sites | partial adoption |
| `.card` | yes | 18 sites | partial adoption |
| `.mobile-screen` | yes | 10 sites | applied at the top of each page |

**Net effect:** the app has the *bones* of a design system but has not committed to using it. Every divergent button is a new spacing decision.

### 2.2 Spacing chaos — 17 distinct padding values in active use

Top of the inventory (full list in §X-1 of source data):

| Class | px | Use count |
|---|---|---|
| `py-3` | 12 | 29 |
| `px-5` | 20 | 28 |
| `py-2` | 8 | 14 |
| `px-4` | 16 | 14 |
| `py-4` | 16 | 10 |
| `pb-28` (safe-area) | 112 | 9 |
| `px-3` | 12 | 9 |
| `p-2` | 8 | 8 |
| `py-5` | 20 | 8 |
| `py-0.5` | 2 | 8 |
| `px-1.5` | 6 | 7 |
| `px-6` | 24 | 7 |
| `py-1.5` | 6 | 5 |
| ... | | |

Distinct padding values used: **0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 11, 14, 16, 28, 32** (Tailwind units).

The half-step values (`p-0.5`, `p-1.5`, `p-2.5`, `p-3.5`) are a clear sign of visual tweaking rather than a system. Margins show similar drift: 8 distinct values. Border-radius: 5 distinct values (`rounded`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-full`).

### 2.3 Typography chaos

**Font-size class distribution (Tailwind):**

| Class | Px | Use count |
|---|---|---|
| `text-sm` | 14 | 63 |
| `text-xs` | 12 | 43 |
| `text-base` | 16 | 8 |
| `text-lg` | 18 | 6 |
| `text-xl` | 20 | 1 |
| `text-2xl` | 24 | 1 |

Plus arbitrary values, notably **`text-[11px]`** in the bottom nav (`App.jsx:97`) and in section headings ("NEED A HEAD START?", "LAST WEEK'S MEALS", etc.).

**The crucial observation:** `text-base` (16px, the iOS HIG / Material body floor) is used **8 times across the entire app** while `text-xs` (12px) is used **43 times**. The app has effectively no body-text size and very little visual hierarchy — only **one** `text-xl` and **one** `text-2xl` use across all pages.

**Color/contrast distribution (gray-scale text classes):**

| Class | Use count | Contrast on cream-50 (the page bg) |
|---|---|---|
| `text-gray-400` | 47 | **2.41:1** — ❌ FAIL WCAG AA |
| `text-gray-500` | 28 | 4.59:1 — ✅ passes AA (just) |
| `text-gray-900` | 20 | 16.85:1 — ✅ passes AAA |
| `text-gray-700` | 13 | 9.79:1 — ✅ passes AAA |
| `text-gray-300` | 13 | **1.40:1** — ❌ FAIL |
| `text-gray-600` | 7 | 7.18:1 — ✅ passes AAA |
| `text-gray-800` | 3 | 13.94:1 — ✅ passes AAA |
| `text-gray-200` | 1 | **1.18:1** — ❌ FAIL (essentially invisible) |

**`text-gray-400` is used 47 times for actual text** and fails AA contrast on cream/white backgrounds. Together with `text-gray-300` and `text-gray-200`, that's **61 contrast failures by class alone**, before counting brand-on-white misuse.

### 2.4 Live audit — measured contrast failures (computed values from production)

Captured on `recipe-rhythm.vercel.app` at 448px content width (the `max-w-md` mobile column). All ratios are WCAG-style relative luminance.

| # | Element | Where | Computed | Verdict |
|---|---|---|---|---|
| C1 | "FOR MY WIFE" page header (every page) | `App.jsx`-driven, e.g. `Vault/index.jsx:150`, `LogMode.jsx:174` | 14px brand-600 on cream-50, **3.84:1** | ❌ FAIL AA |
| C2 | Inactive bottom-nav labels (LOG, PREP TABLE, CALENDAR, etc.) | `App.jsx:97` | 11px gray-400 on cream-50, **2.41:1** | ❌ FAIL AA & 3:1 floor |
| C3 | "LAST WEEK'S MEALS" section header | `BrainstormMode.jsx` | 11px gray-400 uppercase, **2.41:1** | ❌ FAIL AA |
| C4 | Brainstorm weekday labels ("MON", "TUE") in last-week card | `BrainstormMode.jsx` | 11–12px brand or gray, **2.31–2.54:1** | ❌ FAIL AA |
| C5 | Struck-through cooked meal names ("Beef Tacos") | `BrainstormMode.jsx` | 14px gray w/ strikethrough, **2.54:1** | ❌ FAIL AA |
| C6 | "No limit" white-on-orange chip in Preferences (active state) | `Preferences/index.jsx` | 12px white on brand-500, **3.65:1** | ❌ FAIL AA (body) |
| C7 | "SETTINGS" page header (Preferences) | `Preferences/index.jsx:204` | 14px brand-600 on cream-50, **4.19:1** | ❌ FAIL AA (just under) |
| C8 | "REGENERATE" text-button on Brainstorm | `BrainstormMode.jsx` | gray-300 14px | ❌ FAIL — barely visible |
| C9 | Empty-state copy "Tap any meal to add it…" | `Vault/index.jsx:215` | text-xs gray-400 | ❌ FAIL AA |
| C10 | Suggestion-chip icons (BookmarkPlus, Loader2) | `Vault/index.jsx:225-226` | 11px gray-400 | ❌ FAIL AA — and undersized |

These are not isolated bugs; they're **patterns repeated across pages.** Fixing them means fixing the underlying class choices, not the individual sites.

### 2.5 Touch target violations

Apple HIG (44×44pt) and Material Design (48×48dp) both specify a minimum tappable size. Current violations:

| # | Element | Size | Where |
|---|---|---|---|
| T1 | Vault add-recipe button | 40×40px (`w-10 h-10`) | `Vault/index.jsx:137` |
| T2 | Logout button (top-right of every page) | ~40×40px | `App.jsx:59` |
| T3 | Suggestion chips ("Spaghetti Bolognese" etc.) | ~32–36px tall (`py-1.5 px-3.5`) | `Vault/index.jsx:222` |
| T4 | Drag handles in Brainstorm rows | `<GripVertical size={18}>` inside `p-2.5 -ml-1.5` ≈ 32px tap area | `BrainstormMode.jsx:194-198` |
| T5 | Dismiss-X buttons (`<X size={16}>` with no padding) | ~16px hit area | `Vault/index.jsx:159` and elsewhere |
| T6 | Calendar nav chevrons | small icon, no padded wrapper | `CalendarView.jsx` |
| T7 | "+ ADD ANOTHER MEAL" inline text-button | ~24px tall | `BrainstormMode.jsx` |

### 2.6 Per-page issues — Brainstorm (priority page)

The 1,572-line `BrainstormMode.jsx` is where the most visible chaos lives.

- **Header pattern OK** but inherits the C1 contrast failure on "FOR MY WIFE."
- **THIS WEEK / MAYBE pill toggle** is well-styled — the active pill is white on cream with a soft shadow.
- **"LAST WEEK'S MEALS" card** is huge for the data it shows: 5 days × ~88px row each, each row containing only a weekday label and a dash for "no meal logged." Information density is low; vertical real estate is wasted.
- **"YOUR MEAL PLAN" card** has each day row at ~95px tall with: drag handle (T4 violation) → recipe name (truncates at "Grilled Salmon with…") → "✨ NEW" pill + external-link arrow → "COOKED" + checkbox → "+ ADD ANOTHER MEAL" link. **Information density is low and tap targets are violated simultaneously.**
- **Recipe-name truncation** with ellipsis: "Grilled Salmon with…" — not enough room for the full dish name even at 14px.
- **OS-default blue checkbox for "COOKED"** clashes with the brand orange palette. Visually jarring.
- **Bottom action stack** ("Share plan via text", "Groceries", "Reset this plan") has unclear hierarchy — Share + Groceries side-by-side, Reset full-width below. Unequal visual weights.
- **"REGENERATE" in `text-gray-300`** is barely visible (C8).

### 2.7 Per-page issues — Vault (priority page)

- **Header collision (cross-cutting bug):** the absolutely-positioned Sign Out button (`App.jsx:59`) and the absolutely-positioned `+` button (`Vault/index.jsx:133-148`) **overlap in the top-right corner.** The `+` button at `top-1/2 right-5` sits ~40px below the Sign Out button at `top-[max(20px,…)] right-[max(20px,…)]` — they touch and visually compete.
- **"NEED A HEAD START?" section header** uses `text-[11px] font-bold text-gray-400 tracking-widest uppercase` — small, low contrast (C9 family).
- **Body copy** "Tap any meal to add it to your vault…" at `text-xs text-gray-400` (C9) — fails AA.
- **Suggestion chips** (T3) — small tap target, inconsistent with the iOS HIG floor.
- **Empty state** uses `text-gray-400 text-sm` + `text-gray-300 text-xs` — both fail contrast and the second is borderline invisible.
- **Recipe cards themselves** (Tater Tots, BLATE in the screenshot) are well-structured with proper padding and clear hierarchy. The cards are not the problem; the chrome around them is.

### 2.8 Per-page issues — LogMode

- **Header pattern matches** Vault and Brainstorm (good consistency on this surface).
- **Massive empty space** between the note input and the mic button area on tall phones (~30–40% of viewport height). The layout doesn't intentionally fill the screen.
- **Mystery decorative chat-bubble icon** to the left of the mic — visible in the production build but unclear what it does. Either remove or give a clear purpose + label.
- **"Save to log" disabled state** has very low-contrast text (gray-on-cream) — borderline reads as a non-button.
- **Mic FAB is well-sized** (~80px) — passes the touch target rule.

### 2.9 Per-page issues — Calendar

- **Calendar cells crop recipe names.** Each cell is ~50px wide on a 448px content column; recipe names like "Grilled Salmon with…" truncate with ellipsis, then take strikethrough on top, then become 12px gray-400 — **effectively illegible at a glance.**
- **Today indicator** (red ring around the date number) is clear but only highlights the *number*, not the cell.
- **Day-of-week headers** (S M T W T F S) are 12px gray — light.
- **Month nav chevrons** are small (T6 violation).
- **Adjacent-month dates** (29–31 of previous month, 1–9 of next) are extremely faint, near-invisible.
- The calendar is an **information-density problem masquerading as a styling problem** — putting dish names in 50px cells will always be cramped. A list-mode fallback or tap-to-expand interaction is the real fix.

### 2.10 Per-page issues — Preferences (Settings)

- **Inconsistent header pattern:** Settings uses a *left-aligned* header with "SETTINGS" small caps + "Preferences" italic serif. Every other page uses a *centered* header with the heart logo + "FOR MY WIFE" + page subtitle. Settings is the visual outlier and looks like a different app.
- **"SETTINGS" header itself fails contrast** (C7: 4.19:1 — just under AA's 4.5:1).
- **Helper text** "These rules filter every brainstorm…" at 12px gray-500 — passes contrast (4.59:1) but is at the lower bound of legibility on mobile, and the italic serif at this size is fatiguing for a paragraph of text.
- **Chip selectors** (Vegetarian, Vegan, etc.) — small tap targets (~32–36px).
- **Active chip** ("No limit") has white text on brand-500 at 12px — fails contrast (C6: 3.65:1).

### 2.11 Cross-cutting layout bugs

- **Top-right collision** in Vault (described in 2.7).
- **Inconsistent header pattern** in Settings (described in 2.10).
- **Massive empty space** in LogMode (described in 2.8).
- **Calendar information density** (described in 2.9).
- **OS-default blue checkbox** for "COOKED" in Brainstorm (clashes with brand palette).
- **Mystery icon** in LogMode (described in 2.8).

## 3. Goals

1. **Eliminate every WCAG AA contrast failure** on primary text and interactive elements identified in §2.4.
2. **Establish a small, enforced spacing scale** (≤7 values) and a small typography scale (6 sizes) that the codebase actually uses — banning the half-step values and arbitrary `text-[11px]`.
3. **Enforce a 16px body-text floor** on mobile. Reserve 12–14px strictly for tertiary metadata (timestamps, secondary tags), never for body copy.
4. **Enforce 44×44px minimum touch targets** for every tappable element.
5. **Make the design-system primitives in `src/index.css` the only way buttons / inputs / cards / chips are built.** Expand the primitive set where needed. Refactor existing pages to use them.
6. **Fix the cross-cutting bugs** — header collision, Settings outlier header, mystery icon, blue checkbox, calendar density, LogMode dead space.
7. **Resolve consistently across all four primary pages** (Vault, Brainstorm, LogMode, PeriodReview) and all eight shared components (DateStripPicker, CalendarView, Preferences, Auth, VaultMatchSheet, LeftoverPicker, GapDayView, DayPicker).
8. **Add a regression guardrail** so future PRs cannot reintroduce banned values or sub-44px tap targets.

## 4. Non-Goals

1. **No new features.** This PRD is hygiene only. Anything that looks like a feature belongs in PRD-002, -003, or -004.
2. **No redesign of the brand palette.** Brand colors stay; we may shift `brand-500` ↔ `brand-700` usage for contrast, but the palette itself is not up for debate.
3. **No icon-set change.** lucide-react stays.
4. **No font change.** DM Sans + Fraunces stay.
5. **No accessibility work beyond WCAG AA.** AAA (7:1) is a P2 future item.
6. **No motion / animation work.** Out of scope.
7. **No dark-mode design.** Single-theme stays.
8. **No `BrainstormMode.jsx` decomposition** in the P0 scope — it's 1,572 lines and would be welcome, but doing it inside this PRD risks over-broad scope. Tracked as P1.1 below; do it after P0.7 lands.

## 5. Target Users

Primary persona — **The Planner (wife)**, who uses the app on her phone weekly to plan meals. The current state visibly fatigues her: small text, low contrast, cluttered Brainstorm, illegible Calendar. Success means sit-down planning sessions feel pleasant rather than chore-y, with no rough edges that make her question whether the app is finished.

## 6. Requirements

### P0 — Must have (the foundation)

| # | Requirement | Acceptance criteria |
|---|---|---|
| P0.1 | **Define and document the spacing scale** | `tailwind.config.js` gets a comment block listing the 7 sanctioned values (`1, 2, 3, 4, 6, 8, 12` Tailwind units = 4, 8, 12, 16, 24, 32, 48 px) plus `safe`. The rule "no half-step padding values" is documented in `docs/architecture.md`. No code change to `tailwind.config.js` content beyond comments. |
| P0.2 | **Define and document the typography scale** | 6 sanctioned sizes (see §7). Each gets a documented purpose and pairing line-height. Scale lives in `docs/architecture.md` and as a comment in `src/index.css`. |
| P0.3 | **Define and document the contrast / color rules** | Documented in `docs/architecture.md`. Primary text: `text-gray-900` or `text-gray-700`. Secondary: `text-gray-700` / `text-gray-600`. Tertiary / disabled: `text-gray-500` MINIMUM. **`text-gray-400` and `text-gray-300` are banned for any text that conveys meaning** (decorative dividers OK). Brand-on-cream/white: use `text-brand-700`; `text-brand-600` is allowed only at 18px+ bold. White-on-brand: only on `bg-brand-600` or darker. |
| P0.4 | **Update existing primitives + add new ones** | **Update:** `.btn-primary` switches from `bg-brand-500` to `bg-brand-600` to satisfy white-on-brand contrast (`brand-500` is 3.47:1 — fails AA). `.btn-ghost` either gets restored to use or deleted (currently 0 uses). **Add** new component classes in `src/index.css`: `.btn-secondary` (white bg + brand-700 outline + text), `.btn-icon` (44×44 round, neutral and brand variants), `.btn-text` (text-only inline action with `text-brand-700`), `.chip` (44px hit area, py-2 px-4, text-sm gray-700), `.section-heading` (uppercase tracking, gray-700 minimum, paired with the right size), `.body-text` (16px gray-700 default), `.helper-text` (14px gray-700, optional italic). Each gets a doc comment with one-line purpose. |
| P0.5 | **Refactor `App.jsx` shell** | Bottom-nav labels move from `text-[11px]` to `text-xs` (12px) `text-gray-700` for inactive (≥3:1) and `text-brand-700` for active. Sign Out button uses `.btn-icon` (44×44). **Top-right collision is resolved** by relocating the Vault `+` button into the Vault header content (inline, not absolutely positioned). |
| P0.6 | **Refactor Vault (`pages/Vault/index.jsx`, `RecipeForm.jsx`, `RecipeCard.jsx`, `ChipPicker.jsx`)** | All buttons → `.btn-primary` / `.btn-secondary` / `.btn-icon`. All chips → `.chip`. Section headers (`NEED A HEAD START?` etc.) → `.section-heading`. Empty-state copy → `text-base text-gray-700` (was `text-xs text-gray-300/400`). Add button moves inline to header per P0.5. |
| P0.7 | **Refactor BrainstormMode (`pages/BrainstormMode.jsx`)** | Section headers → `.section-heading`. Day rows use a `.day-row` primitive with proper drag-handle area (44×44 grab zone, larger `<GripVertical>` icon). "COOKED" checkbox is restyled with brand-orange `accent-color: var(--brand-500)` (or replaced with a custom `<button role="checkbox">`). Recipe names: `text-base` (16px) when active, `text-gray-500` (not gray-400) when struck through. "+ ADD ANOTHER MEAL" → `.btn-text`. "REGENERATE" gets `text-brand-700` (was gray-300). Recipe-name truncation uses 2-line clamp instead of single-line ellipsis where vertical room allows. |
| P0.8 | **Refactor LogMode (`pages/LogMode.jsx`)** | Layout uses consistent vertical rhythm — no >24px empty gaps unless intentional (use `space-y-6`). Mystery decorative icon left of the mic is **removed** (or given a clear purpose + label, but default is remove). Mic FAB and Save button use `.btn-primary` and `.btn-icon` treatments. Disabled "Save to log" state has visible label (`text-gray-500` minimum). |
| P0.9 | **Refactor Calendar (`components/CalendarView.jsx`)** | Calendar cells either (a) drop to a list-mode fallback below 400px viewport, or (b) gain a tap-to-expand interaction surfacing the full meal info in a sheet. Today indicator uses brand-600 ring at min 2px. Day-of-week headers → `text-gray-700`. Chevrons → `.btn-icon` (44×44). |
| P0.10 | **Refactor Settings/Preferences (`components/Preferences/index.jsx`)** | Header pattern matches the rest of the app: centered logo + "FOR MY WIFE" + italic-serif page subtitle. Body text → 16px gray-700. Chips → `.chip`. Active chip uses `bg-brand-600` (not `brand-500`) with `text-white` to clear contrast. |
| P0.11 | **Refactor PeriodReview, GapDayView, LeftoverPicker, DateStripPicker, DayPicker, VaultMatchSheet, Auth** | All adopt the new primitives. Each as its own commit / sub-PR for review-ability. |
| P0.12 | **Add a CI guardrail to prevent regression** | Either an ESLint rule, a stylelint rule, or a CI grep script that fails the build on usage of: `text-[11px]` (or any other `text-[<14px>]`), `text-gray-400` / `text-gray-300` for text, half-step padding (`p-0.5`, `p-1.5`, `p-2.5`, `p-3.5`), or any new `<button>` whose computed height is < 44px. A grep-based pre-commit + GH Action is sufficient — overengineering not required. |

### P1 — Nice to have (after P0)

- **P1.1** Decompose `BrainstormMode.jsx` into smaller files (it's 1,572 lines now). Mirrors the PRD-001 P0.9 pattern. Easier *after* P0.7 because the new primitives reduce per-file complexity. Estimated split: `BrainstormMode/index.jsx`, `LastWeekCard.jsx`, `MealPlanCard.jsx`, `SortableMealItem.jsx`, `MaybeShortlist.jsx`, plus a `useBrainstorm.js` data hook.
- **P1.2** Add a `/dev/styleguide` route (gated to dev-only) showing every primitive in isolation with the spacing/typography scale visualized. Helps future-Matt and any future contributor.
- **P1.3** Standardize haptic feedback across pages. Currently inconsistent (`useHaptics` is called sporadically).
- **P1.4** Replace "Loading vault…" gray-400 text states with skeleton loaders.
- **P1.5** Replace bare-text empty states (Vault when 0 recipes, LogMode after save) with a small empty-state illustration. The existing `ChefKnife.jsx` SVG component is a candidate.

### P2 — Future considerations

- **P2.1** WCAG AAA contrast (7:1 for body) once AA is shipped and stable.
- **P2.2** Dark mode.
- **P2.3** Dynamic Type / iOS-respecting font scaling.
- **P2.4** Reduced-motion media-query handling for `framer-motion` animations.

## 7. Proposed Spacing & Typography System

### 7.1 Spacing scale (Tailwind units → px)

| Token | Tailwind | Px | Use |
|---|---|---|---|
| 1 | `p-1` / `gap-1` | 4 | tight (icon padding) |
| 2 | `p-2` / `gap-2` | 8 | default tight (chip internals) |
| 3 | `p-3` / `gap-3` | 12 | inputs, buttons (vertical) |
| 4 | `p-4` / `gap-4` | 16 | card-internal default |
| 6 | `p-6` / `gap-6` | 24 | section gap, page horizontal padding |
| 8 | `p-8` / `gap-8` | 32 | major break |
| 12 | `p-12` / `gap-12` | 48 | hero / extra emphasis |

**Banned** for new code: `p-0.5`, `p-1.5`, `p-2.5`, `p-3.5`, `p-5`, `p-7`, `p-9`, `p-10`, `p-11`, and any arbitrary `p-[Npx]`. Existing `pb-28` / `pb-safe` for the safe-area bottom-nav clearance is allowed; document in code.

### 7.2 Typography scale

| Token | Tailwind | Px / line-height | Use |
|---|---|---|---|
| metadata | `text-xs leading-4` | 12 / 16 | timestamps, tertiary tags ONLY (never body) |
| secondary | `text-sm leading-5` | 14 / 20 | secondary text, button labels, chips |
| body | `text-base leading-6` | **16 / 24** | **default for all body copy** |
| heading-sm | `text-lg leading-7` | 18 / 28 | section headings (with `font-bold`) |
| heading-md | `text-xl leading-7 font-bold` | 20 / 28 | page titles |
| heading-lg | `text-2xl leading-8 font-serif italic` | 24 / 32 | hero / page subtitle ("What did you eat tonight?") |

**Banned:** `text-[11px]` and any other `text-[Npx]` arbitrary value below 14px.

### 7.3 Color/contrast rules

| Use | Class | Contrast on cream-50 |
|---|---|---|
| Primary text | `text-gray-900` | 16.85:1 |
| Secondary text | `text-gray-700` | 9.79:1 |
| Tertiary / metadata | `text-gray-600` | 7.18:1 |
| Disabled / placeholder | `text-gray-500` (MINIMUM) | 4.59:1 (just clears AA) |
| Brand text on cream/white | `text-brand-700` (NOT 600 or 500) | 7.76:1 |
| White text on brand bg | only on `bg-brand-600` (4.41:1, OK at ≥18px bold) or `bg-brand-700` (8.17:1, safe at any size) | varies |

**Banned for any text:** `text-gray-400`, `text-gray-300`, `text-gray-200`. May still be used for decorative (non-text) borders/dividers.

### 7.4 Touch target rules

- All `<button>`, `<a>`, and tappable `<div>` elements: minimum 44×44px tap area.
- Icon-only buttons → `.btn-icon` (44×44 round).
- Chips → `.chip` primitive (`min-h-[44px]` with padded content).
- Inline text-action buttons ("+ ADD ANOTHER MEAL") → `.btn-text` with at least `py-3` to reach 44px.
- The bottom-nav each tap region is 1/5th of viewport × 64px — already passes; just fix the label styling.

## 8. Phasing & Timeline

No external deadline. Recommended order (each phase is one PR / branch):

- **Phase 1 (P0.1–P0.4):** documentation + design-system primitives expansion. Low-risk foundation. ~1 sitting.
- **Phase 2 (P0.5):** App-shell refactor + the Vault/`+`-button collision fix. Touches every page implicitly via `App.jsx` and the nav. ~1 sitting.
- **Phase 3 (P0.6):** Vault page refactor. ~1 sitting.
- **Phase 4 (P0.7):** Brainstorm page refactor (priority page, biggest PR). ~2 sittings if done thoroughly.
- **Phase 5 (P0.8):** LogMode refactor. ~1 sitting.
- **Phase 6 (P0.9):** Calendar refactor (involves the list-mode-vs-tap-to-expand decision). ~1–2 sittings.
- **Phase 7 (P0.10–P0.11):** Settings + remaining shared components. ~1–2 sittings, can split.
- **Phase 8 (P0.12):** CI guardrail.

Phases 3 onward can each go on their own branch and be reviewed in any order. The dependency only flows Phase 1 → Phase 2 → all others.

## 9. Success Metrics

### Leading indicators (verifiable as each phase ships)

- **Zero contrast failures.** Re-run the JS audit from §2.4 against each page; should return 0 AA failures (computed-style ratio < 4.5 for any rendered text).
- **Spacing-scale adherence.** A grep across `src/` for banned values returns 0 matches: `text-\\[11px\\]`, `text-gray-400` (in `text-gray-400` for text contexts — or just outright across the codebase if simpler), half-step padding (`p-0\\.5`, `p-1\\.5`, `p-2\\.5`, `p-3\\.5`).
- **Touch-target adherence.** Manual spot-check + an optional Playwright assertion that no `<button>` or `<a>` in the rendered DOM has `getBoundingClientRect().height < 44`.
- **Primitive adoption.** Count of `<button className="btn-primary">` / `.btn-secondary` / `.btn-icon` / `.chip` in `src/` is ≥ count of `<button>` elements minus exempt cases (form-submit buttons inside `<form>` etc.).

### Lagging indicators (1–3 months post-launch)

- **The Planner reports the app feels "easier on the eyes"** in a casual post-ship check-in.
- **No regression in capture friction** — LogMode "open → save" stays under 15 seconds (per PRD-001 success metric).
- **No new sub-44px touch-target violations** introduced in PRDs that ship after this one.

## 10. Open Questions

| # | Question | Recommendation |
|---|---|---|
| OQ.A | Should we use Tailwind's `safelist` config to formalize the allowed classes, or is documentation + lint sufficient? | Start with documentation + lint (P0.12). Adopt `safelist` if regressions still creep in after Phase 8. |
| OQ.B | The "COOKED" checkbox is currently a native `<input type="checkbox">`. What's the cleanest fix for the OS-blue clash with the brand palette? | Use `accent-color: var(--brand-500)` (CSS one-liner, supported by all modern mobile browsers). Falls back gracefully on older browsers. Custom `<button role="checkbox">` is the alternative if `accent-color` proves inadequate. |
| OQ.C | Calendar information density (§2.9): list-mode fallback below 400px viewport, or always tap-to-expand? | Lean toward **tap-to-expand** at all viewports — the current cramped grid IS the bug, and forcing meal names into 50px cells is the wrong frame. The cell shows "•" or a single letter for "has-meal" / "gap-day" / "today"; tapping opens the existing day-detail UI. |
| OQ.D | Should the bottom-nav inactive-label color be `text-gray-700` (≈10:1, very visible) or `text-gray-600` (≈7.2:1, subtler)? Aesthetic vs. accessibility. | `text-gray-700` for the strongest accessibility, but `text-gray-600` is acceptable per §7.3 if visual subtlety is preferred. Decide during Phase 2. |
| OQ.E | LogMode's mystery icon (§2.8) — is it intentional? | Default is **remove**, but check git blame on `LogMode.jsx` first. If it predates a feature that was rolled back, deleting is fine. If it was supposed to open a "previous log" sheet, restore the click handler. |

## 11. Testing Plan

This PRD is mostly visual / structural; testing is largely visual regression rather than unit tests. But:

| Phase | Test work |
|---|---|
| P0.4 (primitives) | No new tests required for the CSS primitives themselves, but `src/__tests__/a11y.test.jsx` (already exists) gets updated to assert the new contrast rules. |
| P0.5 (App.jsx) | Existing tests continue to pass. Add a single test that verifies `<App>` does NOT render two absolutely-positioned buttons in the same corner on the Vault page (regression for the collision bug). |
| P0.6 (Vault) | Existing `Vault.test.jsx`, `RecipeForm.test.jsx`, `RecipeCard.test.jsx` continue to pass against the refactored markup. |
| P0.7 (Brainstorm) | Existing `BrainstormMode.test.jsx` continues to pass. Add a Playwright e2e: "render Brainstorm page → assert no rendered text has `getBoundingClientRect().height < 16` AND `getComputedStyle().fontSize` < 14px." |
| P0.8 (LogMode) | Existing `LogMode.test.jsx`, `LogMode.disambiguation.test.jsx` continue to pass. |
| P0.9 (Calendar) | Existing `CalendarView.test.jsx` continues to pass; if list-mode fallback is added, a new test covers the breakpoint switch. |
| P0.10 (Preferences) | Existing `Preferences/__tests__/index.test.jsx` continues to pass against the new centered header. |
| P0.12 (lint guardrail) | The CI script itself is a test. A failing-by-design test commit verifies it catches a regression. |

**Manual smoke test:** the `.claude/test-credentials.md` checklist already walks the four pages in order; extend it with a "no contrast or sub-44px violations observed" line item.

---

## Revision History

| Version | Date | Notes |
|---|---|---|
| v0.1 | 2026-04-28 | Initial draft from a 3-layer audit: codebase design-system inventory (Layer 3) + production visual audit at 448px content width (Layer 1) + computed-typography pass with WCAG-style contrast measurement (Layer 2). Identified 47+ uses of contrast-failing `text-gray-400` for text, 17 distinct padding values in active use, the `+` / Sign Out button collision in Vault, the OS-blue checkbox in Brainstorm, and the Settings header outlier pattern. P0 phases sized for 1–2 sittings each. |
