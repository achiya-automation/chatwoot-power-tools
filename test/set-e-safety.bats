#!/usr/bin/env bats
# Regression suite for a real bug class found while writing install.sh: every lib/*.sh
# file is designed to be sourced by install.sh, which (correctly, for a public installer)
# runs under `set -euo pipefail`. Several internal pipelines (grep/head with no match,
# awk, psql) are MEANT to fail as part of normal graceful-fallback control flow — but an
# unguarded pipeline failure under `set -e -o pipefail` aborts the ENTIRE script
# immediately, at the failing statement, before the function's own fallback logic or
# error message is ever reached.
#
# Important nuance verified empirically while writing these tests: if the *outermost*
# call to a function is itself wrapped in a guard (`if ! f; then`, `x=$(f) || ...`), bash
# exempts f's ENTIRE execution from set -e for that one statement — including pipelines
# deep inside it — so a disciplined call site alone would already "hide" this bug class.
# install.sh IS written to guard every call site, but these tests deliberately call the
# functions BARE (unguarded — the failure mode a future caller might introduce by
# accident, or a quick one-off debug invocation) to prove the fix holds regardless of
# caller discipline. Each test is designed so the function's OVERALL result is 0 (success,
# via a fallback) despite an internal hiccup, specifically so a bare call can still reach
# a trailing sentinel line — a function that's SUPPOSED to return 1 aborts a bare caller
# either way (that part is set -e doing its job correctly, not a bug).

setup() {
  REPO="$(cd "$(dirname "$BATS_TEST_DIRNAME")" && pwd)"
  MOCKS="$BATS_TEST_DIRNAME/mocks"
}

@test "detect_service_container's fallback survives set -e when the primary lookup pipeline itself exits non-zero" {
  # Primary strategy (compose ps -q) genuinely FAILS (not just empty) here; the secondary
  # strategy (docker ps name-grep) then genuinely SUCCEEDS — so a bare call still reaches
  # SENTINEL only if the internal `cid=... || true` guard let execution continue past the
  # first failure into the fallback.
  run bash -c "
    set -euo pipefail
    export PATH='${MOCKS}:/usr/bin:/bin'
    export MOCK_COMPOSE_PS_EXIT=1
    export MOCK_DOCKER_PS_NAMES='chatwoot-rails-1'
    source '${REPO}/lib/detect.sh'
    detect_service_container /opt/chatwoot rails
    echo 'SENTINEL_REACHED'
  " </dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"chatwoot-rails-1"* ]]
  [[ "$output" == *"SENTINEL_REACHED"* ]]
}

@test "detect_reverse_proxy survives set -e (bare call) when docker ps itself exits non-zero" {
  run bash -c "
    set -euo pipefail
    export PATH='${MOCKS}:/usr/bin:/bin'
    export MOCK_DOCKER_PS_IMAGE_EXIT=1
    source '${REPO}/lib/detect.sh'
    detect_reverse_proxy
    echo 'SENTINEL_REACHED'
  " </dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"none"* ]]
  [[ "$output" == *"SENTINEL_REACHED"* ]]
}

@test "provision_db (bare call) survives set -e when the pg_roles existence query itself exits non-zero" {
  COMPOSE_DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$COMPOSE_DIR"
  cat > "$COMPOSE_DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
EOF
  run bash -c "
    set -euo pipefail
    export PATH='${MOCKS}:/usr/bin:/bin'
    export MOCK_PSQL_ROLES_QUERY_EXIT=1
    source '${REPO}/lib/db.sh'
    provision_db '${COMPOSE_DIR}'
    echo 'SENTINEL_REACHED'
  " </dev/null
  [ "$status" -eq 0 ]
  # Falls through to the create-role branch (query treated as "not found") instead of
  # silently vanishing partway through.
  [[ "$output" == *"role_created"* ]]
  [[ "$output" == *"SENTINEL_REACHED"* ]]
}

@test "provision_db (bare call) survives set -e when the final informational verify queries fail" {
  COMPOSE_DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$COMPOSE_DIR"
  cat > "$COMPOSE_DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
EOF
  run bash -c "
    set -euo pipefail
    export PATH='${MOCKS}:/usr/bin:/bin'
    export MOCK_PSQL_VERIFY_EXIT=1
    source '${REPO}/lib/db.sh'
    provision_db '${COMPOSE_DIR}'
    echo 'SENTINEL_REACHED'
  " </dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"PROVISION_DONE"* ]]
  [[ "$output" == *"SENTINEL_REACHED"* ]]
}

@test "add_route_caddy (bare call) returns its OWN clean error, not a raw abort, with no anchor line" {
  # Note: awk essentially never exits non-zero just because its pattern never matched (it
  # still processes all input and exits 0), so this scenario doesn't actually exercise the
  # awk `|| true` guard itself (that one guards a much rarer case — e.g. disk-full while
  # writing $tmp — impractical to simulate portably). What this DOES verify: a bare call
  # that legitimately returns 1 does so via add_route_caddy's own clear stderr message
  # (visible here because `run` captures both streams) with the original file untouched,
  # rather than dying silently at some earlier, unrelated point.
  echo "empty.example.com { respond \"hi\" }" > "$BATS_TEST_TMPDIR/NoAnchor"
  run bash -c "
    set -euo pipefail
    export PATH='${MOCKS}/reverse-proxy:/usr/bin:/bin'
    source '${REPO}/lib/proxy-caddy.sh'
    add_route_caddy '${BATS_TEST_TMPDIR}/NoAnchor' '127.0.0.1:3100'
  " </dev/null
  [ "$status" -ne 0 ]
  [[ "$output" == *"no reverse_proxy"* ]]
  ! grep -q "chatwoot-addons" "$BATS_TEST_TMPDIR/NoAnchor"
}

@test "_cwpt_content_hash's own internal pipeline never aborts a set -e caller that guards its call" {
  # Points shasum at a directory (guaranteed to fail — "Is a directory") to force a real
  # non-zero exit from inside _cwpt_content_hash's pipeline. Note this test guards the CALL
  # (`|| true`) itself, same as inject_dashboard_script does internally — it documents
  # _cwpt_content_hash's failure behavior in isolation, it does not by itself prove
  # inject_dashboard_script's own internal `ver=... || true` guard is load-bearing (that
  # would require the real committed smart-import bundle file to be unhashable, which
  # isn't practical to construct without touching a real repo file).
  run bash -c "
    set -euo pipefail
    export PATH='${MOCKS}:/usr/bin:/bin'
    source '${REPO}/lib/inject.sh'
    ver=\"\$(_cwpt_content_hash '${BATS_TEST_TMPDIR}')\" || true
    echo \"SENTINEL_REACHED ver=[\${ver}]\"
  " </dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"SENTINEL_REACHED"* ]]
}

@test "inject_dashboard_script (bare call) survives set -e end to end (full happy path)" {
  run bash -c "
    set -euo pipefail
    export PATH='${MOCKS}:/usr/bin:/bin'
    source '${REPO}/lib/inject.sh'
    inject_dashboard_script /opt/chatwoot /chatwoot-addons import
    echo 'SENTINEL_REACHED'
  " </dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"dashboard_script_injected"* ]]
  [[ "$output" == *"SENTINEL_REACHED"* ]]
}

@test "inject_dashboard_script (bare call) survives set -e when reading the PREVIOUS DASHBOARD_SCRIPTS value itself fails" {
  # _cwpt_fetch_dashboard_scripts's docker exec can genuinely fail (rails container mid-
  # restart, etc) — inject_dashboard_script guards that one call site itself
  # (`|| existing=""`), so it must fall through to treating DASHBOARD_SCRIPTS as unknown/
  # empty (append-only) rather than aborting the whole injection, even called bare.
  run bash -c "
    set -euo pipefail
    export PATH='${MOCKS}:/usr/bin:/bin'
    export MOCK_FETCH_DASHBOARD_EXIT=1
    source '${REPO}/lib/inject.sh'
    inject_dashboard_script /opt/chatwoot /chatwoot-addons import
    echo 'SENTINEL_REACHED'
  " </dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"dashboard_script_injected"* ]]
  [[ "$output" == *"SENTINEL_REACHED"* ]]
}

@test "remove_dashboard_script (bare call) survives set -e end to end (block removal)" {
  run bash -c "
    set -euo pipefail
    export PATH='${MOCKS}:/usr/bin:/bin'
    export MOCK_EXISTING_DASHBOARD_SCRIPTS=\"\$(printf '<script>before();</script>\n<!-- CWPT:START -->\nours\n<!-- CWPT:END -->')\"
    source '${REPO}/lib/inject.sh'
    remove_dashboard_script /opt/chatwoot
    echo 'SENTINEL_REACHED'
  " </dev/null
  [ "$status" -eq 0 ]
  [[ "$output" == *"dashboard_script_block_removed"* ]]
  [[ "$output" == *"SENTINEL_REACHED"* ]]
}
