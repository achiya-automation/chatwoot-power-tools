#!/usr/bin/env bash
# lib/proxy-caddy.sh
#
# Adds the single /chatwoot-addons/* route to an existing host Caddyfile. Ported from the
# awk-anchor technique in the original modules/smart-import/deploy/set-import-tool.sh
# (proven in production): insert a new `handle_path` block right before Chatwoot's own
# `reverse_proxy <host>:<port> {` line, so Caddy's directive-order handling never lets the
# catch-all proxy shadow our path prefix. The anchor is a generic host:port pattern, not a
# hardcoded 127.0.0.1:3000 — Chatwoot's default, but not guaranteed on every deployment.
#
# Idempotent (grep-guard) and safe: backup -> edit -> validate -> rollback-on-failure ->
# reload -> rollback-and-reload-old-on-failure. Never leaves the Caddyfile in a broken or
# half-migrated state.
#
# Meant to be sourced (`source lib/proxy-caddy.sh`), not executed directly.

# add_route_caddy <caddyfile> <upstream>
#   <upstream> is a host:port reverse_proxy target (e.g. "127.0.0.1:3100"). Prints
#   "already_present" (exit 0) if the route exists already, "added_and_reloaded" (exit 0)
#   on success, or a message on stderr + non-zero exit on any failure (the Caddyfile is
#   left byte-for-byte unchanged in every failure case).
add_route_caddy() {
  local caddyfile="$1" upstream="$2"
  if [ -z "$caddyfile" ] || [ -z "$upstream" ]; then
    echo "add_route_caddy: caddyfile and upstream are required" >&2
    return 1
  fi
  if [ ! -f "$caddyfile" ]; then
    echo "add_route_caddy: ${caddyfile} not found" >&2
    return 1
  fi

  if grep -q 'handle_path /chatwoot-addons/\*' "$caddyfile"; then
    echo "already_present"
    return 0
  fi

  local backup tmp
  backup="${caddyfile}.bak.cwpt.$(date +%s)"
  if ! cp "$caddyfile" "$backup"; then
    echo "add_route_caddy: could not create a backup at ${backup} — aborting without touching ${caddyfile}" >&2
    return 1
  fi

  tmp="$(mktemp)"
  # `|| true`: sourced into install.sh (set -e -o pipefail) — a bare, unguarded awk exit
  # would abort the whole installer before the very next line's own (clearer) failure
  # check ever runs.
  awk -v upstream="$upstream" '
    /^[ \t]*reverse_proxy[ \t]+[^ \t{]+:[0-9]+/ && !done {
      print "    handle_path /chatwoot-addons/* {"
      print "        reverse_proxy " upstream
      print "    }"
      print ""
      done = 1
    }
    { print }
  ' "$caddyfile" > "$tmp" || true

  if ! grep -q 'handle_path /chatwoot-addons/\*' "$tmp"; then
    rm -f "$tmp"
    echo "add_route_caddy: no reverse_proxy <host>:<port> anchor line found in ${caddyfile} — use print_manual_snippet instead" >&2
    return 1
  fi

  if ! cp "$tmp" "$caddyfile"; then
    rm -f "$tmp"
    echo "add_route_caddy: could not write ${caddyfile} (original is untouched; backup at ${backup})" >&2
    return 1
  fi
  rm -f "$tmp"

  if ! caddy validate --config "$caddyfile" --adapter caddyfile >/dev/null 2>&1; then
    echo "add_route_caddy: caddy validate failed — restoring backup" >&2
    cp "$backup" "$caddyfile" || echo "add_route_caddy: RESTORE ALSO FAILED — manually run: cp ${backup} ${caddyfile}" >&2
    return 1
  fi

  if ! caddy reload --config "$caddyfile" >/dev/null 2>&1; then
    echo "add_route_caddy: caddy reload failed — restoring backup and reloading" >&2
    cp "$backup" "$caddyfile" || echo "add_route_caddy: RESTORE ALSO FAILED — manually run: cp ${backup} ${caddyfile}" >&2
    caddy reload --config "$caddyfile" >/dev/null 2>&1 || true
    return 1
  fi

  echo "added_and_reloaded"
}
