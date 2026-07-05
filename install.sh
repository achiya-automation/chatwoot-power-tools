#!/usr/bin/env bash
# install.sh — chatwoot-power-tools installer.
#
# Run ON the self-hosted Chatwoot host, as root/sudo (docker on both discovery hosts
# requires it — docs/superpowers/discovery-2026-07-03.md). Detects the environment
# dynamically (lib/detect.sh) — nothing here is specific to any one deployment.
#
# Flow: parse flags -> preflight -> detect environment -> provision DB role/schema ->
# copy modules/ into the compose dir -> write addons env vars -> `docker compose up` the
# engine -> add the single /chatwoot-addons/* proxy route -> inject the dashboard script
# -> verify. `--dry-run` prints this plan (using best-effort real detection where
# possible) and performs zero side effects; `--uninstall` reverses steps 2-6, always
# leaving the provisioned database role/schema in place (a manual DROP is printed, never
# run automatically — data safety over convenience).
#
# IMPORTANT — modules/sequences/webapp/dist is PRE-BUILT and committed to git (it is NOT
# gitignored, unlike modules/smart-import/dist which is a gitignored intermediate). A
# clean `git clone` has no local docker/build step of its own, so the engine's
# Dockerfile (modules/sequences/engine/Dockerfile: `COPY webapp/dist`) needs the real
# built bundle to already be on disk — without it, `docker compose build` fails outright.
# Smart-import's static assets (modules/smart-import/dist/import-tool.js +
# modules/smart-import/vendor/xlsx.mini.min.js) are, for the same reason, pre-merged INTO
# the committed modules/sequences/webapp/dist/smart-import/ rather than merged on the
# target host at install time: the engine's Docker build context is modules/sequences
# only, which cannot reach a sibling modules/smart-import/ directory, so the committed
# copy under webapp/dist is the only way those files ever reach the running container —
# the existing static file server (already serving webapp/dist at "/") then picks them up
# for free, no Dockerfile or engine source change needed. After ANY change under
# modules/sequences/webapp/src or modules/smart-import, rebuild AND re-merge before
# committing:
#   cd modules/sequences/webapp && npm run build
#   cd modules/smart-import && npm run build
#   cp modules/smart-import/dist/import-tool.js modules/smart-import/vendor/xlsx.mini.min.js \
#     modules/sequences/webapp/dist/smart-import/
# (No CI freshness check exists yet for this — a TODO for a follow-up PR; until then this
# is enforced by code review only.)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/detect.sh
source "$HERE/lib/detect.sh"
# shellcheck source=lib/db.sh
source "$HERE/lib/db.sh"
# shellcheck source=lib/proxy-caddy.sh
source "$HERE/lib/proxy-caddy.sh"
# shellcheck source=lib/proxy-nginx.sh
source "$HERE/lib/proxy-nginx.sh"
# shellcheck source=lib/proxy-snippet.sh
source "$HERE/lib/proxy-snippet.sh"
# shellcheck source=lib/inject.sh
source "$HERE/lib/inject.sh"

ADDONS_BASE="/chatwoot-addons"
ENGINE_PORT="3100"
UPSTREAM="127.0.0.1:${ENGINE_PORT}"
# Overridable so a non-standard Caddy install (or a test) can point elsewhere; the vast
# majority of self-hosted Caddy-on-host setups use this path unmodified.
CADDYFILE="${CWPT_CADDYFILE:-/etc/caddy/Caddyfile}"

DRY_RUN=0
DO_UNINSTALL=0
ASSUME_YES=0
MODULES_RAW="all"

_cwpt_usage() {
  cat <<'EOF'
chatwoot-power-tools installer

Usage: install.sh [options]

Options:
  --dry-run          Show the installation plan; make no changes.
  --uninstall        Remove chatwoot-power-tools (route, engine container, dashboard
                      script). The provisioned database role/schema is left in place —
                      a manual DROP is printed, never run automatically.
  --modules=LIST     Comma-separated: all | import,sequences,dashboard (default: all).
                     The FULL desired set, re-applied idempotently — NOT additive. To update
                     an existing install (or add a newly-shipped module), just re-run with no
                     --modules (defaults to all); passing a subset shrinks the injected UI.
  --yes              Do not prompt for confirmation.
  -h, --help         Show this help.

Not for Chatwoot Cloud — self-hosted Docker Compose deployments only.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --uninstall) DO_UNINSTALL=1 ;;
    --yes) ASSUME_YES=1 ;;
    --modules=*) MODULES_RAW="${arg#--modules=}" ;;
    -h|--help) _cwpt_usage; exit 0 ;;
    *)
      echo "install.sh: unknown option '${arg}'" >&2
      _cwpt_usage
      exit 1
      ;;
  esac
done

# _cwpt_resolve_modules <raw>
#   Expands "all" to the full internal module list and translates the user-facing
#   "dashboard" name to assemble_dashboard_script's internal "enhancements" module key
#   (lib/assemble-dashboard-script.sh, already built in Phase 1 — its module vocabulary
#   is import|sequences|enhancements; this installer's user-facing flag spec uses
#   import|sequences|dashboard, so this function is the one place that bridges the two).
#   Prints one resolved (internal) module name per line. Returns 1 with a message on
#   stderr for an unrecognized name — prints nothing in that case.
_cwpt_resolve_modules() {
  local raw="$1" name
  if [ "$raw" = "all" ]; then
    printf 'import\nsequences\nenhancements\n'
    return 0
  fi
  for name in ${raw//,/ }; do
    case "$name" in
      import) echo "import" ;;
      sequences) echo "sequences" ;;
      dashboard) echo "enhancements" ;;
      *)
        echo "install.sh: unknown module '${name}' (expected: import, sequences, dashboard)" >&2
        return 1
        ;;
    esac
  done
}

# _cwpt_preflight
#   Behavioral checks (not an `id -u` identity check) — proves docker is installed, is
#   compose v2, and is actually reachable with our current privileges, rather than
#   assuming "not root" always means "can't run docker" (group membership can grant it).
_cwpt_preflight() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "install.sh: docker is not installed or not on PATH." >&2
    return 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "install.sh: 'docker compose' (v2) is required (checked via 'docker compose version')." >&2
    return 1
  fi
  if ! docker ps >/dev/null 2>&1; then
    echo "install.sh: cannot run docker commands — re-run as root/sudo, or add this user to the docker group." >&2
    return 1
  fi
  return 0
}

# _cwpt_upsert_env_var <file> <KEY> <value>
#   Non-secret config upsert: replaces an existing `^KEY=` line or appends one. Unlike
#   provision_db's CWPT_DATABASE_URL (a secret, left alone once set since the password
#   can't be recovered), these values are safe to keep in sync with the environment on
#   every run (e.g. FRONTEND_URL changing after a domain migration).
_cwpt_upsert_env_var() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$(mktemp)"
  if [ -f "$file" ]; then
    grep -v "^${key}=" "$file" > "$tmp" || true
  fi
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

# _cwpt_write_addons_env <compose_dir>
#   Writes CWPT_PUBLIC_BASE_URL (derived from Chatwoot's own FRONTEND_URL — MUST be an
#   absolute https:// origin, or Meta can't fetch WhatsApp template media; see
#   modules/sequences/engine/src/config.js) and CWPT_CHATWOOT_BASE_URL. CWPT_DATABASE_URL
#   is provision_db's own responsibility (lib/db.sh) since it owns the secret's lifecycle.
#
#   CWPT_CHATWOOT_BASE_URL's host is the rails container's actual name, from
#   detect_service_container (same detection lib/inject.sh already uses to `docker exec`
#   into it) — Docker's embedded DNS resolves a container by its real name on the shared
#   compose network just as reliably as by its compose service alias, and this way a
#   deployment whose rails service isn't literally named "rails" still gets a working
#   value instead of a hardcoded guess. Falls back to the literal "rails" (the compose
#   service name Chatwoot's own docker-compose.yml uses, confirmed on both discovery
#   hosts — docs/superpowers/discovery-2026-07-03.md) when detection fails for any reason
#   (docker unreachable at this point, container not up yet, etc) — never fatal.
_cwpt_write_addons_env() {
  local compose_dir="$1"
  local env_file="${compose_dir}/.env"
  local frontend_url=""
  frontend_url="$(read_env_var "$compose_dir" FRONTEND_URL)" || frontend_url=""
  frontend_url="${frontend_url%/}"

  if [ -z "$frontend_url" ]; then
    echo "  WARNING: FRONTEND_URL not found in ${env_file}." >&2
    echo "    CWPT_PUBLIC_BASE_URL could not be derived automatically — WhatsApp template" >&2
    echo "    media URLs will be broken until you set it manually in ${env_file}:" >&2
    echo "    CWPT_PUBLIC_BASE_URL=https://<your-chatwoot-domain>${ADDONS_BASE}" >&2
  else
    _cwpt_upsert_env_var "$env_file" CWPT_PUBLIC_BASE_URL "${frontend_url}${ADDONS_BASE}"
    echo "  CWPT_PUBLIC_BASE_URL=${frontend_url}${ADDONS_BASE}"
  fi

  local rails_host="rails"
  local detected_rails=""
  detected_rails="$(detect_service_container "$compose_dir" rails)" || detected_rails=""
  [ -n "$detected_rails" ] && rails_host="$detected_rails"

  _cwpt_upsert_env_var "$env_file" CWPT_CHATWOOT_BASE_URL "http://${rails_host}:3000"
  echo "  CWPT_CHATWOOT_BASE_URL=http://${rails_host}:3000"

  # Absolute build context for docker-compose.addons.yml's ${CWPT_BUILD_CONTEXT}. docker
  # compose resolves a relative build context against the project directory (the Chatwoot
  # compose dir), NOT against the -f file's location — so modules copied under
  # chatwoot-power-tools/ would otherwise be looked for one level too high. An absolute
  # path sidesteps that entirely.
  _cwpt_upsert_env_var "$env_file" CWPT_BUILD_CONTEXT "${compose_dir}/chatwoot-power-tools/modules/sequences"
  echo "  CWPT_BUILD_CONTEXT=${compose_dir}/chatwoot-power-tools/modules/sequences"
}

# _cwpt_find_nginx_conf
#   Best-effort search for an nginx server-block file already `include`d by the running
#   nginx (so a reload picks up our edit). Prints the first match, or nothing (exit 1).
_cwpt_find_nginx_conf() {
  local candidates=(/etc/nginx/conf.d/chatwoot.conf /etc/nginx/sites-enabled/chatwoot /etc/nginx/sites-enabled/default /etc/nginx/nginx.conf)
  local c
  for c in "${candidates[@]}"; do
    if [ -f "$c" ]; then
      printf '%s\n' "$c"
      return 0
    fi
  done
  return 1
}

# _cwpt_add_route <proxy_type>
#   Dispatches to the matching lib/proxy-*.sh function; falls back to
#   print_manual_snippet whenever auto-editing isn't possible or fails, so the operator
#   always gets a copyable block instead of a silent gap.
_cwpt_add_route() {
  local proxy_type="$1"
  case "$proxy_type" in
    caddy-host)
      if [ -f "$CADDYFILE" ]; then
        if ! add_route_caddy "$CADDYFILE" "$UPSTREAM"; then
          echo "install.sh: could not edit ${CADDYFILE} automatically — manual step needed:" >&2
          print_manual_snippet "$proxy_type" "$UPSTREAM"
        fi
      else
        echo "install.sh: caddy detected but ${CADDYFILE} not found — manual step needed:" >&2
        print_manual_snippet "$proxy_type" "$UPSTREAM"
      fi
      ;;
    nginx)
      local nginx_conf=""
      nginx_conf="$(_cwpt_find_nginx_conf)" || nginx_conf=""
      if [ -n "$nginx_conf" ]; then
        if ! add_route_nginx "$nginx_conf" "$UPSTREAM"; then
          echo "install.sh: could not edit ${nginx_conf} automatically — manual step needed:" >&2
          print_manual_snippet "$proxy_type" "$UPSTREAM"
        fi
      else
        echo "install.sh: nginx detected but no editable server config found — manual step needed:" >&2
        print_manual_snippet "$proxy_type" "$UPSTREAM"
      fi
      ;;
    *)
      echo "install.sh: no auto-editable reverse proxy detected (${proxy_type}) — manual step needed:" >&2
      print_manual_snippet "$proxy_type" "$UPSTREAM"
      ;;
  esac
}

# _cwpt_remove_route <proxy_type>
#   Best-effort reversal of _cwpt_add_route, for --uninstall. Only caddy-host is
#   auto-editable (matching _cwpt_add_route); everything else prints a manual reminder.
_cwpt_remove_route() {
  local proxy_type="$1"
  case "$proxy_type" in
    caddy-host)
      if [ -f "$CADDYFILE" ] && grep -q 'handle_path /chatwoot-addons/\*' "$CADDYFILE" 2>/dev/null; then
        local backup tmp
        backup="${CADDYFILE}.bak.cwpt-uninstall.$(date +%s)"
        if ! cp "$CADDYFILE" "$backup"; then
          echo "  WARNING: could not back up ${CADDYFILE} — skipping automatic route removal" >&2
          return 1
        fi
        tmp="$(mktemp)"
        # 3-state machine so the round trip is byte-for-byte clean: state 1 = inside the
        # block (added by add_route_caddy, suppress every line); state 2 = just consumed
        # the block's closing "}" — also swallow exactly one blank line after it (the
        # blank line add_route_caddy always inserts following the block), if present,
        # then resume normal printing either way.
        awk '
          state == 1 {
            if ($0 ~ /^[ \t]*\}[ \t]*$/) state = 2
            next
          }
          state == 2 {
            state = 0
            if ($0 ~ /^[ \t]*$/) next
          }
          /handle_path \/chatwoot-addons\/\*/ { state = 1; next }
          { print }
        ' "$CADDYFILE" > "$tmp" || true
        if ! cp "$tmp" "$CADDYFILE"; then
          rm -f "$tmp"
          echo "  WARNING: could not write ${CADDYFILE} — original left untouched" >&2
          return 1
        fi
        rm -f "$tmp"
        if caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
          caddy reload --config "$CADDYFILE" >/dev/null 2>&1 || true
          echo "  route removed from ${CADDYFILE}"
        else
          echo "  WARNING: could not cleanly remove the route block — restoring backup" >&2
          cp "$backup" "$CADDYFILE" || echo "  RESTORE ALSO FAILED — manually run: cp ${backup} ${CADDYFILE}" >&2
        fi
      else
        echo "  no /chatwoot-addons/* route found in ${CADDYFILE} (nothing to remove)"
      fi
      ;;
    *)
      echo "  route removal for '${proxy_type}' is manual — remove the /chatwoot-addons/* block yourself."
      ;;
  esac
}

# _cwpt_verify
#   Loopback health check against the engine (bypasses the proxy — confirms the
#   container itself booted correctly). A non-200 is reported, never fatal on its own:
#   the install already completed; this is a diagnostic, not a rollback trigger.
_cwpt_verify() {
  local code="000" i
  # Retry ~10×/2s: the engine was just built and started; it needs a moment to boot and run
  # its migrations before it answers 200. A single immediate curl races on a perfectly
  # healthy install (false negative) AND never catches a genuine crash-loop.
  for i in $(seq 1 10); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${ENGINE_PORT}/drip-api/health" 2>/dev/null)" || code="000"
    [ "$code" = "200" ] && break
    sleep 2
  done
  if [ "$code" = "200" ]; then
    echo "  engine health check: OK (200)"
  else
    echo "  engine health check: got HTTP ${code} after ~20s (expected 200) — check 'docker logs cwpt-engine'" >&2
  fi
}

# _cwpt_print_plan
#   The --dry-run contract: best-effort REAL detection (never fatal if docker/caddy is
#   absent or misbehaves — this must work identically whether run on a bare laptop with
#   no docker at all, or on the real target server), zero side effects, always exit 0
#   (module-name validation errors excepted — those are a usage mistake, not an
#   environment problem, and are reported the same way in a real run too).
_cwpt_print_plan() {
  echo "*** DRY RUN — no changes will be made ***"
  echo

  if [ "$DO_UNINSTALL" -eq 1 ]; then
    echo "Mode: uninstall"
    echo
    echo "Would remove:"
    echo "  - the /chatwoot-addons/* reverse-proxy route"
    echo "  - the cwpt-engine container"
    echo "  - the injected DASHBOARD_SCRIPTS entry"
    echo
    echo "The 'drip_engine' database role/schema would be LEFT IN PLACE (manual cleanup only)."
    return 0
  fi

  local modules_output=""
  if ! modules_output="$(_cwpt_resolve_modules "$MODULES_RAW")"; then
    exit 1
  fi
  if [ -z "$modules_output" ]; then
    echo "install.sh: at least one module must be selected (--modules=all|import,sequences,dashboard)" >&2
    exit 1
  fi
  echo "Modules requested: ${MODULES_RAW} -> $(printf '%s' "$modules_output" | tr '\n' ' ')"
  echo

  local compose_dir=""
  compose_dir="$(detect_compose_dir 2>/dev/null)" || compose_dir=""
  if [ -n "$compose_dir" ]; then
    echo "Detected Chatwoot compose directory: ${compose_dir}"
  else
    echo "Chatwoot compose directory: NOT DETECTED in this environment"
    echo "  (a real run searches 'docker compose ls' + /opt/chatwoot, /root/chatwoot, /srv/chatwoot, /data/chatwoot, then aborts if still not found)"
  fi

  local proxy_type="none"
  proxy_type="$(detect_reverse_proxy 2>/dev/null)" || proxy_type="none"
  echo "Detected reverse proxy: ${proxy_type}"
  echo

  echo "Would perform, in order:"
  echo "  1. Provision least-privilege 'drip_engine' DB role + schema in Chatwoot's Postgres"
  echo "  2. Copy modules/ + docker-compose.addons.yml to <compose_dir>/chatwoot-power-tools/"
  echo "  3. Write CWPT_DATABASE_URL / CWPT_CHATWOOT_BASE_URL / CWPT_PUBLIC_BASE_URL to .env"
  echo "  4. docker compose up -d --build cwpt-engine"
  echo "  5. Add the single route /chatwoot-addons/* (via ${proxy_type}) -> ${UPSTREAM}"
  echo "  6. Inject the dashboard script (modules: $(printf '%s' "$modules_output" | tr '\n' ' '))"
  echo "  7. Verify: engine health check + route reachability"
}

# _cwpt_do_install
#   The real (non-dry-run) install flow.
_cwpt_do_install() {
  local modules_output=""
  if ! modules_output="$(_cwpt_resolve_modules "$MODULES_RAW")"; then
    exit 1
  fi
  if [ -z "$modules_output" ]; then
    echo "install.sh: at least one module must be selected (--modules=all|import,sequences,dashboard)" >&2
    exit 1
  fi
  local -a modules_arr=()
  local m
  while IFS= read -r m; do
    [ -n "$m" ] && modules_arr+=("$m")
  done <<< "$modules_output"

  _cwpt_preflight || exit 1

  echo "==> Detecting environment"
  local compose_dir=""
  if ! compose_dir="$(detect_compose_dir)"; then
    echo "install.sh: could not find a self-hosted Chatwoot docker-compose directory." >&2
    echo "  Looked via 'docker compose ls' and common paths (/opt/chatwoot, /root/chatwoot, /srv/chatwoot, /data/chatwoot)." >&2
    exit 1
  fi
  echo "  compose dir: ${compose_dir}"

  local proxy_type="none"
  proxy_type="$(detect_reverse_proxy)" || proxy_type="none"
  echo "  reverse proxy: ${proxy_type}"
  echo "  modules: ${modules_arr[*]}"

  if [ "$ASSUME_YES" -ne 1 ]; then
    printf 'Install chatwoot-power-tools into %s ? [y/N] ' "$compose_dir"
    local reply=""
    read -r reply || reply=""
    case "$reply" in
      y|Y|yes|YES) ;;
      *) echo "Aborted. (Running non-interactively, e.g. via 'curl | bash'? Pass --yes.)"; exit 1 ;;
    esac
  fi

  echo "==> Provisioning database role/schema"
  if ! provision_db "$compose_dir"; then
    echo "install.sh: provision_db failed" >&2
    exit 1
  fi

  echo "==> Copying modules into the compose directory"
  local target="${compose_dir}/chatwoot-power-tools"
  mkdir -p "$target"
  # Clear the previously-copied modules + compose file first, so anything DELETED or renamed
  # between versions doesn't linger (tar-extract overwrites existing files but never removes
  # gone ones). Critical for migrations — a stale .sql left behind would still be run by
  # migrate.js. Scoped to these two paths only: dashboard_scripts.prev.bak (the uninstall
  # backup) also lives under $target and must survive an update.
  rm -rf "${target}/modules" "${target}/docker-compose.addons.yml"
  # tar (not cp -R): excludes node_modules (the Dockerfile runs its own `npm install`
  # inside the build, so the host's node_modules — possibly built for a different
  # platform — is both unnecessary and slow to copy) while still copying both the
  # modules/ directory and docker-compose.addons.yml in one shot.
  if ! (tar --exclude='node_modules' --exclude='.preview' -C "$HERE" -cf - modules docker-compose.addons.yml \
        | tar -C "$target" -xf -); then
    echo "install.sh: failed to copy modules/ into ${target}" >&2
    exit 1
  fi
  # No on-host merge step needed here: modules/sequences/webapp/dist/smart-import/ is
  # already pre-merged and committed (see this file's header comment) — the tar copy
  # above brought it along for free, and the Dockerfile's `COPY webapp/dist` picks it up
  # regardless of which --modules were selected.

  echo "==> Writing addons environment variables"
  _cwpt_write_addons_env "$compose_dir"

  echo "==> Building and starting cwpt-engine"
  local project=""
  project="$(_cwpt_detect_compose_project "$compose_dir")"
  if ! (cd "$compose_dir" && docker compose -f docker-compose.yml -f chatwoot-power-tools/docker-compose.addons.yml -p "$project" up -d --build cwpt-engine); then
    echo "install.sh: docker compose up failed for cwpt-engine" >&2
    exit 1
  fi

  echo "==> Adding the /chatwoot-addons/* route"
  _cwpt_add_route "$proxy_type"

  echo "==> Injecting the dashboard script"
  if ! inject_dashboard_script "$compose_dir" "$ADDONS_BASE" "${modules_arr[@]}"; then
    echo "install.sh: inject_dashboard_script failed" >&2
    exit 1
  fi

  echo "==> Verifying installation"
  _cwpt_verify

  echo
  echo "chatwoot-power-tools installed. Refresh Chatwoot in your browser — the new entries should appear."
}

# _cwpt_do_uninstall
#   Reverses steps 2-6 of _cwpt_do_install. Always leaves the drip_engine role/schema in
#   place (a schema DROP is destructive and irreversible — the operator decides that).
_cwpt_do_uninstall() {
  _cwpt_preflight || exit 1

  echo "==> Locating the Chatwoot compose directory"
  local compose_dir=""
  if ! compose_dir="$(detect_compose_dir)"; then
    echo "install.sh: could not find the Chatwoot compose directory." >&2
    exit 1
  fi
  echo "  compose dir: ${compose_dir}"

  if [ "$ASSUME_YES" -ne 1 ]; then
    printf 'Remove chatwoot-power-tools from %s ? [y/N] ' "$compose_dir"
    local reply=""
    read -r reply || reply=""
    case "$reply" in
      y|Y|yes|YES) ;;
      *) echo "Aborted. (Running non-interactively, e.g. via 'curl | bash'? Pass --yes.)"; exit 1 ;;
    esac
  fi

  local target="${compose_dir}/chatwoot-power-tools"
  local project=""
  project="$(_cwpt_detect_compose_project "$compose_dir")"

  echo "==> Stopping and removing the cwpt-engine container"
  if [ -f "${target}/docker-compose.addons.yml" ]; then
    (cd "$compose_dir" && docker compose -f docker-compose.yml -f chatwoot-power-tools/docker-compose.addons.yml -p "$project" rm -sf cwpt-engine) >/dev/null 2>&1 || true
  fi

  echo "==> Removing the /chatwoot-addons/* route"
  local proxy_type="none"
  proxy_type="$(detect_reverse_proxy)" || proxy_type="none"
  _cwpt_remove_route "$proxy_type"

  echo "==> Removing chatwoot-power-tools' block from the dashboard script"
  # remove_dashboard_script (lib/inject.sh) strips ONLY our own CWPT:START/END block —
  # DASHBOARD_SCRIPTS may hold operator content unrelated to chatwoot-power-tools, so this
  # is never a blind `InstallationConfig#destroy` of the whole value (see lib/inject.sh's
  # header comment). A best-effort backup of the pre-removal value is always written to
  # <compose_dir>/chatwoot-power-tools/dashboard_scripts.prev.bak first.
  remove_dashboard_script "$compose_dir" || echo "  WARNING: could not clear DASHBOARD_SCRIPTS automatically" >&2

  echo "==> Removing copied files"
  rm -rf "$target"

  echo
  echo "chatwoot-power-tools removed."
  echo "NOTE: the following were deliberately left in place (data safety over convenience):"
  echo "  - the 'drip_engine' database role and 'drip' schema. To remove them manually,"
  echo "    run inside the postgres container:"
  echo "      DROP SCHEMA IF EXISTS drip CASCADE; DROP ROLE IF EXISTS drip_engine;"
  echo "  - the 'cwpt_media' docker volume (uploaded WhatsApp template media)."
  echo "    Remove it manually once you're sure it's no longer needed:"
  echo "      docker volume rm ${project}_cwpt_media"
}

main() {
  if [ "$DRY_RUN" -eq 1 ]; then
    _cwpt_print_plan
    exit 0
  fi

  if [ "$DO_UNINSTALL" -eq 1 ]; then
    _cwpt_do_uninstall
  else
    _cwpt_do_install
  fi
}

main
