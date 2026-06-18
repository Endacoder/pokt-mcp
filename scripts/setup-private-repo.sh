#!/usr/bin/env bash
# Move pokt-mcp MVP to a private GitHub repository.
#
# Prerequisites:
#   - GitHub CLI: https://cli.github.com/
#   - Authenticated as the account/org owner:
#       gh auth login
#
# Usage:
#   ./scripts/setup-private-repo.sh [OWNER] [REPO_NAME]
#
# Example (personal account):
#   ./scripts/setup-private-repo.sh myuser pokt-mcp-private
#
# Example (organization):
#   ./scripts/setup-private-repo.sh Endacoder pokt-mcp-private

set -euo pipefail

OWNER="${1:-}"
REPO_NAME="${2:-pokt-mcp-private}"
SOURCE_BRANCH="${SOURCE_BRANCH:-cursor/mvp-implementation-9ce0}"

if [[ -z "$OWNER" ]]; then
  OWNER="$(gh api user -q .login)"
  echo "Using authenticated user as owner: $OWNER"
fi

PRIVATE_REMOTE="${PRIVATE_REMOTE:-private}"
REPO="$OWNER/$REPO_NAME"

echo "==> Creating private repository: $REPO"
gh repo create "$REPO" --private --description "pokt-mcp MVP (private)" --confirm

echo "==> Preparing merged main with MVP branch"
git fetch origin
git checkout "$SOURCE_BRANCH"
git checkout -B main

echo "==> Adding private remote and pushing"
git remote remove "$PRIVATE_REMOTE" 2>/dev/null || true
git remote add "$PRIVATE_REMOTE" "git@github.com:$REPO.git"
git push -u "$PRIVATE_REMOTE" main
git push "$PRIVATE_REMOTE" "$SOURCE_BRANCH" 2>/dev/null || true

echo ""
echo "Done. Private repo: https://github.com/$REPO"
echo ""
echo "Recommended next steps to protect IP on the public repo:"
echo "  1. Do NOT merge PR #2 on Endacoder/pokt-mcp (keeps MVP off public main)"
echo "  2. Delete public feature branch after verifying private push:"
echo "       git push origin --delete cursor/mvp-implementation-9ce0"
echo "  3. Optionally archive or make Endacoder/pokt-mcp private in GitHub Settings"
echo "  4. Update local origin to the private repo:"
echo "       git remote set-url origin git@github.com:$REPO.git"
