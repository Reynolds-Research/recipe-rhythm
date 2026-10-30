#!/usr/bin/env bash
# Install (or refresh) the audit timer on the Linux PC. Idempotent.
# Never enables the timer — arming is a separate, explicit step:
#   systemctl --user enable --now recipe-rhythm-audits.timer
# Undo: systemctl --user disable --now recipe-rhythm-audits.timer
# Try one audit by hand first: scripts/run-audits.sh --audit prd-drift
set -euo pipefail
die() { echo "install.sh: $*" >&2; exit 1; }
[ "$(uname -s)" = Linux ] || die "Linux only (the Mac uses scripts/launchd/)"
[ -x "$HOME/.local/bin/claude" ] || die "$HOME/.local/bin/claude not found"
command -v gh >/dev/null || die "gh not found"
[ "$(git -C "$HOME/projects/recipe-rhythm" branch --show-current)" = main ] \
  || die "~/projects/recipe-rhythm is not on main; the timer runs whatever is checked out"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dest="$HOME/.config/systemd/user"
mkdir -p "$dest"
install -m 644 "$here/recipe-rhythm-audits.service" "$here/recipe-rhythm-audits.timer" "$dest/"
systemctl --user daemon-reload
systemd-analyze --user verify "$dest/recipe-rhythm-audits.service" "$dest/recipe-rhythm-audits.timer"
echo "Installed. Timer NOT enabled."
