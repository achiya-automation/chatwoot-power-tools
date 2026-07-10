#!/usr/bin/env bash
# lib/assemble-dashboard-script.sh
#
# Assembles the Chatwoot DASHBOARD_SCRIPTS payload (instance-wide InstallationConfig hook,
# see lib/inject.sh) from the per-module parts under modules/*/{parts,inject}/*.js, selected
# by module name. window.__CW_ADDONS_BASE is injected once at the top so every part resolves
# its own asset/API paths at runtime from a single dynamic base — zero hardcoded domain, zero
# hardcoded path.
#
# Usage:
#   assemble_dashboard_script <addons_base> <module...>
#     modules: import (smart-import) | sequences (drip sequences) | enhancements (dashboard-enhancements)
#
# Meant to be sourced (`source lib/assemble-dashboard-script.sh`), not executed directly.

# Resolves the repo root relative to this file's own location, so callers can source this
# script from any working directory.
_cwpt_assemble_root() {
  (cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
}

# Prints (one per line) the part file paths — relative to the repo root — that belong to a
# given module. Unknown module name → non-zero exit, nothing printed.
_cwpt_module_parts() {
  case "$1" in
    import)
      echo "modules/smart-import/inject/import-button.js"
      ;;
    sequences)
      echo "modules/sequences/inject/sequences-nav.js"
      ;;
    enhancements)
      printf '%s\n' \
        "modules/dashboard-enhancements/parts/campaign-modal.js" \
        "modules/dashboard-enhancements/parts/campaign-stats.js" \
        "modules/dashboard-enhancements/parts/video-compressor.js"
      ;;
    *)
      return 1
      ;;
  esac
}

# assemble_dashboard_script <addons_base> <module...>
#   Prints window.__CW_ADDONS_BASE="<addons_base>" as a <script> tag, followed by each
#   selected module's parts, each wrapped in its own <script> tag (matching the original
#   dashboard-script.html layout: one top-level IIFE per <script> block, sharing window/document
#   but not each other's local scope). Modules are emitted in the order given; unknown modules
#   or missing part files abort with a message on stderr and a non-zero exit.
assemble_dashboard_script() {
  local base="$1"
  shift
  local root
  root="$(_cwpt_assemble_root)"

  printf '<script>window.__CW_ADDONS_BASE="%s";</script>\n' "$base"

  local mod rel path
  for mod in "$@"; do
    if ! _cwpt_module_parts "$mod" >/dev/null 2>&1; then
      echo "assemble_dashboard_script: unknown module '${mod}'" >&2
      return 1
    fi
    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      path="${root}/${rel}"
      if [ ! -f "$path" ]; then
        echo "assemble_dashboard_script: missing part '${rel}' (module '${mod}')" >&2
        return 1
      fi
      printf '<script>\n'
      printf '// part: %s\n' "$rel"
      cat "$path"
      printf '\n</script>\n'
    done < <(_cwpt_module_parts "$mod")
  done
}
