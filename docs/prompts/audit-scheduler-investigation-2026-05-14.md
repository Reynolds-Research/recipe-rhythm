# Claude Code Prompt — Audit scheduler investigation (2026-05-14)

**For:** Claude Code (executor, running locally on Matt's Mac)
**Authored by:** Cowork (planning surface) on 2026-05-14
**Linked context:** [`audits/README.md`](../../audits/README.md) — the recurring audit kit migrated from GitHub Actions to local launchd on 2026-05-11.
**Type:** Investigation + minimal repair. Not a feature PR.

---

## Why this exists

On 2026-05-11 we ported the 11-audit kit off GitHub Actions onto a local **launchd** job (`com.matt.recipe-rhythm.audits`) so Matt's Claude Max subscription covers the compute instead of paying per-token API fees. The runner (`scripts/run-audits.sh`) is meant to fire daily at 2:00 AM local time and decide which audits to run today based on cadence rules in `audits/README.md`.

**The runner has not produced any unattended overnight logs.** As of today (2026-05-14, Thursday), `.audit-logs/` contains exactly one dated file: `audit-run-2026-05-11.log`. Both entries inside it are manual `--audit security` smoke-test runs at **20:28 PT** and **20:38 PT** on install day — not 2 AM launchd fires. Between then and now, at minimum the **Dependencies** audit (daily cadence) should have fired each night and written a heartbeat log line. It hasn't.

Something is wrong with the scheduling layer. We don't know what. This prompt asks you to investigate, identify the root cause, and apply the smallest correct fix — or stop and surface what you find if the fix isn't obvious.

**Branch suggestion:** `chore/audit-scheduler-repair` (only if you end up changing tracked files; if the fix is purely local-machine state like reloading the plist, no branch is needed).

---

## ⚠ Pre-flight: confirm you're in the right place

```bash
EXPECTED="/Users/Matt/Desktop/Current Projects/recipe-rhythm"
ACTUAL="$(git rev-parse --show-toplevel 2>/dev/null)"
echo "expected: $EXPECTED"
echo "actual:   $ACTUAL"
[ "$ACTUAL" = "$EXPECTED" ] || { echo "ABORT: not in the recipe-rhythm repo root"; exit 1; }

PROMPT="docs/prompts/audit-scheduler-investigation-2026-05-14.md"
test -f "$PROMPT" || { echo "ABORT: $PROMPT not found in this working tree"; exit 1; }

git fetch origin
git status   # working tree should be clean
git log --oneline -5

# Confirm the audit kit is present (no point investigating a runner that doesn't exist)
test -f scripts/run-audits.sh                                            || { echo "ABORT: scripts/run-audits.sh missing"; exit 1; }
test -f scripts/launchd/com.matt.recipe-rhythm.audits.plist              || { echo "ABORT: plist source missing"; exit 1; }
test -f audits/README.md                                                  || { echo "ABORT: audits/README.md missing"; exit 1; }
```

If anything aborts, stop and ask the user.

---

## Hard ground rules

1. **This is investigation-first.** Do not "fix" anything until you've identified a specific root cause. Document each check's output before moving on.
2. **No full audit-suite runs.** If you need to test that the runner works end-to-end, use `./scripts/run-audits.sh --audit dependencies` — that's the smallest/fastest audit and a single run won't eat meaningful rate-limit budget. Never run `--all` during diagnosis.
3. **Read-only by default.** `launchctl list`, `cat`, `ls`, `pmset -g sched` are fine without confirmation. `launchctl load`, `launchctl unload`, `launchctl kickstart`, edits to the plist, `sudo pmset repeat ...` — these change machine state. **Ask the user before doing any of them.**
4. **If a check would require `sudo`, surface that to the user up front** — don't try to prompt for a password in a non-interactive context.
5. **If you find evidence the user already partially fixed this** (e.g., they reloaded the plist after the smoke test but the log just hasn't rolled over to a new file yet), say so plainly. Don't pile on changes.

---

## Investigation plan — work through these in order

Each step has: what to run, what you expect to see, and what it tells you. **Capture the actual output of each step in your report** — don't just say "ran it, looks fine."

### Step 1 — Is the launchd agent loaded at all?

```bash
launchctl list | grep recipe-rhythm
```

- **Loaded and healthy:** one line with `com.matt.recipe-rhythm.audits` and a recent PID column showing `-` (not running right now, which is correct between 2 AM fires) and a status column of `0` (last exit code clean).
- **Loaded but failing:** the line shows a non-zero status code (e.g. `78`, `127`). The number is your most useful clue — see Step 5.
- **Empty output:** the agent is **not loaded**. This is the most likely cause. Jump to Step 2.

### Step 2 — Is the plist file in the right place?

```bash
ls -la ~/Library/LaunchAgents/ | grep recipe-rhythm
```

- **Missing entirely:** Step 3 of the README install was never executed. This is consistent with what the audit logs already suggest (only manual smoke tests recorded).
- **Present:** compare its contents to the source-of-truth file in the repo:

  ```bash
  diff -u scripts/launchd/com.matt.recipe-rhythm.audits.plist \
          ~/Library/LaunchAgents/com.matt.recipe-rhythm.audits.plist
  ```

  Any diff is interesting — it means the installed copy is stale relative to the repo (or vice versa).

### Step 3 — Does the plist's script path actually match the repo?

The plist hardcodes the script's absolute path. If the repo has ever moved on disk, this path is wrong and launchd will silently fail to start the job.

```bash
# What the plist thinks the path is
grep -A1 ProgramArguments scripts/launchd/com.matt.recipe-rhythm.audits.plist | grep '<string>'

# Where the script actually lives right now
realpath scripts/run-audits.sh
```

Both should resolve to the same absolute path. If they don't, that's the bug.

### Step 4 — Is the runner script executable?

```bash
ls -la scripts/run-audits.sh
```

The mode column should include an `x` for the owner (`-rwxr--r--` or similar). If it's `-rw-r--r--`, the README's Step 1c (`chmod +x scripts/run-audits.sh`) wasn't applied — launchd will fail to spawn it.

### Step 5 — If launchctl shows a non-zero exit status, what's the diagnostic detail?

```bash
launchctl print "gui/$(id -u)/com.matt.recipe-rhythm.audits" 2>&1 | head -80
```

Look for `last exit code = <N>` and `runs = <N>`. Common cases:
- `last exit code = 127` → command not found. The script's shebang interpreter or a tool the script calls (`claude`, `gh`) isn't on launchd's PATH (which is a small default, not your shell's PATH). This is a frequent gotcha.
- `last exit code = 126` → script not executable (same as Step 4 finding).
- `last exit code = 1` (or another small number) → the script ran but failed inside. Check the script's own stderr destination.
- `runs = 0` after install day → launchd never even tried to fire it.

### Step 6 — Where does the runner's output actually go?

Open the plist and read the `StandardOutPath` / `StandardErrorPath` keys (if any). If they're set, those files are where launchd captures anything the script wrote *outside* of `.audit-logs/`. The README mentions `~/Library/Logs/recipe-rhythm-audits.log` — check it:

```bash
ls -la ~/Library/Logs/ | grep recipe-rhythm
test -f ~/Library/Logs/recipe-rhythm-audits.log && tail -100 ~/Library/Logs/recipe-rhythm-audits.log
```

If the file exists and has content, you may find the real failure message there — especially "command not found" errors from a PATH mismatch.

### Step 7 — Is the Mac actually awake at 2 AM?

```bash
pmset -g sched
```

If you don't see a `wakeorpoweron` line for around 1:55 AM, the README's optional Step 4 (`sudo pmset repeat wakeorpoweron MTWRFSU 01:55:00`) wasn't applied. If Matt closes the lid overnight, launchd defers the 2 AM fire until the next wake. **But** — even a deferred run should still produce a log entry when it eventually fires. So if Steps 1–6 all look healthy and you're still seeing zero logs across 3 days, lid-closed-no-wake is a strong candidate.

### Step 8 — Read the runner script to understand "no audits today" behavior

```bash
sed -n '1,120p' scripts/run-audits.sh
```

Specifically, confirm: when the script runs but the cadence calculator decides "no audits scheduled today," does it still write a heartbeat line into `.audit-logs/audit-run-YYYY-MM-DD.log`? Or does it exit silently?

This matters because **if the script exits silently on a no-audits-today day, the absence of a log file for May 13 and May 14 is consistent with the script firing correctly each night.** That would mean the bug is purely "I'm reading the logs wrong," not "the scheduler is broken."

- May 12 (Tue): Test coverage + AI prompt quality (weekly Tue) + Dependencies (daily) → should fire ≥ 3 audits
- May 13 (Wed): Dependencies (daily) → should fire 1 audit
- May 14 (Thu): Dependencies (daily) → should fire 1 audit (already, at 2 AM)

So even if the script is silent on zero-audit days (it shouldn't have any), May 12, 13, and 14 each should have at least one audit's worth of log content. The complete absence is still a real signal.

### Step 9 — Force a launchd-style run RIGHT NOW (only if Steps 1–8 leave you needing confirmation)

**Ask the user before doing this.** It will burn a small amount of Claude Max rate-limit budget (one `dependencies` audit).

```bash
# Trigger the launchd job as if 2 AM had just hit — runs through launchd, not your shell,
# so PATH and environment match the real overnight conditions.
launchctl kickstart -k "gui/$(id -u)/com.matt.recipe-rhythm.audits"

# Wait ~5–10 minutes, then check:
ls -la .audit-logs/
tail -50 .audit-logs/audit-run-$(date +%Y-%m-%d).log 2>/dev/null
```

This is the highest-signal test you have. If it produces a log line + a GitHub Issue, the runner works fine under launchd and the only mystery is why it hasn't been firing on its own. If it fails, the failure mode (and exit code) tells you exactly what's broken.

---

## Likely root causes, ranked

Based on what I observed from the planning surface:

1. **Plist was never installed** (`cp` to `~/Library/LaunchAgents/` + `launchctl load`). README Step 2 (smoke test) was completed; Step 3 (install) was not. **High prior.**
2. **PATH issue inside launchd's environment** (`claude` / `gh` / `node` not on the default launchd PATH). The plist would need an `EnvironmentVariables` dict adding `/opt/homebrew/bin` (and possibly `/usr/local/bin` and `~/.npm-global/bin` for global npm packages) to `PATH`. **Medium prior** — this is the most common reason a launchd job runs in `launchctl list` but produces nothing useful.
3. **Mac asleep with lid closed, no `pmset` wake rule.** Less likely to produce *zero* logs over 3 days unless the Mac was also closed each morning, but worth ruling out.
4. **Runner script not executable** (`chmod +x` skipped). Rare since the smoke test would have failed too, but cheap to check.
5. **Repo moved on disk → hardcoded path in plist is stale.** Unlikely given Matt's repo location is the long-standing one, but verify in Step 3.

---

## When you find the root cause

**If the fix is "install the plist and load it"** (Cause 1):
- Ask the user to confirm: "I'd like to copy the plist to `~/Library/LaunchAgents/` and run `launchctl load` on it. This is the missing Step 3 from the install guide. OK to proceed?"
- After confirmation, run:
  ```bash
  cp scripts/launchd/com.matt.recipe-rhythm.audits.plist ~/Library/LaunchAgents/
  launchctl load ~/Library/LaunchAgents/com.matt.recipe-rhythm.audits.plist
  launchctl list | grep recipe-rhythm   # confirm
  ```
- Then run the Step 9 kickstart to prove an end-to-end fire works.
- **No tracked file changes.** No branch, no commit, no PR. This is local-machine state.

**If the fix is "add `EnvironmentVariables` to the plist for PATH"** (Cause 2):
- This *is* a tracked file change to `scripts/launchd/com.matt.recipe-rhythm.audits.plist`. Branch + commit.
- Add a `<key>EnvironmentVariables</key>` block before `</dict>`:
  ```xml
  <key>EnvironmentVariables</key>
  <dict>
      <key>PATH</key>
      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  ```
- Resolve the actual paths to `claude` and `gh` on the user's machine first (`which claude && which gh`) and make sure both directories are in the PATH string — don't trust the example above blindly.
- After editing, reload the plist (`unload` + `cp` + `load`).
- Suggested commit: `fix(audits): add PATH to launchd plist so claude/gh resolve under launchd's reduced environment`.

**If the fix is "the repo moved and the plist path is stale"** (Cause 5):
- Update the `<string>` under `ProgramArguments` in the source plist file in the repo.
- Reinstall the plist (`unload` + `cp` + `load`).
- Suggested commit: `fix(audits): update launchd plist script path after repo move`.

**If the fix is something else not on the list above:**
- **Stop and ask the user.** Don't improvise. Write up what you found in the report below and let Matt decide.

---

## Anti-patterns to avoid

- **Don't run `./scripts/run-audits.sh --all` "to make sure everything works."** That's 8–11 audits in one go and eats real rate-limit budget. Use `--audit dependencies` or the launchd kickstart from Step 9 instead.
- **Don't rewrite the plist from scratch.** If the existing one is fine except for a missing `EnvironmentVariables` block or a stale path, edit those specific bits.
- **Don't delete `.github/workflows/audit-*.yml`** as part of this work. That cleanup is the README's planned final step *after* the local runner has proven itself. We're not there yet; this PR's job is to *get* there.
- **Don't add new GitHub Issues** while debugging. If your kickstart fires successfully and produces a real issue, that's fine — but don't manually `gh issue create` test issues that you'll then need to close.
- **Don't fix unrelated lint / test failures.** Note them as follow-ups; don't expand scope.

---

## What to report back

Write up your findings in this shape (paste into the chat or, if you opened a branch, into the PR description):

1. **Each investigation step's actual output.** Steps 1 through 8 minimum. Step 9 only if you ran the kickstart.
2. **Identified root cause** — which of the 5 ranked causes (or something else) matched.
3. **Fix applied** — exact commands run, files changed, plist reloaded yes/no.
4. **Verification** — output of `launchctl list | grep recipe-rhythm` after the fix, plus the result of a kickstart run if you performed one.
5. **Remaining concerns** — anything you noticed that wasn't broken but felt fragile (e.g., "the runner has no retry logic if `claude` rate-limits mid-run").
6. **Recommendation on the GitHub Actions cleanup** — only "yes, safe to delete the legacy workflows now" if you saw at least one successful end-to-end launchd-driven run. Otherwise "wait until the next unattended overnight cycle produces a clean log."

---

## Known gotchas

1. **`launchctl list` shows the job even when it's broken.** A line in the list output only means "loaded into launchd's registry," not "ran successfully last time." Always read the status column (rightmost number) — that's the last exit code.
2. **launchd uses local time, not UTC.** The plist's `Hour: 2` means 2 AM Pacific (Matt's timezone). Don't second-guess this unless you find evidence to the contrary.
3. **The smoke-test runs in the existing log file use `mode: specific` and timestamps around 20:28–20:41 PT.** Those are evening, manual, single-audit runs. Don't mistake them for evidence the scheduler works.
4. **`launchctl kickstart` runs the job synchronously-ish under launchd's environment.** That's the closest you can get to "what would happen at 2 AM" without waiting until 2 AM. It's the right verification tool.
5. **macOS Sequoia and newer require Full Disk Access for some launchd jobs that touch user files.** Unlikely to affect this one (the script only writes inside the repo), but if Step 9 fails with a permission error and Steps 1–7 all looked healthy, ask the user to check System Settings → Privacy & Security → Full Disk Access and grant it to `/bin/bash` or `/bin/zsh` (whichever the shebang in `run-audits.sh` uses).

---

## When done

Report back with the 6-item structure above. If your investigation ends with **"plist is installed, loaded, kicked-started successfully, and produced a log entry + a GitHub Issue"** — that's the green light Matt needs. The next step (out of scope here) is waiting for one unattended overnight cycle (the 2:00 AM fire on 2026-05-15) to produce its own log, after which the legacy `.github/workflows/audit-*.yml` files can be deleted in a separate small PR.

If your investigation ends anywhere short of that, leave the legacy workflows in place and explain what's still missing.
