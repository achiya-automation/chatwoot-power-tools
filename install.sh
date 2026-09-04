#!/usr/bin/env bash
# install.sh — chatwoot-power-tools installer.
#
# Run ON the self-hosted Chatwoot host, as root/sudo (docker on both discovery hosts
# requires it — docs/superpowers/discovery-2026-07-03.md). Detects the environment
# dynamically (lib/detect.sh) — nothing here is specific to any one deployment.
#
# Flow: parse flags -> preflight -> detect environment -> provision DB role/schema when a
# database-backed module is selected -> copy selected artifacts into the compose dir ->
# write addons env vars -> `docker compose up` the engine -> finalize the exact module
# privileges -> apply owner migrations for database-backed modules -> add the single
# /chatwoot-addons/* proxy route -> verify the public deployment identity -> inject the
# dashboard script. `--dry-run` prints this plan (using best-effort real detection where
# possible) and performs zero side effects; `--uninstall` removes deployed artifacts,
# route and dashboard integration, always
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
# ‏CI אוכף את זה: השלב "Verify committed dist matches src" בונה מחדש עם ה-BUILD_ID
# הצרוב ב-dist המחויב ונופל על כל הפרש תוכן.
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
                     --modules (defaults to all). A subset removes unselected artifacts and
                     disables their server routes/background work.
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
  local raw="$1" name internal seen=","
  if [ "$raw" = "all" ]; then
    printf 'import\nsequences\nenhancements\n'
    return 0
  fi
  for name in ${raw//,/ }; do
    case "$name" in
      import) internal="import" ;;
      sequences) internal="sequences" ;;
      dashboard) internal="enhancements" ;;
      *)
        echo "install.sh: unknown module '${name}' (expected: import, sequences, dashboard)" >&2
        return 1
        ;;
    esac
    # A duplicate flag value must not duplicate copied tar members or injected UI blocks.
    # Preserve the operator's first-seen order while emitting each internal module once.
    if [[ "$seen" != *",${internal},"* ]]; then
      echo "$internal"
      seen="${seen}${internal},"
    fi
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

# _cwpt_detect_chatwoot_version <compose_dir>
#   Reads the running Rails container's image tag (or the explicit operator override) and
#   prints a normalized X.Y.Z. We intentionally do not guess for `latest`, digests, or
#   custom unversioned image names: the engine reads public.campaign_recipients directly,
#   which is only part of the supported Chatwoot schema from 4.17.1 onward.
_cwpt_detect_chatwoot_version() {
  local compose_dir="$1" raw="${CWPT_CHATWOOT_VERSION:-}"
  if [ -z "$raw" ]; then
    local rails_container image
    rails_container="$(detect_service_container "$compose_dir" rails)" || return 1
    image="$(docker inspect --format '{{.Config.Image}}' "$rails_container" 2>/dev/null)" || return 1
    [[ "$image" == *@* ]] && return 1
    raw="${image##*:}"
  fi

  # Only a stable release tag proves the requirement. Treat rc/beta/dev/build-suffixed
  # tags as unknown instead of normalizing e.g. 4.17.1-rc.1 into the stable 4.17.1.
  if [[ "$raw" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    printf '%d.%d.%d\n' "$((10#${BASH_REMATCH[1]}))" "$((10#${BASH_REMATCH[2]}))" "$((10#${BASH_REMATCH[3]}))"
    return 0
  fi
  return 1
}

_cwpt_version_at_least() {
  local actual="$1" minimum="$2"
  local a_major a_minor a_patch m_major m_minor m_patch
  IFS=. read -r a_major a_minor a_patch <<< "$actual"
  IFS=. read -r m_major m_minor m_patch <<< "$minimum"
  [ "$a_major" -gt "$m_major" ] ||
    { [ "$a_major" -eq "$m_major" ] && [ "$a_minor" -gt "$m_minor" ]; } ||
    { [ "$a_major" -eq "$m_major" ] && [ "$a_minor" -eq "$m_minor" ] && [ "$a_patch" -ge "$m_patch" ]; }
}

_cwpt_require_supported_chatwoot() {
  local compose_dir="$1" minimum="4.17.1" actual=""
  if ! actual="$(_cwpt_detect_chatwoot_version "$compose_dir")"; then
    echo "install.sh: could not prove the running Chatwoot version." >&2
    echo "  chatwoot-power-tools requires Chatwoot >= ${minimum} (campaign_recipients schema)." >&2
    echo "  If you use an unversioned image tag, verify it and re-run with CWPT_CHATWOOT_VERSION=X.Y.Z." >&2
    return 1
  fi
  if ! _cwpt_version_at_least "$actual" "$minimum"; then
    echo "install.sh: unsupported Chatwoot ${actual}; version ${minimum} or newer is required." >&2
    echo "  Upgrade Chatwoot first. No chatwoot-power-tools changes were made." >&2
    return 1
  fi
  echo "  Chatwoot version: ${actual} (supported)"
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

# _cwpt_write_addons_env <compose_dir> <enabled_modules_csv>
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
  local enabled_modules_csv="$2"
  local managed_target="${3:-${compose_dir}/chatwoot-power-tools}"
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
  _cwpt_upsert_env_var "$env_file" CWPT_BUILD_CONTEXT "${managed_target}/modules/sequences"
  echo "  CWPT_BUILD_CONTEXT=${managed_target}/modules/sequences"

  _cwpt_upsert_env_var "$env_file" CWPT_ENABLED_MODULES "$enabled_modules_csv"
  echo "  CWPT_ENABLED_MODULES=${enabled_modules_csv}"

  # Import-only must not inherit a credential from an earlier sequence/dashboard install.
  # Keep an explicit empty value so Compose cannot fall back to stale host state; a later
  # database-backed expansion self-heals the role password and rewrites this line.
  if [[ ",${enabled_modules_csv}," != *",sequences,"* &&
        ",${enabled_modules_csv}," != *",enhancements,"* ]]; then
    _cwpt_upsert_env_var "$env_file" CWPT_DATABASE_URL ""
    echo "  CWPT_DATABASE_URL=(disabled for import-only)"
  fi

  # Per-run identity proves the public proxy reached THIS replacement container, not an old
  # engine that happens to share the same committed SPA build and module list.
  local deploy_id=""
  if ! deploy_id="$(openssl rand -hex 16 2>/dev/null)" ||
     [[ ! "$deploy_id" =~ ^[0-9a-f]{32}$ ]]; then
    echo "install.sh: could not generate CWPT_DEPLOY_ID" >&2
    return 1
  fi
  _cwpt_upsert_env_var "$env_file" CWPT_DEPLOY_ID "$deploy_id"
  echo "  CWPT_DEPLOY_ID=(generated)"

  # Flow Builder (journeys) real-time hook secret — generated once, never rotated by the
  # installer (rotating would orphan the webhook rows Chatwoot already points at the old
  # path). The path IS the secret; compose composes the full URL from it.
  if [[ ",${enabled_modules_csv}," == *",sequences,"* ]] &&
     ! grep -q '^CWPT_JOURNEY_HOOK_SECRET=' "$env_file" 2>/dev/null; then
    local hook_secret=""
    hook_secret="$(openssl rand -hex 24 2>/dev/null)" || hook_secret=""
    if [ -n "$hook_secret" ]; then
      _cwpt_upsert_env_var "$env_file" CWPT_JOURNEY_HOOK_SECRET "$hook_secret"
      echo "  CWPT_JOURNEY_HOOK_SECRET=(generated)"
    else
      echo "  WARNING: openssl unavailable — CWPT_JOURNEY_HOOK_SECRET not generated;" >&2
      echo "    journeys will run on the 60s tick scan only (no real-time hook)." >&2
    fi
  fi

  # External Journey intake has a separate master secret from the Chatwoot event hook.
  # Keeping the purposes independent means exposing or rotating one credential cannot open
  # the other entry point. The account-specific Basic password is derived at integration time.
  if [[ ",${enabled_modules_csv}," == *",sequences,"* ]] &&
     ! grep -q '^CWPT_JOURNEY_INTAKE_SECRET=' "$env_file" 2>/dev/null; then
    local intake_secret=""
    intake_secret="$(openssl rand -hex 32 2>/dev/null)" || intake_secret=""
    if [ -n "$intake_secret" ]; then
      _cwpt_upsert_env_var "$env_file" CWPT_JOURNEY_INTAKE_SECRET "$intake_secret"
      echo "  CWPT_JOURNEY_INTAKE_SECRET=(generated)"
    else
      echo "  WARNING: openssl unavailable — CWPT_JOURNEY_INTAKE_SECRET not generated;" >&2
      echo "    external journey intake will remain disabled." >&2
    fi
  fi
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
#   always gets a copyable block instead of a silent gap. Returns non-zero whenever the
#   route was not configured automatically. The caller still proceeds to the public health
#   check, because a manually-managed proxy may already have the route; only real public
#   reachability decides whether the installation is complete.
_cwpt_add_route() {
  local proxy_type="$1"
  case "$proxy_type" in
    caddy-host)
      if [ -f "$CADDYFILE" ]; then
        if ! add_route_caddy "$CADDYFILE" "$UPSTREAM"; then
          echo "install.sh: could not edit ${CADDYFILE} automatically — manual step needed:" >&2
          print_manual_snippet "$proxy_type" "$UPSTREAM"
          return 1
        fi
      else
        echo "install.sh: caddy detected but ${CADDYFILE} not found — manual step needed:" >&2
        print_manual_snippet "$proxy_type" "$UPSTREAM"
        return 1
      fi
      return 0
      ;;
    nginx)
      local nginx_conf=""
      nginx_conf="$(_cwpt_find_nginx_conf)" || nginx_conf=""
      if [ -n "$nginx_conf" ]; then
        if ! add_route_nginx "$nginx_conf" "$UPSTREAM"; then
          echo "install.sh: could not edit ${nginx_conf} automatically — manual step needed:" >&2
          print_manual_snippet "$proxy_type" "$UPSTREAM"
          return 1
        fi
      else
        echo "install.sh: nginx detected but no editable server config found — manual step needed:" >&2
        print_manual_snippet "$proxy_type" "$UPSTREAM"
        return 1
      fi
      return 0
      ;;
    *)
      echo "install.sh: no auto-editable reverse proxy detected (${proxy_type}) — manual step needed:" >&2
      print_manual_snippet "$proxy_type" "$UPSTREAM"
      return 1
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

# _cwpt_probe_health <url>
#   Captures the body and HTTP status in one request. A bare HTTP 200 is insufficient:
#   when the reverse-proxy route is missing, some Chatwoot/proxy configurations answer an
#   unknown path with the SPA's HTML shell and status 200. Only the engine's JSON health
#   shape proves the request actually reached cwpt-engine.
_cwpt_probe_health() {
  local url="$1" response="" body=""
  CWPT_PROBE_CODE="000"
  CWPT_PROBE_BODY=""
  if ! response="$(curl -sS --max-time 10 -w $'\n%{http_code}' "$url" 2>/dev/null)"; then
    return 1
  fi
  CWPT_PROBE_CODE="${response##*$'\n'}"
  body="${response%$'\n'*}"
  CWPT_PROBE_BODY="$body"
  [ "$CWPT_PROBE_CODE" = "200" ] &&
    printf '%s' "$body" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' &&
    printf '%s' "$body" | grep -Eq '"build"[[:space:]]*:' &&
    printf '%s' "$body" | grep -Eq '"deployment"[[:space:]]*:' &&
    printf '%s' "$body" | grep -Eq '"modules"[[:space:]]*:[[:space:]]*\['
}

# _cwpt_verify <public_base_url> <enabled_modules_csv> <expected_deploy_id>
#   Requires BOTH the loopback engine and the same public /chatwoot-addons route browsers
#   use to answer 200. A running container behind a missing proxy route is not a completed
#   product install, so any missing URL/non-200 returns non-zero and the caller prints an
#   explicit INCOMPLETE status instead of the old false success message.
_cwpt_verify() {
  local public_base_url="${1:-}"
  local enabled_modules_csv="${2:-}"
  local expected_deploy_id="${3:-}"
  local attempts="${CWPT_VERIFY_ATTEMPTS:-10}"
  local sleep_seconds="${CWPT_VERIFY_SLEEP_SECONDS:-2}"
  local engine_code="000" public_code="000" engine_ok=0 public_ok=0
  local engine_body="" public_body="" expected_modules_json="" compact_engine_body="" i

  for ((i = 1; i <= attempts; i++)); do
    if _cwpt_probe_health "http://127.0.0.1:${ENGINE_PORT}/drip-api/health"; then
      engine_code="$CWPT_PROBE_CODE"
      engine_body="$CWPT_PROBE_BODY"
      engine_ok=1
      break
    fi
    engine_code="$CWPT_PROBE_CODE"
    [ "$i" -lt "$attempts" ] && sleep "$sleep_seconds"
  done
  if [ "$engine_code" != "200" ]; then
    echo "  engine health check: got HTTP ${engine_code} (expected 200) — check 'docker logs cwpt-engine'" >&2
    return 1
  fi
  if [ "$engine_ok" -ne 1 ]; then
    echo "  engine health check: HTTP 200 did not contain the cwpt-engine health response" >&2
    return 1
  fi
  expected_modules_json="[\"${enabled_modules_csv//,/\",\"}\"]"
  compact_engine_body="$(printf '%s' "$engine_body" | tr -d '[:space:]')"
  if [ -z "$enabled_modules_csv" ] ||
     [[ "$compact_engine_body" != *"\"modules\":${expected_modules_json}"* ]]; then
    echo "  engine health check: running modules do not match the requested selection (${enabled_modules_csv:-missing})" >&2
    return 1
  fi
  if [ -z "$expected_deploy_id" ] ||
     [[ "$compact_engine_body" != *"\"deployment\":\"${expected_deploy_id}\""* ]]; then
    echo "  engine health check: deployment identity does not match this install run" >&2
    return 1
  fi
  echo "  engine health check: OK (200)"

  if [ -z "$public_base_url" ]; then
    echo "  public route check: CWPT_PUBLIC_BASE_URL is missing" >&2
    return 1
  fi
  local public_health_url="${public_base_url%/}/drip-api/health"
  for ((i = 1; i <= attempts; i++)); do
    if _cwpt_probe_health "$public_health_url"; then
      public_code="$CWPT_PROBE_CODE"
      public_body="$CWPT_PROBE_BODY"
      public_ok=1
      break
    fi
    public_code="$CWPT_PROBE_CODE"
    [ "$i" -lt "$attempts" ] && sleep "$sleep_seconds"
  done
  if [ "$public_code" != "200" ]; then
    echo "  public route check: got HTTP ${public_code} (expected 200 at /chatwoot-addons/drip-api/health)" >&2
    return 1
  fi
  if [ "$public_ok" -ne 1 ]; then
    echo "  public route check: HTTP 200 did not contain the cwpt-engine health response" >&2
    return 1
  fi
  if [ "$public_body" != "$engine_body" ]; then
    echo "  public route check: response belongs to a stale or different cwpt-engine" >&2
    return 1
  fi
  echo "  public route check: OK (200)"
  return 0
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
    local detected_version=""
    if detected_version="$(_cwpt_detect_chatwoot_version "$compose_dir" 2>/dev/null)"; then
      echo "Detected Chatwoot version: ${detected_version} (minimum: 4.17.1)"
    else
      echo "Detected Chatwoot version: UNKNOWN (a real install fails closed; minimum: 4.17.1)"
    fi
  else
    echo "Chatwoot compose directory: NOT DETECTED in this environment"
    echo "  (a real run searches 'docker compose ls' + /opt/chatwoot, /root/chatwoot, /srv/chatwoot, /data/chatwoot, then aborts if still not found)"
  fi

  local proxy_type="none"
  proxy_type="$(detect_reverse_proxy 2>/dev/null)" || proxy_type="none"
  echo "Detected reverse proxy: ${proxy_type}"
  echo

  echo "Would perform, in order:"
  if [[ "$modules_output" == *"sequences"* || "$modules_output" == *"enhancements"* ]]; then
    echo "  1. Provision least-privilege 'drip_engine' DB role + schema in Chatwoot's Postgres"
  else
    echo "  1. Skip database provisioning (import-only mode)"
  fi
  echo "  2. Copy only selected module artifacts + shared sidecar runtime"
  echo "  3. Write CWPT_ENABLED_MODULES / CWPT_CHATWOOT_BASE_URL / CWPT_PUBLIC_BASE_URL to .env"
  echo "  4. docker compose up -d --build cwpt-engine"
  if [[ "$modules_output" == *"sequences"* || "$modules_output" == *"enhancements"* ]]; then
    echo "  5. Finalize exact module privileges + apply owner-only migrations after the engine schema is ready"
  else
    echo "  5. Revoke any legacy database access (import-only desired state)"
  fi
  echo "  6. Add the single route /chatwoot-addons/* (via ${proxy_type}) -> ${UPSTREAM}"
  echo "  7. Verify: loopback engine health + PUBLIC route identity/reachability (both required)"
  echo "  8. Publish the dashboard script (modules: $(printf '%s' "$modules_output" | tr '\n' ' '))"
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
  local enabled_modules_csv
  enabled_modules_csv="$(IFS=,; echo "${modules_arr[*]}")"
  local needs_database=0
  if [[ ",${enabled_modules_csv}," == *",sequences,"* ||
        ",${enabled_modules_csv}," == *",enhancements,"* ]]; then
    needs_database=1
  fi

  _cwpt_preflight || exit 1

  echo "==> Detecting environment"
  local compose_dir=""
  if ! compose_dir="$(detect_compose_dir)"; then
    echo "install.sh: could not find a self-hosted Chatwoot docker-compose directory." >&2
    echo "  Looked via 'docker compose ls' and common paths (/opt/chatwoot, /root/chatwoot, /srv/chatwoot, /data/chatwoot)." >&2
    exit 1
  fi
  echo "  compose dir: ${compose_dir}"

  if ! _cwpt_require_supported_chatwoot "$compose_dir"; then
    exit 1
  fi

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

  if [ "$needs_database" -eq 1 ]; then
    echo "==> Provisioning database role/schema"
    if ! provision_db "$compose_dir" "$enabled_modules_csv"; then
      echo "install.sh: provision_db failed" >&2
      exit 1
    fi
  else
    echo "==> Skipping database provisioning (import-only mode)"
  fi

  echo "==> Copying modules into the compose directory"
  local target="${compose_dir}/chatwoot-power-tools"
  mkdir -p "$target"
  local target_real="" here_real="" managed_target="$target"
  local compose_fragment="chatwoot-power-tools/docker-compose.addons.yml"
  target_real="$(cd "$target" && pwd -P)"
  here_real="$(cd "$HERE" && pwd -P)"
  if [ "$target_real" = "$here_real" ] ||
     [ -e "${target}/.git" ] ||
     { [ -f "${target}/install.sh" ] && [ -f "${target}/README.md" ]; }; then
    # The production checkout may itself live at the historical deployment target. Keep
    # its tracked source immutable and put the pruned, selected runtime in a dedicated
    # managed directory. This prevents a successful subset install from deleting tracked
    # modules/assets from the checkout while retaining physical desired-state isolation in
    # the image build context.
    managed_target="${target}/.cwpt-runtime"
    compose_fragment="chatwoot-power-tools/.cwpt-runtime/docker-compose.addons.yml"
    echo "  source checkout detected; managed runtime: ${managed_target}"
  fi
  mkdir -p "$managed_target"
  # Stage every selected source BEFORE removing the previous runtime. This ordering is
  # load-bearing when this repository itself is checked out at $target: the selected
  # runtime is archived before its managed destination is replaced.
  # It also means a missing/unreadable source aborts without damaging the live copy.
  local -a copy_paths=(docker-compose.addons.yml modules/sequences)
  [[ ",${enabled_modules_csv}," == *",import,"* ]] && copy_paths+=(modules/smart-import)
  [[ ",${enabled_modules_csv}," == *",enhancements,"* ]] && copy_paths+=(modules/dashboard-enhancements)
  local staged_modules_archive=""
  if ! staged_modules_archive="$(mktemp "${TMPDIR:-/tmp}/cwpt-modules.XXXXXX")"; then
    echo "install.sh: could not create a temporary module archive" >&2
    exit 1
  fi
  if ! tar --exclude='node_modules' --exclude='.preview' -C "$HERE" \
      -cf "$staged_modules_archive" "${copy_paths[@]}"; then
    rm -f "$staged_modules_archive"
    echo "install.sh: failed to stage selected modules before updating ${target}" >&2
    exit 1
  fi
  # Move the previous managed runtime outside its destination before extracting. This both
  # removes stale/renamed files (a stale migration must never survive an update) and gives
  # us a rollback source if tar/disk extraction fails. The backup must be outside $target:
  # in the self-install layout $HERE == $target, so replacing $target/modules also replaces
  # the repository source itself in legacy self-install layouts.
  local previous_runtime_dir=""
  if ! previous_runtime_dir="$(mktemp -d "${TMPDIR:-/tmp}/cwpt-runtime.XXXXXX")"; then
    rm -f "$staged_modules_archive"
    echo "install.sh: could not create a temporary rollback directory" >&2
    exit 1
  fi
  local had_previous_modules=0 had_previous_compose=0
  if [ -e "${managed_target}/modules" ]; then
    if ! mv "${managed_target}/modules" "${previous_runtime_dir}/modules"; then
      rm -f "$staged_modules_archive"
      rmdir "$previous_runtime_dir" 2>/dev/null || true
      echo "install.sh: could not stage the previous modules for rollback" >&2
      exit 1
    fi
    had_previous_modules=1
  fi
  if [ -e "${managed_target}/docker-compose.addons.yml" ]; then
    if ! mv "${managed_target}/docker-compose.addons.yml" "${previous_runtime_dir}/docker-compose.addons.yml"; then
      if [ "$had_previous_modules" -eq 1 ]; then
        mv "${previous_runtime_dir}/modules" "${managed_target}/modules" 2>/dev/null || true
      fi
      rm -f "$staged_modules_archive"
      rmdir "$previous_runtime_dir" 2>/dev/null || true
      echo "install.sh: could not stage the previous compose file for rollback" >&2
      exit 1
    fi
    had_previous_compose=1
  fi
  # Extract the already-staged archive. node_modules was excluded above because the image
  # installs its own Linux dependencies; host dependencies are unnecessary and unsafe to
  # copy across platforms.
  if ! tar -C "$managed_target" -xf "$staged_modules_archive"; then
    rm -f "$staged_modules_archive"
    # Remove only partially-extracted managed paths, then restore the exact previous
    # runtime. Never touch checkout/docs/.git or the dashboard backup in $target.
    rm -rf "${managed_target}/modules" "${managed_target}/docker-compose.addons.yml"
    local rollback_failed=0
    if [ "$had_previous_modules" -eq 1 ] &&
       ! mv "${previous_runtime_dir}/modules" "${managed_target}/modules"; then
      rollback_failed=1
    fi
    if [ "$had_previous_compose" -eq 1 ] &&
       ! mv "${previous_runtime_dir}/docker-compose.addons.yml" "${managed_target}/docker-compose.addons.yml"; then
      rollback_failed=1
    fi
    if [ "$rollback_failed" -eq 1 ]; then
      echo "install.sh: extraction failed and the previous runtime could not be fully restored; backup preserved at ${previous_runtime_dir}" >&2
    else
      rmdir "$previous_runtime_dir" 2>/dev/null || true
      echo "install.sh: failed to extract the replacement; previous runtime restored" >&2
    fi
    exit 1
  fi
  rm -f "$staged_modules_archive"
  rm -rf "$previous_runtime_dir"
  # smart-import is pre-merged under the shared runtime for Docker-context reasons. Remove
  # that copy when import is not selected, or a guessed static URL would still deploy it.
  if [[ ",${enabled_modules_csv}," != *",import,"* ]]; then
    rm -rf "${managed_target}/modules/sequences/webapp/dist/smart-import"
  fi
  printf '%s\n' "${modules_arr[@]}" > "${managed_target}/enabled-modules.txt"

  echo "==> Writing addons environment variables"
  _cwpt_write_addons_env "$compose_dir" "$enabled_modules_csv" "$managed_target"

  echo "==> Building and starting cwpt-engine"
  local project=""
  project="$(_cwpt_detect_compose_project "$compose_dir")"
  if ! (cd "$compose_dir" && docker compose -f docker-compose.yml -f "$compose_fragment" -p "$project" up -d --build cwpt-engine); then
    echo "install.sh: docker compose up failed for cwpt-engine" >&2
    exit 1
  fi

  echo "==> Finalizing module-scoped database privileges"
  if ! finalize_db_module_privileges "$compose_dir" "$enabled_modules_csv"; then
    echo "install.sh: database privilege finalization failed — installation is INCOMPLETE" >&2
    exit 1
  fi
  if [ "$needs_database" -eq 1 ]; then
    echo "==> Applying owner-only database migrations"
    if ! apply_owner_migrations "$compose_dir" "$enabled_modules_csv"; then
      echo "install.sh: owner migrations failed — installation is INCOMPLETE" >&2
      exit 1
    fi
  fi

  echo "==> Adding the /chatwoot-addons/* route"
  local route_auto_configured=1
  if ! _cwpt_add_route "$proxy_type"; then
    route_auto_configured=0
  fi

  # Verify the replacement backend before publishing UI that points at it. In particular,
  # a stale public proxy target must leave the previously-installed dashboard block intact,
  # not strand users on new UI backed by the wrong engine.
  echo "==> Verifying engine and public route before publishing dashboard UI"
  local public_base_url=""
  public_base_url="$(read_env_var "$compose_dir" CWPT_PUBLIC_BASE_URL)" || public_base_url=""
  local expected_deploy_id=""
  expected_deploy_id="$(read_env_var "$compose_dir" CWPT_DEPLOY_ID)" || expected_deploy_id=""
  if ! _cwpt_verify "$public_base_url" "$enabled_modules_csv" "$expected_deploy_id"; then
    echo >&2
    echo "chatwoot-power-tools installation is INCOMPLETE: the engine or its public route is not reachable." >&2
    echo "Apply the printed reverse-proxy route, then re-run install.sh; it is idempotent." >&2
    exit 1
  fi
  if [ "$route_auto_configured" -eq 0 ]; then
    echo "  public route was already reachable through externally-managed proxy configuration"
  fi

  echo "==> Publishing the dashboard script"
  if ! inject_dashboard_script "$compose_dir" "$ADDONS_BASE" "${modules_arr[@]}"; then
    echo "install.sh: inject_dashboard_script failed — installation is INCOMPLETE" >&2
    exit 1
  fi

  echo
  echo "chatwoot-power-tools installed. Refresh Chatwoot in your browser — the new entries should appear."
}

# _cwpt_stop_engine_for_uninstall <compose_dir> <project> <managed_target> <compose_fragment>
#   Stop/remove the exact fixed-name sidecar and prove it is absent. Compose is preferred,
#   but a missing/broken fragment falls back to Docker's exact-name lookup. Never report a
#   completed uninstall while a background engine can still deliver sequence messages.
_cwpt_stop_engine_for_uninstall() {
  local compose_dir="$1" project="$2" managed_target="$3" compose_fragment="$4"
  local compose_removed=0
  if [ -f "${managed_target}/docker-compose.addons.yml" ]; then
    if (cd "$compose_dir" && docker compose -f docker-compose.yml -f "$compose_fragment" -p "$project" rm -sf cwpt-engine) >/dev/null 2>&1; then
      compose_removed=1
    else
      echo "  compose removal failed; checking the exact cwpt-engine container directly" >&2
    fi
  else
    echo "  compose fragment missing; checking the exact cwpt-engine container directly" >&2
  fi

  local remaining=""
  if ! remaining="$(docker ps -a --filter 'name=^/cwpt-engine$' --format '{{.Names}}' 2>/dev/null)"; then
    echo "install.sh: could not determine whether cwpt-engine still exists" >&2
    return 1
  fi
  if printf '%s\n' "$remaining" | grep -Fxq 'cwpt-engine'; then
    if ! docker rm -f cwpt-engine >/dev/null 2>&1; then
      echo "install.sh: could not stop/remove the remaining cwpt-engine container" >&2
      return 1
    fi
  elif [ "$compose_removed" -eq 0 ]; then
    echo "  no exact cwpt-engine container found (nothing to stop)"
  fi

  if ! remaining="$(docker ps -a --filter 'name=^/cwpt-engine$' --format '{{.Names}}' 2>/dev/null)"; then
    echo "install.sh: could not verify cwpt-engine removal" >&2
    return 1
  fi
  if printf '%s\n' "$remaining" | grep -Fxq 'cwpt-engine'; then
    echo "install.sh: cwpt-engine still exists after removal attempt" >&2
    return 1
  fi
  echo "  cwpt-engine absent"
}

# _cwpt_do_uninstall
#   Removes the sidecar, route, injected UI and copied artifacts. Always leaves the
#   drip_engine role/schema in
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
  local managed_target="$target"
  local compose_fragment="chatwoot-power-tools/docker-compose.addons.yml"
  if [ -f "${target}/.cwpt-runtime/docker-compose.addons.yml" ]; then
    managed_target="${target}/.cwpt-runtime"
    compose_fragment="chatwoot-power-tools/.cwpt-runtime/docker-compose.addons.yml"
  fi

  echo "==> Validating the dashboard script before stopping the engine"
  # Validate the shared mutable value before stopping anything. A malformed/unreadable
  # DASHBOARD_SCRIPTS value leaves the entire deployment intact. A later compare-and-set
  # conflict can still leave the already-stopped engine down, but can never leave a hidden
  # background sender running after uninstall reported success.
  if ! verify_dashboard_script "$compose_dir"; then
    echo "chatwoot-power-tools removal is INCOMPLETE: DASHBOARD_SCRIPTS could not be safely validated." >&2
    echo "No engine, route, or copied files were removed. Resolve the reported conflict and retry." >&2
    exit 1
  fi

  echo "==> Stopping and removing the cwpt-engine container"
  if ! _cwpt_stop_engine_for_uninstall "$compose_dir" "$project" "$managed_target" "$compose_fragment"; then
    echo "chatwoot-power-tools removal is INCOMPLETE: cwpt-engine may still be running." >&2
    echo "The dashboard script, route, and copied files were left in place." >&2
    exit 1
  fi

  echo "==> Removing chatwoot-power-tools' block from the dashboard script"
  if ! remove_dashboard_script "$compose_dir"; then
    echo "chatwoot-power-tools removal is INCOMPLETE: cwpt-engine is stopped, but DASHBOARD_SCRIPTS was left untouched." >&2
    echo "The route and copied files were left in place. Resolve the reported conflict and retry." >&2
    exit 1
  fi

  echo "==> Removing the /chatwoot-addons/* route"
  local proxy_type="none"
  proxy_type="$(detect_reverse_proxy)" || proxy_type="none"
  _cwpt_remove_route "$proxy_type"

  echo "==> Removing copied files"
  local target_real="" here_real=""
  target_real="$(cd "$target" 2>/dev/null && pwd -P)" || target_real=""
  here_real="$(cd "$HERE" 2>/dev/null && pwd -P)" || here_real=""
  local target_is_checkout=0
  if { [ -n "$target_real" ] && [ "$target_real" = "$here_real" ]; } ||
     [ -e "${target}/.git" ] ||
     { [ -f "${target}/install.sh" ] && [ -f "${target}/README.md" ]; }; then
    target_is_checkout=1
  fi
  if [ "$target_is_checkout" -eq 1 ]; then
    # Production may keep the Git checkout exactly at the deployment target. In that
    # layout modules/, docker-compose.addons.yml, install.sh, docs and .git are source,
    # not disposable copies. Removing them would destroy the operator's checkout. The
    # container/route/UI are already gone, so remove only installer state and preserve the
    # checkout for a future reinstall/update.
    rm -rf "${target}/.cwpt-runtime"
    rm -f "${target}/enabled-modules.txt"
    echo "  source checkout preserved at ${target}"
  elif [ -d "$target" ]; then
    # Never recursively delete the whole target: an operator may keep a checkout or other
    # files there even when install.sh was invoked elsewhere. Remove only paths this
    # installer owns. Preserve dashboard_scripts.prev.bak as a recovery record.
    rm -rf "${target}/modules" "${target}/.cwpt-runtime"
    rm -f "${target}/docker-compose.addons.yml" "${target}/enabled-modules.txt"
    if ! rmdir "$target" 2>/dev/null; then
      echo "  preserved non-managed files and/or dashboard_scripts.prev.bak in ${target}"
    fi
  fi

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
