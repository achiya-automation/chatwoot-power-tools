#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-recent}"
case "$MODE" in
  recent|full) ;;
  *) echo "unsupported mode: $MODE" >&2; exit 2 ;;
esac

ROOT=/opt/chatwoot/waha-contact-sync
CONTAINER=chatwoot-rails-1
LOCK=/run/lock/waha-contact-sync.lock
CONTAINER_SCRIPT=/tmp/waha_contact_sync.rb
CONTAINER_CONFIG=/tmp/waha-contact-sync-config.json

exec 9>"$LOCK"
flock -w 300 9

cleanup() {
  docker exec "$CONTAINER" rm -f "$CONTAINER_SCRIPT" "$CONTAINER_CONFIG" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker cp "$ROOT/waha_contact_sync.rb" "$CONTAINER:$CONTAINER_SCRIPT"
docker cp "$ROOT/config.json" "$CONTAINER:$CONTAINER_CONFIG"
docker exec "$CONTAINER" chmod 600 "$CONTAINER_CONFIG"
docker exec \
  -e WAHA_CONTACT_SYNC_CONFIG="$CONTAINER_CONFIG" \
  "$CONTAINER" \
  bundle exec rails runner "$CONTAINER_SCRIPT" "$MODE"
