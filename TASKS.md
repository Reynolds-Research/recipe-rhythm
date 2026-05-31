# Recipe Rhythm — TODO

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

## Notes

- **Session log:** this repo doesn't currently have a `SESSION-LOG.md` analogue to indigo-flow's. The 2026-05-19 Anthropic API spend audit narrative lives in `indigo-flow/docs/active/planning/SESSION-LOG.md` because the diagnostic work originated there; the recipe-rhythm side of the same audit is captured by the shipped item above plus the 11 file edits themselves. If a session log is wanted for this repo going forward, create `docs/SESSION-LOG.md` (or `docs/active/planning/SESSION-LOG.md` to mirror the sibling project's layout) and back-populate from this file's shipped items + `git log`.
