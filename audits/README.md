# Recipe-Rhythm — Recurring Audit Kit

This bundle gives you 11 recurring audits, each driven by **Claude Code CLI** running on a **GitHub Actions cron schedule**, with findings opened as **labeled GitHub Issues** in your code repo.

> **History note.** This kit was originally built on the Gemini CLI to keep audits cheap. We swapped to Claude Code on 2026-05-11 because the Gemini API free tier (20 requests/day) couldn't support 11 weekly audits, and the user already had an Anthropic API key wired up for the app. The prompts and workflows are otherwise unchanged.

## Mental model

Think of this kit as a panel of specialist consultants on retainer. Each consultant (an audit prompt) knows their lane — security, accessibility, UX, etc. — and reports in on a predictable schedule. GitHub Actions is the calendar booking system. Claude is the consultant who actually does the inspection. The GitHub Issue is the report on your desk Monday morning.

## What's in this bundle

```
audits/
├── README.md                            ← you are here
├── prompts/
│   ├── 01-security.md                   weekly
│   ├── 02-rls.md                        weekly
│   ├── 03-dependencies.md               daily
│   ├── 04-accessibility.md              biweekly (even weeks)
│   ├── 05-heuristic-mobile.md           biweekly (odd weeks)
│   ├── 06-edge-case.md                  biweekly
│   ├── 07-test-coverage.md              weekly
│   ├── 08-api-drift.md                  weekly
│   ├── 09-performance.md                monthly
│   ├── 10-ai-prompt-quality.md          weekly
│   └── 11-prd-drift.md                  monthly
└── workflows/
    └── (one .yml per prompt, same numbering)
```

## Step 1 — Where each file goes in your code repo

Copy this whole `audits/` folder to the root of your **code repo** (not this docs project), and then **move the workflow files** to `.github/workflows/`:

```
your-code-repo/
├── audits/
│   ├── README.md
│   └── prompts/
│       ├── 01-security.md
│       └── …
└── .github/
    └── workflows/
        ├── audit-security.yml
        ├── audit-rls.yml
        └── …
```

GitHub Actions only sees workflow YAML files when they live in `.github/workflows/`. The prompts can live anywhere — `audits/prompts/` is just the convention this bundle uses.

If you want to keep the prompts in this Claude Projects folder for future iteration (so you can edit them here, then sync to the code repo), that's fine — just remember the version in the code repo is what actually runs.

## Step 2 — Required GitHub secrets

In your code repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Required for | How to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | All 11 audits | Generated at [console.anthropic.com](https://console.anthropic.com/) → API Keys. Same key the app's `api-server.mjs` already uses — you can reuse it. Make sure the key has a paid billing source attached (the free trial credits will run out fast across 11 audits). |
| `GITHUB_TOKEN` | All 11 audits (for opening issues) | **No action needed** — GitHub provides this automatically to every Action run. |

**Cost estimate.** Claude Code uses Sonnet 4.6 by default for these audits. Each run is roughly 30K–150K input tokens depending on how many files the prompt asks Claude to read. Total monthly spend for the full kit running on schedule should sit in the $2–8 range. If that grows surprising, check the [Anthropic Console usage dashboard](https://console.anthropic.com/settings/usage).

## Step 2.5 — Create the GitHub Issue labels

The `gh issue create --label` command **fails if the label doesn't exist**. Before the first run, create these labels in your repo (Issues tab → Labels → New label, or run the gh CLI snippet below):

```bash
# Run once from your code repo root after authenticating gh CLI:
gh label create audit              --color "0E8A16" --description "Auto-generated audit finding"
gh label create audit:security     --color "B60205" --description "Security audit"
gh label create audit:rls          --color "B60205" --description "Supabase RLS audit"
gh label create audit:dependencies --color "FBCA04" --description "Dependency / supply chain"
gh label create audit:a11y         --color "1D76DB" --description "Accessibility audit"
gh label create audit:ux           --color "5319E7" --description "UX heuristic + mobile"
gh label create audit:edge-case    --color "D93F0B" --description "Edge case audit"
gh label create audit:tests        --color "0E8A16" --description "Test coverage"
gh label create audit:api-drift    --color "FBCA04" --description "api-server.mjs ↔ api/ drift"
gh label create audit:performance  --color "C5DEF5" --description "Performance audit"
gh label create audit:ai-prompts   --color "5319E7" --description "AI prompt quality"
gh label create audit:prd-drift    --color "BFD4F2" --description "PRD ↔ implementation drift"
```

If you skip this step, the first scheduled run of each audit will fail at the "Open GitHub Issue" step with a clear error message — easy to fix retroactively, but easier to just run the snippet now.

## Step 3 — Cadence summary

| Audit | Cadence | Day / time (UTC) | Why this cadence |
|---|---|---|---|
| Dependencies | Daily | 13:00 every day | New CVEs drop daily; cheap to run |
| Security | Weekly | Mon 14:00 | Highest-risk slow-moving check |
| RLS | Weekly | Mon 14:15 | Same as security; data-safety critical |
| API drift | Weekly | Mon 14:30 | api-server.mjs ↔ api/ desync is high-frequency |
| Test coverage | Weekly | Tue 14:00 | Catches "shipped without tests" patterns weekly |
| AI prompt quality | Weekly | Tue 14:30 | Active PRD-004/006 prompt work |
| Accessibility | Biweekly | Mon 15:00 (even ISO weeks) | Slower-moving; pairs with UX |
| UX heuristic + mobile | Biweekly | Mon 15:00 (odd ISO weeks) | Alternates with a11y |
| Edge cases | Biweekly | Mon 15:30 (even ISO weeks) | Pairs with a11y on the heavy week |
| Performance | Monthly | 1st of month 16:00 | Code-level; complement to occasional Lighthouse |
| PRD drift | Monthly | 1st of month 17:00 | Docs move slowly |

Times are UTC. 14:00 UTC = 7am PT / 10am ET / 3pm CET. Adjust the `cron:` lines in each workflow to suit your timezone.

## Step 4 — Manual trigger (your "test drive")

Every workflow has `workflow_dispatch:` enabled, which adds a **"Run workflow"** button to its page in the GitHub Actions tab. Use this to run any audit on demand:

1. Push the kit to your code repo (`main` branch).
2. Go to **Actions** tab.
3. Pick an audit from the left sidebar.
4. Click **Run workflow → Run workflow** (top right).
5. A few minutes later, a new GitHub Issue appears with the findings.

This is how you'll prove the kit works without waiting a week.

## Step 5 — How findings flow

```
GitHub Action runs on schedule
    ↓
Installs @anthropic-ai/claude-code
    ↓
Pipes audits/prompts/NN-*.md into `claude -p --permission-mode bypassPermissions`
    ↓
Claude reads your repo, writes findings to audit-output.md
    ↓
gh CLI opens a GitHub Issue with that content as the body
    ↓
Issue is labeled `audit` + audit-specific label (e.g., `audit:security`)
    ↓
You triage on your normal Issue review cadence
    ↓
For non-trivial fixes, paste relevant lines into a Claude Code prompt
```

The Issue body is intentionally in the same P0/P1/P2/P3 + E/M/H format as your existing `RECIPE_TODOS.md` — you can copy findings directly into your TODOs file when triaging.

## Local testing (without GitHub Actions)

To test a prompt locally before pushing:

```bash
# In your code repo root
npm install -g @anthropic-ai/claude-code
export ANTHROPIC_API_KEY="your-key-here"
claude -p --permission-mode bypassPermissions < audits/prompts/01-security.md > test-output.md
open test-output.md  # or `cat`
```

The `--permission-mode bypassPermissions` flag auto-approves Claude's filesystem/shell tool calls — required for CI, fine for local testing on your own repo. (Equivalent to Gemini's old `--yolo` flag.)

## Known limitations and things to verify

I want to flag a few things I'm not 100% sure about, per project rule #8:

1. **Claude Code CLI flag names.** I'm using `-p` (alias `--print`) and `--permission-mode bypassPermissions` based on the Anthropic docs as of 2026-05-11. The CLI is under active development; if either flag is renamed, the workflows will fail. The fix is usually a one-word change in each workflow file. Run any audit manually first to catch this.

2. **`@anthropic-ai/claude-code` package name.** Correct as of 2026-05-11. If it's been republished under a different scope, swap the `npm install -g` line.

3. **Issue spam over time.** Each audit run currently creates a *new* issue. Over months that adds up. A future enhancement is "find an open issue with this label and add a comment instead of creating a new one" — happy to write that pattern when you're ready.

4. **Claude context window for large repos.** Each audit prompt asks Claude to read substantial portions of the codebase. Sonnet 4.6 has a 200K-token context window, which is comfortable for Recipe-Rhythm today. Watch for context-limit errors if the codebase grows significantly.

5. **Biweekly cadence via ISO week parity.** GitHub Actions doesn't support biweekly cron natively. I'm using `date +%V` (ISO week number) and checking even/odd. This is correct but a bit hacky — if a finding shows up in an unexpected week, that's why.

6. **Cost monitoring.** Claude API spend varies with prompt complexity. If you run a lot of `workflow_dispatch` manual triggers during testing, watch the [usage dashboard](https://console.anthropic.com/settings/usage). Each audit is roughly 30K–150K input tokens at Sonnet 4.6 pricing.

## When to update this kit

- **A prompt produces noise** → edit the prompt's "Anti-patterns to avoid" section to suppress that class of finding.
- **A new PRD lands** → check `11-prd-drift.md` mentions it.
- **A new endpoint is added** → no change needed; the API-drift and AI-prompt audits will find it automatically.
- **A new file pattern (e.g., a `routes/` directory)** → mention it in the relevant prompt's "Files to read first" section so Claude knows where to look.

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

Built 2026-05-11. Tweak freely.
