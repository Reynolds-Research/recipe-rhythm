# UX Heuristic + Mobile Responsiveness Audit Prompt — Recipe-Rhythm

## Role
You are a senior product designer doing a Nielsen-style heuristic walkthrough of the Recipe-Rhythm UI, plus a mobile/responsive sweep. The owner is a senior UX researcher and will respect specific, evidence-based observations — not generic "make it more delightful" feedback.

## Project context
- **Audience:** households planning weekly meals on phones (primary) and tablets (secondary). Desktop is a "nice-to-have" surface.
- **Primary tasks:** save a recipe, plan a week of meals, generate a grocery list, swap a meal.
- **UI primitives:** react-modal-sheet for bottom sheets, framer-motion for transitions, @dnd-kit for drag-and-drop meal slot rearrangement.
- **Tailwind breakpoints:** default Tailwind 3 (sm: 640, md: 768, lg: 1024, xl: 1280, 2xl: 1536).

## Files to read first
1. `src/App.jsx` — page-level structure
2. All `.jsx` files under `src/` — components and pages
3. `src/index.css` or wherever global styles live
4. `tailwind.config.js`

## Audit dimensions

### Nielsen's 10 heuristics
For each, walk the codebase and the recent commit messages, then assess:
1. **Visibility of system status** — loading spinners on async actions, optimistic UI for fast operations, success toasts after destructive actions. Are there async functions in components that show nothing during their await?
2. **Match between system and real world** — UI labels use cooking language (e.g., "ingredients," not "items"). Any developer jargon visible to users (e.g., "submit," "entity," "record")?
3. **User control and freedom** — undo on delete? Cancel on multi-step flows? Back button on modals?
4. **Consistency and standards** — same action labeled the same way across screens (Save vs Done vs Confirm). Same icon meaning across screens. Modal close = always X in same corner.
5. **Error prevention** — destructive actions (delete recipe, clear week's plan) need confirmation. Forms validate before submit.
6. **Recognition rather than recall** — recently-viewed recipes surfaced, common ingredients prefilled, last-week's plan as a starting point.
7. **Flexibility and efficiency of use** — keyboard shortcuts for power users, "duplicate this week" for repeat users.
8. **Aesthetic and minimalist design** — every option visible by default earns its place. Are there toolbars/menus showing rarely-used options at the top level?
9. **Help users recognize, diagnose, and recover from errors** — every error toast/banner answers "what happened and what do I do?" Generic "Something went wrong" is a fail.
10. **Help and documentation** — empty states explain what the page will become once populated. First-run tooltips on non-obvious affordances.

### Mobile / responsive (the hard part)
- **Touch targets:** every interactive element should be ≥44×44 CSS px. Inspect Tailwind classes — `h-8 w-8 p-1` is 32×32 with 4px padding = 32×32 hit target = FAIL. Common offenders: icon-only buttons.
- **No horizontal scroll at 375px:** grep for fixed widths (`w-[400px]`, `min-w-[500px]`). Any of these in components used on mobile pages will overflow iPhone SE.
- **Input font size:** all `<input>`, `<textarea>`, `<select>` should render at ≥16px on mobile, OR iOS will auto-zoom on focus (jarring). Check Tailwind text classes on form fields.
- **Safe-area insets:** for fixed bottom navigation or fixed top headers, are `env(safe-area-inset-*)` values respected? Modern iPhones need `pb-[env(safe-area-inset-bottom)]` on bottom-fixed elements.
- **Bottom sheet UX:** react-modal-sheet — are sheets dismissible by drag-down AND by tapping backdrop? Is content inside scrollable when it overflows?
- **Drag-and-drop on touch:** @dnd-kit — is `TouchSensor` configured with `activationConstraint: { delay: 250, tolerance: 5 }` so taps don't accidentally trigger drags?
- **Landscape orientation:** does any layout assume portrait? (E.g., fixed `h-screen` containers that get clipped in landscape.)

## Anti-patterns to avoid
- DO NOT critique color palette or visual design taste — focus on behavior and information architecture.
- DO NOT recommend redesigns of major flows — recommend targeted fixes. "Add a confirm step to delete" is good. "Reimagine the meal planning page" is not.
- DO NOT cite heuristic violations without a specific file or screen reference.

## Output format (return as your direct response — do NOT use the Write tool or create any file; the output of this conversation will be piped into a downstream tool)

```markdown
# UX + Mobile Audit — {{run_date}}

## Top 5 highest-leverage fixes
1. [P{0|1|2} · {E|M|H}] one-liner — file reference

## Heuristic-by-heuristic findings

### H1 — Visibility of system status
- ✅ Working: ...
- ⚠️ Issues: list with file refs and severity

(repeat for H2 through H10)

## Mobile / responsive findings

### Touch target violations
| Component | File | Current size | Suggested fix |
|---|---|---|---|
| ... |

### Other responsive issues
- list with file refs and severity

## Patterns to consider adopting (optional, P3)
- non-blocking suggestions for future polish
```

If you walk the codebase and a category genuinely has no issues, say so. Empty findings is a real signal.
