#!/usr/bin/env bats
# lib/proxy-caddy.sh + lib/proxy-nginx.sh + lib/proxy-snippet.sh — the single
# /chatwoot-addons/* route, added idempotently with backup -> validate -> rollback (and
# rollback again if reload itself fails). caddy/nginx are mocked
# (test/mocks/reverse-proxy/) so no real reverse proxy is ever touched.

setup() {
  REPO="$(cd "$(dirname "$BATS_TEST_DIRNAME")" && pwd)"
  export PATH="$BATS_TEST_DIRNAME/mocks/reverse-proxy:/usr/bin:/bin"
  source "$REPO/lib/proxy-caddy.sh"
  source "$REPO/lib/proxy-nginx.sh"
  source "$REPO/lib/proxy-snippet.sh"
  unset MOCK_CADDY_VALIDATE_EXIT MOCK_CADDY_RELOAD_EXIT MOCK_NGINX_TEST_EXIT MOCK_NGINX_RELOAD_EXIT

  CF="$BATS_TEST_TMPDIR/Caddyfile"
  NG="$BATS_TEST_TMPDIR/nginx.conf"
  cp "$REPO/test/fixtures/Caddyfile" "$CF"
  cp "$REPO/test/fixtures/nginx.conf" "$NG"
}

# ── add_route_caddy ──────────────────────────────────────────────────────────

@test "add_route_caddy inserts a handle_path block before the app's reverse_proxy" {
  run add_route_caddy "$CF" "127.0.0.1:3100"
  [ "$status" -eq 0 ]
  grep -q "handle_path /chatwoot-addons/\*" "$CF"
  grep -q "reverse_proxy 127.0.0.1:3100" "$CF"
  # order: our block must appear BEFORE the original Chatwoot reverse_proxy line
  addons_line="$(grep -n 'handle_path /chatwoot-addons/\*' "$CF" | head -1 | cut -d: -f1)"
  rails_line="$(grep -n 'reverse_proxy 127\.0\.0\.1:3000' "$CF" | head -1 | cut -d: -f1)"
  [ "$addons_line" -lt "$rails_line" ]
}

@test "add_route_caddy is idempotent" {
  add_route_caddy "$CF" "127.0.0.1:3100"
  add_route_caddy "$CF" "127.0.0.1:3100"
  run grep -c "handle_path /chatwoot-addons/\*" "$CF"
  [ "$output" -eq 1 ]
}

@test "add_route_caddy backs up the original file before editing" {
  add_route_caddy "$CF" "127.0.0.1:3100"
  run bash -c "ls '$BATS_TEST_TMPDIR'/Caddyfile.bak.cwpt.* 2>/dev/null | wc -l"
  [ "$(echo "$output" | tr -d ' ')" -ge 1 ]
}

@test "add_route_caddy rolls back when caddy validate fails" {
  export MOCK_CADDY_VALIDATE_EXIT=1
  before="$(cat "$CF")"
  run add_route_caddy "$CF" "127.0.0.1:3100"
  [ "$status" -ne 0 ]
  after="$(cat "$CF")"
  [ "$before" = "$after" ]
  ! grep -q "chatwoot-addons" "$CF"
}

@test "add_route_caddy rolls back when caddy reload fails" {
  export MOCK_CADDY_RELOAD_EXIT=1
  before="$(cat "$CF")"
  run add_route_caddy "$CF" "127.0.0.1:3100"
  [ "$status" -ne 0 ]
  after="$(cat "$CF")"
  [ "$before" = "$after" ]
}

@test "add_route_caddy fails cleanly when no reverse_proxy anchor exists" {
  echo "empty.example.com { respond \"hi\" }" > "$BATS_TEST_TMPDIR/NoAnchor"
  run add_route_caddy "$BATS_TEST_TMPDIR/NoAnchor" "127.0.0.1:3100"
  [ "$status" -ne 0 ]
  ! grep -q "chatwoot-addons" "$BATS_TEST_TMPDIR/NoAnchor"
}

@test "add_route_caddy requires both arguments" {
  run add_route_caddy "$CF" ""
  [ "$status" -ne 0 ]
}

# ── add_route_nginx ──────────────────────────────────────────────────────────

@test "add_route_nginx inserts a location block for the addons prefix" {
  run add_route_nginx "$NG" "127.0.0.1:3100"
  [ "$status" -eq 0 ]
  grep -q "location /chatwoot-addons/" "$NG"
  grep -q "proxy_pass http://127.0.0.1:3100" "$NG"
}

@test "add_route_nginx is idempotent" {
  add_route_nginx "$NG" "127.0.0.1:3100"
  add_route_nginx "$NG" "127.0.0.1:3100"
  run grep -c "location /chatwoot-addons/" "$NG"
  [ "$output" -eq 1 ]
}

@test "add_route_nginx rolls back when nginx -t fails" {
  export MOCK_NGINX_TEST_EXIT=1
  before="$(cat "$NG")"
  run add_route_nginx "$NG" "127.0.0.1:3100"
  [ "$status" -ne 0 ]
  after="$(cat "$NG")"
  [ "$before" = "$after" ]
}

@test "add_route_nginx rolls back when nginx reload fails" {
  export MOCK_NGINX_RELOAD_EXIT=1
  before="$(cat "$NG")"
  run add_route_nginx "$NG" "127.0.0.1:3100"
  [ "$status" -ne 0 ]
  after="$(cat "$NG")"
  [ "$before" = "$after" ]
}

# ── print_manual_snippet ─────────────────────────────────────────────────────

@test "print_manual_snippet emits a copyable block for traefik" {
  run print_manual_snippet traefik "127.0.0.1:3100"
  [[ "$output" == *"chatwoot-addons"* ]]
  [[ "$output" == *"127.0.0.1:3100"* ]]
}

@test "print_manual_snippet emits a copyable block for nginx" {
  run print_manual_snippet nginx "127.0.0.1:3100"
  [[ "$output" == *"chatwoot-addons"* ]]
  [[ "$output" == *"proxy_pass"* ]]
}

@test "print_manual_snippet emits a copyable block for unknown/none proxy types" {
  run print_manual_snippet none "127.0.0.1:3100"
  [ "$status" -eq 0 ]
  [[ "$output" == *"chatwoot-addons"* ]]
}
