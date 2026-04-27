#!/bin/sh
# Installs the project's git hooks into .git/hooks/.
# Run once from the repo root: bash scripts/install-git-hooks.sh
#
# Re-run anytime to refresh hooks (e.g., after pulling updates to scripts/git-hooks/).

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="$REPO_ROOT/scripts/git-hooks"
TARGET_DIR="$REPO_ROOT/.git/hooks"

if [ ! -d "$REPO_ROOT/.git" ]; then
  echo "ERROR: $REPO_ROOT is not a git repository."
  exit 1
fi

if [ ! -d "$SOURCE_DIR" ]; then
  echo "ERROR: $SOURCE_DIR does not exist."
  exit 1
fi

echo "Installing git hooks from scripts/git-hooks/ to .git/hooks/..."

for hook in "$SOURCE_DIR"/*; do
  hook_name=$(basename "$hook")
  cp "$hook" "$TARGET_DIR/$hook_name"
  chmod +x "$TARGET_DIR/$hook_name"
  echo "  installed: $hook_name"
done

echo ""
echo "Done."
echo ""
echo "If you don't yet have gitleaks installed, run:"
echo "  brew install gitleaks"
echo ""
echo "After that, every 'git commit' will scan staged changes for secrets."
echo "If a commit is blocked, the output will tell you which file and rule matched."
