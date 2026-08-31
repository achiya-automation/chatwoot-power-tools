#!/usr/bin/env bats

setup() {
  REPO="$(cd "$(dirname "$BATS_TEST_DIRNAME")" && pwd)"
  export CWPT_SYNC_SERVERS_LIBRARY_ONLY=1
  set --
  # shellcheck source=modules/sequences/deploy/sync-servers.sh
  source "$REPO/modules/sequences/deploy/sync-servers.sh"

  FIXTURE_REPO="$BATS_TEST_TMPDIR/repository"
  mkdir -p \
    "$FIXTURE_REPO/modules/sequences/engine/src/@scope" \
    "$FIXTURE_REPO/modules/sequences/engine/migrations" \
    "$FIXTURE_REPO/modules/sequences/webapp/dist/assets" \
    "$FIXTURE_REPO/modules/smart-import/inject" \
    "$FIXTURE_REPO/modules/dashboard-enhancements/parts"

  printf '%s\n' 'export const authenticate = () => true;' \
    > "$FIXTURE_REPO/modules/sequences/engine/src/auth.js"
  printf '%s\n' 'export const scoped = true;' \
    > "$FIXTURE_REPO/modules/sequences/engine/src/@scope/A-first.js"
  printf '%s\n' 'export const last = true;' \
    > "$FIXTURE_REPO/modules/sequences/engine/src/z-last.js"
  printf '%s\n' 'SELECT 2;' \
    > "$FIXTURE_REPO/modules/sequences/engine/migrations/002_second.sql"
  printf '%s\n' 'SELECT 10;' \
    > "$FIXTURE_REPO/modules/sequences/engine/migrations/010_tenth.sql"
  printf '%s\n' '<main>fixture</main>' \
    > "$FIXTURE_REPO/modules/sequences/webapp/dist/index.html"
  printf '%s\n' 'window.ZAsset = true;' \
    > "$FIXTURE_REPO/modules/sequences/webapp/dist/assets/Z-last.js"
  printf '%s\n' 'window.aAsset = true;' \
    > "$FIXTURE_REPO/modules/sequences/webapp/dist/assets/a-first.js"
  printf '%s\n' 'window.smartImport = true;' \
    > "$FIXTURE_REPO/modules/smart-import/inject/import-button.js"
  printf '%s\n' 'window.dashboardEnhancements = true;' \
    > "$FIXTURE_REPO/modules/dashboard-enhancements/parts/campaign-modal.js"
  printf '%s\n' 'services: {}' > "$FIXTURE_REPO/docker-compose.addons.yml"

  git -C "$FIXTURE_REPO" init -q
  git -C "$FIXTURE_REPO" config user.name 'Manifest Test'
  git -C "$FIXTURE_REPO" config user.email 'manifest-test@example.invalid'
  git -C "$FIXTURE_REPO" add .
  git -C "$FIXTURE_REPO" commit -qm 'fixture'

  # The committed-manifest helpers intentionally use this global, so point them at the
  # isolated repository rather than the real checkout under test.
  REPO_ROOT="$FIXTURE_REPO"
}

extract_committed_tree() {
  local destination="$1"
  mkdir -p "$destination"
  git -C "$FIXTURE_REPO" archive HEAD | tar -x -C "$destination"
}

payload_manifest_for() {
  local layout="$1" root="$2"
  payload_manifest_script | bash -s -- "$layout" "$root"
}

container_manifest_for() {
  local root="$1"
  container_manifest_script | node - "$root"
}

@test "flat payload manifest exactly matches the committed archive tree" {
  archive_tree="$BATS_TEST_TMPDIR/flat-exact"
  extract_committed_tree "$archive_tree"

  committed="$(committed_payload_manifest HEAD flat)"
  extracted="$(payload_manifest_for flat "$archive_tree/modules/sequences")"

  [ "$extracted" = "$committed" ]
  [[ "$extracted" == *$'\tengine/src/auth.js'* ]]
  [[ "$extracted" == *$'\tengine/migrations/010_tenth.sql'* ]]
  [[ "$extracted" == *$'\twebapp/dist/assets/a-first.js'* ]]
}

@test "flat payload manifest detects source, migration, deletion and extra-file drift" {
  committed="$(committed_payload_manifest HEAD flat)"

  auth_tree="$BATS_TEST_TMPDIR/flat-auth"
  extract_committed_tree "$auth_tree"
  printf '%s\n' 'export const authenticate = () => false;' \
    > "$auth_tree/modules/sequences/engine/src/auth.js"
  [ "$(payload_manifest_for flat "$auth_tree/modules/sequences")" != "$committed" ]

  migration_tree="$BATS_TEST_TMPDIR/flat-migration"
  extract_committed_tree "$migration_tree"
  printf '%s\n' 'SELECT 999;' \
    > "$migration_tree/modules/sequences/engine/migrations/010_tenth.sql"
  [ "$(payload_manifest_for flat "$migration_tree/modules/sequences")" != "$committed" ]

  deletion_tree="$BATS_TEST_TMPDIR/flat-deletion"
  extract_committed_tree "$deletion_tree"
  rm "$deletion_tree/modules/sequences/webapp/dist/assets/a-first.js"
  [ "$(payload_manifest_for flat "$deletion_tree/modules/sequences")" != "$committed" ]

  extra_tree="$BATS_TEST_TMPDIR/flat-extra"
  extract_committed_tree "$extra_tree"
  printf '%s\n' 'window.uncommitted = true;' \
    > "$extra_tree/modules/sequences/webapp/dist/assets/uncommitted.js"
  [ "$(payload_manifest_for flat "$extra_tree/modules/sequences")" != "$committed" ]
}

@test "filesystem payload manifest fails closed on a symlink" {
  archive_tree="$BATS_TEST_TMPDIR/flat-symlink"
  extract_committed_tree "$archive_tree"
  ln -s auth.js "$archive_tree/modules/sequences/engine/src/auth-link.js"

  run payload_manifest_for flat "$archive_tree/modules/sequences"

  [ "$status" -ne 0 ]
}

@test "filesystem payload manifest fails closed on a FIFO special entry" {
  archive_tree="$BATS_TEST_TMPDIR/flat-fifo"
  extract_committed_tree "$archive_tree"
  mkfifo "$archive_tree/modules/sequences/webapp/dist/assets/stream.pipe"

  run payload_manifest_for flat "$archive_tree/modules/sequences"

  [ "$status" -ne 0 ]
}

@test "modular payload manifest exactly matches the complete committed archive tree" {
  archive_tree="$BATS_TEST_TMPDIR/modular-exact"
  extract_committed_tree "$archive_tree"

  committed="$(committed_payload_manifest HEAD modular)"
  extracted="$(payload_manifest_for modular "$archive_tree")"

  [ "$extracted" = "$committed" ]
  [[ "$extracted" == *$'\tmodules/smart-import/inject/import-button.js'* ]]
  [[ "$extracted" == *$'\tmodules/dashboard-enhancements/parts/campaign-modal.js'* ]]
  [[ "$extracted" == *$'\tdocker-compose.addons.yml'* ]]
}

@test "committed manifests reject a tracked symlink instead of hashing its target text" {
  ln -s auth.js "$FIXTURE_REPO/modules/sequences/engine/src/auth-link.js"
  git -C "$FIXTURE_REPO" add modules/sequences/engine/src/auth-link.js
  git -C "$FIXTURE_REPO" commit -qm 'add unsafe symlink'

  run committed_payload_manifest HEAD modular
  [ "$status" -ne 0 ]

  run committed_container_manifest HEAD
  [ "$status" -ne 0 ]
}

@test "container and committed manifests match with bytewise path ordering" {
  archive_tree="$BATS_TEST_TMPDIR/container-archive"
  container_tree="$BATS_TEST_TMPDIR/container-root"
  extract_committed_tree "$archive_tree"
  mkdir -p "$container_tree/src" "$container_tree/migrations" "$container_tree/webapp-dist"
  cp -R "$archive_tree/modules/sequences/engine/src/." "$container_tree/src/"
  cp -R "$archive_tree/modules/sequences/engine/migrations/." "$container_tree/migrations/"
  cp -R "$archive_tree/modules/sequences/webapp/dist/." "$container_tree/webapp-dist/"

  committed="$(committed_container_manifest HEAD)"
  running="$(container_manifest_for "$container_tree")"
  paths="$(printf '%s\n' "$running" | cut -f2)"
  sorted_paths="$(printf '%s\n' "$paths" | LC_ALL=C sort)"

  [ "$running" = "$committed" ]
  [ "$paths" = "$sorted_paths" ]
  [ "$(printf '%s\n' "$paths" | wc -l | tr -d '[:space:]')" -eq 8 ]
  [[ "$paths" == *$'src/@scope/A-first.js'* ]]
  [[ "$paths" == *$'webapp-dist/assets/Z-last.js'* ]]
}
