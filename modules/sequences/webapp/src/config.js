/*
 * config — נקודות חיבור ל-backend.
 *
 * API_BASE: נקודת הקצה של ה-engine (drip-engine) ל-CRUD על schema drip.
 *   נגזר מ-VITE_ADDONS_BASE (base של כל התוספות, ברירת מחדל /chatwoot-addons) —
 *   אפס דומיין קשוח, ניתן להזיז ל-base אחר בזמן build/dev.
 *
 * resolveAccountId: מאיזה account לטעון רצפים.
 *   1. ?account_id=N ב-URL (גובר — שימושי ל-iframe מוטמע ולפיתוח עצמאי)
 *   2. conversation.account_id מתוך ה-Dashboard App context של Chatwoot
 */

// ברירת מחדל יחסית = same-origin (route יחיד /chatwoot-addons/*, engine מוגש תחתיו
// ב-production, vite proxy ב-dev) → אפס CORS. `?.` על import.meta.env כי הוא לא מוגדר
// כשהקובץ נטען דרך node:test רגיל (לא Vite) — תחת Vite הוא תמיד object מוגדר.
export const API_BASE =
  (import.meta.env?.VITE_ADDONS_BASE || '/chatwoot-addons') + '/drip-api';

export function accountIdFromUrl() {
  try {
    const v = new URLSearchParams(window.location.search).get('account_id');
    return v ? parseInt(v, 10) : null;
  } catch {
    return null;
  }
}

export function resolveAccountId(conversation) {
  return (
    accountIdFromUrl() ||
    (conversation && conversation.account_id) ||
    null
  );
}

// האם האפליקציה מוטמעת בתוך Chatwoot (?embed=1 ב-URL)?
// במצב זה מסתירים את הכותרת הגדולה והבאנר — הם כפילות לניווט של Chatwoot.
export function isEmbedded() {
  try {
    return new URLSearchParams(window.location.search).get('embed') === '1';
  } catch {
    return false;
  }
}

// האם הניווט (סקירה/רצפים/אנשי קשר) מוגש מהסיידבר של Chatwoot (?nav=side)?
// אז מסתירים את שורת הטאבים הפנימית — הניווט הוא פריטי-המשנה בסרגל הצד (כמו "קמפיין").
export function isSideNav() {
  try {
    return new URLSearchParams(window.location.search).get('nav') === 'side';
  } catch {
    return false;
  }
}
