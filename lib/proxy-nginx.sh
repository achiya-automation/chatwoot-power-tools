#!/usr/bin/env bash
# lib/proxy-nginx.sh
#
# Adds the single /chatwoot-addons/* route to an existing nginx server block, for
# deployments that front Chatwoot with nginx instead of Caddy (Caddy-on-host is the
# primary, empirically-verified path — docs/superpowers/discovery-2026-07-03.md — nginx is
# the secondary one). Same safety contract as lib/proxy-caddy.sh: idempotent (grep-guard),
# backup -> edit -> validate (`nginx -t`) -> rollback-on-failure -> reload ->
# rollback-and-reload-old-on-failure.
#
# Assumes <conf> is already `include`d by the running nginx's main config (a site file
# under conf.d/ or sites-enabled/, the common layout) so `nginx -s reload` picks it up;
# install.sh is responsible for pointing at such a file (or falling back to
# print_manual_snippet when it can't find one).
#
# Meant to be sourced (`source lib/proxy-nginx.sh`), not executed directly.

# add_route_nginx <conf> <upstream>
#   <upstream> is a host:port proxy_pass target (e.g. "127.0.0.1:3100"). Prints
#   "already_present" (exit 0) if the route exists already, "added_and_reloaded" (exit 0)
#   on success, or a message on stderr + non-zero exit on any failure (the conf file is
#   left byte-for-byte unchanged in every failure case).
add_route_nginx() {
  local conf="$1" upstream="$2"
  if [ -z "$conf" ] || [ -z "$upstream" ]; then
    echo "add_route_nginx: conf and upstream are required" >&2
    return 1
  fi
  if [ ! -f "$conf" ]; then
    echo "add_route_nginx: ${conf} not found" >&2
    return 1
  fi

  if grep -q 'location /chatwoot-addons/' "$conf"; then
    echo "already_present"
    return 0
  fi

  local backup tmp
  backup="${conf}.bak.cwpt.$(date +%s)"
  if ! cp "$conf" "$backup"; then
    echo "add_route_nginx: could not create a backup at ${backup} — aborting without touching ${conf}" >&2
    return 1
  fi

  tmp="$(mktemp)"
  # `|| true`: sourced into install.sh (set -e -o pipefail) — a bare, unguarded awk exit
  # would abort the whole installer before the very next line's own (clearer) failure
  # check ever runs.
  awk -v upstream="$upstream" '
    /^[ \t]*location[ \t]+\/[ \t]*\{/ && !done {
      print "    location /chatwoot-addons/ {"
      print "        proxy_pass http://" upstream "/;"
      print "        proxy_set_header Host $host;"
      print "        proxy_set_header X-Real-IP $remote_addr;"
      print "    }"
      print ""
      done = 1
    }
    { print }
  ' "$conf" > "$tmp" || true

  if ! grep -q 'location /chatwoot-addons/' "$tmp"; then
    rm -f "$tmp"
    echo "add_route_nginx: no 'location / {' anchor line found in ${conf} — use print_manual_snippet instead" >&2
    return 1
  fi

  if ! cp "$tmp" "$conf"; then
    rm -f "$tmp"
    echo "add_route_nginx: could not write ${conf} (original is untouched; backup at ${backup})" >&2
    return 1
  fi
  rm -f "$tmp"

  # `nginx -t` (NOT `-t -c "$conf"`): $conf is a server-block include (conf.d/*.conf or
  # sites-enabled/*), not a standalone config — `-c` on it fails with "server directive is
  # not allowed here" and would make auto-edit fall back to manual on every run. `nginx -t`
  # validates the real running config, which already `include`s our edited file.
  if ! nginx -t >/dev/null 2>&1; then
    echo "add_route_nginx: nginx -t failed — restoring backup" >&2
    cp "$backup" "$conf" || echo "add_route_nginx: RESTORE ALSO FAILED — manually run: cp ${backup} ${conf}" >&2
    return 1
  fi

  if ! nginx -s reload >/dev/null 2>&1; then
    echo "add_route_nginx: nginx reload failed — restoring backup and reloading" >&2
    cp "$backup" "$conf" || echo "add_route_nginx: RESTORE ALSO FAILED — manually run: cp ${backup} ${conf}" >&2
    nginx -s reload >/dev/null 2>&1 || true
    return 1
  fi

  echo "added_and_reloaded"
}
