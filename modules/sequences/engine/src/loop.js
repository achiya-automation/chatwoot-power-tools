/**
 * loop.js — לולאת רקע שלא נכנסת לעצמה.
 *
 * ⭐ 10.08.2026 — למה זה קיים: `setInterval` יורה לפי שעון בלבד, בלי קשר לשאלה אם
 * הסבב הקודם הסתיים. כשסבב נמשך יותר מהמרווח (מסד עמוס, קריאה תקועה מול מטא)
 * נערמים סבבים במקביל, וכל אחד מהם מושך חיבורים מבריכה של חמישה — כלומר הלולאה
 * מחריפה בעצמה בדיוק את המחסור שעיכב אותה.
 *
 * נמדד: שאילתת דשבורד של 128 שניות תפסה חיבורים, כל שאילתה של הנוכחות חיכתה
 * 10 שניות ל-connect ואז נכשלה, ולולאת הנוכחות (כל 2 שניות) המשיכה להזרים סבבים
 * חדשים לאותו תור — 143 שגיאות "timeout exceeded when trying to connect" ביממה.
 * לולאת השליחה, שכבר החזיקה את הנעילה הזאת, לא ייצרה אף אחת מהן.
 *
 * דילוג הוא הדבר הנכון: הסבב הבא יטפל באותה עבודה ממילא — שתי הלולאות עובדות מול
 * סמן/תור מתמשך, לא מול אירוע חד-פעמי.
 */
export function startLoop(intervalMs, label, fn, { warn = console.warn, error = console.error } = {}) {
  const state = { running: false, skipped: 0 };
  const timer = setInterval(async () => {
    if (state.running) { state.skipped += 1; return; }
    state.running = true;
    try {
      await fn();
    } catch (e) {
      error(`${label} tick error:`, e.message);
    } finally {
      state.running = false;
      // מדווחים פעם אחת בסוף הסבב האיטי ולא על כל דילוג: במרווח של 2 שניות
      // דיווח-לכל-דילוג הוא עשרות שורות לתקלה אחת, וזה מטשטש את הסיבה.
      if (state.skipped) {
        warn(`${label} slow tick — skipped ${state.skipped} cycle(s)`);
        state.skipped = 0;
      }
    }
  }, intervalMs);
  return { timer, isRunning: () => state.running };
}
