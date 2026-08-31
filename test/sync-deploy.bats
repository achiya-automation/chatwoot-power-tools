#!/usr/bin/env bats

setup() {
  REPO="$(cd "$(dirname "$BATS_TEST_DIRNAME")" && pwd)"
  export CWPT_SYNC_SERVERS_LIBRARY_ONLY=1
  set --
  # shellcheck source=modules/sequences/deploy/sync-servers.sh
  source "$REPO/modules/sequences/deploy/sync-servers.sh"
}

make_full_modular_payload() {
  local payload="$1"
  mkdir -p "$payload/modules/sequences/engine/src" \
           "$payload/modules/sequences/engine/migrations" \
           "$payload/modules/sequences/webapp/dist/smart-import" \
           "$payload/modules/smart-import/inject" \
           "$payload/modules/dashboard-enhancements/parts"
  echo index > "$payload/modules/sequences/engine/src/index.js"
  echo dockerfile > "$payload/modules/sequences/engine/Dockerfile"
  echo migration > "$payload/modules/sequences/engine/migrations/001.sql"
  echo webapp > "$payload/modules/sequences/webapp/dist/index.html"
  echo import-bundle > "$payload/modules/sequences/webapp/dist/smart-import/import-tool.js"
  echo import-inject > "$payload/modules/smart-import/inject/import-button.js"
  echo dashboard > "$payload/modules/dashboard-enhancements/parts/campaign-modal.js"
  echo compose > "$payload/docker-compose.addons.yml"
}

@test "sync deploy resolves owner migrations for flat, legacy modular and managed modular layouts" {
  [ "$(remote_engine_migrations flat)" = "/opt/chatwoot/engine/migrations" ]
  [ "$(remote_engine_migrations modular)" = "/opt/chatwoot/chatwoot-power-tools/modules/sequences/engine/migrations" ]
  [ "$(remote_engine_migrations modular-managed)" = "/opt/chatwoot/chatwoot-power-tools/.cwpt-runtime/modules/sequences/engine/migrations" ]
  [ "$(remote_engine_src modular-managed)" = "/opt/chatwoot/chatwoot-power-tools/.cwpt-runtime/modules/sequences/engine/src" ]
}

@test "layout classification trusts managed build context for repair and rejects checkout/root contradictions" {
  managed_context="/opt/chatwoot/chatwoot-power-tools/.cwpt-runtime/modules/sequences"
  root_context="/opt/chatwoot/chatwoot-power-tools/modules/sequences"
  [ "$(classify_layout_facts "$managed_context" 1 0 1 0)" = "modular-managed" ]
  [[ "$(classify_layout_facts "$root_context" 1 0 1 0)" == conflict:* ]]
  [ "$(classify_layout_facts "" 0 0 1 0)" = "modular" ]
  [[ "$(classify_layout_facts "" 1 0 1 0)" == conflict:* ]]
}

@test "managed modular rebuild uses the isolated runtime compose file" {
  capture="$BATS_TEST_TMPDIR/ssh-command"
  ssh() { printf '%s\n' "$*" > "$capture"; }
  head_md5() { printf '%s' same; }
  remote_md5() { printf '%s' same; }
  ok() { :; }

  rebuild_engine chatwoot_admon modular-managed

  grep -q "chatwoot-power-tools/.cwpt-runtime/docker-compose.addons.yml" "$capture"
  grep -q "up -d --build --no-deps cwpt-engine" "$capture"
}

@test "sync accepts the complete managed module selection" {
  ssh() { printf '%s\n' 'sequences,enhancements,import'; }
  ok() { :; }

  assert_sync_module_selection example.invalid modular-managed
}

@test "sync refuses a modular subset before it can deploy unselected code" {
  ssh() { printf '%s\n' 'import'; }

  run assert_sync_module_selection example.invalid modular-managed

  [ "$status" -ne 0 ]
  [[ "$output" == *"supports only the complete module set"* ]]
  [[ "$output" == *"install.sh"* ]]
}

@test "managed sync rejects a missing module key while legacy modular keeps the all-modules fallback" {
  ssh() { :; }
  ok() { :; }

  run assert_sync_module_selection example.invalid modular-managed
  [ "$status" -ne 0 ]
  [[ "$output" == *"missing CWPT_ENABLED_MODULES"* ]]

  assert_sync_module_selection example.invalid modular
}

@test "remote runtime EXIT trap restores the exact previous runtime on an unhandled mid-install failure" {
  root="$BATS_TEST_TMPDIR/runtime"
  payload="$BATS_TEST_TMPDIR/payload"
  archive="$BATS_TEST_TMPDIR/runtime.tgz"
  mkdir -p "$root/modules/old"
  make_full_modular_payload "$payload"
  mkdir -p "$payload/modules/new"
  echo old-runtime > "$root/modules/old/sentinel"
  echo old-compose > "$root/docker-compose.addons.yml"
  echo new-runtime > "$payload/modules/new/sentinel"
  echo new-compose > "$payload/docker-compose.addons.yml"
  tar -C "$payload" -czf "$archive" modules docker-compose.addons.yml

  CWPT_SWAP_FAIL_UNHANDLED_DURING_INSTALL=1 run bash "$REPO/modules/sequences/deploy/remote-swap-runtime.sh" modular "$root" "$archive"

  [ "$status" -ne 0 ]
  [ "$(cat "$root/modules/old/sentinel")" = "old-runtime" ]
  [ "$(cat "$root/docker-compose.addons.yml")" = "old-compose" ]
  [ ! -e "$root/modules/new" ]
}

@test "remote runtime swap validates then installs a complete managed archive" {
  root="$BATS_TEST_TMPDIR/runtime"
  payload="$BATS_TEST_TMPDIR/payload"
  archive="$BATS_TEST_TMPDIR/runtime.tgz"
  mkdir -p "$root/modules/old"
  make_full_modular_payload "$payload"
  mkdir -p "$payload/modules/new"
  echo old-runtime > "$root/modules/old/sentinel"
  echo old-compose > "$root/docker-compose.addons.yml"
  echo new-runtime > "$payload/modules/new/sentinel"
  echo new-compose > "$payload/docker-compose.addons.yml"
  tar -C "$payload" -czf "$archive" modules docker-compose.addons.yml

  run bash "$REPO/modules/sequences/deploy/remote-swap-runtime.sh" modular "$root" "$archive"

  [ "$status" -eq 0 ]
  [ "$(cat "$root/modules/new/sentinel")" = "new-runtime" ]
  [ "$(cat "$root/docker-compose.addons.yml")" = "new-compose" ]
  [ ! -e "$root/modules/old" ]
  [ -z "$(find "$root" -maxdepth 1 -name '.cwpt-sync-*' -print -quit)" ]
}

@test "sync deploy applies owner migrations before rebuilding the engine" {
  selection_line="$(grep -n '^[[:space:]]*assert_sync_module_selection "\$server" "\$layout"' "$REPO/modules/sequences/deploy/sync-servers.sh" | head -n 1 | cut -d: -f1)"
  drift_line="$(grep -n 'check_drift "\$server" "\$layout"; drift_state=' "$REPO/modules/sequences/deploy/sync-servers.sh" | head -n 1 | cut -d: -f1)"
  deploy_line="$(grep -n '^[[:space:]]*deploy_engine "\$server" "\$layout"' "$REPO/modules/sequences/deploy/sync-servers.sh" | cut -d: -f1)"
  apply_line="$(grep -n '^[[:space:]]*apply_owner_migrations_remote \"\$server\" \"\$layout\"' "$REPO/modules/sequences/deploy/sync-servers.sh" | cut -d: -f1)"
  patch_line="$(grep -n '^[[:space:]]*deploy_patch \"\$server\"' "$REPO/modules/sequences/deploy/sync-servers.sh" | cut -d: -f1)"
  rebuild_line="$(grep -n '^[[:space:]]*rebuild_engine \"\$server\" \"\$layout\"' "$REPO/modules/sequences/deploy/sync-servers.sh" | cut -d: -f1)"
  [ -n "$selection_line" ]
  [ -n "$drift_line" ]
  [ -n "$deploy_line" ]
  [ -n "$apply_line" ]
  [ -n "$patch_line" ]
  [ -n "$rebuild_line" ]
  [ "$selection_line" -lt "$drift_line" ]
  [ "$selection_line" -lt "$deploy_line" ]
  [ "$deploy_line" -lt "$apply_line" ]
  [ "$apply_line" -lt "$patch_line" ]
  [ "$apply_line" -lt "$rebuild_line" ]
}

@test "owner SQL and ledger marker share one fail-closed transaction" {
  script="$REPO/modules/sequences/deploy/sync-servers.sh"
  grep -q "printf 'BEGIN;" "$script"
  grep -q 'INSERT INTO drip.schema_migrations' "$script"
  grep -q "printf 'COMMIT;" "$script"
  grep -q 'psql -v ON_ERROR_STOP=1' "$script"
  grep -q 'owner migrations failed — engine was not rebuilt' "$script"
}
