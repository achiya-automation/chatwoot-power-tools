#!/usr/bin/env bats
# lib/db.sh — provisions the least-privilege drip_engine role/schema in Chatwoot's own
# Postgres and writes CWPT_DATABASE_URL to Chatwoot's .env. Ported from the
# production-proven deploy/provision-db-role.sh; only the hardcoded container/user/db/path
# are replaced by lib/detect.sh calls. All docker/psql calls go through test/mocks/docker —
# no real container or database is ever touched.

setup() {
  REPO="$(cd "$(dirname "$BATS_TEST_DIRNAME")" && pwd)"
  export PATH="$BATS_TEST_DIRNAME/mocks:/usr/bin:/bin"
  source "$REPO/lib/db.sh"
  unset MOCK_ROLE_EXISTS MOCK_COMPOSE_PS_EMPTY MOCK_DOCKER_PS_NAMES MOCK_CID_POSTGRES \
        MOCK_POSTGRES_CONTAINER MOCK_PSQL_EXIT

  COMPOSE_DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  mkdir -p "$COMPOSE_DIR"
  cat > "$COMPOSE_DIR/.env" <<'EOF'
POSTGRES_USERNAME=chatwoot
POSTGRES_DATABASE=chatwoot
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_PASSWORD=super-secret-chatwoot-pw
FRONTEND_URL=https://chat.example.com
EOF
}

@test "provision_db creates role+schema, applies grants, and appends CWPT_DATABASE_URL" {
  run provision_db "$COMPOSE_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *"role_created"* ]]
  [[ "$output" == *"env_appended"* ]]
  [[ "$output" == *"grants_applied"* ]]
  [[ "$output" == *"PROVISION_DONE"* ]]
  grep -q '^CWPT_DATABASE_URL=postgres://drip_engine:' "$COMPOSE_DIR/.env"
}

@test "provision_db derives the connection string from detected host/port, not a hardcoded default" {
  sed -i '' 's/POSTGRES_HOST=postgres/POSTGRES_HOST=custom-pg-host/' "$COMPOSE_DIR/.env" 2>/dev/null \
    || sed -i 's/POSTGRES_HOST=postgres/POSTGRES_HOST=custom-pg-host/' "$COMPOSE_DIR/.env"
  run provision_db "$COMPOSE_DIR"
  [ "$status" -eq 0 ]
  grep -q '^CWPT_DATABASE_URL=postgres://drip_engine:[^@]*@custom-pg-host:5432/chatwoot$' "$COMPOSE_DIR/.env"
}

@test "provision_db never prints a password" {
  run provision_db "$COMPOSE_DIR"
  [[ "$output" != *"PASSWORD"* ]]
  ! [[ "$output" =~ [0-9a-f]{48} ]]
}

@test "provision_db is idempotent when the role already exists (no duplicate .env write)" {
  export MOCK_ROLE_EXISTS=1
  run provision_db "$COMPOSE_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *"role_already_exists"* ]]
  [[ "$output" != *"role_created"* ]]
  ! grep -q '^CWPT_DATABASE_URL=' "$COMPOSE_DIR/.env"
}

@test "provision_db always (re)applies grants even when the role already exists" {
  export MOCK_ROLE_EXISTS=1
  run provision_db "$COMPOSE_DIR"
  [[ "$output" == *"grants_applied"* ]]
  [[ "$output" == *"PROVISION_DONE"* ]]
}

@test "provision_db does not append a second CWPT_DATABASE_URL if one is already present" {
  echo "CWPT_DATABASE_URL=postgres://drip_engine:oldpw@postgres:5432/chatwoot" >> "$COMPOSE_DIR/.env"
  run provision_db "$COMPOSE_DIR"
  [[ "$output" == *"env_already_present"* ]]
  [ "$(grep -c '^CWPT_DATABASE_URL=' "$COMPOSE_DIR/.env")" -eq 1 ]
}

@test "provision_db returns 1 when the postgres container cannot be detected" {
  export MOCK_COMPOSE_PS_EMPTY=1
  export MOCK_DOCKER_PS_NAMES="unrelated-container-1"
  run provision_db "$COMPOSE_DIR"
  [ "$status" -eq 1 ]
}

@test "provision_db requires a compose_dir argument" {
  run provision_db ""
  [ "$status" -eq 1 ]
}
