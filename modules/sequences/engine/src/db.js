import pg from 'pg';
let pool;
export function getPool(config) {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 5,
      // רשת ביטחון: שאילתה שגולשת מעבר לדקה מתה במקום להחזיק חיבור מתוך חמישה. בלי זה
      // שאילתה כבדה אחת (10.8.26: anti-join ריבועי של 125 שניות) מרעיבה את הבריכה — ואיתה
      // נופלים גם ה-API של שאר הלקוחות וגם לולאת השליחה, שחולקים אותה בריכה בדיוק.
      // מיגרציות פטורות (ראה runMigrations) — CREATE INDEX על טבלה גדולה עובר דקה בקלות.
      statement_timeout: 60_000,
      // בלי זה, בריכה מלאה גורמת ל-connect() להמתין לנצח במקום להיכשל — טיק תקוע
      // אחד היה מבליע גם את ה-API של הפאנל, שחולק את אותה בריכה.
      connectionTimeoutMillis: 10_000,
    });
    // ⚠️ חובה. pg פולט 'error' על *חיבור סרק* שנפל (ריסטרט של המסד, ניתוק רשת רגעי).
    // בלי מאזין זו חריגה לא-מטופלת ש-Node מתרגם לקריסת התהליך — ואותו תהליך מריץ גם
    // את ה-API של כל הלקוחות וגם את לולאת השליחה. הבריכה מחליפה את החיבור בעצמה;
    // מספיק לתעד ולהמשיך.
    pool.on('error', (e) => console.error('[drip] pg idle-client error (recovered):', e.message));
  }
  return pool;
}
export async function query(text, params) { return (await pool.query(text, params)).rows; }
export async function withTx(pool, fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
