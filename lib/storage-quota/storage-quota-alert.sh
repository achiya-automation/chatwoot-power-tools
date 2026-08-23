#!/usr/bin/env bash
# בדיקת מכסת אחסון מדיה + התראות.
#
# מריץ את החישוב בתוך קונטיינר ה-rails, ואם יש חשבון שחרג או מתקרב —
# שולח מייל ללקוח (מתוך הסקריפט ה-Ruby) וסיכום WhatsApp לאחיה.
#
# ברירת המחדל היא הרצה יבשה. שליחה בפועל רק כש-SEND=1 ב-config.
# הקונפיג יושב בקובץ נפרד כדי שהסקריפט יישאר בגיט בלי סודות.

set -euo pipefail

CONFIG="${CONFIG:-/opt/chatwoot/scripts/storage-quota.env}"
LOG="/var/log/storage-quota-alert.log"
[ -f "$CONFIG" ] && . "$CONFIG"

SEND="${SEND:-0}"
UPGRADE_URL="${UPGRADE_URL:-}"
QUOTA_BASE_GB="${QUOTA_BASE_GB:-10}"
QUOTA_STEP_GB="${QUOTA_STEP_GB:-10}"
QUOTA_STEP_PRICE="${QUOTA_STEP_PRICE:-30}"
QUOTA_WARN_PCT="${QUOTA_WARN_PCT:-80}"

log() { echo "[$(date '+%Y-%m-%d %H:%M')] $*" >> "$LOG"; }

# התמונות נשלחות בתוך המייל עצמו, ולכן צריכות להיות נגישות לקונטיינר.
# הסקריפט מגיע ב-stdin ולא יכול לקרוא קבצים מהמארח, אז מעתיקים אותן לפני כל
# ריצה — כך גם קונטיינר שנוצר מחדש מקבל אותן.
for IMG in quota-over.jpg quota-warn.jpg; do
  [ -f "$(dirname "$0")/$IMG" ] && docker cp "$(dirname "$0")/$IMG" "chatwoot-rails-1:/tmp/$IMG" >/dev/null 2>&1 \
    || log "אזהרה: $IMG לא הועתק — המייל יישלח בלי התמונה"
done

# הסקריפט נכנס דרך stdin (`rails runner -`) כדי לא להוסיף עוד mount לקונטיינר
OUT=$(docker exec -i \
  -e SEND="$SEND" \
  -e UPGRADE_URL="$UPGRADE_URL" \
  -e QUOTA_BASE_GB="$QUOTA_BASE_GB" \
  -e QUOTA_STEP_GB="$QUOTA_STEP_GB" \
  -e QUOTA_STEP_PRICE="$QUOTA_STEP_PRICE" \
  -e QUOTA_WARN_PCT="$QUOTA_WARN_PCT" \
  -e STATE_FILE=/app/tmp/storage-quota-state.json \
  chatwoot-rails-1 bundle exec rails runner - \
  < "$(dirname "$0")/storage_quota_alert.rb" 2>/dev/null \
  | sed -n '/^{/,$p')

COUNT=$(echo "$OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["alerts_count"])' 2>/dev/null || echo 0)
log "alerts=$COUNT send=$SEND"

if [ "$COUNT" = "0" ]; then
  echo "אין חשבון שמתקרב או חרג מהמכסה."
  exit 0
fi

# סיכום קריא לאחיה
SUMMARY=$(echo "$OUT" | python3 -c '
import json, sys
d = json.load(sys.stdin)
p = d["pricing"]
lines = ["מכסת אחסון Chatwoot — %d חשבונות דורשים תשומת לב:" % d["alerts_count"], ""]
for a in d["alerts"]:
    mark = "חריגה" if a["level"] == "over" else "מתקרב"
    lines.append("%s — %s: %.2fGB מתוך %.0fGB" % (mark, a["name"], a["used_gb"], a["quota_gb"]))
    if a["level"] == "over":
        lines.append("   תוספת: %d₪/חודש → מכסה חדשה %dGB" % (a["extra_ils"], a["new_quota_gb"]))
    if a.get("send_error"):
        lines.append("   שגיאת שליחה: %s" % a["send_error"])
lines.append("")
lines.append("מחירון: עד %.0fGB כלול, %d₪ לכל %.0fGB נוספים." % (p["base_gb"], p["step_price_ils"], p["step_gb"]))
if d["mode"] == "DRY_RUN":
    lines.append("(הרצה יבשה — לא נשלח דבר ללקוחות)")
print("\n".join(lines))
')

echo "$SUMMARY"

# WhatsApp לאחיה — רק אם הוגדרו יעד ושרת, ורק במצב שליחה
if [ "$SEND" = "1" ] && [ -n "${WAHA_URL:-}" ] && [ -n "${ALERT_CHAT_ID:-}" ]; then
  curl -sf -X POST "$WAHA_URL/api/sendText" \
    -H 'Content-Type: application/json' \
    -H "X-Api-Key: ${WAHA_API_KEY:-}" \
    -d "$(python3 -c '
import json, os, sys
print(json.dumps({
  "session": os.environ.get("WAHA_SESSION", "default"),
  "chatId": os.environ["ALERT_CHAT_ID"],
  "text": sys.stdin.read()
}))' <<< "$SUMMARY")" >/dev/null && log "נשלחה התראת WhatsApp" || log "כשל בשליחת WhatsApp"
fi
