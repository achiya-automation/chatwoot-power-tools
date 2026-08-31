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
  export MOCK_DASHBOARD_STATE_FILE="$BATS_TEST_TMPDIR/dashboard.state"
  export MOCK_DASHBOARD_STAGED_FILE="$BATS_TEST_TMPDIR/dashboard.staged"
  export MOCK_CWPT_CONTAINER_STATE_FILE="$BATS_TEST_TMPDIR/cwpt-container.state"
  export CWPT_MIGRATION_WAIT_ATTEMPTS=1
  export CWPT_MIGRATION_WAIT_SLEEP_SECONDS=0
  export CWPT_VERIFY_ATTEMPTS=1
  export CWPT_VERIFY_SLEEP_SECONDS=0
  rm -f "$MOCK_DASHBOARD_STATE_FILE" "$MOCK_DASHBOARD_STAGED_FILE" \
        "$MOCK_CWPT_CONTAINER_STATE_FILE"
  unset MOCK_COMPOSE_LS_JSON MOCK_COMPOSE_DIR MOCK_COMPOSE_PS_EMPTY MOCK_COMPOSE_PS_EXIT \
        MOCK_CID_RAILS MOCK_CID_POSTGRES MOCK_RAILS_CONTAINER MOCK_POSTGRES_CONTAINER \
        MOCK_DOCKER_PS_NAMES MOCK_DOCKER_PS_IMAGES MOCK_DOCKER_PS_IMAGE_EXIT \
        MOCK_DOCKER_PS_EXIT MOCK_ROLE_EXISTS MOCK_PSQL_EXIT MOCK_PSQL_ROLES_QUERY_EXIT \
        MOCK_PSQL_VERIFY_EXIT MOCK_PSQL_CAPTURE MOCK_RAILS_RUNNER_EXIT MOCK_DOCKER_CP_EXIT \
        MOCK_DOCKER_CP_CAPTURE MOCK_COMPOSE_UP_EXIT MOCK_COMPOSE_RM_EXIT \
        MOCK_DOCKER_RM_EXIT MOCK_DOCKER_PS_ALL_EXIT \
        MOCK_CURL_HTTP_CODE MOCK_CURL_EXIT MOCK_CURL_BODY \
        MOCK_CURL_ENGINE_HTTP_CODE MOCK_CURL_ENGINE_EXIT MOCK_CURL_ENGINE_BODY \
        MOCK_CURL_PUBLIC_HTTP_CODE MOCK_CURL_PUBLIC_EXIT MOCK_CURL_PUBLIC_BODY \
        MOCK_CURL_PUBLIC_DEPLOY_ID MOCK_RAILS_IMAGE MOCK_CWPT_ENABLED_MODULES MOCK_CWPT_DEPLOY_ID \
        MOCK_ENGINE_MIGRATIONS_READY CWPT_CHATWOOT_VERSION
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
  echo "image: chatwoot/chatwoot:v4.17.1" > "$DIR/docker-compose.yml"
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

@test "dry-run normalizes duplicate module names to one exact selection" {
  run bash "$REPO/install.sh" --dry-run --modules=import,import
  [ "$status" -eq 0 ]
  [[ "$output" == *"Modules requested: import,import -> import"* ]]
  [[ "$output" != *"import import"* ]]
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

@test "self-install subset preserves checkout source and deploys an isolated managed runtime" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  SELF="$DIR/chatwoot-power-tools"
  mkdir -p "$SELF"
  # Reproduce the production checkout layout without copying host node_modules.
  tar --exclude='node_modules' --exclude='.git' -C "$REPO" -cf - \
    install.sh lib docker-compose.addons.yml modules | tar -C "$SELF" -xf -
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
EOF
  export MOCK_COMPOSE_DIR="$DIR"

  run bash "$SELF/install.sh" --yes --modules=import

  [ "$status" -eq 0 ]
  [[ "$output" == *"chatwoot-power-tools installed."* ]]
  [[ "$output" == *"source checkout detected"* ]]
  # Tracked source remains complete even though dashboard/sequences were not selected.
  [ -f "$SELF/modules/sequences/engine/src/index.js" ]
  [ -f "$SELF/modules/sequences/webapp/dist/smart-import/import-tool.js" ]
  [ -f "$SELF/modules/dashboard-enhancements/parts/campaign-modal.js" ]
  [ -f "$SELF/docker-compose.addons.yml" ]
  # Only the selected optional module is present in the actual build/deployment runtime.
  [ -f "$SELF/.cwpt-runtime/modules/smart-import/inject/import-button.js" ]
  [ -f "$SELF/.cwpt-runtime/modules/sequences/webapp/dist/smart-import/import-tool.js" ]
  [ ! -d "$SELF/.cwpt-runtime/modules/dashboard-enhancements" ]
  [ "$(cat "$SELF/.cwpt-runtime/enabled-modules.txt")" = "import" ]
  grep -q "^CWPT_BUILD_CONTEXT=$SELF/.cwpt-runtime/modules/sequences$" "$DIR/.env"
}

@test "failed replacement extraction restores the previous managed runtime" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  TARGET="$DIR/chatwoot-power-tools"
  mkdir -p "$TARGET/modules/previous" "$BATS_TEST_TMPDIR/fail-tar-bin"
  echo "previous-runtime" > "$TARGET/modules/previous/sentinel.txt"
  echo "previous-compose" > "$TARGET/docker-compose.addons.yml"
  echo "operator-file" > "$TARGET/operator-note.txt"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  export CWPT_REAL_TAR="$(command -v tar)"
  cat > "$BATS_TEST_TMPDIR/fail-tar-bin/tar" <<'EOF'
#!/usr/bin/env bash
for arg in "$@"; do
  if [ "$arg" = "-xf" ]; then
    exit 91
  fi
done
exec "$CWPT_REAL_TAR" "$@"
EOF
  chmod +x "$BATS_TEST_TMPDIR/fail-tar-bin/tar"

  PATH="$BATS_TEST_TMPDIR/fail-tar-bin:$PATH" run bash "$REPO/install.sh" --yes --modules=import

  [ "$status" -ne 0 ]
  [[ "$output" == *"previous runtime restored"* ]]
  [ "$(cat "$TARGET/modules/previous/sentinel.txt")" = "previous-runtime" ]
  [ "$(cat "$TARGET/docker-compose.addons.yml")" = "previous-compose" ]
  [ "$(cat "$TARGET/operator-note.txt")" = "operator-file" ]
  [ ! -e "$TARGET/modules/sequences" ]
}

@test "a full mocked install run provisions the DB, brings up the engine, and injects the script" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
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
  [[ "$output" == *"MOCK_COMPOSE_UP"* ]]
  [[ "$output" == *"owner_migration_applied:024_auto_onboard_role_grants.sql"* ]]
  [[ "$output" == *"owner_migration_applied:033_journeys_role_grants.sql"* ]]
  [[ "$output" == *"owner_migration_applied:051_campaign_recipients_role_grants.sql"* ]]
  [[ "$output" == *"dashboard_script_injected"* || "$output" == *"MOCK_EXEC"* ]]
  [[ "$output" == *"engine health check: OK"* ]]
  [[ "$output" == *"public route check: OK"* ]]
  grep -q '^CWPT_PUBLIC_BASE_URL=https://chat.example.com/chatwoot-addons$' "$DIR/.env"
  # host is the DETECTED rails container name (mock default: chatwoot-rails-1) — see
  # "derives CWPT_CHATWOOT_BASE_URL's host from the detected rails container" below for
  # the fallback-to-literal-"rails" case.
  grep -q '^CWPT_CHATWOOT_BASE_URL=http://chatwoot-rails-1:3000$' "$DIR/.env"
  grep -q '^CWPT_DATABASE_URL=postgres://drip_engine:' "$DIR/.env"
  grep -q '^CWPT_ENABLED_MODULES=import,sequences,enhancements$' "$DIR/.env"
  grep -q '^CWPT_JOURNEY_INTAKE_SECRET=' "$DIR/.env"
  [ -d "$DIR/chatwoot-power-tools/modules" ]
  [ -f "$DIR/chatwoot-power-tools/docker-compose.addons.yml" ]
  # smart-import assets must be merged into the webapp dist for the engine's static
  # fallback to serve them (see the docstring at the top of install.sh for why).
  [ -f "$DIR/chatwoot-power-tools/modules/sequences/webapp/dist/smart-import/import-tool.js" ]
  [ -d "$DIR/chatwoot-power-tools/modules/smart-import" ]
  [ -d "$DIR/chatwoot-power-tools/modules/dashboard-enhancements" ]
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
    image: chatwoot/chatwoot:v4.17.1
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
    image: chatwoot/chatwoot:v4.17.1
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
  export CWPT_CHATWOOT_VERSION=4.17.1
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
    image: chatwoot/chatwoot:v4.17.1
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
  [ "$(grep -c '^CWPT_JOURNEY_INTAKE_SECRET=' "$DIR/.env")" -eq 1 ]
}

@test "a full mocked install run adds the caddy route when caddy-host is detected" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
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
    image: chatwoot/chatwoot:v4.17.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  export MOCK_PSQL_EXIT=1
  run bash "$REPO/install.sh" --yes --modules=sequences
  [ "$status" -ne 0 ]
  [[ "$output" == *"provision_db failed"* ]]
  # nothing should have been brought up if the DB step itself failed
  [[ "$output" != *"MOCK_COMPOSE_UP"* ]]
}

@test "dashboard shrink does not revoke live sequence privileges before compose-up succeeds" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  export MOCK_COMPOSE_UP_EXIT=1
  export MOCK_PSQL_CAPTURE="$BATS_TEST_TMPDIR/prebuild.psql"
  run bash "$REPO/install.sh" --yes --modules=dashboard
  [ "$status" -ne 0 ]
  [[ "$output" == *"docker compose up failed"* ]]
  ! grep -q 'REVOKE UPDATE (custom_attributes)' "$MOCK_PSQL_CAPTURE"
  ! grep -q 'REVOKE EXECUTE ON FUNCTION drip.ensure_account_bot' "$MOCK_PSQL_CAPTURE"
}

@test "--uninstall (mocked) removes the copied directory and reports the DB is left in place" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR/chatwoot-power-tools"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
EOF
  echo "placeholder" > "$DIR/.env"
  cp "$REPO/docker-compose.addons.yml" "$DIR/chatwoot-power-tools/"
  export MOCK_COMPOSE_DIR="$DIR"
  run bash "$REPO/install.sh" --uninstall --yes
  [ "$status" -eq 0 ]
  [[ "$output" == *"drip_engine"* ]]
  [ ! -d "$DIR/chatwoot-power-tools" ]
}

@test "self-uninstall preserves the source checkout and removes only generated state" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  SELF="$DIR/chatwoot-power-tools"
  mkdir -p "$SELF/.git"
  tar --exclude='node_modules' --exclude='.git' -C "$REPO" -cf - \
    install.sh lib docker-compose.addons.yml modules README.md | tar -C "$SELF" -xf -
  echo "git-sentinel" > "$SELF/.git/sentinel"
  echo "import" > "$SELF/enabled-modules.txt"
  echo "operator-file" > "$SELF/operator-note.txt"
  mkdir -p "$SELF/.cwpt-runtime/modules/managed"
  cp "$SELF/docker-compose.addons.yml" "$SELF/.cwpt-runtime/docker-compose.addons.yml"
  echo "managed-runtime" > "$SELF/.cwpt-runtime/modules/managed/sentinel.txt"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
EOF
  echo "placeholder" > "$DIR/.env"
  export MOCK_COMPOSE_DIR="$DIR"

  run bash "$SELF/install.sh" --uninstall --yes

  [ "$status" -eq 0 ]
  [[ "$output" == *"source checkout preserved"* ]]
  [ -f "$SELF/install.sh" ]
  [ -f "$SELF/README.md" ]
  [ -f "$SELF/.git/sentinel" ]
  [ -f "$SELF/modules/sequences/engine/src/index.js" ]
  [ -f "$SELF/docker-compose.addons.yml" ]
  [ -f "$SELF/operator-note.txt" ]
  [ ! -e "$SELF/.cwpt-runtime" ]
  [ ! -e "$SELF/enabled-modules.txt" ]
}

@test "uninstall fails closed and preserves the backend when DASHBOARD_SCRIPTS cannot be read" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR/chatwoot-power-tools"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
EOF
  echo "placeholder" > "$DIR/.env"
  cp "$REPO/docker-compose.addons.yml" "$DIR/chatwoot-power-tools/"
  export MOCK_COMPOSE_DIR="$DIR"
  export MOCK_FETCH_DASHBOARD_EXIT=1
  run bash "$REPO/install.sh" --uninstall --yes
  [ "$status" -ne 0 ]
  [[ "$output" == *"removal is INCOMPLETE"* ]]
  [[ "$output" == *"No engine, route, or copied files were removed"* ]]
  [[ "$output" != *"chatwoot-power-tools removed."* ]]
  [ -d "$DIR/chatwoot-power-tools" ]
}

@test "uninstall never reports success or removes UI route/files while cwpt-engine still exists" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
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

  PATH="$BATS_TEST_DIRNAME/mocks/reverse-proxy:$PATH" run bash "$REPO/install.sh" --yes --modules=import
  [ "$status" -eq 0 ]
  [ -f "$MOCK_CWPT_CONTAINER_STATE_FILE" ]
  grep -q 'handle_path /chatwoot-addons/\*' "$CADDYFILE"
  grep -q 'CWPT:START' "$MOCK_DASHBOARD_STATE_FILE"

  export MOCK_COMPOSE_RM_EXIT=1
  export MOCK_DOCKER_RM_EXIT=1
  PATH="$BATS_TEST_DIRNAME/mocks/reverse-proxy:$PATH" run bash "$REPO/install.sh" --uninstall --yes

  [ "$status" -ne 0 ]
  [[ "$output" == *"removal is INCOMPLETE"* ]]
  [[ "$output" == *"may still be running"* ]]
  [[ "$output" != *"chatwoot-power-tools removed."* ]]
  [ -f "$MOCK_CWPT_CONTAINER_STATE_FILE" ]
  [ -d "$DIR/chatwoot-power-tools/modules" ]
  grep -q 'handle_path /chatwoot-addons/\*' "$CADDYFILE"
  grep -q 'CWPT:START' "$MOCK_DASHBOARD_STATE_FILE"
}

@test "full round-trip: install adds the caddy route, uninstall (mocked) removes it again" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
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

@test "install hard-fails before changes on Chatwoot older than 4.17.1" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.0
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  export MOCK_RAILS_IMAGE="chatwoot/chatwoot:v4.17.0"
  run bash "$REPO/install.sh" --yes
  [ "$status" -ne 0 ]
  [[ "$output" == *"unsupported Chatwoot 4.17.0"* ]]
  [[ "$output" == *"4.17.1 or newer is required"* ]]
  [[ "$output" != *"role_created"* ]]
  [[ "$output" != *"MOCK_COMPOSE_UP"* ]]
}

@test "install rejects a 4.17.1 release-candidate tag as unproven" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1-rc.1
EOF
  echo "FRONTEND_URL=https://chat.example.com" > "$DIR/.env"
  export MOCK_COMPOSE_DIR="$DIR"
  export MOCK_RAILS_IMAGE="chatwoot/chatwoot:v4.17.1-rc.1"
  run bash "$REPO/install.sh" --yes --modules=import
  [ "$status" -ne 0 ]
  [[ "$output" == *"could not prove the running Chatwoot version"* ]]
  [[ "$output" != *"Provisioning database"* ]]
  [ ! -d "$DIR/chatwoot-power-tools" ]
}

@test "install fails closed for an unversioned image" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:latest
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  export MOCK_RAILS_IMAGE="chatwoot/chatwoot:latest"
  run bash "$REPO/install.sh" --yes
  [ "$status" -ne 0 ]
  [[ "$output" == *"could not prove the running Chatwoot version"* ]]
  [[ "$output" == *"CWPT_CHATWOOT_VERSION=X.Y.Z"* ]]
}

@test "a verified version override supports an unversioned official image" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:latest
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  export MOCK_RAILS_IMAGE="chatwoot/chatwoot:latest"
  export CWPT_CHATWOOT_VERSION=4.17.1
  run bash "$REPO/install.sh" --yes --modules=import
  [ "$status" -eq 0 ]
  [[ "$output" == *"Chatwoot version: 4.17.1 (supported)"* ]]
}

@test "installer exits incomplete and never prints success when public route is unreachable" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  export MOCK_CURL_PUBLIC_HTTP_CODE=404
  run bash "$REPO/install.sh" --yes --modules=import
  [ "$status" -ne 0 ]
  [[ "$output" == *"public route check: got HTTP 404"* ]]
  [[ "$output" == *"installation is INCOMPLETE"* ]]
  [[ "$output" != *"chatwoot-power-tools installed."* ]]
}

@test "installer rejects a public HTTP 200 that is Chatwoot HTML instead of engine health JSON" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  export MOCK_CURL_PUBLIC_HTTP_CODE=200
  export MOCK_CURL_PUBLIC_BODY='<!doctype html><title>Chatwoot</title>'
  run bash "$REPO/install.sh" --yes --modules=import
  [ "$status" -ne 0 ]
  [[ "$output" == *"HTTP 200 did not contain the cwpt-engine health response"* ]]
  [[ "$output" == *"installation is INCOMPLETE"* ]]
  [[ "$output" != *"chatwoot-power-tools installed."* ]]
}

@test "installer rejects a valid health response from a stale public engine" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  export MOCK_CURL_PUBLIC_DEPLOY_ID='stale-deployment-id'
  printf '%s' '<script>previous-dashboard();</script>' > "$MOCK_DASHBOARD_STATE_FILE"
  run bash "$REPO/install.sh" --yes --modules=import
  [ "$status" -ne 0 ]
  [[ "$output" == *"stale or different cwpt-engine"* ]]
  [[ "$output" == *"installation is INCOMPLETE"* ]]
  [[ "$output" != *"chatwoot-power-tools installed."* ]]
  [[ "$output" != *"Publishing the dashboard script"* ]]
  [ "$(cat "$MOCK_DASHBOARD_STATE_FILE")" = '<script>previous-dashboard();</script>' ]
}

@test "installer exits incomplete when FRONTEND_URL cannot produce a public route URL" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  run bash "$REPO/install.sh" --yes --modules=import
  [ "$status" -ne 0 ]
  [[ "$output" == *"CWPT_PUBLIC_BASE_URL is missing"* ]]
  [[ "$output" == *"installation is INCOMPLETE"* ]]
  [[ "$output" != *"chatwoot-power-tools installed."* ]]
}

@test "import-only install skips sequence DB/grants and deploys only import artifacts" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
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
  [[ "$output" == *"Skipping database provisioning (import-only mode)"* ]]
  [[ "$output" != *"role_created"* ]]
  [[ "$output" != *"owner_migration_applied"* ]]
  grep -q '^CWPT_DATABASE_URL=$' "$DIR/.env"
  grep -q '^CWPT_ENABLED_MODULES=import$' "$DIR/.env"
  [ -d "$DIR/chatwoot-power-tools/modules/smart-import" ]
  [ -d "$DIR/chatwoot-power-tools/modules/sequences/webapp/dist/smart-import" ]
  [ ! -d "$DIR/chatwoot-power-tools/modules/dashboard-enhancements" ]
  [ "$(cat "$DIR/chatwoot-power-tools/enabled-modules.txt")" = "import" ]
}

@test "shrinking an existing DB-backed install to import removes grants and container credential" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
CWPT_DATABASE_URL=postgres://drip_engine:old-test-value@postgres:5432/chatwoot
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  export MOCK_ROLE_EXISTS=1
  export MOCK_PSQL_CAPTURE="$BATS_TEST_TMPDIR/import-shrink.psql"

  run bash "$REPO/install.sh" --yes --modules=import

  [ "$status" -eq 0 ]
  grep -q '^CWPT_DATABASE_URL=$' "$DIR/.env"
  [ "$(grep -c '^CWPT_DATABASE_URL=' "$DIR/.env")" -eq 1 ]
  [[ "$output" == *"import_privileges_finalized"* ]]
  grep -q 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public' "$MOCK_PSQL_CAPTURE"
  grep -q 'REVOKE EXECUTE ON FUNCTION drip.ensure_account_bot(integer)' "$MOCK_PSQL_CAPTURE"
  grep -q '051_campaign_recipients_role_grants.sql' "$MOCK_PSQL_CAPTURE"
}

@test "a fresh import-only install can expand to sequences and receives the new role credential" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
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
  grep -q '^CWPT_DATABASE_URL=$' "$DIR/.env"

  run bash "$REPO/install.sh" --yes --modules=sequences
  [ "$status" -eq 0 ]
  [[ "$output" == *"env_rewritten"* ]]
  [ "$(grep -c '^CWPT_DATABASE_URL=' "$DIR/.env")" -eq 1 ]
  grep -q '^CWPT_DATABASE_URL=postgres://drip_engine:' "$DIR/.env"
}

@test "dashboard-only install excludes sequence owner migrations, writes and UI artifacts" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  export MOCK_PSQL_CAPTURE="$BATS_TEST_TMPDIR/dashboard.psql"
  run bash "$REPO/install.sh" --yes --modules=dashboard
  [ "$status" -eq 0 ]
  grep -q '^CWPT_ENABLED_MODULES=enhancements$' "$DIR/.env"
  [[ "$output" == *"owner_migration_applied:051_campaign_recipients_role_grants.sql"* ]]
  [[ "$output" != *"024_auto_onboard"* ]]
  [[ "$output" != *"033_journeys"* ]]
  [ -d "$DIR/chatwoot-power-tools/modules/dashboard-enhancements" ]
  [ ! -d "$DIR/chatwoot-power-tools/modules/smart-import" ]
  [ ! -d "$DIR/chatwoot-power-tools/modules/sequences/webapp/dist/smart-import" ]
  ! grep -q 'GRANT UPDATE (custom_attributes)' "$MOCK_PSQL_CAPTURE"
  ! grep -q 'GRANT UPDATE (message_templates' "$MOCK_PSQL_CAPTURE"
  [ "$(cat "$DIR/chatwoot-power-tools/enabled-modules.txt")" = "enhancements" ]
}

@test "reinstalling a subset removes stale unselected module artifacts" {
  DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$DIR/chatwoot-power-tools/modules/smart-import" \
           "$DIR/chatwoot-power-tools/modules/dashboard-enhancements" \
           "$DIR/chatwoot-power-tools/modules/sequences/webapp/dist/smart-import"
  touch "$DIR/chatwoot-power-tools/modules/smart-import/stale.js"
  touch "$DIR/chatwoot-power-tools/modules/dashboard-enhancements/stale.js"
  touch "$DIR/chatwoot-power-tools/modules/sequences/webapp/dist/smart-import/stale.js"
  cat > "$DIR/docker-compose.yml" <<'EOF'
services:
  rails:
    image: chatwoot/chatwoot:v4.17.1
EOF
  cat > "$DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
FRONTEND_URL=https://chat.example.com
EOF
  export MOCK_COMPOSE_DIR="$DIR"
  run bash "$REPO/install.sh" --yes --modules=sequences
  [ "$status" -eq 0 ]
  grep -q '^CWPT_ENABLED_MODULES=sequences$' "$DIR/.env"
  [ ! -d "$DIR/chatwoot-power-tools/modules/smart-import" ]
  [ ! -d "$DIR/chatwoot-power-tools/modules/dashboard-enhancements" ]
  [ ! -d "$DIR/chatwoot-power-tools/modules/sequences/webapp/dist/smart-import" ]
  [ "$(cat "$DIR/chatwoot-power-tools/enabled-modules.txt")" = "sequences" ]
}
