#!/usr/bin/env bash
# בדיקת שפיות לבדיקת dashboard_script שב-cwpt-watchdog.sh.
#
# ה-watchdog עצמו לא נמצא בריפו — הוא יושב על השרתים ב-/opt/chatwoot/scripts/cwpt-watchdog.sh
# (root:700, מכיל webhook URL + טוקן). הסקריפט הזה מחלץ ממנו את גוף ה-python של הבדיקה
# ומריץ אותו מול קלטים מזויפים, כדי לוודא שהוא עדיין מבדיל בין תקין לכשל אמיתי.
#
#   שימוש:  sudo bash watchdog-dashboard-check.sh [נתיב-ל-cwpt-watchdog.sh]
#
# רקע: עד 27/07/2026 הבדיקה זיהתה את הבלוק לפי הערת ה-HTML "<!-- CWPT:START -->".
# נתיב הפריסה בשימוש כותב את DASHBOARD_SCRIPTS raw בלי הסמן הזה, ולכן מ-26/07/2026 22:02
# (הפריסה של יישור העיצוב ל-Chatwoot 4.16) הבדיקה דיווחה "הבלוק נעלם כליל" כל 15 דקות
# בזמן שכל 8 המודולים היו מוזרקים בפועל. הזיהוי הועבר לתוכן — חותמות "// part:".
set -uo pipefail

F="${1:-/opt/chatwoot/scripts/cwpt-watchdog.sh}"
PY=$(mktemp)
trap 'rm -f "$PY"' EXIT

python3 - "$F" "$PY" <<'EX'
import re, sys
src = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r"\| python3 -c '\n(.*?)\n' 2>/dev/null\)", src, re.S)
if not m:
    sys.exit("ABORT: could not extract the check body from %s" % sys.argv[1])
open(sys.argv[2], "w", encoding="utf-8").write(m.group(1) + "\n")
EX
[ -s "$PY" ] || exit 1

ALL8="modules/smart-import/inject/import-button.js
modules/sequences/inject/sequences-nav.js
modules/sequences/inject/templates-nav.js
modules/sequences/inject/journeys-nav.js
modules/sequences/inject/journey-launch.js
modules/dashboard-enhancements/parts/campaign-modal.js
modules/dashboard-enhancements/parts/campaign-stats.js
modules/dashboard-enhancements/parts/video-compressor.js"

mk() { while read -r p; do [ -n "$p" ] && echo "// part: $p"; done; }

fail=0
chk() { # chk <שם> <קלט> <צפוי>
  local got
  got=$(printf '%s' "$2" | python3 "$PY")
  if [ "$got" = "$3" ]; then
    echo "  ok   $1 -> $got"
  else
    echo "  FAIL $1 -> got [$got] want [$3]"
    fail=1
  fi
}

echo "בדיקות ($F):"
chk "פלט ריק (rails לא ענה)" ""                "unknown"
chk "רק רווחים"               "   "             "unknown"
chk "אין רשומה ב-DB"          "NOROW"           "missing"
chk "סקריפט בלי אף מודול"     "console.log(1);" "missing"
chk "כל 8 המודולים"           "$(echo "$ALL8" | mk)" "ok"
chk "חסרים 2 האחרונים"        "$(echo "$ALL8" | head -6 | mk)" \
    "incomplete campaign-stats.js video-compressor.js"
chk "חסרים מודולי journeys"   "$(echo "$ALL8" | grep -v journey | mk)" \
    "incomplete journeys-nav.js journey-launch.js"
chk "חסר campaign-stats"      "$(echo "$ALL8" | grep -v campaign-stats | mk)" \
    "incomplete campaign-stats.js"

# בלוק חתום: חתימה שלא תואמת את התוכן = הערך הושחת
body="$(echo "$ALL8" | mk)"
sig=$(printf '%s' "wrong content" | sha256sum | cut -d' ' -f1)
chk "חתימה לא תואמת" \
    "$(printf '<!-- CWPT:START -->\n<!-- cwpt-integrity sha256:%s -->\n%s\n<!-- CWPT:END -->' "$sig" "$body")" \
    "corrupt"

sig=$(printf '%s' "$body" | sha256sum | cut -d' ' -f1)
chk "חתימה תואמת" \
    "$(printf '<!-- CWPT:START -->\n<!-- cwpt-integrity sha256:%s -->\n%s\n<!-- CWPT:END -->' "$sig" "$body")" \
    "ok"

[ "$fail" -eq 0 ] && echo "ALL_PASS" || echo "SOME_FAILED"
exit "$fail"
