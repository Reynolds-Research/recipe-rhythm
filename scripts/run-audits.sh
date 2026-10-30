#!/usr/bin/env bash
# =====================================================================
# Recipe-Rhythm — Local Audit Runner
#
# Runs scheduled audits via the local `claude` CLI (uses your Max
# subscription, not the API) and saves each report LOCALLY on the PC.
# Nothing is posted to GitHub: the repo is public and the security / RLS
# audits describe weaknesses (decided 2026-10-30).
#
# WHEN THIS RUNS:
#   - Automatically: the systemd timer on the Linux PC fires this script
#     daily at 02:10 (scripts/systemd/). The old Mac launchd plist is in
#     scripts/launchd/ for reference only.
#   - Manually:
#       ./scripts/run-audits.sh             # run today's scheduled audits
#       ./scripts/run-audits.sh --all       # run all 11 right now (testing)
#       ./scripts/run-audits.sh --audit security   # run one specific audit
#
# OUTPUTS:
#   - One report per audit run: $REPO_ROOT/.audit-logs/<audit>-<date>.md
#   - $REPO_ROOT/.audit-logs/INDEX.md — every report, newest on top
#   - Run log: $REPO_ROOT/.audit-logs/audit-run-<date>.log
#   (.audit-logs/ is gitignored, so none of this is ever committed.)
# =====================================================================

# Stop on undefined vars; pipeline failures count as failures.
# We DON'T use `set -e` here because we want to keep running through
# individual audit failures (one broken audit shouldn't tank the rest).
set -uo pipefail

# ---------------------------------------------------------------------
# Discover repo root from this script's location.
# Lets the script move with the repo without breaking.
# ---------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# launchd starts with a minimal PATH. Make sure Homebrew binaries
# (where `claude` and `gh` live on Apple Silicon and Intel Macs) are found.
# On the Linux PC (systemd, scripts/systemd/) `claude` lives in ~/.local/bin.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

# Claude Code needs HOME set to find its OAuth credentials at ~/.claude/
export HOME="${HOME:-/Users/Matt}"

cd "$REPO_ROOT" || { echo "ERROR: cannot cd into $REPO_ROOT"; exit 1; }

# ---------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------
LOG_DIR="$REPO_ROOT/.audit-logs"
mkdir -p "$LOG_DIR"
DATE="$(date +%Y-%m-%d)"
RUN_LOG="$LOG_DIR/audit-run-$DATE.log"

log() {
  echo "[$(date +'%Y-%m-%d %T %z')] $*" | tee -a "$RUN_LOG"
}

# ---------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------
MODE="cadence"          # default: run only what's scheduled for today
SPECIFIC_AUDIT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      MODE="all"
      shift
      ;;
    --audit)
      MODE="specific"
      SPECIFIC_AUDIT="${2:-}"
      if [ -z "$SPECIFIC_AUDIT" ]; then
        echo "ERROR: --audit requires a name (e.g., --audit security)"
        exit 1
      fi
      shift 2
      ;;
    -h|--help)
      cat <<EOF
Recipe-Rhythm audit runner.

Usage:
  $0                      Run audits scheduled for today
  $0 --all                Run all 11 audits (for testing)
  $0 --audit <name>       Run one specific audit
                          Names: security rls dependencies accessibility
                                 heuristic-mobile edge-case test-coverage
                                 api-drift performance ai-prompts prd-drift
EOF
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1"
      exit 1
      ;;
  esac
done

log "=== Audit run starting (mode: $MODE) ==="
log "REPO_ROOT=$REPO_ROOT"

# ---------------------------------------------------------------------
# Cadence calculation
# ---------------------------------------------------------------------
DOW="$(date +%u)"                # 1=Monday, 7=Sunday
DOM="$(date +%-d)"               # 1-31 (no leading zero)
WEEK="$(date +%V)"               # ISO week number (01-53)
WEEK_PARITY="$((10#$WEEK % 2))"  # 0=even, 1=odd

log "Today: DOW=$DOW DOM=$DOM ISO_WEEK=$WEEK PARITY=$WEEK_PARITY"

# Booleans for "should this cadence fire today?"
IS_MON="$([ "$DOW" -eq 1 ] && echo true || echo false)"
IS_TUE="$([ "$DOW" -eq 2 ] && echo true || echo false)"
IS_FIRST_OF_MONTH="$([ "$DOM" -eq 1 ] && echo true || echo false)"
IS_EVEN_WEEK="$([ "$WEEK_PARITY" -eq 0 ] && echo true || echo false)"
IS_ODD_WEEK="$([ "$WEEK_PARITY" -eq 1 ] && echo true || echo false)"

# ---------------------------------------------------------------------
# Audit runner
# ---------------------------------------------------------------------
# Each call: run_audit <slug> <prompt-relative-path> <gh-label> <issue-title-prefix>
run_audit() {
  local slug="$1"
  local prompt_file="$2"
  local label="$3"
  local title_prefix="$4"

  log "→ Starting audit: $slug"

  local out_file="$LOG_DIR/$slug-$DATE.md"
  local err_file="$LOG_DIR/$slug-$DATE.err"

  if [ ! -f "$prompt_file" ]; then
    log "✗ $slug: prompt file not found at $prompt_file"
    return 1
  fi

  # Run Claude. stdout (the audit findings) → $out_file. stderr → $err_file.
  if claude -p --permission-mode bypassPermissions < "$prompt_file" \
       > "$out_file" 2> "$err_file"; then
    log "✓ $slug: Claude run succeeded (output: $out_file)"
  else
    log "✗ $slug: Claude run failed; first 20 lines of $err_file:"
    head -n 20 "$err_file" | tee -a "$RUN_LOG"
    return 1
  fi

  # Defensive post-processing: strip outer markdown code fence if Claude
  # wrapped the entire response in one (it sometimes does, mimicking the
  # ```markdown ... ``` example block shown in the prompt template).
  # Without this strip, the report renders as a single code
  # block with no formatting — readable but ugly.
  if head -n 1 "$out_file" | grep -qE '^```' && \
     tail -n 1 "$out_file" | grep -qE '^```$'; then
    log "  · stripping outer markdown code fence from $slug output"
    # Portable in-place edit: BSD sed (macOS) needs `-i ''`, GNU sed (Linux)
    # rejects it; a backup suffix works on both.
    sed -i.bak '1d;$d' "$out_file" && rm -f "$out_file.bak"
  fi

  # Reports stay LOCAL (decided 2026-10-30): this repo is public, and the
  # security / RLS audits describe weaknesses, so nothing is posted as a
  # GitHub issue any more. The report is $out_file (in the gitignored
  # .audit-logs/), and .audit-logs/INDEX.md lists every run, newest on top.
  # `$label` is kept in the index so reports stay easy to filter.
  local index="$LOG_DIR/INDEX.md"
  [ -f "$index" ] || printf '# Audit reports (local only)\n\nNewest on top. Each line: date · audit · report file.\n\n' > "$index"
  local entry="- $DATE · $title_prefix (\`$label\`) · [$slug-$DATE.md]($slug-$DATE.md)"
  # Insert below the 4-line header so the newest run is on top.
  { head -n 4 "$index"; echo "$entry"; tail -n +5 "$index"; } > "$index.tmp" && mv "$index.tmp" "$index"
  log "✓ $slug: report saved locally ($out_file); listed in $index"
}

# ---------------------------------------------------------------------
# Dispatch: decide which audits to run based on MODE + cadence
# ---------------------------------------------------------------------
# `maybe_run` only runs the audit if the cadence flag is "true" OR the
# user passed --all OR they targeted this specific audit with --audit.
maybe_run() {
  local slug="$1"
  local cadence="$2"  # 'true' or 'false'
  local prompt_file="$3"
  local label="$4"
  local title_prefix="$5"

  case "$MODE" in
    all)
      run_audit "$slug" "$prompt_file" "$label" "$title_prefix" || true
      ;;
    specific)
      if [ "$SPECIFIC_AUDIT" = "$slug" ]; then
        run_audit "$slug" "$prompt_file" "$label" "$title_prefix" || true
      fi
      ;;
    cadence)
      if [ "$cadence" = "true" ]; then
        run_audit "$slug" "$prompt_file" "$label" "$title_prefix" || true
      else
        log "Skipping $slug (not scheduled today)"
      fi
      ;;
  esac
}

# Daily
maybe_run "dependencies"     "true"              "audits/prompts/03-dependencies.md"      "audit:dependencies" "Dependency audit"

# Weekly Mondays
maybe_run "security"         "$IS_MON"           "audits/prompts/01-security.md"          "audit:security"     "Security audit"
maybe_run "rls"              "$IS_MON"           "audits/prompts/02-rls.md"               "audit:rls"          "RLS audit"
maybe_run "api-drift"        "$IS_MON"           "audits/prompts/08-api-drift.md"         "audit:api-drift"    "API drift audit"

# Weekly Tuesdays
maybe_run "test-coverage"    "$IS_TUE"           "audits/prompts/07-test-coverage.md"     "audit:tests"        "Test coverage audit"
maybe_run "ai-prompts"       "$IS_TUE"           "audits/prompts/10-ai-prompt-quality.md" "audit:ai-prompts"   "AI prompt quality audit"

# Biweekly — even ISO weeks on Mondays
BIWEEKLY_EVEN="$([ "$IS_MON" = "true" ] && [ "$IS_EVEN_WEEK" = "true" ] && echo true || echo false)"
maybe_run "accessibility"    "$BIWEEKLY_EVEN"    "audits/prompts/04-accessibility.md"     "audit:a11y"         "Accessibility audit"
maybe_run "edge-case"        "$BIWEEKLY_EVEN"    "audits/prompts/06-edge-case.md"         "audit:edge-case"    "Edge case audit"

# Biweekly — odd ISO weeks on Mondays
BIWEEKLY_ODD="$([ "$IS_MON" = "true" ] && [ "$IS_ODD_WEEK" = "true" ] && echo true || echo false)"
maybe_run "heuristic-mobile" "$BIWEEKLY_ODD"     "audits/prompts/05-heuristic-mobile.md"  "audit:ux"           "UX + mobile audit"

# Monthly — 1st of each month
maybe_run "performance"      "$IS_FIRST_OF_MONTH" "audits/prompts/09-performance.md"      "audit:performance"  "Performance audit"
maybe_run "prd-drift"        "$IS_FIRST_OF_MONTH" "audits/prompts/11-prd-drift.md"        "audit:prd-drift"    "PRD drift audit"

log "=== Audit run complete ==="
