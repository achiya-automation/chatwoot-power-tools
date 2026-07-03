#!/usr/bin/env bats
# install.sh — top-level orchestration. Primary focus (per the implementation plan): the
# --dry-run contract (prints a plan, makes zero changes, never fails just because docker
# is absent or misbehaving) and flag parsing. A handful of fully-mocked non-dry-run runs
# are included too, as extra confidence that the wiring between install.sh and lib/*.sh is
# correct — but the real end-to-end proof is Task 3.6, run against chatwoot_admon by the
# controller, not here.

setup() {
  REPO="$(cd "$(dirname "$BATS_TEST_DIRNAME")" && pwd)"
  export PATH="$BATS_TEST_DIRNAME/mocks:/usr/bin:/bin"
  unset MOCK_COMPOSE_LS_JSON MOCK_COMPOSE_DIR MOCK_COMPOSE_PS_EMPTY MOCK_COMPOSE_PS_EXIT \
        MOCK_CID_RAILS MOCK_CID_POSTGRES MOCK_RAILS_CONTAINER MOCK_POSTGRES_CONTAINER \
        MOCK_DOCKER_PS_NAMES MOCK_DOCKER_PS_IMAGES MOCK_DOCKER_PS_IMAGE_EXIT \
        MOCK_DOCKER_PS_EXIT MOCK_ROLE_EXISTS MOCK_PSQL_EXIT MOCK_PSQL_ROLES_QUERY_EXIT \
        MOCK_PSQL_VERIFY_EXIT MOCK_RAILS_RUNNER_EXIT MOCK_DOCKER_CP_EXIT \
        MOCK_DOCKER_CP_CAPTURE MOCK_COMPOSE_UP_EXIT MOCK_COMPOSE_RM_EXIT \
        MOCK_CURL_HTTP_CODE MOCK_CURL_EXIT
}

# ── --dry-run: the core contract ─────────────────────────────────────────────

@test "dry-run prints a plan without side effects and mentions DRY RUN + the route" {
  run bash "$REPO/install.sh" --dry-run --modules=all
  [ "$status" -eq 0 ]
  [[ "$output" == *"DRY RUN"* ]]
  [[ "$output" == *"chatwoot-addons"* ]]
}

@test "dry-run does not require docker to be present at all" {
  run env PATH="/usr/bin:/bin" bash "$REPO/install.sh" --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"DRY RUN"* ]]
  [[ "$output" == *"NOT DETECTED"* ]]
}

@test "dry-run reports the detected compose dir when docker is mocked to find one" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  echo "image: chatwoot/chatwoot:v4.15.1" > "$DIR/docker-compose.yml"
  export MOCK_COMPOSE_DIR="$DIR"
  run bash "$REPO/install.sh" --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"$DIR"* ]]
}

@test "dry-run lists the requested modules" {
  run bash "$REPO/install.sh" --dry-run --modules=import,sequences
  [ "$status" -eq 0 ]
  [[ "$output" == *"import"* ]]
  [[ "$output" == *"sequences"* ]]
}

@test "dry-run rejects an unknown module name" {
  run bash "$REPO/install.sh" --dry-run --modules=bogus
  [ "$status" -ne 0 ]
  [[ "$output" == *"unknown module"* ]]
}

@test "uninstall flag is recognized in dry-run mode" {
  run bash "$REPO/install.sh" --uninstall --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"uninstall"* ]]
  [[ "$output" == *"DRY RUN"* ]]
}

@test "uninstall dry-run warns the DB role/schema is left in place" {
  run bash "$REPO/install.sh" --uninstall --dry-run
  [[ "$output" == *"drip_engine"* ]]
}

# ── flag parsing ─────────────────────────────────────────────────────────────

@test "--help prints usage and exits 0" {
  run bash "$REPO/install.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage"* ]]
}

@test "an unknown flag is rejected with a non-zero exit" {
  run bash "$REPO/install.sh" --not-a-real-flag
  [ "$status" -ne 0 ]
  [[ "$output" == *"unknown option"* ]]
}

@test "install.sh with no arguments at all does not crash (defaults, but requires docker for a real run)" {
  # No --dry-run and no docker on PATH: should fail cleanly via preflight, not crash.
  run env PATH="/usr/bin:/bin" bash "$REPO/install.sh" --yes
  [ "$status" -ne 0 ]
  [[ "$output" == *"docker"* ]]
}

# ── fully-mocked non-dry-run runs (extra confidence, not the primary contract) ──

@test "a full mocked install run provisions the DB, brings up the engine, and injects the script" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.15.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  run bash "$REPO/install.sh" --yes --modules=import
  [ "$status" -eq 0 ]
  [[ "$output" == *"role_created"* ]]
  [[ "$output" == *"MOCK_COMPOSE_UP"* ]]
  [[ "$output" == *"dashboard_script_injected"* || "$output" == *"MOCK_EXEC"* ]]
  [[ "$output" == *"engine health check: OK"* ]]
  grep -q '^CWPT_PUBLIC_BASE_URL=https://chat.example.com/chatwoot-addons$' "$DIR/.env"
  # host is the DETECTED rails container name (mock default: chatwoot-rails-1) — see
  # "derives CWPT_CHATWOOT_BASE_URL's host from the detected rails container" below for
  # the fallback-to-literal-"rails" case.
  grep -q '^CWPT_CHATWOOT_BASE_URL=http://chatwoot-rails-1:3000$' "$DIR/.env"
  grep -q '^CWPT_DATABASE_URL=postgres://drip_engine:' "$DIR/.env"
  [ -d "$DIR/chatwoot-power-tools/modules" ]
  [ -f "$DIR/chatwoot-power-tools/docker-compose.addons.yml" ]
  # smart-import assets must be merged into the webapp dist for the engine's static
  # fallback to serve them (see the docstring at the top of install.sh for why).
  [ -f "$DIR/chatwoot-power-tools/modules/sequences/webapp/dist/smart-import/import-tool.js" ]
}

@test "CWPT_CHATWOOT_BASE_URL uses the detected rails container name, not a hardcoded literal" {
  # A deployment whose rails container isn't literally named "chatwoot-rails-1" (e.g. a
  # different project name, or container_name override) must still get a host that
  # actually resolves on the compose network — proving install.sh derives it via
  # detect_service_container rather than assuming a fixed name.
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.15.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  export MOCK_RAILS_CONTAINER="acmecorp-rails-1"
  run bash "$REPO/install.sh" --yes --modules=import
  [ "$status" -eq 0 ]
  grep -q '^CWPT_CHATWOOT_BASE_URL=http://acmecorp-rails-1:3000$' "$DIR/.env"
}

@test "CWPT_CHATWOOT_BASE_URL falls back to the literal 'rails' when the container truly can't be detected" {
  # Force rails detection specifically to come up empty via BOTH of
  # detect_service_container's strategies (compose ps -q empty + a docker-ps name list
  # with no "rails"-matching entry), while leaving postgres detectable (via the docker-ps
  # name fallback) so provision_db still succeeds. Note: the LATER inject_dashboard_script
  # step needs that same rails detection to docker-exec into the container, so the overall
  # install still fails at that step (pre-existing, unrelated-to-this-fix behavior — no
  # rails container means nothing more can be done). What this test proves is narrower and
  # still meaningful: by the time that later step aborts the script,
  # _cwpt_write_addons_env (which runs earlier) has already written CWPT_CHATWOOT_BASE_URL
  # using the "rails" fallback rather than crashing or leaving it unset.
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.15.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  export MOCK_COMPOSE_PS_EMPTY=1
  export MOCK_DOCKER_PS_NAMES="chatwoot-postgres-1"
  run bash "$REPO/install.sh" --yes --modules=import
  [ "$status" -ne 0 ]
  [[ "$output" == *"inject_dashboard_script failed"* ]]
  grep -q '^CWPT_CHATWOOT_BASE_URL=http://rails:3000$' "$DIR/.env"
}

@test "install.sh is fully idempotent: running it twice in a row succeeds cleanly both times" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.15.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
EOF
  export MOCK_COMPOSE_DIR="$DIR"

  run bash "$REPO/install.sh" --yes --modules=all
  [ "$status" -eq 0 ]
  [[ "$output" == *"role_created"* ]]

  # Second run: the mock docker still reports the role as pre-existing only if we tell it
  # to — a real re-run would find the REAL role now created, so simulate that faithfully.
  export MOCK_ROLE_EXISTS=1
  run bash "$REPO/install.sh" --yes --modules=all
  [ "$status" -eq 0 ]
  [[ "$output" == *"role_already_exists"* ]]
  [[ "$output" == *"grants_applied"* ]]
  # CWPT_DATABASE_URL must still appear exactly once (not duplicated across the two runs).
  [ "$(grep -c '^CWPT_DATABASE_URL=' "$DIR/.env")" -eq 1 ]
  [ "$(grep -c '^CWPT_PUBLIC_BASE_URL=' "$DIR/.env")" -eq 1 ]
  [ "$(grep -c '^CWPT_CHATWOOT_BASE_URL=' "$DIR/.env")" -eq 1 ]
}

@test "a full mocked install run adds the caddy route when caddy-host is detected" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.15.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  CADDYFILE="$BATS_TEST_TMPDIR/Caddyfile"
  cp "$REPO/test/fixtures/Caddyfile" "$CADDYFILE"
  export CWPT_CADDYFILE="$CADDYFILE"
  PATH="$BATS_TEST_DIRNAME/mocks/reverse-proxy:$PATH" run bash "$REPO/install.sh" --yes --modules=all
  [ "$status" -eq 0 ]
  grep -q 'handle_path /chatwoot-addons/\*' "$CADDYFILE"
}

@test "a full mocked run fails cleanly (non-zero, clear message) when provision_db fails" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.15.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  export MOCK_PSQL_EXIT=1
  run bash "$REPO/install.sh" --yes --modules=import
  [ "$status" -ne 0 ]
  [[ "$output" == *"provision_db failed"* ]]
  # nothing should have been brought up if the DB step itself failed
  [[ "$output" != *"MOCK_COMPOSE_UP"* ]]
}

@test "--uninstall (mocked) removes the copied directory and reports the DB is left in place" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR/chatwoot-power-tools"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.15.1
EOF
  echo "placeholder" > "$DIR/.env"
  cp "$REPO/docker-compose.addons.yml" "$DIR/chatwoot-power-tools/"
  export MOCK_COMPOSE_DIR="$DIR"
  run bash "$REPO/install.sh" --uninstall --yes
  [ "$status" -eq 0 ]
  [[ "$output" == *"drip_engine"* ]]
  [ ! -d "$DIR/chatwoot-power-tools" ]
}

@test "full round-trip: install adds the caddy route, uninstall (mocked) removes it again" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.15.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  CADDYFILE="$BATS_TEST_TMPDIR/Caddyfile"
  cp "$REPO/test/fixtures/Caddyfile" "$CADDYFILE"
  export CWPT_CADDYFILE="$CADDYFILE"
  ORIGINAL_LINE_COUNT="$(wc -l < "$CADDYFILE")"

  PATH="$BATS_TEST_DIRNAME/mocks/reverse-proxy:$PATH" run bash "$REPO/install.sh" --yes --modules=import
  [ "$status" -eq 0 ]
  grep -q 'handle_path /chatwoot-addons/\*' "$CADDYFILE"

  PATH="$BATS_TEST_DIRNAME/mocks/reverse-proxy:$PATH" run bash "$REPO/install.sh" --uninstall --yes
  [ "$status" -eq 0 ]
  ! grep -q 'handle_path /chatwoot-addons/\*' "$CADDYFILE"
  # the original reverse_proxy line for Chatwoot itself must still be intact
  grep -q 'reverse_proxy 127.0.0.1:3000' "$CADDYFILE"
  [ "$(wc -l < "$CADDYFILE")" -eq "$ORIGINAL_LINE_COUNT" ]
}
