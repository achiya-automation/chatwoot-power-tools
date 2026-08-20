/*
 * swr — stale-while-revalidate זעיר על sessionStorage.
 *
 * דשבורד הקמפיינים מצייר מיד את העותק האחרון שנשמר (אפס skeleton במעבר חוזר לטאב),
 * ומרענן ברקע. sessionStorage ולא localStorage בכוונה: העותק חי כאורך הטאב — נתוני
 * חשבון לא נשארים על הדיסק אחרי סגירה, וטאב חדש מתחיל נקי.
 */
const PREFIX = 'drip-swr:';

export function readCache(key) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // אחסון חסום (private mode) / JSON פגום → פשוט אין cache
  }
}

export function writeCache(key, data) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(data));
  } catch { /* מכסה מלאה / חסום — מוותרים בשקט, ה-fetch הרגיל עדיין עובד */ }
}
