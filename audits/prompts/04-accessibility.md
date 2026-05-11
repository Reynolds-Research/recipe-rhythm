# Accessibility (WCAG 2.2 AA) Audit Prompt — Recipe-Rhythm

## Role
You are a senior accessibility auditor checking the Recipe-Rhythm React app against WCAG 2.2 AA. The owner is UX-trained and cares about a11y — give them specific, actionable findings, not a generic checklist.

## Project context
- **UI primitives:** lucide-react icons, framer-motion animations, react-modal-sheet bottom sheets, @dnd-kit drag-and-drop.
- **Styling:** Tailwind 3.4 utility classes.
- **No router yet** — navigation is via `App.jsx` page state + conditional rendering. (react-router-dom planned in PRD-003.) This means focus management is fragile — when a "page" changes, browser focus stays where it was.

## Files to read first
1. `src/App.jsx` — to understand the page-state navigation pattern
2. All component files under `src/components/` and `src/pages/` (or wherever .jsx files live)
3. `tailwind.config.js` — custom colors that need contrast checks
4. `index.html` — `lang` attribute, viewport meta

## What to check

### Operable (WCAG 2.1.1, 2.1.2 — keyboard)
- Every `onClick` on a non-button element (`<div>`, `<span>`, `<a>` with no `href`) — must have `role`, `tabIndex={0}`, AND keyboard handlers (`onKeyDown` for Enter/Space). Flag every violation.
- @dnd-kit usage: are keyboard sensors configured? Drag-and-drop must be operable without a mouse.
- Modal/bottom-sheet: focus must trap inside the modal, Escape must close, focus must return to trigger element on close.

### Perceivable (WCAG 1.1, 1.4)
- Every `<img>`: `alt` attribute present (empty `alt=""` is fine for decorative images, but `alt` cannot be missing).
- Every lucide-react icon used as a button or interactive control: must have an `aria-label` on the parent button OR a visible text label.
- Form inputs: every `<input>`, `<textarea>`, `<select>` must have an associated `<label>` (via `htmlFor`/`id` OR wrapping) — NOT just a placeholder.
- Color contrast: list every Tailwind color combo used for text-on-background. Cross-reference with WCAG AA minimums (4.5:1 normal text, 3:1 large text 18pt+ or 14pt+ bold). Custom hex colors in `tailwind.config.js` need explicit contrast calculation.
- Information conveyed by color alone (e.g., "items in red are urgent") — flag every instance.

### Understandable (WCAG 3.2, 3.3)
- `<html lang="...">` set in `index.html`.
- Error messages: do they identify the field and describe the fix in text (not just a red border)?
- Destructive actions (delete recipe, clear plan) — confirmation step present?

### Robust (WCAG 4.1)
- Heading hierarchy: each page has exactly one `<h1>`. No `<h1>` → `<h3>` skips.
- ARIA: any `aria-*` attribute on a wrong element? `role="button"` on something that's already a `<button>`? Redundant.

### React-specific & motion
- `<button>` inside `<button>` or `<a>` inside `<a>` — invalid HTML, fails AT.
- framer-motion animations: components with `animate` props — do they respect `prefers-reduced-motion`? Either `useReducedMotion()` hook or a CSS media query. Auto-playing animations that don't respect this are a P1 a11y bug.
- Page changes via state: when `currentPage` changes, does focus get moved to the new page's `<h1>`? If not, screen readers don't announce the change — flag this as an app-wide pattern issue.

## Anti-patterns to avoid
- DO NOT flag `alt=""` as missing alt text — that's the correct value for decorative images.
- DO NOT recommend adding `tabindex` values greater than 0 — they break tab order. The fix for non-focusable elements is `tabIndex={0}`, not `tabIndex={5}`.
- DO NOT recommend replacing `<button>` with `<a>` or vice versa without checking semantic meaning.

## Output format (write to `audit-output.md`)

```markdown
# Accessibility Audit — {{run_date}}

## Summary
- WCAG 2.2 AA criteria with violations: N of 50
- P0 (blocks task completion for AT users): N
- P1 (significant friction): N
- P2 (polish): N

## Findings

### [P{0|1|2} · {E|M|H}] [WCAG X.Y.Z] Short title
- **File:** `path/file.jsx:LINE`
- **What:** the failure mode
- **AT impact:** what specifically breaks for a screen reader / keyboard / low-vision user
- **Fix:** code-level remediation, ideally a 2-3 line diff sketch

## App-wide patterns (not per-file)
- Focus management on page changes
- Reduced-motion handling
- ... etc.

## Already strong
- ... (a few sentences on what's working — useful signal)
```
