#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-recent}"
DRY_RUN="${2:-}"
case "$MODE" in
  recent|full) ;;
  *) echo "unsupported mode: $MODE" >&2; exit 2 ;;
esac
case "$DRY_RUN" in
  ""|--dry-run) ;;
  *) echo "unsupported option: $DRY_RUN" >&2; exit 2 ;;
esac
if (( $# > 2 )); then
  echo "too many arguments" >&2
  exit 2
fi

ROOT=/opt/chatwoot/waha-contact-sync
CONTAINER=chatwoot-rails-1
LOCK=/run/lock/waha-contact-sync.lock
CONTAINER_SCRIPT=/tmp/waha_contact_sync.rb
CONTAINER_CONFIG=/tmp/waha-contact-sync-config.json

CONFIG_MODE="$(stat -c '%a' "$ROOT/config.json")"
if [[ "$CONFIG_MODE" != "600" ]]; then
  echo "config.json must have mode 600 (found $CONFIG_MODE)" >&2
  exit 2
fi

# Validate shape without ever printing the protected key values.
python3 - "$ROOT/config.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    config = json.load(handle)

base_url = config.get("waha_base_url")
targets = config.get("targets")
if not isinstance(base_url, str) or not base_url.startswith(("http://", "https://")):
    raise SystemExit("invalid waha_base_url")
if not isinstance(targets, list) or not targets:
    raise SystemExit("targets must be a non-empty list")

seen = set()
for target in targets:
    if not isinstance(target, dict):
        raise SystemExit("every target must be an object")
    for field in ("session", "account_id", "inbox_id", "key"):
        if field not in target:
            raise SystemExit(f"target is missing {field}")
    if not isinstance(target["session"], str) or not target["session"]:
        raise SystemExit("target session must be non-empty")
    if not isinstance(target["key"], str) or not target["key"]:
        raise SystemExit("target key must be non-empty")
    identity = (int(target["account_id"]), int(target["inbox_id"]), target["session"])
    if identity in seen:
        raise SystemExit("duplicate target")
    seen.add(identity)
PY

exec 9>"$LOCK"
flock -w 300 9

cleanup() {
  docker exec "$CONTAINER" rm -f "$CONTAINER_SCRIPT" "$CONTAINER_CONFIG" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker cp "$ROOT/waha_contact_sync.rb" "$CONTAINER:$CONTAINER_SCRIPT"
docker cp "$ROOT/config.json" "$CONTAINER:$CONTAINER_CONFIG"
docker exec "$CONTAINER" chmod 600 "$CONTAINER_CONFIG"

RAILS_ARGS=("$MODE")
if [[ "$DRY_RUN" == "--dry-run" ]]; then
  RAILS_ARGS+=("--dry-run")
fi
docker exec \
  -e WAHA_CONTACT_SYNC_CONFIG="$CONTAINER_CONFIG" \
  "$CONTAINER" \
  bundle exec rails runner "$CONTAINER_SCRIPT" "${RAILS_ARGS[@]}"
