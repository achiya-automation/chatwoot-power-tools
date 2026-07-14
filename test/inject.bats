#!/usr/bin/env bats
# lib/inject.sh — injects the assembled dashboard-script HTML into Chatwoot's
# DASHBOARD_SCRIPTS InstallationConfig via a local `docker exec ... rails runner` (no ssh —
# this runs ON the Chatwoot host). All docker calls go through test/mocks/docker.

setup() {
  REPO="$(cd "$(dirname "$BATS_TEST_DIRNAME")" && pwd)"
  export PATH="$BATS_TEST_DIRNAME/mocks:/usr/bin:/bin"
  source "$REPO/lib/inject.sh"
  unset MOCK_RAILS_CONTAINER MOCK_COMPOSE_PS_EMPTY MOCK_DOCKER_PS_NAMES MOCK_CID_RAILS \
        MOCK_EXISTING_DASHBOARD_SCRIPTS MOCK_FETCH_DASHBOARD_EXIT MOCK_DOCKER_CP_CAPTURE
}

@test "inject builds a rails-runner command targeting the detected container" {
  export MOCK_RAILS_CONTAINER=cw_rails_x
  run inject_dashboard_script /opt/chatwoot /chatwoot-addons import
  [ "$status" -eq 0 ]
  [[ "$output" == *"cw_rails_x"* ]]
  [[ "$output" == *"DASHBOARD_SCRIPTS"* ]]
}

@test "inject reports success on the standard container name" {
  run inject_dashboard_script /opt/chatwoot /chatwoot-addons import
  [ "$status" -eq 0 ]
  [[ "$output" == *"dashboard_script_injected"* ]]
}

@test "inject cache-busts the smart-import bundle placeholder to a real content hash" {
  # See the base-embedding test above for why we inspect the captured file rather than
  # $output: the assembled HTML is only ever written to a file, never echoed.
  export MOCK_DOCKER_CP_CAPTURE="$BATS_TEST_TMPDIR/captured.html"
  run inject_dashboard_script /opt/chatwoot /chatwoot-addons import
  [ "$status" -eq 0 ]
  ! grep -q '__CWI_VER__' "$MOCK_DOCKER_CP_CAPTURE"
  # import-button.js builds the URL at runtime as ADDONS_BASE + '.../import-tool.js?v=' +
  # ASSET_VER — the placeholder is only ever substituted where ASSET_VER is declared.
  grep -qE "ASSET_VER = '[0-9a-f]{10}'" "$MOCK_DOCKER_CP_CAPTURE"
}

@test "inject embeds the given addons base for the window global" {
  # The base is written into a file that's docker-cp'd into the rails container and read
  # there by Ruby — it never appears as a docker-exec argument, so capture the copied file
  # itself (via the mock's MOCK_DOCKER_CP_CAPTURE) to verify what was actually assembled.
  export MOCK_DOCKER_CP_CAPTURE="$BATS_TEST_TMPDIR/captured.html"
  run inject_dashboard_script /opt/chatwoot /custom-base import
  [ "$status" -eq 0 ]
  grep -q 'window.__CW_ADDONS_BASE="/custom-base"' "$MOCK_DOCKER_CP_CAPTURE"
}

@test "inject supports multiple modules in one call" {
  run inject_dashboard_script /opt/chatwoot /chatwoot-addons import sequences enhancements
  [ "$status" -eq 0 ]
  [[ "$output" == *"DASHBOARD_SCRIPTS"* ]]
}

@test "inject returns 1 when the rails container cannot be detected" {
  export MOCK_COMPOSE_PS_EMPTY=1
  export MOCK_DOCKER_PS_NAMES="unrelated-container-1"
  run inject_dashboard_script /opt/chatwoot /chatwoot-addons import
  [ "$status" -eq 1 ]
}

@test "inject returns 1 and does not touch docker when assemble fails (unknown module)" {
  run inject_dashboard_script /opt/chatwoot /chatwoot-addons totally-unknown-module
  [ "$status" -eq 1 ]
  [[ "$output" != *"MOCK_EXEC"* ]]
}

@test "inject requires compose_dir, base and at least one module" {
  run inject_dashboard_script /opt/chatwoot /chatwoot-addons
  [ "$status" -eq 1 ]
}

# ── DASHBOARD_SCRIPTS is shared: read-merge-write, never a blind overwrite ──────────────

@test "_cwpt_merge_dashboard_scripts appends the new block after existing (non-CWPT) content" {
  run _cwpt_merge_dashboard_scripts '<script>existing_analytics();</script>' \
'<!-- CWPT:START -->
NEW_BLOCK
<!-- CWPT:END -->'
  [ "$status" -eq 0 ]
  [[ "$output" == *"existing_analytics();"*"NEW_BLOCK"* ]]
}

@test "_cwpt_merge_dashboard_scripts uses the new block alone when existing is empty" {
  run _cwpt_merge_dashboard_scripts '' \
'<!-- CWPT:START -->
NEW_BLOCK
<!-- CWPT:END -->'
  [ "$status" -eq 0 ]
  [[ "$output" == *"NEW_BLOCK"* ]]
}

@test "_cwpt_merge_dashboard_scripts uses the new block alone when existing is whitespace-only" {
  run _cwpt_merge_dashboard_scripts '

  ' \
'<!-- CWPT:START -->
NEW_BLOCK
<!-- CWPT:END -->'
  [ "$status" -eq 0 ]
  [[ "$output" == *"NEW_BLOCK"* ]]
}

@test "_cwpt_merge_dashboard_scripts replaces only a previous CWPT block, keeping content around it" {
  run _cwpt_merge_dashboard_scripts \
'<script>before();</script>
<!-- CWPT:START -->
OLD_BLOCK
<!-- CWPT:END -->
<script>after();</script>' \
'<!-- CWPT:START -->
NEW_BLOCK
<!-- CWPT:END -->'
  [ "$status" -eq 0 ]
  [[ "$output" == *"before();"* ]]
  [[ "$output" == *"after();"* ]]
  [[ "$output" == *"NEW_BLOCK"* ]]
  [[ "$output" != *"OLD_BLOCK"* ]]
}

@test "inject appends its block after existing operator DASHBOARD_SCRIPTS content, preserving it" {
  export MOCK_EXISTING_DASHBOARD_SCRIPTS='<script>window.customerAnalytics();</script>'
  export MOCK_DOCKER_CP_CAPTURE="$BATS_TEST_TMPDIR/captured.html"
  run inject_dashboard_script /opt/chatwoot /chatwoot-addons import
  [ "$status" -eq 0 ]
  grep -q 'customerAnalytics' "$MOCK_DOCKER_CP_CAPTURE"
  grep -q 'CWPT:START' "$MOCK_DOCKER_CP_CAPTURE"
  grep -q 'window.__CW_ADDONS_BASE' "$MOCK_DOCKER_CP_CAPTURE"
  # existing operator content must come BEFORE our appended block
  analytics_line="$(grep -n 'customerAnalytics' "$MOCK_DOCKER_CP_CAPTURE" | head -1 | cut -d: -f1)"
  cwpt_line="$(grep -n 'CWPT:START' "$MOCK_DOCKER_CP_CAPTURE" | head -1 | cut -d: -f1)"
  [ "$analytics_line" -lt "$cwpt_line" ]
}

@test "inject replaces only its own previous block on re-run, preserving surrounding operator content" {
  export MOCK_EXISTING_DASHBOARD_SCRIPTS="$(printf '<script>before();</script>\n<!-- CWPT:START -->\n<script>OLD_CWPT_VERSION</script>\n<!-- CWPT:END -->\n<script>after();</script>')"
  export MOCK_DOCKER_CP_CAPTURE="$BATS_TEST_TMPDIR/captured.html"
  run inject_dashboard_script /opt/chatwoot /chatwoot-addons import
  [ "$status" -eq 0 ]
  grep -q 'before();' "$MOCK_DOCKER_CP_CAPTURE"
  grep -q 'after();' "$MOCK_DOCKER_CP_CAPTURE"
  grep -q 'window.__CW_ADDONS_BASE' "$MOCK_DOCKER_CP_CAPTURE"
  ! grep -q 'OLD_CWPT_VERSION' "$MOCK_DOCKER_CP_CAPTURE"
  # exactly one of each marker — the old block was replaced, not duplicated alongside a new one
  [ "$(grep -c 'CWPT:START' "$MOCK_DOCKER_CP_CAPTURE")" -eq 1 ]
  [ "$(grep -c 'CWPT:END' "$MOCK_DOCKER_CP_CAPTURE")" -eq 1 ]
}

@test "inject backs up the previous DASHBOARD_SCRIPTS value before changing it" {
  export MOCK_EXISTING_DASHBOARD_SCRIPTS='<script>legacy_tracking_snippet();</script>'
  run inject_dashboard_script "$BATS_TEST_TMPDIR/opt/chatwoot" /chatwoot-addons import
  [ "$status" -eq 0 ]
  [ -f "$BATS_TEST_TMPDIR/opt/chatwoot/chatwoot-power-tools/dashboard_scripts.prev.bak" ]
  grep -q 'legacy_tracking_snippet' "$BATS_TEST_TMPDIR/opt/chatwoot/chatwoot-power-tools/dashboard_scripts.prev.bak"
}

# ── remove_dashboard_script (--uninstall path) ──────────────────────────────────────────

@test "remove_dashboard_script strips only its own block, preserving surrounding operator content" {
  export MOCK_EXISTING_DASHBOARD_SCRIPTS="$(printf '<script>before();</script>\n<!-- CWPT:START -->\n<script>ours();</script>\n<!-- CWPT:END -->\n<script>after();</script>')"
  export MOCK_DOCKER_CP_CAPTURE="$BATS_TEST_TMPDIR/captured.html"
  run remove_dashboard_script /opt/chatwoot
  [ "$status" -eq 0 ]
  [[ "$output" == *"dashboard_script_block_removed"* ]]
  grep -q 'before();' "$MOCK_DOCKER_CP_CAPTURE"
  grep -q 'after();' "$MOCK_DOCKER_CP_CAPTURE"
  ! grep -q 'CWPT:START' "$MOCK_DOCKER_CP_CAPTURE"
  ! grep -q 'ours();' "$MOCK_DOCKER_CP_CAPTURE"
}

@test "remove_dashboard_script backs up the previous value before removing the block" {
  export MOCK_EXISTING_DASHBOARD_SCRIPTS="$(printf '<script>before();</script>\n<!-- CWPT:START -->\n<script>ours();</script>\n<!-- CWPT:END -->')"
  run remove_dashboard_script "$BATS_TEST_TMPDIR/opt/chatwoot"
  [ "$status" -eq 0 ]
  grep -q 'before();' "$BATS_TEST_TMPDIR/opt/chatwoot/chatwoot-power-tools/dashboard_scripts.prev.bak"
  grep -q 'ours();' "$BATS_TEST_TMPDIR/opt/chatwoot/chatwoot-power-tools/dashboard_scripts.prev.bak"
}

@test "remove_dashboard_script destroys the InstallationConfig row only when nothing is left after removal" {
  export MOCK_EXISTING_DASHBOARD_SCRIPTS="$(printf '<!-- CWPT:START -->\n<script>ours();</script>\n<!-- CWPT:END -->')"
  run remove_dashboard_script /opt/chatwoot
  [ "$status" -eq 0 ]
  [[ "$output" == *"dashboard_script_destroyed"* ]]
}

@test "remove_dashboard_script leaves DASHBOARD_SCRIPTS untouched when no chatwoot-power-tools block is found" {
  export MOCK_EXISTING_DASHBOARD_SCRIPTS='<script>only_operator_content();</script>'
  run remove_dashboard_script /opt/chatwoot
  [ "$status" -eq 0 ]
  [[ "$output" == *"no chatwoot-power-tools block found"* ]]
  [[ "$output" != *"MOCK_EXEC"* ]]
}

@test "remove_dashboard_script reports nothing to remove when DASHBOARD_SCRIPTS is empty" {
  run remove_dashboard_script /opt/chatwoot
  [ "$status" -eq 0 ]
  [[ "$output" == *"dashboard_script_nothing_to_remove"* ]]
  [[ "$output" != *"MOCK_EXEC"* ]]
}

@test "remove_dashboard_script returns 1 when the rails container cannot be detected" {
  export MOCK_COMPOSE_PS_EMPTY=1
  export MOCK_DOCKER_PS_NAMES="unrelated-container-1"
  run remove_dashboard_script /opt/chatwoot
  [ "$status" -eq 1 ]
}

@test "remove_dashboard_script requires a compose_dir argument" {
  run remove_dashboard_script
  [ "$status" -eq 1 ]
}

# ── integrity: the guard against a stored value that no longer matches the code ──────────
# Prod lost the whole campaigns dashboard to a DASHBOARD_SCRIPTS value that had been rewritten
# through a Ruby string, folding a doubled backslash into a single one. Git was clean, the test
# suite was green, and the browser threw a SyntaxError nobody was watching. These tests cover
# the one layer that can see that: the value actually stored in the database.

# Builds a well-formed CWPT block (integrity line first) around <payload>.
_mk_block() {
  local payload="$1" hash
  hash="$(_cwpt_string_hash "$payload")"
  printf '%s\n%s%s%s\n%s\n%s' \
    "$_CWPT_DASHBOARD_MARK_START" \
    "$_CWPT_INTEGRITY_PREFIX" "$hash" "$_CWPT_INTEGRITY_SUFFIX" \
    "$payload" "$_CWPT_DASHBOARD_MARK_END"
}

@test "inject writes an integrity line pinning the payload hash" {
  export MOCK_DOCKER_CP_CAPTURE="$BATS_TEST_TMPDIR/captured.html"
  run inject_dashboard_script /opt/chatwoot /drip enhancements
  [ "$status" -eq 0 ]
  grep -qE '^<!-- cwpt-integrity sha256:[0-9a-f]{64} -->$' "$MOCK_DOCKER_CP_CAPTURE"
}

@test "verify_dashboard_script: intact block → ok" {
  export MOCK_EXISTING_DASHBOARD_SCRIPTS="$(_mk_block '<script>var CARD_SEL = "[class~=\"group/cardLayout\"]";</script>')"
  run verify_dashboard_script /opt/chatwoot
  [ "$status" -eq 0 ]
  [[ "$output" == *"dashboard_script_ok"* ]]
}

@test "verify_dashboard_script: the exact prod corruption (Ruby folds a doubled backslash) → CORRUPT" {
  local payload='<script>document.querySelectorAll(".group\\/cardLayout");</script>'
  local block corrupted
  block="$(_mk_block "$payload")"
  corrupted="${block//\\\\/\\}"   # ← precisely what the DB value suffered
  [ "$corrupted" != "$block" ]    # sanity: the simulation really did change something

  export MOCK_EXISTING_DASHBOARD_SCRIPTS="$corrupted"
  run verify_dashboard_script /opt/chatwoot
  [ "$status" -eq 2 ]
  [[ "$output" == *"dashboard_script_corrupt"* ]]
}

@test "verify_dashboard_script: operator content around the block does not affect the hash" {
  export MOCK_EXISTING_DASHBOARD_SCRIPTS="$(printf '<script>theirs();</script>\n%s\n<script>more();</script>' "$(_mk_block '<script>ours();</script>')")"
  run verify_dashboard_script /opt/chatwoot
  [ "$status" -eq 0 ]
  [[ "$output" == *"dashboard_script_ok"* ]]
}

@test "verify_dashboard_script: pre-integrity block → reported as legacy, never a false all-clear" {
  export MOCK_EXISTING_DASHBOARD_SCRIPTS="$(printf '%s\n<script>old();</script>\n%s' "$_CWPT_DASHBOARD_MARK_START" "$_CWPT_DASHBOARD_MARK_END")"
  run verify_dashboard_script /opt/chatwoot
  [ "$status" -eq 0 ]
  [[ "$output" == *"dashboard_script_legacy_no_integrity_line"* ]]
}

@test "verify_dashboard_script: nothing installed → not_installed" {
  run verify_dashboard_script /opt/chatwoot
  [ "$status" -eq 0 ]
  [[ "$output" == *"dashboard_script_not_installed"* ]]
}
