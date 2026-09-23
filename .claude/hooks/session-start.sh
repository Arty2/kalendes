#!/bin/bash
# Gets a fresh Claude Code on the web container ready to run `npm run quick`
# before the session's first command, rather than spending the first turn on
# an install.
set -euo pipefail

# Local checkouts manage their own node_modules; this is only for the remote
# container, which starts from a bare clone every time.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# `ci`, not `install`: it never rewrites package-lock.json, so the session
# doesn't start with a dirty tree. --prefer-offline reuses the npm cache when
# the container image already has it.
npm ci --no-audit --no-fund --prefer-offline
