#!/usr/bin/env bash
# lib/proxy-snippet.sh
#
# Fallback for any reverse proxy install.sh can't safely edit automatically (Traefik's
# routing lives in labels or a dynamic-config file with no single canonical location to
# anchor on; "none" means nothing was detected at all). Prints a ready-to-paste block for
# the single /chatwoot-addons/* route so the operator can wire it in manually — never
# touches any file.
#
# Meant to be sourced (`source lib/proxy-snippet.sh`), not executed directly.

# print_manual_snippet <proxy_type> <upstream>
#   <proxy_type> is typically the output of detect_reverse_proxy (traefik | nginx |
#   caddy-host | caddy-docker | none) but any unrecognized value falls back to a generic
#   block. <upstream> is a host:port target (e.g. "127.0.0.1:3100"). Always exits 0.
print_manual_snippet() {
  local proxy_type="$1" upstream="$2"

  case "$proxy_type" in
    traefik)
      cat <<EOF
# Traefik has no single Caddyfile/nginx.conf install.sh can edit safely. Add labels like
# these to the container/service that should receive /chatwoot-addons/* (or the
# equivalent in your dynamic-config file), then let Traefik pick them up:
labels:
  - "traefik.http.routers.chatwoot-addons.rule=PathPrefix(\`/chatwoot-addons\`)"
  - "traefik.http.services.chatwoot-addons.loadbalancer.server.url=http://${upstream}"
EOF
      ;;
    nginx)
      cat <<EOF
# Add this location block inside the server {} block in front of Chatwoot, then
# validate (nginx -t) and reload (nginx -s reload):
location /chatwoot-addons/ {
    proxy_pass http://${upstream}/;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
}
EOF
      ;;
    caddy-host|caddy-docker)
      cat <<EOF
# Add this block to your Caddyfile (before Chatwoot's own reverse_proxy line), then
# validate (caddy validate) and reload (caddy reload):
handle_path /chatwoot-addons/* {
    reverse_proxy ${upstream}
}
EOF
      ;;
    *)
      cat <<EOF
# No supported reverse proxy was detected automatically. Add a rule in front of
# Chatwoot that forwards the single path prefix /chatwoot-addons/* to:
#   ${upstream}
# The exact syntax depends on your proxy — see docs/hosting.md for worked examples.
EOF
      ;;
  esac
}
