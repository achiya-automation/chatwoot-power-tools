/*
 * csv.js — בריחת שדה CSV אחת ויחידה לכל הייצואים (pure, ניתנת לבדיקה ב-node --test).
 *
 * הגנה מפני הזרקת נוסחאות (CWE-1236): ערכים שמקורם בפרופיל וואטסאפ (שם/טלפון) אינם
 * מהימנים — תא שמתחיל ב-= + - @ טאב או CR מתפרש כנוסחה ב-Excel/Sheets, לכן מקדימים
 * גרש בודד. בנוסף: ציטוט כל שדה + הכפלת גרשיים כפולים (RFC 4180).
 */
export function csvField(value) {
  const s = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** שורת CSV שלמה מתוך מערך ערכים. */
export function csvRow(values) {
  return values.map(csvField).join(',');
}
