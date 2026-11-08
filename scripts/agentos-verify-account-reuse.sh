#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$repo_root/../.toolchain/node_modules/.bin:$PATH"
test_home="$(mktemp -d /private/tmp/agentos-account-test-home.XXXXXXXX)"
report="$(mktemp /private/tmp/agentos-account-reuse-database.XXXXXXXX)"
trap 'rm -rf -- "$test_home"' EXIT
export PAPERCLIP_HOME="$test_home"
export PAPERCLIP_INSTANCE_ID="account-reuse-verification"
unset DATABASE_URL
cd "$repo_root"

printf '%s\n' 'Checking account reuse, credential recovery and access in disposable test databases.'
printf '%s\n' 'This does not sign in to a provider, change the running AgentOS instance, or migrate Supabase.'
if node node_modules/vitest/vitest.mjs run --maxWorkers=1 \
  server/src/__tests__/ai-workspace-accounts.test.ts \
  server/src/services/ai-execution-capacity.test.ts \
  server/src/__tests__/ai-connections.test.ts \
  server/src/__tests__/subscriptions.test.ts \
  server/src/__tests__/access-service.test.ts \
  server/src/__tests__/openapi-routes.test.ts > "$report" 2>&1; then
  printf '%s\n' 'Database checks passed.'
else
  result=$?
  printf '%s\n' "Database checks failed (exit $result). The full failure log is saved for Codex."
  printf 'Saved result: %s\n' "$report"
  exit "$result"
fi
printf 'Saved result: %s\n' "$report"
