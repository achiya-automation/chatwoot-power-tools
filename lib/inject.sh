#!/usr/bin/env bash
# lib/inject.sh
#
# Injects the assembled dashboard script (lib/assemble-dashboard-script.sh) into
# Chatwoot's `DASHBOARD_SCRIPTS` InstallationConfig — the same instance-wide hook
# chatwoot/set-dashboard-script.sh used, ported to run LOCALLY on the Chatwoot host (no
# ssh: install.sh runs directly on the target server) and WITHOUT the legacy CSP
# frame-src block (dropped — same-origin under /chatwoot-addons/* needs no frame-src
# grant; that was only ever needed for the old cross-origin sequences.* iframe).
#
# Also resolves the modules/smart-import/inject/import-button.js `__CWI_VER__`
# placeholder to a real content hash of the built smart-import bundle, so browsers never
# serve a stale cached copy across an upgrade — the same cache-busting
# modules/smart-import/deploy/set-import-tool.sh used to do with `shasum` + `sed`.
#
# DASHBOARD_SCRIPTS is a SINGLE InstallationConfig value shared by the whole Chatwoot
# instance — an operator may already have their own analytics/tracking snippet in there.
# inject_dashboard_script/remove_dashboard_script therefore never blindly overwrite or
# destroy the whole value: our own HTML is always wrapped in _CWPT_DASHBOARD_MARK_START/
# END markers, and every write reads the current value first (_cwpt_fetch_dashboard_scripts),
# backs it up (_cwpt_backup_dashboard_scripts), then either replaces just the marked block
# or appends a new one — see _cwpt_merge_dashboard_scripts. remove_dashboard_script mirrors
# this: it strips only the marked block, and only destroys the InstallationConfig row
# itself when nothing (not even operator content) is left afterwards.
#
# Meant to be sourced (`source lib/inject.sh`), not executed directly.

_cwpt_inject_root() { (cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd); }

if ! declare -f detect_service_container >/dev/null 2>&1; then
  # shellcheck source=lib/detect.sh
  source "$(_cwpt_inject_root)/lib/detect.sh"
fi
if ! declare -f assemble_dashboard_script >/dev/null 2>&1; then
  # shellcheck source=lib/assemble-dashboard-script.sh
  source "$(_cwpt_inject_root)/lib/assemble-dashboard-script.sh"
fi

# _cwpt_content_hash <file>
#   Prints a short (10-hex-char) content hash of <file>, matching the cache-bust length
#   the original deploy script used. Falls back to `openssl dgst` if shasum isn't on PATH.
_cwpt_content_hash() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | cut -c1-10
  else
    openssl dgst -sha256 "$file" | awk '{print $NF}' | cut -c1-10
  fi
}

# Markers wrapping chatwoot-power-tools' own contribution inside the single shared
# DASHBOARD_SCRIPTS value — see this file's header comment for why these exist.
_CWPT_DASHBOARD_MARK_START='<!-- CWPT:START -->'
_CWPT_DASHBOARD_MARK_END='<!-- CWPT:END -->'

# _cwpt_fetch_dashboard_scripts <rails_container>
#   Prints the CURRENT DASHBOARD_SCRIPTS InstallationConfig value verbatim (empty, exit 0,
#   when no such row exists yet — `&.value` on nil). Never fails the caller: stderr is
#   discarded and the caller is expected to guard the call (`|| existing=""`), matching
#   this codebase's set -e -o pipefail safety convention (test/set-e-safety.bats).
#   NOTE: the literal `&.value` below is load-bearing — test/mocks/docker's case
#   statement keys on it to tell this READ apart from the WRITE rails runner calls in
#   inject_dashboard_script/remove_dashboard_script. Keep it if you touch this string.
_cwpt_fetch_dashboard_scripts() {
  local rails_container="$1"
  docker exec "$rails_container" bundle exec rails runner "
    print InstallationConfig.find_by(name: 'DASHBOARD_SCRIPTS')&.value
  " 2>/dev/null
}

# _cwpt_backup_dashboard_scripts <compose_dir> <content>
#   Best-effort snapshot of DASHBOARD_SCRIPTS as it stood immediately before this run's
#   write/removal, written to <compose_dir>/chatwoot-power-tools/dashboard_scripts.prev.bak
#   so an operator can recover a pre-chatwoot-power-tools value by hand if something goes
#   wrong. Never fatal (mkdir/write failures are swallowed) — sourced into install.sh's
#   `set -e -o pipefail`, and a backup hiccup must not abort the actual injection/removal.
_cwpt_backup_dashboard_scripts() {
  local compose_dir="$1" content="$2" dir
  dir="${compose_dir}/chatwoot-power-tools"
  mkdir -p "$dir" 2>/dev/null || return 0
  printf '%s' "$content" > "${dir}/dashboard_scripts.prev.bak" 2>/dev/null || true
}

# _cwpt_merge_dashboard_scripts <existing> <new_block>
#   Prints what DASHBOARD_SCRIPTS should become. If <existing> already contains a
#   CWPT:START/END block (a previous install of this same tool), that block alone is
#   replaced in place — anything else the operator has in DASHBOARD_SCRIPTS (their own
#   snippet, before and/or after ours) survives untouched. Otherwise <new_block> is
#   appended after <existing>, or used alone when <existing> is empty/whitespace-only
#   (e.g. a fresh Chatwoot instance with no DASHBOARD_SCRIPTS set at all yet).
_cwpt_merge_dashboard_scripts() {
  local existing="$1" new_block="$2"
  if [[ "$existing" == *"$_CWPT_DASHBOARD_MARK_START"*"$_CWPT_DASHBOARD_MARK_END"* ]]; then
    local prefix="${existing%%"$_CWPT_DASHBOARD_MARK_START"*}"
    local suffix="${existing#*"$_CWPT_DASHBOARD_MARK_END"}"
    printf '%s%s%s' "$prefix" "$new_block" "$suffix"
  elif [ -n "$(printf '%s' "$existing" | tr -d '[:space:]')" ]; then
    printf '%s\n\n%s' "$existing" "$new_block"
  else
    printf '%s' "$new_block"
  fi
}

# inject_dashboard_script <compose_dir> <base> <module...>
#   Assembles the DASHBOARD_SCRIPTS HTML for <base>+<module...>, cache-busts the
#   smart-import bundle reference, wraps it in CWPT:START/END markers, and merges it into
#   whatever is CURRENTLY stored in Chatwoot's DASHBOARD_SCRIPTS InstallationConfig
#   (_cwpt_fetch_dashboard_scripts + _cwpt_merge_dashboard_scripts): a prior chatwoot-
#   power-tools block is replaced in place, anything else the operator has is appended
#   after, never clobbered. The pre-change value is always backed up first
#   (_cwpt_backup_dashboard_scripts). Idempotent — re-running with the same modules
#   replaces only chatwoot-power-tools' own block again. Returns 0 on success, 1 if
#   arguments are missing, assembly fails (e.g. unknown module), the rails container
#   can't be detected, or a docker step fails.
inject_dashboard_script() {
  local compose_dir="$1" base="$2"
  if [ -z "$compose_dir" ] || [ -z "$base" ] || [ "$#" -lt 3 ]; then
    echo "inject_dashboard_script: compose_dir, base and at least one module are required" >&2
    return 1
  fi
  shift 2

  local html
  html="$(assemble_dashboard_script "$base" "$@")" || {
    echo "inject_dashboard_script: assemble_dashboard_script failed" >&2
    return 1
  }

  local bundle
  # The bundle the engine actually serves (and that ships in git) is the pre-merged copy
  # under the sequences webapp dist — NOT modules/smart-import/dist, which is a gitignored
  # build intermediate absent from a clean clone / the install tarball. Hashing the served
  # copy is both correct (its hash is the cache-bust key browsers see) and CI-safe.
  bundle="$(_cwpt_inject_root)/modules/sequences/webapp/dist/smart-import/import-tool.js"
  if [ -f "$bundle" ]; then
    local ver
    # `|| true`: sourced into install.sh (set -e -o pipefail) — a hash-computation hiccup
    # must not abort the whole injection; worst case the placeholder is left unreplaced.
    ver="$(_cwpt_content_hash "$bundle")" || true
    html="${html//__CWI_VER__/$ver}"
  fi

  local rails_container
  rails_container="$(detect_service_container "$compose_dir" rails)" || {
    echo "inject_dashboard_script: could not detect the rails container" >&2
    return 1
  }

  # Read-merge-write, not a blind overwrite: DASHBOARD_SCRIPTS is one value shared with
  # whatever else the operator has configured (see this file's header comment).
  local existing=""
  existing="$(_cwpt_fetch_dashboard_scripts "$rails_container")" || existing=""
  _cwpt_backup_dashboard_scripts "$compose_dir" "$existing"

  local new_block
  new_block="$(printf '%s\n%s\n%s' "$_CWPT_DASHBOARD_MARK_START" "$html" "$_CWPT_DASHBOARD_MARK_END")"
  local merged
  merged="$(_cwpt_merge_dashboard_scripts "$existing" "$new_block")"

  local tmp_local tmp_remote
  tmp_local="$(mktemp)"
  printf '%s' "$merged" > "$tmp_local"
  tmp_remote="/tmp/cwpt-dashboard-script.$$.html"

  if ! docker cp "$tmp_local" "${rails_container}:${tmp_remote}"; then
    rm -f "$tmp_local"
    echo "inject_dashboard_script: docker cp to ${rails_container} failed" >&2
    return 1
  fi
  rm -f "$tmp_local"

  if ! docker exec "$rails_container" bundle exec rails runner "
    c = InstallationConfig.find_or_initialize_by(name: 'DASHBOARD_SCRIPTS')
    c.value = File.read('${tmp_remote}')
    c.save!
    GlobalConfig.clear_cache rescue nil
    puts \"DASHBOARD_SCRIPTS set (#{c.value.to_s.length} chars)\"
  "; then
    echo "inject_dashboard_script: rails runner failed on ${rails_container}" >&2
    return 1
  fi

  docker exec "$rails_container" rm -f "$tmp_remote" >/dev/null 2>&1 || true
  echo "dashboard_script_injected"
}

# remove_dashboard_script <compose_dir>
#   Reverses inject_dashboard_script for --uninstall. Removes ONLY the CWPT:START/END
#   block from DASHBOARD_SCRIPTS — never `InstallationConfig#destroy`s the row outright,
#   since it may hold operator content that has nothing to do with chatwoot-power-tools.
#   The pre-change value is always backed up first (_cwpt_backup_dashboard_scripts).
#   The InstallationConfig row is destroyed ONLY when removing our block leaves the value
#   empty or whitespace-only. If no chatwoot-power-tools block is found at all (nothing
#   to remove, or DASHBOARD_SCRIPTS predates this marker scheme), the value is left
#   completely untouched. Returns 0 on success (including "nothing to do"), 1 if the
#   rails container can't be detected or a docker step fails.
remove_dashboard_script() {
  local compose_dir="$1"
  if [ -z "$compose_dir" ]; then
    echo "remove_dashboard_script: compose_dir is required" >&2
    return 1
  fi

  local rails_container
  rails_container="$(detect_service_container "$compose_dir" rails)" || {
    echo "remove_dashboard_script: could not detect the rails container" >&2
    return 1
  }

  local existing=""
  existing="$(_cwpt_fetch_dashboard_scripts "$rails_container")" || existing=""

  if [ -z "$(printf '%s' "$existing" | tr -d '[:space:]')" ]; then
    echo "dashboard_script_nothing_to_remove"
    return 0
  fi

  _cwpt_backup_dashboard_scripts "$compose_dir" "$existing"

  if [[ "$existing" != *"$_CWPT_DASHBOARD_MARK_START"*"$_CWPT_DASHBOARD_MARK_END"* ]]; then
    echo "  no chatwoot-power-tools block found in DASHBOARD_SCRIPTS — leaving it untouched" >&2
    return 0
  fi

  local prefix="${existing%%"$_CWPT_DASHBOARD_MARK_START"*}"
  local suffix="${existing#*"$_CWPT_DASHBOARD_MARK_END"}"
  local remaining="${prefix}${suffix}"

  if [ -z "$(printf '%s' "$remaining" | tr -d '[:space:]')" ]; then
    if ! docker exec "$rails_container" bundle exec rails runner "
      c = InstallationConfig.find_by(name: 'DASHBOARD_SCRIPTS')
      c&.destroy
      GlobalConfig.clear_cache rescue nil
    " >/dev/null 2>&1; then
      echo "remove_dashboard_script: rails runner failed to destroy DASHBOARD_SCRIPTS on ${rails_container}" >&2
      return 1
    fi
    echo "dashboard_script_destroyed"
    return 0
  fi

  local tmp_local tmp_remote
  tmp_local="$(mktemp)"
  printf '%s' "$remaining" > "$tmp_local"
  tmp_remote="/tmp/cwpt-dashboard-script-remove.$$.html"

  if ! docker cp "$tmp_local" "${rails_container}:${tmp_remote}"; then
    rm -f "$tmp_local"
    echo "remove_dashboard_script: docker cp to ${rails_container} failed" >&2
    return 1
  fi
  rm -f "$tmp_local"

  if ! docker exec "$rails_container" bundle exec rails runner "
    c = InstallationConfig.find_or_initialize_by(name: 'DASHBOARD_SCRIPTS')
    c.value = File.read('${tmp_remote}')
    c.save!
    GlobalConfig.clear_cache rescue nil
    puts \"DASHBOARD_SCRIPTS updated (#{c.value.to_s.length} chars)\"
  "; then
    echo "remove_dashboard_script: rails runner failed on ${rails_container}" >&2
    return 1
  fi

  docker exec "$rails_container" rm -f "$tmp_remote" >/dev/null 2>&1 || true
  echo "dashboard_script_block_removed"
}
