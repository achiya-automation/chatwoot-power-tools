#!/usr/bin/env bats

setup() {
  REPO="$(cd "$(dirname "$BATS_TEST_DIRNAME")" && pwd)"
  SCRIPT="$REPO/modules/sequences/deploy/sync-servers.sh"
  LIB="$BATS_TEST_TMPDIR/sync-lib.sh"
  sed '/^# ── run ─/,$d' "$SCRIPT" > "$LIB"
}

make_scratch_repo() {
  local root="$1"
  mkdir -p "$root/modules/sequences/engine/src" \
    "$root/modules/sequences/engine/migrations" \
    "$root/modules/sequences/webapp/dist" \
    "$root/modules/sequences/deploy/chatwoot-initializers" \
    "$root/modules/smart-import/dist"
  git -C "$root" init -q
  git -C "$root" config user.email test@example.invalid
  git -C "$root" config user.name test
  printf 'COMMITTED\n' > "$root/modules/sequences/engine/src/campaigns.js"
  printf 'CSV\n' > "$root/modules/sequences/engine/src/campaignCsv.js"
  printf 'SELECT 1;\n' > "$root/modules/sequences/engine/migrations/001_init.sql"
  printf 'WEBAPP\n' > "$root/modules/sequences/webapp/dist/index.html"
  printf '# initializer\n' > "$root/modules/sequences/deploy/chatwoot-initializers/a.rb"
  printf 'modules/smart-import/dist/\n' > "$root/.gitignore"
  printf 'COMPOSE_COMMITTED\n' > "$root/docker-compose.addons.yml"
  git -C "$root" add -A
  git -C "$root" commit -qm init
}

@test "archive is one pinned commit and includes the committed addons compose file" {
  SCRATCH="$BATS_TEST_TMPDIR/repo"
  make_scratch_repo "$SCRATCH"
  PINNED="$(git -C "$SCRATCH" rev-parse HEAD)"

  # Neither tracked edits nor ignored build output may enter the archive.
  printf 'DIRTY\n' > "$SCRATCH/modules/sequences/engine/src/campaigns.js"
  printf 'COMPOSE_DIRTY\n' > "$SCRATCH/docker-compose.addons.yml"
  printf 'IGNORED\n' > "$SCRATCH/modules/smart-import/dist/import-tool.js"

  run bash -c '
    lib="$1"; repo="$2"; pinned="$3"; archive="$4"
    set --
    source "$lib"
    REPO_ROOT="$repo"
    DEPLOY_COMMIT="$pinned"
    build_deploy_archive modular "$archive"
  ' _ "$LIB" "$SCRATCH" "$PINNED" "$BATS_TEST_TMPDIR/payload.tgz"
  [ "$status" -eq 0 ]
  [ "$(tar -xzOf "$BATS_TEST_TMPDIR/payload.tgz" modules/sequences/engine/src/campaigns.js)" = "COMMITTED" ]
  [ "$(tar -xzOf "$BATS_TEST_TMPDIR/payload.tgz" docker-compose.addons.yml)" = "COMPOSE_COMMITTED" ]
  ! tar -tzf "$BATS_TEST_TMPDIR/payload.tgz" | grep -q 'smart-import/dist'
}

@test "symbolic HEAD moving after pinning cannot mix commits into one payload" {
  SCRATCH="$BATS_TEST_TMPDIR/repo"
  make_scratch_repo "$SCRATCH"
  PINNED="$(git -C "$SCRATCH" rev-parse HEAD)"
  printf 'LATER_COMMIT\n' > "$SCRATCH/modules/sequences/engine/src/campaigns.js"
  git -C "$SCRATCH" add modules/sequences/engine/src/campaigns.js
  git -C "$SCRATCH" commit -qm later

  run bash -c '
    lib="$1"; repo="$2"; pinned="$3"; archive="$4"
    set --
    source "$lib"
    REPO_ROOT="$repo"
    DEPLOY_COMMIT="$pinned"
    build_deploy_archive flat "$archive"
  ' _ "$LIB" "$SCRATCH" "$PINNED" "$BATS_TEST_TMPDIR/payload.tgz"
  [ "$status" -eq 0 ]
  [ "$(tar -xzOf "$BATS_TEST_TMPDIR/payload.tgz" engine/src/campaigns.js)" = "COMMITTED" ]
}

@test "server flag is a closed allowlist before any ssh call" {
  run bash "$SCRIPT" --check --server customer-production
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown server"* ]]
}

@test "failed upload removes the exact local and remote staging paths" {
  SCRATCH="$BATS_TEST_TMPDIR/repo"
  make_scratch_repo "$SCRATCH"
  PINNED="$(git -C "$SCRATCH" rev-parse HEAD)"
  mkdir -p "$BATS_TEST_TMPDIR/local-tmp"
  LOG="$BATS_TEST_TMPDIR/ssh.log"

  run env TEST_LIB="$LIB" TEST_REPO="$SCRATCH" TEST_COMMIT="$PINNED" \
    TEST_TMP="$BATS_TEST_TMPDIR/local-tmp" TEST_LOG="$LOG" bash -c '
      source "$TEST_LIB"
      REPO_ROOT="$TEST_REPO"
      DEPLOY_COMMIT="$TEST_COMMIT"
      DEPLOY_ID="${DEPLOY_COMMIT:0:12}-20260831000000-123"
      TMPDIR="$TEST_TMP"
      ssh() {
        if [[ "$*" == *"mktemp -d /tmp/cwpt-sync."* ]]; then
          printf "/tmp/cwpt-sync.ABC12345\n"
        else
          printf "%s\n" "$*" >> "$TEST_LOG"
        fi
      }
      scp() { return 1; }
      deploy_engine chatwoot flat
    '
  [ "$status" -ne 0 ]
  [ -z "$(find "$BATS_TEST_TMPDIR/local-tmp" -type f -print -quit)" ]
  grep -Fq "rm -rf -- '/tmp/cwpt-sync.ABC12345'" "$LOG"
}

@test "live directories are moved to a scoped backup before staged state replaces them" {
  backup_line="$(grep -n 'mv -- "${targets\[\$i\]}" "\$backup/' "$SCRIPT" | cut -d: -f1)"
  replace_line="$(grep -n 'mv -- "${staged\[\$i\]}" "${targets\[\$i\]}"' "$SCRIPT" | cut -d: -f1)"
  [ -n "$backup_line" ]
  [ -n "$replace_line" ]
  [ "$backup_line" -lt "$replace_line" ]
  grep -Fq 'backup="/opt/chatwoot/backups/cwpt-deploy-${deploy_id}"' "$SCRIPT"
  ! grep -Fq 'sudo rm -rf /opt/chatwoot/engine/src' "$SCRIPT"
  ! grep -Fq 'sudo rm -rf /opt/chatwoot/chatwoot-power-tools/modules' "$SCRIPT"
}
