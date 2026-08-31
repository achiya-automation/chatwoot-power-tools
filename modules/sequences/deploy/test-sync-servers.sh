#!/usr/bin/env bash
#
# test-sync-servers.sh — proves the one claim the header makes: what gets deployed is what
# is COMMITTED. Builds a scratch repo, dirties it, and checks that nothing uncommitted and
# nothing .gitignored can reach the wire. No ssh, no servers, no network.
#
#   ./test-sync-servers.sh
#
# Everything above the "── run ──" marker in sync-servers.sh is function definitions, so it
# can be sourced without triggering a deploy. REPO_ROOT is overridden afterwards to point
# at the scratch repo.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/sync-servers.sh"
TMP="$(mktemp -d -t cwpt-test)"
trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
check() { # check <description> <expected> <actual>
  if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"
  else FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s\n      expected: %s\n      actual:   %s\n' "$1" "$2" "$3"; fi
}

# ── scratch repo, same layout the script expects ─────────────────────────────
REPO="$TMP/repo"
mkdir -p "$REPO/modules/sequences/engine/src" \
         "$REPO/modules/sequences/engine/migrations" \
         "$REPO/modules/sequences/webapp/dist" \
         "$REPO/modules/sequences/deploy/chatwoot-initializers" \
         "$REPO/modules/sequences/deploy/chatwoot-initializers/test" \
         "$REPO/modules/smart-import/dist"
cd "$REPO"
git init -q . && git config user.email t@t && git config user.name t

echo 'COMMITTED' > modules/sequences/engine/src/campaigns.js
echo 'COMMITTED' > modules/sequences/engine/src/campaignCsv.js
echo 'SELECT 1;' > modules/sequences/engine/migrations/001_init.sql
echo 'COMMITTED' > modules/sequences/webapp/dist/index.html
echo '# committed initializer' > modules/sequences/deploy/chatwoot-initializers/patch_a.rb
echo '# committed test, never an initializer' > modules/sequences/deploy/chatwoot-initializers/test/patch_a_test.rb
echo 'modules/smart-import/dist/' > .gitignore
echo 'addons' > docker-compose.addons.yml
git add -A && git commit -qm init

# The three things a working-tree deploy would have shipped, and must not:
echo 'DIRTY'                  > modules/sequences/engine/src/campaigns.js   # uncommitted edit
echo 'BUILD ARTIFACT'         > modules/smart-import/dist/import-tool.js    # .gitignored
echo '# uncommitted patch'    > modules/sequences/deploy/chatwoot-initializers/patch_b.rb

# ── load the real functions ──────────────────────────────────────────────────
sed '/^# ── run ─/,$d' "$SCRIPT" > "$TMP/lib.sh"
# shellcheck disable=SC1090
source "$TMP/lib.sh"
# The library sets -e for its own run; a test needs commands to be allowed to fail.
set +e
REPO_ROOT="$REPO"
DEPLOY_COMMIT="$(git -C "$REPO" rev-parse HEAD)"
DEPLOY_ID="${DEPLOY_COMMIT:0:12}-20260831000000-$$"

md5_of_string() { printf '%s\n' "$1" | md5_stdin; }

echo "head_md5 reads HEAD, not the disk"
check "dirty file compares as its COMMITTED version" \
  "$(md5_of_string COMMITTED)" "$(head_md5 modules/sequences/engine/src/campaigns.js)"
check "and not as the working-tree version" \
  "no-match" "$([[ "$(head_md5 modules/sequences/engine/src/campaigns.js)" == "$(md5_of_string DIRTY)" ]] && echo MATCHED || echo no-match)"

# die inside a command substitution exits that subshell, so the caller sees non-zero.
( head_md5 modules/sequences/engine/src/nope.js >/dev/null 2>&1 )
check "missing-in-HEAD path is fatal, not silently empty" "fatal" \
  "$([[ $? -ne 0 ]] && echo fatal || echo silent)"

echo
echo "build_deploy_archive ships the pinned commit"
build_deploy_archive flat "$TMP/captured.tgz"
check "flat: carries committed bytes, not the dirty working tree" "COMMITTED" \
  "$(tar -xzOf "$TMP/captured.tgz" engine/src/campaigns.js | tr -d '\n')"
check "flat: member paths unchanged (engine/src/...)" "present" \
  "$(tar -tzf "$TMP/captured.tgz" | grep -q '^engine/src/campaigns.js$' && echo present || echo missing)"
check "flat: migrations still included" "present" \
  "$(tar -tzf "$TMP/captured.tgz" | grep -q '^engine/migrations/' && echo present || echo missing)"

build_deploy_archive modular "$TMP/captured.tgz"
check "modular: carries committed bytes" "COMMITTED" \
  "$(tar -xzOf "$TMP/captured.tgz" modules/sequences/engine/src/campaigns.js | tr -d '\n')"
check "modular: docker-compose.addons.yml still included" "present" \
  "$(tar -tzf "$TMP/captured.tgz" | grep -q '^docker-compose.addons.yml$' && echo present || echo missing)"
check "modular: .gitignored build output never reaches the wire" "absent" \
  "$(tar -tzf "$TMP/captured.tgz" | grep -q 'smart-import/dist' && echo LEAKED || echo absent)"

echo
echo "initializers are enumerated from HEAD"
listed="$(head_initializer_paths | xargs -n1 basename | sort | tr '\n' ' ')"
check "only committed root-level initializers are deploy candidates" "patch_a.rb " "$listed"

echo
echo "clean-tree guard covers the whole deploy scope"
# Second repo, otherwise the first one's dirty modules/ would mask a yml-only miss.
REPO2="$TMP/repo2"
mkdir -p "$REPO2/modules/sequences" && cd "$REPO2"
git init -q . && git config user.email t@t && git config user.name t
echo 'x' > modules/sequences/keep.js && echo 'addons' > docker-compose.addons.yml
git add -A && git commit -qm init
echo 'edited-but-not-committed' > docker-compose.addons.yml   # only the yml is dirty

REPO_ROOT="$REPO2"; FORCE=0
DEPLOY_COMMIT="$(git -C "$REPO2" rev-parse HEAD)"
( require_clean_tree >/dev/null 2>&1 )
check "a dirty docker-compose.addons.yml alone still stops the deploy" "stopped" \
  "$([[ $? -ne 0 ]] && echo stopped || echo "slipped through")"
REPO_ROOT="$REPO"
DEPLOY_COMMIT="$(git -C "$REPO" rev-parse HEAD)"

echo
if [[ $FAIL -eq 0 ]]; then printf '\033[32m%d passed\033[0m\n' "$PASS"; exit 0
else printf '\033[31m%d passed, %d failed\033[0m\n' "$PASS" "$FAIL"; exit 1; fi
