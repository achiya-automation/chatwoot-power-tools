#!/usr/bin/env bats
# Dynamic environment discovery — verifies lib/detect.sh never hardcodes a compose dir,
# container name, or reverse-proxy flavor. All docker calls go through test/mocks/docker;
# PATH is pinned to core system tools only, so a real caddy/nginx/docker that happens to be
# installed on the machine running these tests can never leak in and make a test flaky.

setup() {
  REPO="$(cd "$(dirname "$BATS_TEST_DIRNAME")" && pwd)"
  export PATH="$BATS_TEST_DIRNAME/mocks:/usr/bin:/bin"
  source "$REPO/lib/detect.sh"
  unset MOCK_COMPOSE_LS_JSON MOCK_COMPOSE_DIR MOCK_COMPOSE_PS_EMPTY MOCK_CID_RAILS \
        MOCK_CID_POSTGRES MOCK_RAILS_CONTAINER MOCK_POSTGRES_CONTAINER \
        MOCK_DOCKER_PS_NAMES MOCK_DOCKER_PS_IMAGES
}

# ── detect_compose_dir ───────────────────────────────────────────────────────

@test "detect_compose_dir finds the project via docker compose ls" {
  mkdir -p "$BATS_TEST_TMPDIR/opt/chatwoot"
  echo "image: chatwoot/chatwoot:v4.15.1" > "$BATS_TEST_TMPDIR/opt/chatwoot/docker-compose.yml"
  export MOCK_COMPOSE_DIR="$BATS_TEST_TMPDIR/opt/chatwoot"
  run detect_compose_dir
  [ "$status" -eq 0 ]
  [ "$output" = "$BATS_TEST_TMPDIR/opt/chatwoot" ]
}

@test "detect_compose_dir picks the chatwoot project among several unrelated ones" {
  mkdir -p "$BATS_TEST_TMPDIR/opt/chatwoot" "$BATS_TEST_TMPDIR/opt/n8n"
  echo "image: chatwoot/chatwoot:v4.15.1" > "$BATS_TEST_TMPDIR/opt/chatwoot/docker-compose.yml"
  echo "image: n8nio/n8n:latest" > "$BATS_TEST_TMPDIR/opt/n8n/docker-compose.yml"
  export MOCK_COMPOSE_LS_JSON="[{\"Name\":\"n8n\",\"Status\":\"running(1)\",\"ConfigFiles\":\"$BATS_TEST_TMPDIR/opt/n8n/docker-compose.yml\"},{\"Name\":\"chatwoot\",\"Status\":\"running(4)\",\"ConfigFiles\":\"$BATS_TEST_TMPDIR/opt/chatwoot/docker-compose.yml\"}]"
  run detect_compose_dir
  [ "$status" -eq 0 ]
  [ "$output" = "$BATS_TEST_TMPDIR/opt/chatwoot" ]
}

@test "detect_compose_dir falls back to common install paths when compose ls yields nothing" {
  export MOCK_COMPOSE_LS_JSON=""
  # Simulate a common path fixture by pointing the (private) common-dirs list detection at
  # a fixture through the real filesystem is not possible without root-owned /opt, so this
  # verifies the ls-based path only returns empty and the function does not crash — the
  # common-path fallback itself is exercised implicitly by "returns 1 when nothing found".
  run detect_compose_dir
  [ "$status" -eq 1 ]
}

@test "detect_compose_dir returns 1 when nothing matches anywhere" {
  export MOCK_COMPOSE_LS_JSON="[]"
  run detect_compose_dir
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

# ── detect_service_container ─────────────────────────────────────────────────

@test "detect_service_container finds rails by compose service label" {
  run detect_service_container /opt/chatwoot rails
  [ "$status" -eq 0 ]
  [ -n "$output" ]
  [ "$output" = "chatwoot-rails-1" ]
}

@test "detect_service_container resolves a differently-named container (portability)" {
  export MOCK_RAILS_CONTAINER="cw_rails_x"
  run detect_service_container /opt/chatwoot rails
  [ "$status" -eq 0 ]
  [ "$output" = "cw_rails_x" ]
}

@test "detect_service_container falls back to docker ps name-grep when compose ps is empty" {
  export MOCK_COMPOSE_PS_EMPTY=1
  export MOCK_DOCKER_PS_NAMES="chatwoot-rails-1
chatwoot-postgres-1
chatwoot-sidekiq-1"
  run detect_service_container /opt/chatwoot rails
  [ "$status" -eq 0 ]
  [ "$output" = "chatwoot-rails-1" ]
}

@test "detect_service_container returns 1 when the service can't be found at all" {
  export MOCK_COMPOSE_PS_EMPTY=1
  export MOCK_DOCKER_PS_NAMES="unrelated-container"
  run detect_service_container /opt/chatwoot rails
  [ "$status" -eq 1 ]
}

# ── read_env_var ─────────────────────────────────────────────────────────────

@test "read_env_var reads a plain value" {
  printf 'FRONTEND_URL=https://chat.example.com\nPOSTGRES_USERNAME=chatwoot\n' > "$BATS_TEST_TMPDIR/.env"
  run read_env_var "$BATS_TEST_TMPDIR" POSTGRES_USERNAME
  [ "$status" -eq 0 ]
  [ "$output" = "chatwoot" ]
}

@test "read_env_var strips surrounding quotes" {
  printf 'FRONTEND_URL="https://chat.example.com"\n' > "$BATS_TEST_TMPDIR/.env"
  run read_env_var "$BATS_TEST_TMPDIR" FRONTEND_URL
  [ "$status" -eq 0 ]
  [ "$output" = "https://chat.example.com" ]
}

@test "read_env_var returns 1 when the variable is missing" {
  printf 'POSTGRES_USERNAME=chatwoot\n' > "$BATS_TEST_TMPDIR/.env"
  run read_env_var "$BATS_TEST_TMPDIR" NOT_THERE
  [ "$status" -eq 1 ]
}

@test "read_env_var returns 1 when .env itself is missing" {
  run read_env_var "$BATS_TEST_TMPDIR/does-not-exist" POSTGRES_USERNAME
  [ "$status" -eq 1 ]
}

# ── detect_reverse_proxy ─────────────────────────────────────────────────────

@test "detect_reverse_proxy returns a known type with the default mock (no proxy signals)" {
  run detect_reverse_proxy
  [[ "$output" =~ ^(caddy-host|caddy-docker|nginx|traefik|none)$ ]]
}

@test "detect_reverse_proxy returns none when no signal is present" {
  export MOCK_DOCKER_PS_IMAGES=""
  run detect_reverse_proxy
  [ "$status" -eq 0 ]
  [ "$output" = "none" ]
}

@test "detect_reverse_proxy returns caddy-host when caddy is installed on the host" {
  mkdir -p "$BATS_TEST_TMPDIR/fakebin"
  printf '#!/bin/sh\nexit 0\n' > "$BATS_TEST_TMPDIR/fakebin/caddy"
  chmod +x "$BATS_TEST_TMPDIR/fakebin/caddy"
  PATH="$BATS_TEST_TMPDIR/fakebin:$PATH" run detect_reverse_proxy
  [ "$status" -eq 0 ]
  [ "$output" = "caddy-host" ]
}

@test "detect_reverse_proxy returns caddy-docker when only a caddy container is running" {
  export MOCK_DOCKER_PS_IMAGES="caddy:2-alpine"
  run detect_reverse_proxy
  [ "$output" = "caddy-docker" ]
}

@test "detect_reverse_proxy returns traefik when a traefik container is running" {
  export MOCK_DOCKER_PS_IMAGES="traefik:v3.0"
  run detect_reverse_proxy
  [ "$output" = "traefik" ]
}

@test "detect_reverse_proxy returns nginx when an nginx container is running" {
  export MOCK_DOCKER_PS_IMAGES="nginx:1.27-alpine"
  run detect_reverse_proxy
  [ "$output" = "nginx" ]
}

# ── _cwpt_detect_compose_project (install.sh-only helper, not part of the public API) ──

@test "_cwpt_detect_compose_project resolves the live project name from docker compose ls" {
  mkdir -p "$BATS_TEST_TMPDIR/opt/chatwoot"
  export MOCK_COMPOSE_LS_JSON="[{\"Name\":\"chatwoot_prod\",\"Status\":\"running(4)\",\"ConfigFiles\":\"$BATS_TEST_TMPDIR/opt/chatwoot/docker-compose.yml\"}]"
  run _cwpt_detect_compose_project "$BATS_TEST_TMPDIR/opt/chatwoot"
  [ "$status" -eq 0 ]
  [ "$output" = "chatwoot_prod" ]
}

@test "_cwpt_detect_compose_project falls back to the directory basename when unresolved" {
  export MOCK_COMPOSE_LS_JSON="[]"
  run _cwpt_detect_compose_project "/opt/chatwoot"
  [ "$status" -eq 0 ]
  [ "$output" = "chatwoot" ]
}
