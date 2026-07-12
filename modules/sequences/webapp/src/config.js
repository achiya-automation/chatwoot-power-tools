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

// ה-base נגזר בזמן *ריצה* מהכתובת של המודול עצמו — לא מוטבע ב-build.
//
// קודם הוא הגיע מ-VITE_ADDONS_BASE בזמן build, עם ברירת מחדל '/chatwoot-addons'. אבל
// ההתקנה בפועל בוחרת את ה-base שלה (כאן: '/drip'), ושום דבר לא אכף שה-build ידע עליו:
// מי שבנה לפי ההוראות בריפו (`npm run build`, בלי משתנה סביבה) קיבל bundle שמצביע על
// '/chatwoot-addons' — נתיב שלא קיים אצלו. התוצאה: ה-script לא נטען, ה-API מחזיר 404,
// והדשבורד נשאר לבן בלי שום שגיאה. מלכודת שקטה שתפגע בכל לקוח חדש.
//
// המודול הזה נארז לתוך `<base>/assets/main-<hash>.js`, ולכן הוא יודע בעצמו איפה הוא
// מוגש. אפס קונפיגורציה, אפס דרך לטעות.
function addonsBase() {
  const fallback = import.meta.env?.VITE_ADDONS_BASE || '/chatwoot-addons';
  try {
    if (typeof window === 'undefined') return fallback;          // node:test
    const u = new URL(import.meta.url, window.location.href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallback;
    // ‎<base>/assets/main-<hash>.js → <base>‎. ב-dev (vite serve) אין /assets/, ואז
    // נופלים לברירת המחדל — שם ה-proxy של vite כבר מטפל בנתיב.
    const m = u.pathname.match(/^(.*)\/assets\/[^/]+$/);
    return m ? m[1] : fallback;
  } catch {
    return fallback;
  }
}

export const API_BASE = `${addonsBase()}/drip-api`;

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
