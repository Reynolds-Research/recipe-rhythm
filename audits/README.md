# Recipe-Rhythm — Recurring Audit Kit

This bundle gives you 11 recurring audits, each driven by the **local Claude Code CLI** (using your Claude Max subscription) and scheduled by **macOS launchd**. Findings are posted as **labeled GitHub Issues** in your code repo.

> **History note.** This kit was originally built on the Gemini CLI in GitHub Actions, then ported to Claude Code in GitHub Actions, then ported again to local execution on 2026-05-11 — that last move so the user's existing Claude Max subscription covers the cost instead of paying per-token API fees. The prompts are unchanged across all three iterations.

## Mental model

Think of this kit as a panel of specialist consultants on retainer. Each consultant (an audit prompt) knows their lane — security, accessibility, UX, etc. — and reports in on a predictable schedule. **macOS launchd** is the calendar booking system. **Claude (running locally)** is the consultant who actually does the inspection. The **GitHub Issue** is the report on your desk Monday morning.

## What's in this bundle

```
audits/
├── README.md                            ← you are here
└── prompts/
    ├── 01-security.md                   weekly (Mon)
    ├── 02-rls.md                        weekly (Mon)
    ├── 03-dependencies.md               daily
    ├── 04-accessibility.md              biweekly (Mon, even ISO weeks)
    ├── 05-heuristic-mobile.md           biweekly (Mon, odd ISO weeks)
    ├── 06-edge-case.md                  biweekly (Mon, even ISO weeks)
    ├── 07-test-coverage.md              weekly (Tue)
    ├── 08-api-drift.md                  weekly (Mon)
    ├── 09-performance.md                monthly (1st)
    ├── 10-ai-prompt-quality.md          weekly (Tue)
    └── 11-prd-drift.md                  monthly (1st)

scripts/
├── run-audits.sh                        ← the runner script (cadence + dispatch)
└── launchd/
    └── com.matt.recipe-rhythm.audits.plist   ← scheduler config (2am daily)

.github/workflows/
└── audit-*.yml                          ← LEGACY: kept as fallback during local validation; delete once local setup is proven
```

## How it works

```
Every day at 2am, macOS launchd fires:
    ↓
  scripts/run-audits.sh
    ↓
  Reads today's date → decides which audits are scheduled
    ↓
  For each scheduled audit:
    ↓
    claude -p --permission-mode bypassPermissions < audits/prompts/NN-*.md
       (Claude reads your repo, writes findings to stdout)
    ↓
    gh issue create --label audit,audit:* --body-file <findings>
    ↓
  Logs to .audit-logs/audit-run-YYYY-MM-DD.log
```

The audits use your **local** Claude Code authentication (via your Max subscription) — no API key needed.

## Step 1 — One-time prerequisites

You only need to do these once. Skip any you've already done.

### a) Confirm `claude` and `gh` are installed and authenticated

From your terminal:

```bash
which claude          # should print a path, e.g., /opt/homebrew/bin/claude
claude --version      # should print a version number
gh auth status        # should say "Logged in to github.com"
```

If `claude` is missing: `npm install -g @anthropic-ai/claude-code`, then run `claude` once interactively to log in via your browser (your Max subscription gets picked up here).

If `gh` is not authenticated: `gh auth login` and follow the prompts.

### b) Create the GitHub Issue labels (one-time)

`gh issue create --label` errors if the label doesn't exist. Run this once from your repo root:

```bash
gh label create audit              --color "0E8A16" --description "Auto-generated audit finding" 2>/dev/null || true
gh label create audit:security     --color "B60205" --description "Security audit" 2>/dev/null || true
gh label create audit:rls          --color "B60205" --description "Supabase RLS audit" 2>/dev/null || true
gh label create audit:dependencies --color "FBCA04" --description "Dependency / supply chain" 2>/dev/null || true
gh label create audit:a11y         --color "1D76DB" --description "Accessibility audit" 2>/dev/null || true
gh label create audit:ux           --color "5319E7" --description "UX heuristic + mobile" 2>/dev/null || true
gh label create audit:edge-case    --color "D93F0B" --description "Edge case audit" 2>/dev/null || true
gh label create audit:tests        --color "0E8A16" --description "Test coverage" 2>/dev/null || true
gh label create audit:api-drift    --color "FBCA04" --description "api-server.mjs ↔ api/ drift" 2>/dev/null || true
gh label create audit:performance  --color "C5DEF5" --description "Performance audit" 2>/dev/null || true
gh label create audit:ai-prompts   --color "5319E7" --description "AI prompt quality" 2>/dev/null || true
gh label create audit:prd-drift    --color "BFD4F2" --description "PRD ↔ implementation drift" 2>/dev/null || true
```

The `|| true` suppresses harmless "label already exists" errors.

### c) Make the runner executable

```bash
chmod +x scripts/run-audits.sh
```

## Step 2 — Smoke-test the runner manually

Before installing the scheduler, prove the runner works:

```bash
# Run just one audit to verify the whole pipe (Claude → GitHub Issue) works
./scripts/run-audits.sh --audit security
```

You should see log lines streaming, then a new GitHub Issue titled "Security audit — YYYY-MM-DD" appears in your Issues tab.

If that works, optionally run the full suite once for a baseline:

```bash
./scripts/run-audits.sh --all
```

This takes 30–60 minutes and creates up to 11 Issues. It also uses a fair chunk of your Max rate-limit window — only do this when you're not also using Claude Code for active coding.

## Step 3 — Install the launchd schedule

```bash
# Copy the plist into the standard launchd location
cp scripts/launchd/com.matt.recipe-rhythm.audits.plist ~/Library/LaunchAgents/

# Load it into launchd
launchctl load ~/Library/LaunchAgents/com.matt.recipe-rhythm.audits.plist

# Verify it's registered
launchctl list | grep recipe-rhythm
```

You should see one line with `com.matt.recipe-rhythm.audits` in it. The script will now fire automatically at 2am local time every day.

## Step 4 — Optional: wake the Mac so 2am jobs actually run

If your laptop's lid is closed overnight, the 2am job doesn't run until the next wake — usually when you open the laptop in the morning, which competes with your active work. To wake the Mac five minutes before the job:

```bash
sudo pmset repeat wakeorpoweron MTWRFSU 01:55:00
```

This is a system-level setting that wakes the Mac every day at 1:55am. After the audit run completes, the Mac goes back to sleep on its normal idle timer. You can undo this any time with `sudo pmset repeat cancel`.

**You only need this if:**
- You usually close the laptop lid overnight, AND
- You want the audits to consistently fire at 2am rather than when you next open the lid

If you leave the laptop open or plugged in at your desk overnight, skip this step.

## Step 5 — Confirm it ran

Each morning, check:

- **Issues tab on GitHub** — any new `audit`-labeled issues should be there
- **`.audit-logs/` in the repo** — `audit-run-YYYY-MM-DD.log` gives the high-level run log; per-audit `*-YYYY-MM-DD.md` files capture the raw Claude output (useful when Issue body looks weird)
- **`~/Library/Logs/recipe-rhythm-audits.log`** — anything the script printed to its parent process (usually empty if all went well)

Add `.audit-logs/` to `.gitignore` (it's runtime output, not source).

## Cadence summary

| Audit | Cadence | When (local time) |
|---|---|---|
| Dependencies | Daily | 2:00am every day |
| Security | Weekly | Mondays 2:00am |
| RLS | Weekly | Mondays 2:00am |
| API drift | Weekly | Mondays 2:00am |
| Test coverage | Weekly | Tuesdays 2:00am |
| AI prompt quality | Weekly | Tuesdays 2:00am |
| Accessibility | Biweekly | Mondays 2:00am (even ISO weeks) |
| UX heuristic + mobile | Biweekly | Mondays 2:00am (odd ISO weeks) |
| Edge cases | Biweekly | Mondays 2:00am (even ISO weeks) |
| Performance | Monthly | 1st of month 2:00am |
| PRD drift | Monthly | 1st of month 2:00am |

The runner fires daily at 2am but the script itself decides which audits to actually run based on the date. So no audit fires more often than its cadence.

**Worst-case day** (Mon + 1st-of-month + even ISO week): 8 audits in one run. Sequential execution takes ~45–90 minutes. Still well within a 5-hour Max rate-limit window.

## Manual triggers (running on-demand)

```bash
# Run today's scheduled audits (same as launchd would)
./scripts/run-audits.sh

# Run a specific audit
./scripts/run-audits.sh --audit security
./scripts/run-audits.sh --audit rls
./scripts/run-audits.sh --audit dependencies
# etc.

# Run all 11
./scripts/run-audits.sh --all

# Help
./scripts/run-audits.sh --help
```

## Updating the schedule

To change the time, edit `scripts/launchd/com.matt.recipe-rhythm.audits.plist` — specifically the `StartCalendarInterval` block — then reload:

```bash
launchctl unload ~/Library/LaunchAgents/com.matt.recipe-rhythm.audits.plist
cp scripts/launchd/com.matt.recipe-rhythm.audits.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.matt.recipe-rhythm.audits.plist
```

To stop auto-running entirely:

```bash
launchctl unload ~/Library/LaunchAgents/com.matt.recipe-rhythm.audits.plist
rm ~/Library/LaunchAgents/com.matt.recipe-rhythm.audits.plist
```

## Decommissioning the legacy GitHub Actions workflows

Once you've confirmed the local setup is working for a few cycles, retire the old workflows:

```bash
git rm .github/workflows/audit-*.yml
git commit -m "chore(audits): remove GitHub Actions workflows in favor of local launchd runner"
git push
```

You can also delete the `GEMINI_API_KEY` and `ANTHROPIC_API_KEY` GitHub secrets if you're not using them elsewhere.

## Known limitations and things to verify

I want to flag a few things I'm not 100% sure about, per project rule #8:

1. **Claude Code CLI flag names.** I'm using `-p` (alias `--print`) and `--permission-mode bypassPermissions`. The CLI is under active development; if either flag is renamed, the runner will fail. The fix is usually a one-word change in `scripts/run-audits.sh`.

2. **Claude Max rate limits.** Specific numerical limits aren't published, but Max's 5-hour windows are generous. The worst-case 8-audit day should fit, but if you see "rate limit exceeded" errors, stagger the cadence (e.g., move api-drift to a different day) by editing `scripts/run-audits.sh`.

3. **launchd quirks.** If a job is scheduled to fire while the Mac is asleep AND `pmset repeat wakeorpoweron` is not set, launchd runs the job on next wake. That's fine for most cases but means a closed-lid Mac will run audits when you open it in the morning instead of overnight.

4. **Issue spam over time.** Each run creates a *new* issue. Over months that adds up. A future enhancement is "find an open issue with this label and add a comment instead" — happy to write that pattern when you're ready.

5. **Working directory state.** The runner assumes the repo is on `main` and reasonably clean. If you've got a stray branch checked out, the audits will reflect whatever code is currently in your working tree — usually fine, but worth knowing.

## When to update this kit

- **A prompt produces noise** → edit the prompt's "Anti-patterns to avoid" section to suppress that class of finding.
- **A new PRD lands** → check `11-prd-drift.md` mentions it.
- **A new endpoint is added** → no change needed; the API-drift and AI-prompt audits will find it automatically.
- **A new file pattern (e.g., a `routes/` directory)** → mention it in the relevant prompt's "Files to read first" section so Claude knows where to look.
- **You want a different schedule** → edit the cadence booleans in `scripts/run-audits.sh` AND/OR edit the launchd plist's `StartCalendarInterval`.

## When NOT to trust these audits

These are AI-generated audits and will sometimes:
- Miss real issues (false negatives)
- Flag non-issues (false positives)
- Cite line numbers that have shifted since the file was last edited

Treat findings as **leads to investigate**, not as gospel. For anything P0, verify manually before opening a PR.

For high-stakes domains — especially security and RLS — these audits **complement** but don't replace:
- An annual professional security audit
- Supabase's own dashboard advisors
- A real human reading the code

---

Built 2026-05-11. Migrated to local execution 2026-05-11. Tweak freely.
