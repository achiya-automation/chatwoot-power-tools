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

# Integrity line, written as the first line INSIDE the block. It pins the sha256 of the
# payload that follows, so any later rewrite of the value that mangles a character is
# detectable — by the installer on the next run, and by the watchdog on a schedule.
#
# This is not paranoia. DASHBOARD_SCRIPTS is one big string in a DB column that operators
# (and past versions of this project) edit with `rails runner`. A Ruby single-quoted string
# folds a doubled backslash into a single one; a double-quoted one mangles far more. That is
# exactly how prod lost `querySelectorAll('.group\/cardLayout')`: the selector turned invalid,
# querySelectorAll threw, and the whole campaigns dashboard vanished — with no error anywhere
# an operator would look. A stored value that no longer matches its own hash is now loud.
_CWPT_INTEGRITY_PREFIX='<!-- cwpt-integrity sha256:'
_CWPT_INTEGRITY_SUFFIX=' -->'

# _cwpt_string_hash <string> → full sha256 hex of the string, with no trailing newline added.
# (_cwpt_content_hash hashes a FILE and truncates to 10 chars for cache-busting — different job.)
_cwpt_string_hash() {
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  else
    printf '%s' "$1" | openssl dgst -sha256 | awk '{print $NF}'
  fi
}

# _cwpt_extract_payload — stdin: the full DASHBOARD_SCRIPTS value. stdout: the hashed payload,
# i.e. everything strictly between the integrity line and CWPT:END. Prints nothing when the
# block or the integrity line is absent. Command substitution strips the trailing newline,
# matching how the payload was hashed at write time.
_cwpt_extract_payload() {
  awk -v endmark="$_CWPT_DASHBOARD_MARK_END" '
    started { if (index($0, endmark) == 1) exit; print; next }
    index($0, "<!-- cwpt-integrity sha256:") == 1 { started = 1 }
  '
}

# _cwpt_declared_hash — stdin: the full value. stdout: the sha256 the block claims for itself.
_cwpt_declared_hash() {
  sed -n 's/^<!-- cwpt-integrity sha256:\([0-9a-f]\{64\}\) -->$/\1/p' | head -1
}

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
  # -e RAILS_LOG_TO_STDOUT=false: Chatwoot production streams its Rails log to STDOUT, and
  # those boot-time log lines print BEFORE the runner body — a bare read interleaves them
  # into the returned value (2>/dev/null drops only stderr, not stdout). Silencing stdout
  # logging for this one read keeps the fetched value exactly the stored string, never a log
  # line — otherwise every inject appends the boot log to DASHBOARD_SCRIPTS, and (worse) an
  # unmarked legacy block never gets recognised, so a second block is appended and its
  # __dripCampaignEnhance guard blocks the real one from running. (&.value kept verbatim —
  # test/mocks/docker keys the READ path on it; a leading -e is transparent to that match.)
  docker exec -e RAILS_LOG_TO_STDOUT=false "$rails_container" bundle exec rails runner "
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

  local integrity_line new_block
  integrity_line="${_CWPT_INTEGRITY_PREFIX}$(_cwpt_string_hash "$html")${_CWPT_INTEGRITY_SUFFIX}"
  new_block="$(printf '%s\n%s\n%s\n%s' \
    "$_CWPT_DASHBOARD_MARK_START" "$integrity_line" "$html" "$_CWPT_DASHBOARD_MARK_END")"
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

  # Read-back verification: what Chatwoot actually STORED must hash to what we wrote. A write
  # that silently mangled a character (see the _CWPT_INTEGRITY_PREFIX comment) fails here
  # instead of shipping a dashboard whose scripts throw on the first tick.
  if ! verify_dashboard_script "$compose_dir"; then
    echo "inject_dashboard_script: stored DASHBOARD_SCRIPTS does not match what was written — NOT trusting this install" >&2
    return 1
  fi

  echo "dashboard_script_injected"
}

# verify_dashboard_script <compose_dir>
#   Re-reads DASHBOARD_SCRIPTS from Chatwoot and checks the chatwoot-power-tools block against
#   the sha256 it carries in its own integrity line. This is the guard against the failure mode
#   that a passing test suite cannot see: the code in git is fine, the assembled artifact is
#   fine, and the value sitting in the database is subtly corrupt.
#   Prints one status word. Exit: 0 = ok / not-installed / legacy (nothing to compare),
#   1 = the rails container can't be reached, 2 = CORRUPT (hash mismatch).
verify_dashboard_script() {
  local compose_dir="$1"
  local rails_container
  rails_container="$(detect_service_container "$compose_dir" rails)" || {
    echo "dashboard_script_unreachable"
    return 1
  }

  local value
  value="$(_cwpt_fetch_dashboard_scripts "$rails_container")" || value=""

  if [[ "$value" != *"$_CWPT_DASHBOARD_MARK_START"* ]]; then
    echo "dashboard_script_not_installed"
    return 0
  fi

  local declared
  declared="$(printf '%s' "$value" | _cwpt_declared_hash)"
  if [ -z "$declared" ]; then
    # A block injected before integrity lines existed. Nothing to compare against — say so
    # rather than claiming an all-clear; the next inject run adds the line.
    echo "dashboard_script_legacy_no_integrity_line"
    return 0
  fi

  local actual
  actual="$(_cwpt_string_hash "$(printf '%s' "$value" | _cwpt_extract_payload)")"
  if [ "$declared" != "$actual" ]; then
    echo "dashboard_script_corrupt declared=${declared:0:12} actual=${actual:0:12}"
    return 2
  fi

  echo "dashboard_script_ok"
  return 0
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
