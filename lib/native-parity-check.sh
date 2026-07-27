#!/usr/bin/env bash
# lib/native-parity-check.sh — בדיקת תאימות של ההזרקות (DASHBOARD_SCRIPTS) מול ה-CSS
# המקומפל של Chatwoot.
#
# ההזרקות בונות DOM עם מחלקות/משתני-CSS/אייקונים שחייבים להתקיים ב-CSS שגרסת ה-Chatwoot
# המותקנת מקמפלת. שדרוג Chatwoot יכול להעלים מחלקה בשקט (זה בדיוק מה שקרה ב-4.15→4.16:
# hover:bg-gradient-to-r הוחלף בגרסאות ltr:/rtl: וה-hover נעלם בלי שום שגיאה).
# הסקריפט בודק כל אסימון שההזרקות תלויות בו ומדפיס ✅/🔴 — להריץ אחרי כל עדכון Chatwoot,
# לפני שסוגרים את העדכון.
#
# שימוש:
#   lib/native-parity-check.sh <path-to-dashboard-css>
#   lib/native-parity-check.sh --server <ssh-host>     # מאתר את ה-CSS ב-unread-assets על השרת
#
# יציאה: 0 = הכול קיים; 1 = חסרים אסימונים (מודפסים).

set -euo pipefail

# ── האסימונים שההזרקות תלויות בהם ─────────────────────────────────────────────
# מחלקות Tailwind (מופיעות ב-CSS בצורה escaped: ':'→'\:', '/'→'\/', '['/']'→'\[' '\]', '.'→'\.')
REQUIRED_CLASSES=(
  # sidebar leaf hover (sequences-nav sub-items) — הגרסאות עם קידומת כיוון בלבד
  'ltr:hover:bg-gradient-to-r'
  'rtl:hover:bg-gradient-to-l'
  'via-n-slate-3/70'
  # tree-line (SidebarGroupLeaf TREE_CONNECTOR)
  'before:start-0'
  'before:bg-n-slate-4'
  'last:after:rounded-es'
  # states + header
  'bg-n-alpha-2'
  'hover:bg-n-alpha-2'
  'text-n-slate-11'
  'text-n-slate-12'
  'text-body-main'
  # panel / loading
  'bg-n-background'
  'animate-spin'
  'text-n-brand'
  # collapsed rail + popover (SidebarGroup collapsed / SidebarCollapsedPopover)
  'size-10'
  'bg-n-alpha-3'
  'backdrop-blur-[100px]'
  'outline-n-weak'
  'rounded-xl'
  'shadow-lg'
  'no-scrollbar'
  # אייקוני mask שההזרקות מרנדרות (רק אלה ש-Chatwoot כולל — layout-template בכוונה לא כאן,
  # הוא SVG inline כי אינו מקומפל)
  'i-lucide-layers'
  'i-lucide-chevron-up'
  'i-lucide-workflow'
  'i-lucide-zap'
  'i-lucide-megaphone'
  'i-lucide-upload'
)
# משתני CSS שהסטיילים המוזרקים (campaign-modal.js) קוראים ישירות
REQUIRED_VARS=(
  '--slate-10' '--slate-11' '--slate-12'
  '--alpha-2' '--alpha-3'
  '--blue-3' '--blue-5' '--blue-6' '--blue-11'
  '--teal-3' '--teal-7' '--teal-11'
  '--ruby-11'
)

css_file=""
if [ "${1:-}" = "--server" ]; then
  host="${2:?usage: native-parity-check.sh --server <ssh-host>}"
  css_file="$(mktemp)"
  trap 'rm -f "$css_file"' EXIT
  # ה-CSS הראשי של הדשבורד הוא הקובץ הגדול ביותר תחת unread-assets/vite/assets
  # shellcheck disable=SC2029
  ssh "$host" 'cat "$(ls -S /opt/chatwoot/unread-assets/vite/assets/dashboard-*.css 2>/dev/null | head -1)"' > "$css_file"
  [ -s "$css_file" ] || { echo "🔴 לא נמצא dashboard-*.css על $host" >&2; exit 1; }
else
  css_file="${1:?usage: native-parity-check.sh <dashboard.css> | --server <host>}"
  [ -r "$css_file" ] || { echo "🔴 קובץ לא קריא: $css_file" >&2; exit 1; }
fi

escape_class() {
  # שם מחלקה כפי שהוא מופיע כסלקטור ב-CSS מקומפל
  printf '%s' "$1" | sed -e 's/:/\\:/g' -e 's#/#\\/#g' -e 's/\[/\\[/g' -e 's/\]/\\]/g'
}

missing=0
for cls in "${REQUIRED_CLASSES[@]}"; do
  esc="$(escape_class "$cls")"
  if grep -qF -- ".$esc" "$css_file"; then
    echo "✅ class  $cls"
  else
    echo "🔴 class  $cls — לא קיים ב-CSS המקומפל"
    missing=1
  fi
done
for var in "${REQUIRED_VARS[@]}"; do
  if grep -qF -- "$var:" "$css_file"; then
    echo "✅ var    $var"
  else
    echo "🔴 var    $var — לא מוגדר ב-CSS המקומפל"
    missing=1
  fi
done

if [ "$missing" -eq 0 ]; then
  echo "— הכול קיים; ההזרקות תואמות לגרסת ה-Chatwoot הזו. ✅"
else
  echo "— יש אסימונים חסרים: לעדכן את ההזרקות לפי המקור (components-next/sidebar) לפני פריסה. 🔴" >&2
  exit 1
fi
