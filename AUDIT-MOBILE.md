# Recipe Rhythm — Mobile Usability Audit

_Generated April 19, 2026. Scope: mobile experience (iOS Safari / installed PWA primary target, based on `apple-mobile-web-app-*` meta tags in `index.html`)._

This is a companion to `AUDIT.md`, which covers code & security. This one is strictly about **how the app feels and behaves on a phone** — padding, spacing, tap targets, typography, forms, feedback, accessibility, and content clarity.

Findings are tagged:

- 🔴 **High** — breaks the experience on real devices (e.g. notch overlap, unreadable text, unusable hit targets)
- 🟡 **Medium** — noticeable rough edge or inconsistency that users will notice over time
- 🟢 **Low** — polish that won't block anyone but will tighten the feel

Each finding shows _what_, _why it matters on a phone_, and _where it lives_ (file:line). A flat checklist you can paste into your tracker is at the bottom.

**Update — April 19, 2026:** after writing sections 1–10 from the source code, you shared three real-device screenshots (Cookbook, Prep Table, Calendar). Section 11 captures what those screenshots confirmed or newly surfaced — read that first if you want the "on my actual phone right now" list.

---

## 1. Safe areas & viewport (the "notch problem")

This is the biggest single category by severity — on modern iPhones and Androids with home indicators / gesture bars, the app currently doesn't reserve space for them.

🔴 **M1. `viewport-fit=cover` is missing from the viewport meta tag.**
Where: `index.html:10` — `<meta name="viewport" content="width=device-width, initial-scale=1.0" />`
Why it matters: Without `viewport-fit=cover`, iOS Safari does not expose `env(safe-area-inset-*)` values, so every `pb-safe` / `pt-safe` style in the code is silently ignored. The bottom nav sits right against the home-indicator strip on iPhone X and newer.
Fix: change to `content="width=device-width, initial-scale=1.0, viewport-fit=cover"`.

🔴 **M2. `pb-safe` is used but never defined.**
Where: `src/App.jsx:78` on the bottom `<nav>`.
Why it matters: Tailwind 3 doesn't ship a `pb-safe` utility by default, and `tailwind.config.js` doesn't extend it. The class emits no CSS — the nav has zero padding under it. On a notchless or older phone nothing looks wrong, but on any iPhone X+ your four tab icons overlap the home indicator.
Fix: in `tailwind.config.js`, extend the theme with a `safe` spacing token, e.g.

```js
spacing: { safe: 'env(safe-area-inset-bottom)' }
```

and then `pb-safe` resolves to `padding-bottom: env(safe-area-inset-bottom)`. Same pattern applies for top safe area on the sign-out button.

🔴 **M3. Sign-out button lives inside the top safe area.**
Where: `src/App.jsx:55-62` (className on line 57) — `absolute top-5 right-5`.
Why it matters: `top-5` = 20px. On notched iPhones in portrait the status bar eats ~47px, so the button ends up _under_ the status bar glyphs or right at the notch.
Fix: use `top-[max(20px,env(safe-area-inset-top))] right-[max(20px,env(safe-area-inset-right))]` (Tailwind 3 supports arbitrary values).

🟡 **M4. No `theme-color` meta tag.**
Where: `index.html`.
Why it matters: When installed as a PWA, iOS uses `theme-color` for the status-bar tint. Without it, the status bar will clash with the cream-50 background in light mode.
Fix: add `<meta name="theme-color" content="#FAF9F6" media="(prefers-color-scheme: light)" />` and a matching dark variant if you plan to support dark mode.

---

## 2. Layout & width — `max-w-sm` everywhere

🟡 **L1. App locked to 384px wide.**
Where: `src/App.jsx:54` and `.mobile-screen` in `src/index.css:13-15` both pin the frame at `max-w-sm` (= 24rem = 384px).
Why it matters: iPhone 12 and up are 390px+ wide, Pixel 7 is 412px, fold/phablets are 430px+. Locking to 384px leaves a 3–20px cream strip on either side that looks unfinished in installed-PWA mode (where there's no browser chrome to hide it).
Fix: switch `.mobile-screen` to `w-full max-w-md` (or remove the max entirely and rely on the phone width). Pages that need a centered layout on tablet/desktop can opt in individually.

🟡 **L2. Bottom nav is also capped at `max-w-sm` but fixed-positioned.**
Where: `src/App.jsx:78` — `max-w-sm mx-auto fixed bottom-0 left-0 right-0`.
Why it matters: On a wider phone, this creates a floating 384px bar with transparent gaps on either side that still receive touch — the user can tap the wallpaper and nothing happens. If you lift the `max-w-sm` cap on `.mobile-screen`, drop it here too.

🟢 **L3. Padding is inconsistent across screens.**
Where: headers use `px-5 py-5`, scroll areas use `px-5 py-4`, Auth uses `p-5`, DateRangePicker uses `px-6 pt-6 pb-8`, LeftoverPicker uses `px-6 pt-6 pb-8`.
Why it matters: not a bug, just jittery — scrolling between screens, the left edge of content shifts 4px. Pick one horizontal rhythm (e.g. `px-5` everywhere) and stick to it.

---

## 3. Tap targets (Apple HIG minimum is 44×44pt)

🔴 **T1. Sign-out button is ~32×32.**
Where: `src/App.jsx:55-62` — `p-2` with a 16px `LogOut` icon = ~32×32 hit area.
Fix: either `p-3` or explicit `h-11 w-11`.

🔴 **T2. Feedback/bug-report icon is ~34×34 and overlaps the mic layout.**
Where: `src/pages/LogMode.jsx:186-193` — `absolute top-8 left-5 … p-2 -ml-2`.
Why it matters: both too small _and_ awkwardly positioned (the `-ml-2` pushes it 8px outside the normal padding). It reads as an accidental element.
Fix: move it to the header (next to sign-out) or make it a `h-11 w-11` button in its own row with a label.

🟡 **T3. Vault expand edit / delete buttons are tiny text links, not buttons.**
Where: `src/pages/Vault.jsx:796-809` — `text-[10px]` tracking-widest text buttons with no padding.
Why it matters: 10px text + zero vertical padding = maybe 14px tall hit area. Accidental deletes become likely if the thumb is anywhere close.
Fix: wrap each in a `py-2 px-3` pill, or use icon buttons with 40×40 footprints. Consider a confirmation step on delete.

🟡 **T4. Brainstorm "Swap" pill is ~28px tall.**
Where: `src/pages/BrainstormMode.jsx:226-232` — `px-3.5 py-1.5 text-[10px]`.
Fix: bump to `py-2 text-xs` — still compact, but thumbs hit it reliably.

🟡 **T5. Drag handle in Brainstorm is ~26×26.**
Where: `src/pages/BrainstormMode.jsx:174-179` — `p-1` with 18px icon.
Why it matters: drag handles are inherently fiddly; small targets compound the problem. dnd-kit's `TouchSensor` also has a 250ms activation delay (line 304) which is fine but _combined with_ a tiny handle, it feels unresponsive.
Fix: `p-2` or `p-2.5`.

🟡 **T6. Chip pickers in Vault have 26–28px tall chips.**
Where: `src/pages/Vault.jsx:117-129` (ChipPicker) and the starter-suggestions pills at 830-844. `px-2.5 py-1 text-xs` = small.
Why it matters: you have up to 18 vegetable chips — users will tap wrong ones. Adjacent chips are only `gap-1.5` (6px) apart.
Fix: `px-3 py-1.5` and `gap-2` — still feels like a chip, but forgiving.

🟢 **T7. Calendar cell "+N more" indicator.**
Where: `src/components/CalendarView.jsx:320` — `text-[9px]` badge inside a 48px cell.
Why it matters: users can't see that the cell has extra meals at a glance. The cell is tappable so it's not a hit-target issue, but it's near-invisible.

---

## 4. Typography & contrast

🔴 **Y1. Text smaller than 11px is used in many places.**
Where (incomplete list):
- `src/pages/Vault.jsx:170` (`text-[10px]` FieldSection label)
- `src/pages/Vault.jsx:182` (`text-[9px]` ComponentRow label)
- `src/pages/Vault.jsx:681` (`text-[9px]` auto-completed badge)
- `src/components/CalendarView.jsx:304, 312` (`text-[10px]` / `text-[9px]` cell content)
- `src/components/DateStripPicker.jsx:135` (`text-[9px]` weekday)
- `src/pages/BrainstormMode.jsx:180` (`text-[10px]` weekday)

Why it matters: Apple's own HIG says 11pt (≈ 14.6px CSS pixels) minimum for body and 9pt (~12px) absolute floor for labels. Below that, users with average vision strain; users with any visual impairment can't read it at all. The `text-[9px]` labels _literally can't be read_ on a phone held at arm's length.
Fix: raise the floor to `text-[11px]` (~11px) for labels and `text-xs` (12px) for secondary content. Keep `text-sm` (14px) as the standard body size.

🟡 **Y2. `font-serif italic` resolves to Times New Roman.**
Where: used in headers across LogMode, Vault, BrainstormMode, GapDayView, CalendarView (`p-tag` lines like `src/pages/LogMode.jsx:102`, `src/pages/Vault.jsx:493`, etc.).
Why it matters: `tailwind.config.js` only declares `fontFamily.sans: ['DM Sans', …]`. There's no `fontFamily.serif` override, so `font-serif` falls back to the browser's default — on iOS that's Times New Roman, which clashes with the modern DM Sans brand. Your "What did you eat tonight?" tagline is currently rendered in Times.
Fix: either define `fontFamily.serif: ['Fraunces', 'Georgia', 'serif']` (and load Fraunces from Google Fonts) or replace `font-serif italic` with a styled DM Sans variant.

🟡 **Y3. Gray-300 and gray-400 text on cream-50.**
Where: `src/pages/Vault.jsx:655` (`text-gray-300 text-xs` empty-state hint), `src/pages/BrainstormMode.jsx:961` (`text-gray-400`), many placeholder strings, disabled-button labels.
Why it matters: Tailwind's `gray-300` is `#d1d5db`. On `#FAF9F6` (cream-50) the contrast ratio is about **1.4:1**, well below WCAG AA's 4.5:1 for body text (or 3:1 for large text). The hint literally cannot be read in sunlight.
Fix: move placeholder/hint text up to `text-gray-500` or `text-gray-600`.

🟢 **Y4. `tracking-[0.2em]` on short uppercase labels.**
Where: every small-caps "FOR MY WIFE", "LAST WEEK'S MEALS", "LEGEND", etc.
Why it matters: 0.2em of letter spacing is very wide on mobile — text starts to look like individual letters not a word. Tightening to `tracking-widest` (0.1em) preserves the editorial feel without losing legibility.

---

## 5. Forms & inputs (iOS specifics)

🔴 **F1. Inputs use `text-sm` (14px), which triggers iOS auto-zoom.**
Where: `.input-base` in `src/index.css:22-24`.
Why it matters: iOS Safari auto-zooms on any `<input>` / `<textarea>` / `<select>` with a computed font-size below 16px. Every time the user taps the meal name, notes, email, password, recipe URL, or custom-chip field, the whole page scales up and then zooms out when blur — jarring on every tap.
Fix: change `.input-base` font-size to `text-base` (16px) on mobile. If you want 14px visually, use `text-base sm:text-sm` or a `font-size: 16px !important` media-query override for `<640px`.

🔴 **F2. No `autoComplete` on auth form.**
Where: `src/components/Auth.jsx:44-64`.
Why it matters: iOS Keychain and password managers won't offer to autofill or save credentials. Every login is typed by hand.
Fix:

```jsx
<input type="email"    autoComplete="email" …/>
<input type="password" autoComplete={isSignUp ? 'new-password' : 'current-password'} …/>
```

🟡 **F3. Native `alert()` used for critical and non-critical paths.**
Where: `src/components/Auth.jsx:21` (signup success), `src/pages/Vault.jsx:340` (duplicate recipe), `src/pages/Vault.jsx:361` (image upload failure), `src/pages/BrainstormMode.jsx:741` (plan copied to clipboard).
Why it matters: `alert()` blocks the main thread, looks like a system error on iOS, and can't be styled or accessibility-tested. It also dismisses any inline state the user was halfway through.
Fix: use a toast/banner in the app's own visual language — you already have `text-green-700 bg-green-50` toasts in LogMode; reuse the pattern. For duplicates, inline the error near the field.

🟡 **F4. Image-upload error asks users to "verify INSERT policy".**
Where: `src/pages/Vault.jsx:361` — `alert('Image upload failed. Please verify that your Supabase "recipe_images" bucket has a permissive INSERT policy configured…')`.
Why it matters: this is a developer debugging message surfaced to end users. Even you-as-user won't know what to do in the moment.
Fix: log the technical detail to console; show users "Couldn't upload the photo — the recipe was saved without it."

🟡 **F5. Backdrop-tap dismisses in-progress modals.**
Where: `src/components/DateRangePicker.jsx:188` and `src/components/CalendarView.jsx:382` — tapping the black backdrop fires `onCancel` / `onClose` with no confirmation.
Why it matters: easy to lose a half-selected date range with a stray thumb. The CalendarView popover is harmless to dismiss, but the DateRangePicker has real in-progress state.
Fix: only dismiss on backdrop tap if the form is unedited; otherwise no-op or confirm.

🟢 **F6. No "show password" toggle.**
Where: `src/components/Auth.jsx:57`. Minor, but a standard mobile courtesy.

🟢 **F7. LogMode textarea can be obscured by the keyboard.**
Where: `src/pages/LogMode.jsx:137-143`. The mic + Save buttons are pinned via `py-4 border-t` below the scroll area. When the iOS keyboard rises, the textarea can end up right at the keyboard's top edge with no visual gap. Consider `scrollPadding` or scroll-into-view on focus.

---

## 6. Feedback & states

🟡 **S1. "Saved" confirmation auto-dismisses with its secondary CTA.**
Where: `src/pages/LogMode.jsx:63-67` — 4-second timeout clears both `saved` and `savedMealName`.
Why it matters: the "Save X to Cookbook" button disappears right as the user is reading it. 4s is fine for the toast; keep the Cookbook CTA sticky until dismissed or acted on.

🟡 **S2. "AI failed — check console" is shown to users.**
Where: `src/pages/Vault.jsx:519-521` and the surrounding `aiError` handling.
Why it matters: referring to the console confuses users. Replace with "Couldn't analyze this recipe. You can fill the details manually."

🟡 **S3. Disabled buttons only use opacity.**
Where: every `disabled:opacity-40 disabled:cursor-not-allowed` (LogMode, Vault, BrainstormMode, DateRangePicker).
Why it matters: `cursor-not-allowed` is a desktop-only cue. On mobile, a 40%-opacity button still looks tappable, so users tap and get no feedback. Worse, the brand-500 color at 40% opacity is still fairly saturated on cream.
Fix: add a real `disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none` variant to `.btn-primary`.

🟡 **S4. Loading states are inconsistent.**
Where: plain "Loading vault…" (`Vault.jsx:465`), "Building your plan…" (`BrainstormMode.jsx:801`), "Checking for leftovers…" (`GapDayView.jsx:63`), vs. spinners elsewhere (`LogMode` Auth, analyze buttons).
Why it matters: the app flashes blank text on every navigation. On slow 3G, the user sees "Loading vault…" for several seconds with nothing else.
Fix: adopt a single skeleton pattern (even three `bg-cream-100 animate-pulse` rectangles that match the card shape). Keep spinners for in-button states.

🟡 **S5. Swap sheet is `absolute`, not `fixed`.**
Where: `src/pages/BrainstormMode.jsx:1041` — `className="absolute inset-0 …"`.
Why it matters: if the parent scroll area has scrolled down, `absolute` positions the sheet relative to the nearest positioned ancestor (the page), not the viewport. On iOS with an already-scrolled screen, the backdrop can miss the top edge or allow content behind it to scroll. Other modals (DateRangePicker, CalendarView popover) correctly use `fixed`.
Fix: change `absolute inset-0` → `fixed inset-0`.

🟢 **S6. No haptics on primary actions.**
Where: mic tap, Serve, Save, delete.
Why it matters: on iOS Safari via WebKit you can't use the Vibration API, but since this is targeted as an installed PWA, you could experiment with `navigator.vibrate(10)` on Android and consider the Taptic Engine via install-time hooks. Pure polish, low priority.

---

## 7. Accessibility

🟡 **A1. "Today" in the calendar relies on color alone.**
Where: `src/components/CalendarView.jsx:277` — `ring-2 ring-brand-400`.
Why it matters: WCAG 1.4.1 (use of color) — users with red-green colorblindness or greyscale displays can't distinguish today from other cells. The ring is the only indicator.
Fix: bold the day number or add a small dot under it for today cells.

🟡 **A2. No focus trap or initial focus in modals.**
Where: DateRangePicker, LeftoverPicker, swap sheet, calendar popover.
Why it matters: a keyboard user (or a user with Switch Control on iOS) tabs past the modal into the page behind it. Focus also doesn't move into the modal on open.
Fix: when opening a modal, `useEffect` to set focus on the first interactive element; use a focus-trap library (or a minimal home-rolled trap).

🟡 **A3. "Logged!" toast is not announced to screen readers.**
Where: `src/pages/LogMode.jsx:163-179` — the success block has no `role="status"` or `aria-live`.
Why it matters: a VoiceOver user gets no confirmation that the save happened.
Fix: wrap in `<div role="status" aria-live="polite">`.

🟡 **A4. Expand/collapse buttons lack `aria-expanded`.**
Where: `src/pages/Vault.jsx:662-693` (recipe rows), `src/components/DateStripPicker.jsx:194-212` ("Show another 7 days").
Fix: add `aria-expanded={expandedId === recipe.id}` and similar for the date strip.

🟢 **A5. Icon-only buttons generally have `aria-label` — good.** Keep the discipline; a few `title` attributes duplicate `aria-label` which is harmless but redundant.

---

## 8. Content & copy clarity

🟡 **N1. "What did you eat tonight?" is fixed — even in the morning.**
Where: `src/pages/LogMode.jsx:102`.
Why it matters: if the user opens the app at 8am to log yesterday's dinner, the "tonight" framing is jarring.
Fix: keep "tonight" after 5pm local time; switch to "What did you eat last night?" or "What did you eat yesterday?" before 11am. Low-effort, feels thoughtful.

🟡 **N2. "Auto-completed" badge is jargon.**
Where: `src/pages/Vault.jsx:680-684`.
Why it matters: user-facing label for an internal flag. Users don't know what it means.
Fix: "AI-filled" or "Needs review" (your call).

🟡 **N3. Period terminology is overloaded.**
"Active period", "Finalized", "Gap day", "Ended", "Between periods", "Roll forward", "Lock in as-is" all appear across BrainstormMode, GapDayView, CalendarView, PeriodReview, and LeftoverPicker. For a mostly-solo app, users can learn the vocabulary, but there's no glossary, no tooltip hover, and several terms are synonyms of each other (ended_unfinalized, gap, finalized).
Fix: create a tiny "?" help popover on the brainstorm screen that defines the three states in plain English.

🟢 **N4. Grocery list exports as .txt.**
Where: `src/pages/BrainstormMode.jsx:786-794`.
Why it matters: .txt downloads on iOS Safari land in Files > Downloads, which is annoying. Consider using `navigator.share` with a file blob when available, falling back to download. You already use the share sheet for the plan itself (line 731).

🟢 **N5. App title mismatch.**
`<title>For My Wife</title>` (`index.html:11`), `apple-mobile-web-app-title` = "For My Wife", repo/package name = "recipe-rhythm" (see also `AUDIT.md` H2). Pick one public name.

---

## 9. Navigation & gestures

🟡 **G1. No iOS-style swipe-back between modes.**
The bottom tabs are the only way to navigate. Not a bug, but on iOS users instinctively swipe from the left edge. Low priority unless you want to feel native.

🟡 **G2. The "Swap" bottom sheet doesn't have a swipe-to-dismiss.**
Where: `src/pages/BrainstormMode.jsx:1039-1120`.
Why it matters: users expect to swipe down bottom sheets. Right now you have to hit the Cancel button or the backdrop. If you adopt a small sheet library (vaul, react-modal-sheet) you get this for free.

🟢 **G3. Pull-to-refresh.**
No screen supports pull-to-refresh. Vault and Calendar would both benefit.

---

## 10. Performance on phones

🟡 **P1. Full-size base64 images held in React state.**
Where: `src/pages/Vault.jsx:253-256` — the resized image is stored as a base64 string in `imageBase64` state _and_ rendered inline as a data URL (line 564).
Why it matters: 1024×1024 JPEG at quality 0.8 is typically 200–400KB; as base64, 30% bigger, and it's held in the component's state tree until the form is reset. Combined with React's dev-time serialization, this can make older iPhones sluggish while the form is open.
Fix: hold a `URL.createObjectURL(blob)` reference for preview, and only base64-encode on submit.

🟡 **P2. Vault re-fetches the full recipe list on every mutation.**
Where: `src/pages/Vault.jsx:391, 420, 459`.
Why it matters: OK at 10 recipes, painful at 200 on 3G.
Fix: optimistic update of the `recipes` state array, plus Supabase returning the inserted/updated row.

🟢 **P3. `localStorage` can throw in private-mode Safari.**
Where: `src/pages/BrainstormMode.jsx:242, 286, 292, 406, 421-432` and `src/pages/Vault.jsx:76-81`.
All accesses are already in try/catch blocks — good. Just flagging that Safari private mode is where this breaks first.

---

## 11. What the device screenshots confirmed

The three screenshots (Cookbook, Prep Table, Calendar) captured 2026-04-19 2:24–2:25pm on what looks like an iPhone 14/15-class device. Below is what shows up visually — some are confirmations of earlier findings, some are brand new.

### Brand-new findings (not visible from code alone)

🔴 **V1. The "COOKED" checkbox is clipped off the right edge of Wildcard rows.**
Where: Screenshot 2 (Prep Table), Tuesday "Spaghetti Carbonara" row. Component: `src/pages/BrainstormMode.jsx:166-235` (SortableMealItem).
What I see: the Tuesday row has the meal name wrapping to two lines, then `🟠 WILDCARD` badge, then the external-link icon, then the `COOKED` label, then a checkbox that is visibly _cut in half_ by the right edge of the card. Monday, Wednesday, and Thursday rows (no Wildcard badge) display the checkbox fully.
Why it matters: the user **cannot tap the Tuesday Cooked checkbox** on a stock iPhone because half the hit target is offscreen.
Root cause: `SortableMealItem` is a flex row with `gap-4` and fixed-width siblings (drag handle, day label, checkbox label), plus a flex-1 meal name — but when `is_wildcard` is true, the name's flex container adds two extra children (WILDCARD pill + ExternalLink) that push the whole row past the parent's width.
Fix options: (a) move the WILDCARD/ExternalLink onto a second line under the meal name; (b) shrink the meal name's max-width when the row is wildcard; (c) replace the "COOKED" text + checkbox with an icon-only checkbox to save ~80px.

🔴 **V2. The starter-suggestions section has horizontal overflow clipping content off the left edge.**
Where: Screenshot 1 (Cookbook), bottom section titled "NEED A HEAD START?". Component: `src/pages/Vault.jsx:823-846`.
What I see: the section heading reads `EED A HEAD START?` (the "N" is clipped), the body line reads `p any meal to add it to your vault with AI-filled details` (the "Ta" is clipped), and the starter chips "Beef Tacos", "Caesar Salad with Grilled Chicken" start slightly past the left edge of the viewport.
Why it matters: first impression for a new user with an empty-ish vault. The sentence literally reads wrong.
Root cause: the section lives inside the `flex-1 overflow-y-auto px-5 py-4 space-y-4` scroll container (`Vault.jsx:498`), so the left padding should be 20px. The only way text could be clipped on the _left_ is if there's a horizontal offset somewhere — most likely the long starter chip "Caesar Salad with Grilled Chicken" is wrapping in a way that pushes the `flex flex-wrap gap-2` line. Worth testing by temporarily capping the chip line with `overflow-hidden` or adding `min-w-0` to the wrapping container.
Fix: add `min-w-0` to the parent of the `flex flex-wrap` chip container, and check the parent ancestor chain for any `w-max` / `w-fit` that would let it exceed `max-w-sm`.

🟡 **V3. Cookbook recipe cards waste a lot of vertical space on short entries.**
Where: Screenshot 1. Cards for "Curry chicken rice salad" (one line of text, three tags) and "Pork chops and tots" (one line, three tags) are about 140px tall with ~80px of empty space between them.
Why it matters: on a standard phone you only get ~5 cards visible at a time. Power users with 30+ recipes will scroll a lot.
Root cause: `card` class uses `p-5` (20px all sides) and the list uses `space-y-4` (16px gaps). 20+20+16 = 56px of vertical chrome per card before any text.
Fix: drop `card` to `p-4` and list gap to `space-y-3`. You'll get ~2 extra cards visible on screen without losing any breathing room.

🟡 **V4. The top of the Cookbook first card is overlapped by the status bar.**
Where: Screenshot 1, top edge. "Meat loaf meatballs polenta and v…" and its tag row sit directly under the "2:25" status bar glyphs with no gap.
Why it matters: this is the same safe-area failure as M1/M3, but it manifests at the _top_ of the scroll area here, not just at the sign-out button. The cream header that should be visible at the top is gone — which suggests the user had scrolled, but even mid-scroll the card should not print _under_ the status bar.
Fix: same as M1 (`viewport-fit=cover`) plus adding `pt-safe` or `pt-[env(safe-area-inset-top)]` to `.mobile-screen` so the scroll container begins below the status bar regardless of scroll position.

### Confirmations with severity bumps

🔴 **V5. Calendar meal previews are truncated to 5–6 characters — effectively unreadable (was 🟡 T7 / 🔴 Y1).**
Where: Screenshot 3. Visible previews: `Curry…`, `North…`, `Meat l…`, `Pork c…`, `Pizza …`, `Spag…`. You cannot distinguish "Pork chops and tots" from "Pork carnitas" from this view.
Why it matters: the calendar's primary job is helping the user see what they ate when. If the meal name is truncated to the point of ambiguity, the view is cosmetic only.
Fix options: (a) drop the day number to a tiny corner badge and give the meal name the full cell width — calendar cells are ~48px wide at 7-col × 336px, which is enough for ~8 chars of `text-xs` (12px); (b) abbreviate by cuisine tag instead of name (e.g. show `🇮🇳 CURRY`, `🇮🇹 PASTA`); (c) drop the preview entirely and use a colored dot to indicate "something happened" — tap reveals details.

🔴 **V6. Serif italic for taglines renders as Times New Roman (was 🟡 Y2).**
Where: "Brainstorm meals" on screenshot 2 and "Your planning history" on screenshot 3 are both visibly Times — the strokes are thin, the italic is angled differently from what a modern serif would produce, and it clashes with the DM Sans uppercase header above it.
Why it matters: this is the first thing the user reads on every non-Log screen. Having it in Times reads like "someone forgot to load a font" rather than "editorial flourish".
Fix: as noted in Y2, either add Fraunces / another modern serif to `tailwind.config.js` and load it via Google Fonts in `index.css`, or drop serif entirely and style the tagline as italic DM Sans (e.g. `italic font-normal text-lg text-gray-700`).

### Positive things worth keeping

- The **bottom-tab nav** looks great — icons + labels + active-state (orange `text-brand-500 scale-110`) reads clearly on both Prep Table and Calendar screenshots. The Chef-knife icon for "PREP TABLE" is a charming custom touch.
- The **Today highlight** on April 19 in the Calendar (orange ring on the 19 cell) is visible and distinct even though A1 notes it's color-only.
- The **"Served on Apr 19"** success banner at the bottom of Prep Table is clear, well-contrasted, and feels resolved. The green against cream works.
- **Brand logo** (heart with "S") and wordmark "FOR MY WIFE" render exactly as intended.
- Hit areas on the **bottom-tab buttons** look properly sized in all three screenshots — ~60px tall, finger-friendly.

---

## Prioritized checklist (paste-ready)

**Do first (breaks on real phones):**

- [ ] **V1:** Fix clipped COOKED checkbox on Wildcard rows (`BrainstormMode.jsx:166-235`) — row overflows past right edge when `is_wildcard` is true
- [ ] **V2:** Fix horizontal clipping in Cookbook starter-suggestions section (`Vault.jsx:823-846`) — "N" in "NEED A HEAD START?" is cut off
- [ ] Add `viewport-fit=cover` to the viewport meta tag (`index.html:10`)
- [ ] Define `pb-safe` / `pt-safe` utilities in `tailwind.config.js`
- [ ] Add `pt-safe` to `.mobile-screen` so scroll content can't print under the status bar (`src/index.css:13-15`)
- [ ] Move sign-out button out of the top safe area (`App.jsx:55-62`)
- [ ] Rethink Calendar cell preview (5-char truncation is unreadable — `CalendarView.jsx:310-324`)
- [ ] Raise `.input-base` font-size to 16px to stop iOS auto-zoom (`src/index.css:22-24`)
- [ ] Add `autoComplete` to email and password inputs (`Auth.jsx:44-64`)
- [ ] Fix the swap bottom sheet's `absolute inset-0` → `fixed inset-0` (`BrainstormMode.jsx:1041`)
- [ ] Enforce 44×44 hit areas on sign-out, feedback icon, and Vault edit/delete links
- [ ] Define `fontFamily.serif` in `tailwind.config.js` OR drop `font-serif italic` so taglines don't render as Times

**Do next (noticeable polish):**

- [ ] Pick a consistent horizontal padding (`px-5`) across all screens and modals
- [ ] Raise minimum text size to 11px (kill all `text-[9px]` / `text-[10px]`)
- [ ] Define `fontFamily.serif` in `tailwind.config.js` or drop `font-serif italic`
- [ ] Replace `alert()` with inline banners on Auth, Vault dup check, image upload error, share-clipboard fallback
- [ ] Replace "AI failed — check console" with a user-friendly copy
- [ ] Sticky Cookbook CTA instead of auto-dismiss after 4s (`LogMode.jsx:63-67`)
- [ ] Add `role="status" aria-live="polite"` to the "Logged!" toast
- [ ] Add `aria-expanded` to recipe rows and date-strip expand button
- [ ] Unify loading states as skeleton placeholders
- [ ] Upgrade disabled button styling beyond opacity-40
- [ ] Rename "Auto-completed" → "AI-filled"
- [ ] Time-of-day aware copy for "What did you eat tonight?"

**Do when there's time (nice-to-have):**

- [ ] Relax `max-w-sm` to `max-w-md` or `w-full` and audit all the consequences
- [ ] Add a theme-color meta tag
- [ ] Show-password toggle on the auth form
- [ ] Pull-to-refresh on Vault and Calendar
- [ ] Swipe-to-dismiss on bottom sheets
- [ ] Use `URL.createObjectURL` for recipe image preview instead of base64 in state
- [ ] Optimistic updates in Vault to avoid re-fetching everything
- [ ] Add a "?" glossary explaining period / gap / finalized / leftovers
- [ ] Bold day number (or dot) in calendar for "today" so color isn't the only cue
- [ ] Tighten `tracking-[0.2em]` to `tracking-widest` on uppercase labels
- [ ] Haptics on primary actions (Android only, best-effort)
