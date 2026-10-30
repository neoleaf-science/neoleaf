#!/usr/bin/env bash
# Runs tests/e2e/specs/forge-real.test.ts against a REAL Forgejo and a REAL Gitea in Docker (pinned images, see dev_forge.sh).
# Slow (it waits for an OAuth token of 90 seconds to expire) and it pulls the images the first time, so it is not part of `mise run test:e2e`.
#   scripts/test_forge_real.sh            both servers
#   scripts/test_forge_real.sh forgejo    only one
set -euo pipefail
cd "$(dirname "$0")/.."
kinds=("$@")
[ "$#" -eq 0 ] && kinds=(forgejo gitea)
status=0
for kind in "${kinds[@]}"; do
  echo "== $kind =="
  trap 'scripts/dev_forge.sh down '"$kind"' >/dev/null 2>&1 || true' EXIT
  FORGE_TOKEN_TTL=90 scripts/dev_forge.sh up "$kind"
  (cd tests/e2e && E2E_FORGE_REAL="$kind" E2E_FORGE_TTL=90 bun test specs/forge-real.test.ts --timeout 500000) || status=1
  scripts/dev_forge.sh down "$kind"
  trap - EXIT
done
exit $status
