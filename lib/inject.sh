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
  local output hash
  if command -v shasum >/dev/null 2>&1; then
    output="$(shasum -a 256 "$file")" || return 1
    hash="${output%%[[:space:]]*}"
  elif command -v openssl >/dev/null 2>&1; then
    output="$(openssl dgst -sha256 "$file")" || return 1
    hash="${output##*[[:space:]]}"
  else
    return 1
  fi
  [[ "$hash" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s' "${hash:0:10}"
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
  local output hash
  if command -v shasum >/dev/null 2>&1; then
    output="$(printf '%s' "$1" | shasum -a 256)" || return 1
    hash="${output%%[[:space:]]*}"
  elif command -v openssl >/dev/null 2>&1; then
    output="$(printf '%s' "$1" | openssl dgst -sha256)" || return 1
    hash="${output##*[[:space:]]}"
  else
    return 1
  fi
  [[ "$hash" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$hash"
}

# _cwpt_validate_dashboard_value <value> <merge|verify>
#   Validates the only structure we are allowed to edit. Marker substrings must each occur
#   either zero times (no CWPT block) or exactly once on their own lines, START must precede
#   END, and an integrity line — when present — must be the first line inside the block and
#   use the canonical 64-lowercase-hex form. `verify` additionally requires that integrity
#   line and a non-empty payload. This deliberately fails closed on duplicate, nested,
#   partial, reordered, or orphaned marker/integrity text: guessing which bytes belong to
#   us could overwrite an operator's unrelated DASHBOARD_SCRIPTS content.
#
#   stdout: absent | present | legacy, or a short invalid:<reason> diagnostic.
#   exit:   0 valid, 2 malformed/unverifiable.
_cwpt_validate_dashboard_value() {
  local value="$1" mode="${2:-merge}"
  printf '%s' "$value" | awk \
    -v start="$_CWPT_DASHBOARD_MARK_START" \
    -v end="$_CWPT_DASHBOARD_MARK_END" \
    -v iprefix="$_CWPT_INTEGRITY_PREFIX" \
    -v isuffix="$_CWPT_INTEGRITY_SUFFIX" \
    -v mode="$mode" '
      function occurrences(haystack, needle, count, pos) {
        count = 0
        while ((pos = index(haystack, needle)) > 0) {
          count++
          haystack = substr(haystack, pos + length(needle))
        }
        return count
      }
      {
        start_occ += occurrences($0, start)
        end_occ += occurrences($0, end)
        integrity_occ += occurrences($0, "cwpt-integrity")
        if ($0 == start) { start_exact++; start_line = NR }
        if ($0 == end) { end_exact++; end_line = NR }
        if (start_line > 0 && NR > start_line + 1 && $0 != end) {
          payload_line = $0
          gsub(/[[:space:]]/, "", payload_line)
          if (length(payload_line) > 0) payload_non_ws = 1
        }

        if (substr($0, 1, length(iprefix)) == iprefix &&
            length($0) > length(iprefix) + length(isuffix) &&
            substr($0, length($0) - length(isuffix) + 1) == isuffix) {
          hash = substr($0, length(iprefix) + 1,
                        length($0) - length(iprefix) - length(isuffix))
          if (length(hash) == 64 && hash !~ /[^0-9a-f]/) {
            integrity_exact++
            integrity_line = NR
          }
        }
      }
      END {
        if (start_occ == 0 && end_occ == 0) {
          if (integrity_occ != 0) { print "invalid:orphan_integrity"; exit 2 }
          if (mode == "verify") { print "invalid:missing_markers"; exit 2 }
          print "absent"
          exit 0
        }
        if (start_occ != 1 || end_occ != 1) {
          print "invalid:marker_count"
          exit 2
        }
        if (start_exact != 1 || end_exact != 1) {
          print "invalid:marker_not_canonical_line"
          exit 2
        }
        if (start_line >= end_line) {
          print "invalid:marker_order"
          exit 2
        }
        if (integrity_occ == 0) {
          if (mode == "verify") { print "invalid:missing_integrity"; exit 2 }
          print "legacy"
          exit 0
        }
        if (integrity_occ != 1 || integrity_exact != 1) {
          print "invalid:integrity_format_or_count"
          exit 2
        }
        if (integrity_line != start_line + 1 || integrity_line >= end_line) {
          print "invalid:integrity_position"
          exit 2
        }
        if (end_line <= integrity_line + 1 || payload_non_ws != 1) {
          print "invalid:empty_payload"
          exit 2
        }
        print "present"
      }
    '
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
#   when no such row exists yet — `&.value` on nil). A Docker/Rails failure is propagated:
#   callers must distinguish "stored value is empty" from "the stored value could not be
#   read", because treating the latter as empty would clobber operator-owned content.
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

# _cwpt_read_dashboard_scripts <variable_name> <rails_container>
#   Command substitution normally strips every trailing newline, which would corrupt a
#   shared DASHBOARD_SCRIPTS value and make the optimistic hash disagree with Rails. Append
#   a non-newline sentinel inside the substitution, then remove exactly that byte, preserving
#   all original bytes while still propagating a failed Docker/Rails read.
_cwpt_read_dashboard_scripts() {
  local variable_name="$1" rails_container="$2" captured="" sentinel=$'\x1f'
  if ! captured="$(_cwpt_fetch_dashboard_scripts "$rails_container" && printf '%s' "$sentinel")"; then
    return 1
  fi
  [[ "$captured" == *"$sentinel" ]] || return 1
  captured="${captured%"$sentinel"}"
  printf -v "$variable_name" '%s' "$captured"
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
  local structure=""
  if ! structure="$(_cwpt_validate_dashboard_value "$existing" merge)"; then
    echo "_cwpt_merge_dashboard_scripts: refusing malformed existing value (${structure:-invalid:unknown})" >&2
    return 1
  fi
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

_cwpt_merge_dashboard_scripts_into() {
  local variable_name="$1" existing="$2" new_block="$3" captured="" sentinel=$'\x1f'
  if ! captured="$(_cwpt_merge_dashboard_scripts "$existing" "$new_block" && printf '%s' "$sentinel")"; then
    return 1
  fi
  [[ "$captured" == *"$sentinel" ]] || return 1
  captured="${captured%"$sentinel"}"
  printf -v "$variable_name" '%s' "$captured"
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

  # ‏cwpt-watchdog בשרתים משווה את מה שמוזרק בפועל מול רשימה מקובעת בתוכו. הרשימה קופאת:
  # ‏video-compressor הוסר מהקוד ב-20.8.26 וההתראה רצה על מודול מת עד 23.8; waha-controls
  # הוסר ב-21.8 ורשימת אדמון עוד ציפתה לו ב-4.9, בזמן שרשימת השרת הראשי לא כללה אותו כלל —
  # כלומר אותה בדיקה בדיוק דיווחה "תקין" בשני מצבים סותרים. כאן נכתב הקאנון עצמו לקובץ,
  # והשומר קורא ממנו במקום מהעתק שמישהו צריך לזכור לעדכן.
  local canon_dir="${compose_dir}/.cwpt-state"
  if mkdir -p "$canon_dir" 2>/dev/null; then
    local mod
    for mod in "$@"; do _cwpt_module_parts "$mod"; done > "${canon_dir}/dashboard-parts.txt" 2>/dev/null || :
    chmod 644 "${canon_dir}/dashboard-parts.txt" 2>/dev/null || :
  fi

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
  # Only the import module contains this placeholder. A sequences/dashboard-only install
  # must not inspect, hash, or fail because of an unselected module's artifact.
  if [[ "$html" == *"__CWI_VER__"* ]]; then
    if [ ! -f "$bundle" ]; then
      echo "inject_dashboard_script: selected import module is missing its built bundle" >&2
      return 1
    fi
    local ver
    if ! ver="$(_cwpt_content_hash "$bundle")"; then
      echo "inject_dashboard_script: could not hash the smart-import bundle" >&2
      return 1
    fi
    html="${html//__CWI_VER__/$ver}"
  fi
  if [[ "$html" == *"__CWI_VER__"* ]]; then
    echo "inject_dashboard_script: unresolved smart-import content hash placeholder" >&2
    return 1
  fi

  local rails_container
  rails_container="$(detect_service_container "$compose_dir" rails)" || {
    echo "inject_dashboard_script: could not detect the rails container" >&2
    return 1
  }

  # Read-merge-write, not a blind overwrite: DASHBOARD_SCRIPTS is one value shared with
  # whatever else the operator has configured (see this file's header comment).
  local existing=""
  if ! _cwpt_read_dashboard_scripts existing "$rails_container"; then
    echo "inject_dashboard_script: could not read the existing DASHBOARD_SCRIPTS — refusing to overwrite it" >&2
    return 1
  fi
  local existing_structure=""
  if ! existing_structure="$(_cwpt_validate_dashboard_value "$existing" merge)"; then
    echo "inject_dashboard_script: existing DASHBOARD_SCRIPTS is malformed (${existing_structure:-invalid:unknown}) — refusing to overwrite it" >&2
    return 1
  fi
  local expected_existing_hash=""
  if ! expected_existing_hash="$(_cwpt_string_hash "$existing")"; then
    echo "inject_dashboard_script: could not hash the value used for compare-and-set" >&2
    return 1
  fi
  _cwpt_backup_dashboard_scripts "$compose_dir" "$existing"

  local payload_hash="" integrity_line new_block
  if ! payload_hash="$(_cwpt_string_hash "$html")"; then
    echo "inject_dashboard_script: could not compute the dashboard payload integrity hash" >&2
    return 1
  fi
  integrity_line="${_CWPT_INTEGRITY_PREFIX}${payload_hash}${_CWPT_INTEGRITY_SUFFIX}"
  new_block="$(printf '%s\n%s\n%s\n%s' \
    "$_CWPT_DASHBOARD_MARK_START" "$integrity_line" "$html" "$_CWPT_DASHBOARD_MARK_END")"
  local merged
  if ! _cwpt_merge_dashboard_scripts_into merged "$existing" "$new_block"; then
    echo "inject_dashboard_script: could not safely merge DASHBOARD_SCRIPTS" >&2
    return 1
  fi

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
    require 'digest'
    InstallationConfig.transaction do
      c = InstallationConfig.lock.find_or_initialize_by(name: 'DASHBOARD_SCRIPTS')
      raise 'DASHBOARD_SCRIPTS changed concurrently' unless Digest::SHA256.hexdigest(c.value.to_s) == '${expected_existing_hash}'
      c.value = File.read('${tmp_remote}')
      c.save!
      GlobalConfig.clear_cache rescue nil
      puts \"DASHBOARD_SCRIPTS set (#{c.value.to_s.length} chars)\"
    end
  "; then
    echo "inject_dashboard_script: rails runner failed on ${rails_container}" >&2
    return 1
  fi

  docker exec "$rails_container" rm -f "$tmp_remote" >/dev/null 2>&1 || true

  # Read-back verification has two independent jobs: exact equality proves this write won
  # (a no-op save, concurrent overwrite, or an old-but-self-consistent block must not pass),
  # then verify_dashboard_script proves the stored block's own integrity metadata is sound.
  local stored=""
  if ! _cwpt_read_dashboard_scripts stored "$rails_container"; then
    echo "inject_dashboard_script: could not read back the stored DASHBOARD_SCRIPTS" >&2
    return 1
  fi
  if [ "$stored" != "$merged" ]; then
    echo "inject_dashboard_script: stored DASHBOARD_SCRIPTS differs from the exact value written — NOT trusting this install" >&2
    return 1
  fi
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
#   Prints one status word. Exit: 0 = ok / not-installed, 1 = the rails container/value
#   can't be read, 2 = malformed, legacy-unverifiable, or hash mismatch.
verify_dashboard_script() {
  local compose_dir="$1"
  local rails_container
  rails_container="$(detect_service_container "$compose_dir" rails)" || {
    echo "dashboard_script_unreachable"
    return 1
  }

  local value
  if ! _cwpt_read_dashboard_scripts value "$rails_container"; then
    echo "dashboard_script_read_failed"
    return 1
  fi

  if [[ "$value" != *"$_CWPT_DASHBOARD_MARK_START"* ]]; then
    local absent_structure=""
    if ! absent_structure="$(_cwpt_validate_dashboard_value "$value" merge)"; then
      echo "dashboard_script_malformed ${absent_structure:-invalid:unknown}"
      return 2
    fi
    echo "dashboard_script_not_installed"
    return 0
  fi

  local structure=""
  if ! structure="$(_cwpt_validate_dashboard_value "$value" verify)"; then
    echo "dashboard_script_malformed ${structure:-invalid:unknown}"
    return 2
  fi

  local declared=""
  declared="$(printf '%s' "$value" | _cwpt_declared_hash)"

  local payload="" actual=""
  payload="$(printf '%s' "$value" | _cwpt_extract_payload)"
  if ! actual="$(_cwpt_string_hash "$payload")"; then
    echo "dashboard_script_hash_failed"
    return 2
  fi
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
  if ! _cwpt_read_dashboard_scripts existing "$rails_container"; then
    echo "remove_dashboard_script: could not read DASHBOARD_SCRIPTS — refusing to modify it" >&2
    return 1
  fi

  if [ -z "$(printf '%s' "$existing" | tr -d '[:space:]')" ]; then
    echo "dashboard_script_nothing_to_remove"
    return 0
  fi

  _cwpt_backup_dashboard_scripts "$compose_dir" "$existing"

  local existing_structure=""
  if ! existing_structure="$(_cwpt_validate_dashboard_value "$existing" merge)"; then
    echo "remove_dashboard_script: existing DASHBOARD_SCRIPTS is malformed (${existing_structure:-invalid:unknown}) — refusing to modify it" >&2
    return 1
  fi

  if [[ "$existing" != *"$_CWPT_DASHBOARD_MARK_START"*"$_CWPT_DASHBOARD_MARK_END"* ]]; then
    echo "  no chatwoot-power-tools block found in DASHBOARD_SCRIPTS — leaving it untouched" >&2
    return 0
  fi

  local prefix="${existing%%"$_CWPT_DASHBOARD_MARK_START"*}"
  local suffix="${existing#*"$_CWPT_DASHBOARD_MARK_END"}"
  local remaining="${prefix}${suffix}"
  local expected_existing_hash=""
  if ! expected_existing_hash="$(_cwpt_string_hash "$existing")"; then
    echo "remove_dashboard_script: could not hash the value used for compare-and-set" >&2
    return 1
  fi

  if [ -z "$(printf '%s' "$remaining" | tr -d '[:space:]')" ]; then
    if ! docker exec "$rails_container" bundle exec rails runner "
      require 'digest'
      InstallationConfig.transaction do
        c = InstallationConfig.lock.find_by(name: 'DASHBOARD_SCRIPTS')
        raise 'DASHBOARD_SCRIPTS changed concurrently' unless Digest::SHA256.hexdigest(c ? c.value.to_s : '') == '${expected_existing_hash}'
        c.destroy if c
        GlobalConfig.clear_cache rescue nil
      end
    " >/dev/null 2>&1; then
      echo "remove_dashboard_script: rails runner failed to destroy DASHBOARD_SCRIPTS on ${rails_container}" >&2
      return 1
    fi
    local destroyed_readback=""
    if ! _cwpt_read_dashboard_scripts destroyed_readback "$rails_container" ||
       [ -n "$destroyed_readback" ]; then
      echo "remove_dashboard_script: DASHBOARD_SCRIPTS destroy did not verify" >&2
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
    require 'digest'
    InstallationConfig.transaction do
      c = InstallationConfig.lock.find_or_initialize_by(name: 'DASHBOARD_SCRIPTS')
      raise 'DASHBOARD_SCRIPTS changed concurrently' unless Digest::SHA256.hexdigest(c.value.to_s) == '${expected_existing_hash}'
      c.value = File.read('${tmp_remote}')
      c.save!
      GlobalConfig.clear_cache rescue nil
      puts \"DASHBOARD_SCRIPTS updated (#{c.value.to_s.length} chars)\"
    end
  "; then
    echo "remove_dashboard_script: rails runner failed on ${rails_container}" >&2
    return 1
  fi

  docker exec "$rails_container" rm -f "$tmp_remote" >/dev/null 2>&1 || true
  local remaining_readback=""
  if ! _cwpt_read_dashboard_scripts remaining_readback "$rails_container" ||
     [ "$remaining_readback" != "$remaining" ]; then
    echo "remove_dashboard_script: stored DASHBOARD_SCRIPTS differs after removal" >&2
    return 1
  fi
  echo "dashboard_script_block_removed"
}
