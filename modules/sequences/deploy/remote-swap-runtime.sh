#!/usr/bin/env bash
# Atomically-ish replace the managed engine files from a pre-uploaded archive.
# Runs as root on the Chatwoot host. Extraction and required-path validation happen in a
# sibling staging directory before any live path moves. If any later move fails, the exact
# previous paths are restored; a failed restore preserves its backup for manual recovery.
set -euo pipefail

mode="${1:-}"
runtime_root="${2:-}"
archive="${3:-}"

case "$mode" in
  modular)
    managed_paths=(modules docker-compose.addons.yml)
    required_paths=(
      modules/sequences/engine/src/index.js
      modules/sequences/engine/Dockerfile
      modules/sequences/engine/migrations
      modules/sequences/webapp/dist/index.html
      modules/sequences/webapp/dist/smart-import/import-tool.js
      modules/smart-import/inject/import-button.js
      modules/dashboard-enhancements/parts/campaign-modal.js
      docker-compose.addons.yml
    )
    ;;
  flat)
    managed_paths=(engine/src engine/migrations webapp/dist)
    required_paths=(engine/src/index.js engine/migrations webapp/dist/index.html)
    ;;
  *) echo "remote-swap-runtime: mode must be modular or flat" >&2; exit 2 ;;
esac
case "$runtime_root" in
  ""|/) echo "remote-swap-runtime: unsafe runtime root" >&2; exit 2 ;;
esac
[ -f "$archive" ] || { echo "remote-swap-runtime: archive not found" >&2; exit 1; }
mkdir -p "$runtime_root"

stage_dir="$(mktemp -d "${runtime_root}/.cwpt-sync-stage.XXXXXX")"
backup_dir="$(mktemp -d "${runtime_root}/.cwpt-sync-backup.XXXXXX")"
preserve_backup=0
swap_started=0
install_started=0

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  set +e
  if [ "$status" -ne 0 ] && [ "$swap_started" -eq 1 ]; then
    rollback_previous
  fi
  rm -f "$archive"
  rm -rf "$stage_dir"
  if [ "$status" -eq 0 ] || [ "$preserve_backup" -eq 0 ]; then
    rm -rf "$backup_dir"
  else
    echo "remote-swap-runtime: rollback incomplete; backup preserved at ${backup_dir}" >&2
  fi
  exit "$status"
}
trap cleanup EXIT

rollback_previous() {
  local rel="" failed=0
  if [ "$install_started" -eq 1 ]; then
    for rel in "${managed_paths[@]}"; do
      rm -rf "${runtime_root:?}/${rel}" || failed=1
    done
  fi
  # The backup tree itself is the ledger. This closes the failure window between moving
  # an old path and recording it in a separate file: as soon as mv succeeds, its presence
  # here is enough for EXIT cleanup to restore it.
  for rel in "${managed_paths[@]}"; do
    [ -e "${backup_dir}/${rel}" ] || continue
    if ! mkdir -p "${runtime_root}/$(dirname "$rel")" ||
       ! mv "${backup_dir}/${rel}" "${runtime_root}/${rel}"; then
      failed=1
    fi
  done
  if [ "$failed" -eq 0 ]; then
    preserve_backup=0
    swap_started=0
    return 0
  fi
  preserve_backup=1
  return 1
}

on_signal() {
  exit 130
}
trap on_signal HUP INT TERM

# Validate the gzip/tar stream and extract completely before moving a live byte.
tar -tzf "$archive" >/dev/null
tar -C "$stage_dir" -xzf "$archive"
for rel in "${required_paths[@]}"; do
  [ -e "${stage_dir}/${rel}" ] || {
    echo "remote-swap-runtime: archive missing required path ${rel}" >&2
    exit 1
  }
done

# Move the old runtime into a same-filesystem backup. A same-filesystem mv is atomic for
# each managed path and avoids copying large web assets during the outage window.
preserve_backup=1
swap_started=1
for rel in "${managed_paths[@]}"; do
  if [ -e "${runtime_root}/${rel}" ]; then
    mkdir -p "${backup_dir}/$(dirname "$rel")"
    if ! mv "${runtime_root}/${rel}" "${backup_dir}/${rel}"; then
      rollback_previous || true
      echo "remote-swap-runtime: could not stage previous ${rel}" >&2
      exit 1
    fi
  fi
done

# Deterministic failure injection used only by the local Bats rollback regression. The
# fleet script invokes this under sudo without preserving caller environment variables.
install_started=1
if [ "${CWPT_SWAP_FAIL_AFTER_BACKUP:-0}" = "1" ]; then
  rollback_previous || true
  echo "remote-swap-runtime: injected failure after backup" >&2
  exit 97
fi

installed_count=0
for rel in "${managed_paths[@]}"; do
  mkdir -p "${runtime_root}/$(dirname "$rel")"
  if ! mv "${stage_dir}/${rel}" "${runtime_root}/${rel}"; then
    rollback_previous || true
    echo "remote-swap-runtime: failed to install ${rel}; previous runtime restored" >&2
    exit 1
  fi
  installed_count=$((installed_count + 1))
  # Unlike the explicit failure hook above, this deliberately falls through set -e so the
  # EXIT trap itself proves it can recover an unexpected mid-install failure.
  if [ "${CWPT_SWAP_FAIL_UNHANDLED_DURING_INSTALL:-0}" = "1" ] &&
     [ "$installed_count" -eq 1 ]; then
    false
  fi
done

preserve_backup=0
swap_started=0
echo "remote_runtime_swapped"
