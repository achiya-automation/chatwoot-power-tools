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
  export CWPT_MIGRATION_WAIT_ATTEMPTS=1
  export CWPT_MIGRATION_WAIT_SLEEP_SECONDS=0
  unset MOCK_ROLE_EXISTS MOCK_COMPOSE_PS_EMPTY MOCK_DOCKER_PS_NAMES MOCK_CID_POSTGRES \
        MOCK_POSTGRES_CONTAINER MOCK_PSQL_EXIT MOCK_ENGINE_MIGRATIONS_READY \
        MOCK_PSQL_MIGRATION_READY_EXIT MOCK_PSQL_CAPTURE

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

@test "provision_db self-heals .env when the role exists but CWPT_DATABASE_URL is missing" {
  # Interrupted first run (or hand-edited .env): role exists, but .env has no URL. A plain
  # re-run must repair it (reset the unrecoverable password + rewrite the URL), not leave a
  # crash-looping engine. This is the idempotency guarantee for the role-exists path.
  export MOCK_ROLE_EXISTS=1
  run provision_db "$COMPOSE_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *"role_already_exists"* ]]
  [[ "$output" != *"role_created"* ]]
  [[ "$output" == *"env_self_healed"* ]]
  grep -q '^CWPT_DATABASE_URL=postgres://drip_engine:' "$COMPOSE_DIR/.env"
}

@test "provision_db self-heals an explicitly blank import-only database credential" {
  export MOCK_ROLE_EXISTS=1
  echo "CWPT_DATABASE_URL=" >> "$COMPOSE_DIR/.env"
  run provision_db "$COMPOSE_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *"env_self_healed"* ]]
  [ "$(grep -c '^CWPT_DATABASE_URL=' "$COMPOSE_DIR/.env")" -eq 1 ]
  grep -q '^CWPT_DATABASE_URL=postgres://drip_engine:' "$COMPOSE_DIR/.env"
}

@test "provision_db does not self-heal or duplicate when role exists AND url already present" {
  export MOCK_ROLE_EXISTS=1
  echo "CWPT_DATABASE_URL=postgres://drip_engine:existingpw@postgres:5432/chatwoot" >> "$COMPOSE_DIR/.env"
  run provision_db "$COMPOSE_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *"role_already_exists"* ]]
  [[ "$output" != *"env_self_healed"* ]]
  [ "$(grep -c '^CWPT_DATABASE_URL=' "$COMPOSE_DIR/.env")" -eq 1 ]
}

@test "provision_db always (re)applies grants even when the role already exists" {
  export MOCK_ROLE_EXISTS=1
  run provision_db "$COMPOSE_DIR"
  [[ "$output" == *"grants_applied"* ]]
  [[ "$output" == *"PROVISION_DONE"* ]]
}

@test "a newly-created role replaces a stale CWPT_DATABASE_URL without duplicating it" {
  echo "CWPT_DATABASE_URL=postgres://drip_engine:oldpw@postgres:5432/chatwoot" >> "$COMPOSE_DIR/.env"
  run provision_db "$COMPOSE_DIR"
  [[ "$output" == *"env_rewritten"* ]]
  [ "$(grep -c '^CWPT_DATABASE_URL=' "$COMPOSE_DIR/.env")" -eq 1 ]
  ! grep -q 'oldpw' "$COMPOSE_DIR/.env"
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

@test "db.sh grants UPDATE on channel_whatsapp template columns" {
  grep -q "UPDATE (message_templates, message_templates_last_updated) ON public.channel_whatsapp" lib/db.sh
}

@test "db.sh grants read-only access needed to prove an active inbox bot" {
  grep -q "GRANT SELECT ON public.agent_bot_inboxes TO drip_engine" lib/db.sh
}

@test "dashboard-only provisioning is additive until replacement engine starts" {
  export MOCK_PSQL_CAPTURE="$BATS_TEST_TMPDIR/psql.capture"
  run provision_db "$COMPOSE_DIR" enhancements
  [ "$status" -eq 0 ]
  grep -q 'public.campaigns' "$MOCK_PSQL_CAPTURE"
  grep -q 'public.contacts' "$MOCK_PSQL_CAPTURE"
  ! grep -q 'GRANT UPDATE (custom_attributes)' "$MOCK_PSQL_CAPTURE"
  ! grep -q 'GRANT UPDATE (message_templates' "$MOCK_PSQL_CAPTURE"
  ! grep -q 'REVOKE UPDATE (custom_attributes)' "$MOCK_PSQL_CAPTURE"
}

@test "dashboard-only finalization revokes sequence privileges and invalidates owner markers" {
  export MOCK_PSQL_CAPTURE="$BATS_TEST_TMPDIR/finalize.capture"
  run finalize_db_module_privileges "$COMPOSE_DIR" enhancements
  [ "$status" -eq 0 ]
  [[ "$output" == *"dashboard_privileges_finalized"* ]]
  grep -q 'REVOKE UPDATE (custom_attributes)' "$MOCK_PSQL_CAPTURE"
  grep -q 'REVOKE UPDATE (message_templates, message_templates_last_updated)' "$MOCK_PSQL_CAPTURE"
  grep -q 'REVOKE SELECT ON public.accounts' "$MOCK_PSQL_CAPTURE"
  grep -q 'REVOKE SELECT ON public.agent_bot_inboxes' "$MOCK_PSQL_CAPTURE"
  grep -q 'REVOKE EXECUTE ON FUNCTION drip.ensure_account_bot(integer)' "$MOCK_PSQL_CAPTURE"
  grep -q 'REVOKE EXECUTE ON FUNCTION drip.ensure_journey_webhook(integer,text)' "$MOCK_PSQL_CAPTURE"
  grep -q "DELETE FROM drip.schema_migrations" "$MOCK_PSQL_CAPTURE"
  grep -q '053_presence_role_grants.sql' "$MOCK_PSQL_CAPTURE"
}

@test "import-only finalization revokes all public access, owner functions and markers" {
  export MOCK_ROLE_EXISTS=1
  export MOCK_PSQL_CAPTURE="$BATS_TEST_TMPDIR/import-finalize.capture"
  run finalize_db_module_privileges "$COMPOSE_DIR" import
  [ "$status" -eq 0 ]
  [[ "$output" == *"import_privileges_finalized"* ]]
  grep -q 'REVOKE CREATE ON DATABASE' "$MOCK_PSQL_CAPTURE"
  grep -q 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public' "$MOCK_PSQL_CAPTURE"
  grep -q 'REVOKE UPDATE (custom_attributes)' "$MOCK_PSQL_CAPTURE"
  grep -q 'REVOKE EXECUTE ON FUNCTION drip.ensure_account_bot(integer)' "$MOCK_PSQL_CAPTURE"
  grep -q '051_campaign_recipients_role_grants.sql' "$MOCK_PSQL_CAPTURE"
  grep -q '053_presence_role_grants.sql' "$MOCK_PSQL_CAPTURE"
}

@test "fresh import-only finalization is a safe no-op when the role does not exist" {
  run finalize_db_module_privileges "$COMPOSE_DIR" import
  [ "$status" -eq 0 ]
  [[ "$output" == *"import_privileges_already_absent"* ]]
}

@test "apply_owner_migrations deterministically applies and records 024, 033, 051 and 053" {
  run apply_owner_migrations "$COMPOSE_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *"owner_migration_applied:024_auto_onboard_role_grants.sql"* ]]
  [[ "$output" == *"owner_migration_applied:033_journeys_role_grants.sql"* ]]
  [[ "$output" == *"owner_migration_applied:051_campaign_recipients_role_grants.sql"* ]]
  [[ "$output" == *"owner_migration_applied:053_presence_role_grants.sql"* ]]
  [[ "$output" == *"OWNER_MIGRATIONS_DONE"* ]]

  line_024="$(printf '%s\n' "$output" | grep -n 'owner_migration_applied:024_' | cut -d: -f1)"
  line_033="$(printf '%s\n' "$output" | grep -n 'owner_migration_applied:033_' | cut -d: -f1)"
  line_051="$(printf '%s\n' "$output" | grep -n 'owner_migration_applied:051_' | cut -d: -f1)"
  line_053="$(printf '%s\n' "$output" | grep -n 'owner_migration_applied:053_' | cut -d: -f1)"
  [ "$line_024" -lt "$line_033" ]
  [ "$line_033" -lt "$line_051" ]
  [ "$line_051" -lt "$line_053" ]
}

@test "dashboard-only applies only campaign recipient owner grant after its own schema" {
  run apply_owner_migrations "$COMPOSE_DIR" enhancements
  [ "$status" -eq 0 ]
  [[ "$output" == *"owner_migration_applied:051_campaign_recipients_role_grants.sql"* ]]
  [[ "$output" != *"024_auto_onboard"* ]]
  [[ "$output" != *"033_journeys"* ]]
  [[ "$output" != *"053_presence"* ]]
  [[ "$output" == *"OWNER_MIGRATIONS_DONE"* ]]
}

@test "campaign recipients owner migration fails closed when the Chatwoot table is missing" {
  grep -q "RAISE EXCEPTION 'Chatwoot schema is missing public.campaign_recipients" \
    "$REPO/modules/sequences/engine/migrations/051_campaign_recipients_role_grants.sql"
}

@test "apply_owner_migrations fails before applying grants when engine schema is not ready" {
  export MOCK_ENGINE_MIGRATIONS_READY=0
  run apply_owner_migrations "$COMPOSE_DIR"
  [ "$status" -eq 1 ]
  [[ "$output" == *"engine schema did not reach"* ]]
  [[ "$output" != *"owner_migration_applied"* ]]
}

@test "apply_owner_migrations propagates an owner SQL failure" {
  export MOCK_PSQL_EXIT=1
  run apply_owner_migrations "$COMPOSE_DIR"
  [ "$status" -eq 1 ]
  [[ "$output" == *"024_auto_onboard_role_grants.sql failed"* ]]
  [[ "$output" != *"OWNER_MIGRATIONS_DONE"* ]]
}
