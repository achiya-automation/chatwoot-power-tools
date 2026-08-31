#!/usr/bin/env bats

setup() {
  REPO="$(cd "$(dirname "$BATS_TEST_DIRNAME")" && pwd)"
  export CWPT_SYNC_SERVERS_LIBRARY_ONLY=1
  set --
  # shellcheck source=modules/sequences/deploy/sync-servers.sh
  source "$REPO/modules/sequences/deploy/sync-servers.sh"
}

make_flat_tree() {
  local root="$1"
  mkdir -p "$root/engine/src" "$root/engine/migrations" "$root/webapp/dist"
  printf 'source\n' > "$root/engine/src/index.js"
  printf 'migration\n' > "$root/engine/migrations/001.sql"
  printf 'asset\n' > "$root/webapp/dist/index.html"
}

make_container_tree() {
  local root="$1"
  mkdir -p "$root/src" "$root/migrations" "$root/webapp-dist"
  printf 'source\n' > "$root/src/index.js"
  printf 'migration\n' > "$root/migrations/001.sql"
  printf 'asset\n' > "$root/webapp-dist/index.html"
}

@test "remote payload inventory streams its script through ssh stdin" {
  PAYLOAD_ROOT="$BATS_TEST_TMPDIR/flat"
  make_flat_tree "$PAYLOAD_ROOT"
  ssh() {
    [ "$1" = fixture.invalid ] || return 91
    shift
    bash -s -- flat "$PAYLOAD_ROOT"
  }

  run remote_payload_manifest fixture.invalid flat

  [ "$status" -eq 0 ]
  [[ "$output" == *$'\tengine/src/index.js'* ]]
  [[ "$output" == *$'\tengine/migrations/001.sql'* ]]
}

@test "remote container inventory streams Node source through ssh stdin" {
  CONTAINER_ROOT="$BATS_TEST_TMPDIR/container"
  make_container_tree "$CONTAINER_ROOT"
  ssh() {
    [ "$1" = fixture.invalid ] || return 91
    shift
    node - "$CONTAINER_ROOT"
  }

  run remote_container_manifest fixture.invalid cwpt-engine

  [ "$status" -eq 0 ]
  [[ "$output" == *$'\tsrc/index.js'* ]]
  [[ "$output" == *$'\twebapp-dist/index.html'* ]]
}

@test "verified deployment marker reaches ssh stdin and contains only bounded facts" {
  CAPTURE="$BATS_TEST_TMPDIR/marker"
  DEPLOY_COMMIT=0123456789abcdef0123456789abcdef01234567
  manifest=$'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tengine/src/index.js'
  ssh() {
    [ "$1" = fixture.invalid ] || return 91
    shift
    cat > "$CAPTURE"
  }

  run write_deployment_marker fixture.invalid flat "$manifest"

  [ "$status" -eq 0 ]
  grep -Fxq "commit=$DEPLOY_COMMIT" "$CAPTURE"
  grep -Fxq 'layout=flat' "$CAPTURE"
  grep -Eq '^manifest_sha256=[0-9a-f]{64}$' "$CAPTURE"
  [ "$(wc -l < "$CAPTURE" | tr -d '[:space:]')" -eq 3 ]
}

@test "deployment marker is stored outside writable checkouts with strict ownership checks" {
  [ "$(deployment_marker_path modular-managed)" = /opt/chatwoot/.cwpt-state/deployment ]
  grep -Fq '! -L \"\$state\"' "$REPO/modules/sequences/deploy/sync-servers.sh"
  grep -Fq 'stat -c %u:%g:%a' "$REPO/modules/sequences/deploy/sync-servers.sh"
  grep -Fq 'install -d -o root -g root -m 700' "$REPO/modules/sequences/deploy/sync-servers.sh"
  grep -Fq 'install -o root -g root -m 600 /dev/stdin' "$REPO/modules/sequences/deploy/sync-servers.sh"
}
