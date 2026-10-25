# Recipe Rhythm — TODO

## 🔴 P0 — ship first

_From the 2026-08-02 UXR audit ([`audits/2026-08-02-uxr-heuristic-evaluation.md`](audits/2026-08-02-uxr-heuristic-evaluation.md)). These three are the highest-consequence, lowest-effort fixes — a silent data-loss path, an unguarded destructive action, and an app-wide contrast failure. Full P1/P2 list under **UX / Accessibility** below._

- [ ] **P0-1 · Meal-log save fails silently** — on a failed `meals` insert, `src/pages/LogMode.jsx:64-67` only `console.error`s and returns; the button drops from `Saving…` back to idle with no message. `LogMode` has no error state at all. User believes dinner is logged when it isn't. Fix: add an `error` state, set it in that branch, render it by the button (every sibling page already does this). Effort: XS (~2 lines).
- [ ] **P0-2 · Recipe delete has no confirm and no undo** — `RecipeCard.jsx:408-414` "Remove" → `Vault/index.jsx:82-85` deletes immediately, discarding a ~dozen-field AI-classified record. The DB write is a *soft* delete (`useVault.js:272-278` sets `deleted_at`), so data is recoverable. Fix: reuse the reset-plan confirmation sheet (`BrainstormMode/index.jsx:411-418`), then an undo snackbar that clears `deleted_at`. Effort: S.
- [ ] **P0-3 · Brand orange fails AA contrast on every primary button** — white on `#EF4D23` = 3.64:1 (need 4.5:1); as 12px text on cream = 3.46:1. Hits `.btn-primary` app-wide. Fix: darken the brand fill token to ~`#C63D1C` (note `index.html:10` already uses the darker `#D74520` for `theme-color`). Effort: XS (one token) + extend `lint:ds` to guard the pair.

## Security

- [ ] **Fix high-severity Vite vulnerability** (reported 2026-04-18 by `npm audit`)
  - Package: `vite` 8.0.0 – 8.0.4 (currently installed)
  - Advisories:
    - [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) — Path traversal in optimized deps `.map` handling
    - [GHSA-v2wj-q39q-566r](https://github.com/advisories/GHSA-v2wj-q39q-566r) — `server.fs.deny` bypassed with queries
    - [GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583) — Arbitrary file read via dev-server WebSocket
  - Fix: `npm audit fix` (upgrades Vite past 8.0.4). Re-run `npm run test:unit -- --run` and `npm run build` afterward to confirm nothing regressed.
  - Impact: dev-server only — no production exposure, but still worth patching.

## CI / Infrastructure

- [x] ~~**Disable scheduled CI audit workflows + pin Sonnet on manual runs**~~ ✅ _(2026-05-19, `chore/disable-audit-crons-pin-sonnet`, merged 2026-05-19)_
  - **Why this shipped:** the Anthropic API spend audit on 2026-05-19 (full diagnosis in the matching indigo-flow `SESSION-LOG.md` row) traced ~$17 of May spend on this repo to 11 scheduled `audit-*.yml` workflows running `claude -p` on the default model (Opus). The same audits already run locally via `scripts/run-audits.sh` (launchd, daily at 02:00) against the Max subscription for free — see the script's header comment: _"Uses your Max subscription, not the API."_ So the GitHub Actions copies were paying for audits the launchd job was running anyway. The May 11 spike (~95 Opus requests/min rate-limited) was specifically the `audit-dependencies` cron, which runs daily, racing through the codebase.
  - **What changed:** in all 11 `.github/workflows/audit-*.yml` files, the `schedule:` block and its `- cron:` line are commented out with a dated `# DISABLED 2026-05-19 — API-spend audit. Re-enable by uncommenting…` marker. `workflow_dispatch:` is preserved on every file so the audits can still be triggered manually from the Actions tab if a one-off review is wanted. The `claude -p --permission-mode bypassPermissions` invocation in each file now reads `claude -p --model sonnet --permission-mode bypassPermissions` so any future manual run defaults to Sonnet (~5x cheaper than Opus, plenty capable for the audit prompts).
  - **Net file change:** 11 files, +33/-33 (3 insertions + 3 deletions each). No behavior change to the local launchd path or to any of the prompts in `audits/prompts/`.

- [x] ~~**Mirror `TD-API-KEY-CLEANUP-1`** — Verify in `console.anthropic.com/settings/keys` that no leftover Recipe Rhythm keys are sitting unused. As of 2026-05-19 only one key (`sk-ant-api03-4Wk…CAAA`) was listed against the Recipe Rhythm workspace and it had a "Last used: 2026-05-11" entry consistent with the disabled `audit-dependencies` cron. If a second key surfaces, delete it. Effort: XS (Console-only).~~ ✅ _(2026-05-19, Console action — no code change; verified clean. The unused indigo-flow key that prompted the original `TD-API-KEY-CLEANUP-1` was deleted in the same Console pass.)_

- [x] ~~**Mirror `TD-API-COST-CAP-1`** — Set a monthly spend cap under `console.anthropic.com/settings/limits` so a runaway script (or a re-enabled-and-forgotten cron) can't drain credits silently. The cap applies org-wide, not per-workspace, so this is a single setting that protects both projects. Effort: XS (Console-only).~~ ✅ _(2026-05-19, Console action — no code change; org-wide monthly cap set via `console.anthropic.com/settings/limits`. Single setting covers both workspaces.)_

- [ ] **Mirror `TD-GITLEAKS-1`** — Add a `gitleaks` (or `trufflehog`) pre-commit hook in this repo too, plus a `.github/workflows/secret-scan.yml` job on every PR. Recipe Rhythm's git history is clean of API keys per the 2026-05-19 audit (`git log --all -S "sk-ant-api03"` returned zero hits), but the indigo-flow leak that triggered the audit shows the cost of not having a guard. Effort: XS (~30 min). _Cross-reference:_ same task is filed in indigo-flow's `TODOS.md` as `TD-GITLEAKS-1`.

- [ ] **Optional: rethink the launchd audit cadence** — `scripts/run-audits.sh` only runs when the laptop is awake at 02:00. For audits with a hard cadence requirement (e.g. weekly security), the trade-off now that the GitHub Actions copies are disabled is: (a) keep one `audit-security.yml`-style workflow re-enabled with `--model sonnet` pinned, or (b) run the Max-backed CLI under a hosted box that's always on. Not urgent — the local cadence has been working — but worth noting so the trade-off is visible if a missed-audit gap ever surfaces. Effort: M if pursued.

## UX / Accessibility

_Source: [`audits/2026-08-02-uxr-heuristic-evaluation.md`](audits/2026-08-02-uxr-heuristic-evaluation.md) — Nielsen heuristic evaluation of the live app at 375px, axe-core 4.10.2 + tap-target sweep. Screenshots + raw axe JSON in [`audits/uxr-2026-08-02/`](audits/uxr-2026-08-02/). Severity IDs (P0/P1/P2) are the report's._

### P0 — ship first

_Moved to the **🔴 P0 — ship first** section at the top of this file: P0-1 (silent meal-log save failure), P0-2 (unguarded recipe delete), P0-3 (brand-orange contrast)._

### P1

- [ ] **P1-1 · Add-recipe form is ~5.7 screens tall with no bottom cancel** — ~90 optional chips across 8 sections between name and Save; only exit is the header ✕, which unmounts `RecipeForm` and silently destroys all draft state. Fix: bottom Save/Cancel pair; collapse chip sections behind an "Add details" disclosure; move Prep time + Notes above the chips. Effort: M (worth designing, not patching).
- [ ] **P1-2 · Invented vocabulary at high-stakes moments** — "Your period has ended" banner (DB `planning_period` term; also an unfortunate collision given the app's stated primary user) and "Serve the plan" (`DayPicker.jsx:202`, means "commit & stop editing" — nearly the opposite of serving food). Fix: "Last week's plan is done — mark what you actually cooked"; reuse "Lock in" instead of "Serve." Copy-only.
- [ ] **P1-3 · Selects/inputs missing accessible names** — Cuisine + Flavor `<select>`s have no label (`RecipeForm.jsx:307-314`, axe `select-name` ×2 critical); the image-upload file input has none (axe `label` critical). Fix: `aria-label` on all three. Effort: XS.
- [ ] **P1-4 · Star-rating tap targets are 22×22px** — half the 44px minimum, and 20 of them sit adjacent on the Cookbook screen, so a mis-tap silently sets the wrong rating (no undo). Also the 14×14 "View recipe" icon opens an external URL. Fix: 44px hit areas via padding/overlay, keep the glyph size. Effort: S.
- [ ] **P1-5 · Drag-and-drop reorder has no keyboard path** _(= `AUDIT.md` L2, confirmed still open)_ — `useBrainstorm.js:259-266` registers only Pointer + Touch sensors; the drag handle is a `<div>` with no `tabIndex`/`role`. Fix: add `@dnd-kit` `KeyboardSensor` and make the handle focusable. Effort: S (~10 lines).
- [ ] **P1-6 · Invalid ARIA on every recipe card** — `aria-expanded` on a `<div>` with no `role` (axe `aria-allowed-attr` ×4 critical), so the expand/collapse state is announced to nobody. Fix: `role="button"` + `tabIndex={0}`, or make it a real `<button>`. Effort: XS.

### P2 — backlog

- [ ] **P2-1 · Cookbook has no search / sort / filter** — invisible at 4 recipes, primary complaint at 40; seed suggestions occupy ~60% of the screen and should demote to a single entry point once the vault is non-empty. Effort: M.
- [ ] **P2-2 · Read-path errors are silent or raw** — Auth passes Supabase's message straight through (`Auth.jsx:22,30`); Vault fetch failures only `console.error` (`useVault.js:60,66`) despite a wired-up `vaultError` banner (`index.jsx:233-238`), so a failed load looks identical to an empty Cookbook. Fix: map provider errors; populate `vaultError` on the fetch path. Effort: S.
- [ ] **P2-3 · Sole surviving `alert()`** — `BrainstormMode/index.jsx:95` clipboard-copy fallback (fires on desktop, where a blocking native dialog looks worst). Replace with an inline banner. _(This is the tail of `AUDIT.md` M8, otherwise closed.)_ Effort: XS.
- [ ] **P2-4 · No in-app help / first-run onboarding** — nothing for `onboard|firstRun|tour|welcome`; "About" is a personal letter, not help. A reviewer on the public demo can't learn what "Serve" means. Fix: one line of helper text under ambiguous controls (not a tour). Effort: XS.
- [ ] **P2-5 · Misc a11y** — `react-modal-sheet` backdrop is a nameless button (axe `button-name` critical, library-owned); calendar out-of-range day numbers render at 2.56:1 (`#9D9FA4` on `#FCFBFA`), removing the day's identity not just its emphasis. Effort: S.
- [ ] **P2-6 · Pre-serve plan is device-local, unmarked** — `handleDragEnd`/plan state persist to `localStorage` only (`useBrainstorm.js:213`), so a plan built on a phone won't appear on a laptop until served — yet the sign-in screen promises "sync your meal plan safely." Fix: mark "saved on this device" vs "saved to your account," or persist pre-serve. Effort: M.

## Notes

- **Session log:** this repo doesn't currently have a `SESSION-LOG.md` analogue to indigo-flow's. The 2026-05-19 Anthropic API spend audit narrative lives in `indigo-flow/docs/active/planning/SESSION-LOG.md` because the diagnostic work originated there; the recipe-rhythm side of the same audit is captured by the shipped item above plus the 11 file edits themselves. If a session log is wanted for this repo going forward, create `docs/SESSION-LOG.md` (or `docs/active/planning/SESSION-LOG.md` to mirror the sibling project's layout) and back-populate from this file's shipped items + `git log`.
