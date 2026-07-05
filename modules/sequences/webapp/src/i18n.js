/*
 * i18n — ליבת התרגום הדו-לשונית (he / en). חסרת-React בכוונה: קבצים לא-React
 * (lib/timeline.js, lib/deliveryError.js) מיובאים ישירות ע"י בדיקות ה-engine
 * ב-node, ואלה אינן מכירות React. ה-hook הריאקטיבי (useT / useLocale) חי בקובץ
 * נפרד — useT.js — שמייבא React.
 *
 * מקור ה-locale: ?locale=he|en ב-URL (מוזרק ע"י ה-injector, בדיוק כמו ?theme=).
 * ברירת מחדל 'he' (גם כשאין DOM — סביבת node → בדיקות ה-engine נשארות עבריות).
 * עדכון חי דרך setLocale() (postMessage 'drip-locale' מ-Chatwoot).
 */

const SUPPORTED = ['he', 'en'];
export const DEFAULT_LOCALE = 'he';

function readInitialLocale() {
  try {
    const v = new URLSearchParams(window.location.search).get('locale');
    return SUPPORTED.includes(v) ? v : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE; // node / ללא-DOM (בדיקות engine) → עברית
  }
}

let currentLocale = readInitialLocale();
const listeners = new Set();

export function getLocale() {
  return currentLocale;
}

// מנוי לשינויי locale (משמש את useLocale דרך useSyncExternalStore). מחזיר unsubscribe.
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// החלפת שפה חיה — מעדכן את <html lang/dir> ומודיע לכל המנויים (→ re-render של React).
export function setLocale(next) {
  if (!SUPPORTED.includes(next) || next === currentLocale) return;
  currentLocale = next;
  applyDocumentDir();
  listeners.forEach((fn) => fn());
}

// כיוון הכתיבה לפי שפה (עברית = rtl). null-safe, ברירת מחדל = ה-locale הנוכחי.
export function dirFor(locale = currentLocale) {
  return locale === 'he' ? 'rtl' : 'ltr';
}

// מסנכרן את <html lang/dir> ל-locale הנוכחי. בטוח ב-node (ללא document → no-op).
export function applyDocumentDir() {
  try {
    const el = document.documentElement;
    el.setAttribute('lang', currentLocale);
    el.setAttribute('dir', dirFor());
  } catch {
    /* ללא DOM */
  }
}

// אינטרפולציה פשוטה: "שלום {name}" + {name:'דנה'} → "שלום דנה". placeholder לא-ידוע נשאר כמות-שהוא.
function interpolate(str, vars) {
  if (!vars) return str;
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}

/*
 * translate(messages, key, vars) — חיפוש שטוח לפי ה-locale הנוכחי.
 *   messages = { he: {...}, en: {...} }
 * נפילה-לאחור: locale → he → המפתח עצמו. גרסה לא-ריאקטיבית (קוראת getLocale פעם
 * אחת) — לשימוש בקוד לא-React (lib / api). רכיבי React משתמשים ב-useT(messages).
 */
export function translate(messages, key, vars) {
  const table = (messages && messages[currentLocale]) || {};
  const fallback = (messages && messages[DEFAULT_LOCALE]) || {};
  const s = table[key] != null ? table[key] : fallback[key] != null ? fallback[key] : key;
  return interpolate(s, vars);
}
