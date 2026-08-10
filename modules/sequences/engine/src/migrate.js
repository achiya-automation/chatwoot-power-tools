import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function runMigrations(pool) {
  // חיבור ייעודי אחד לכל הריצה, כדי שאפשר יהיה לבטל עליו את statement_timeout של הבריכה:
  // מיגרציה שבונה אינדקס על טבלה גדולה עוברת דקה בקלות, ותקרת הבריכה הייתה הורגת אותה
  // באמצע ומשאירה סכימה חצי-מיושמת. ה-SET הוא per-session, ולכן חייב את אותו חיבור.
  const c = await pool.connect();
  try {
    await c.query('SET statement_timeout = 0');
    await c.query('CREATE SCHEMA IF NOT EXISTS drip');
    await c.query('CREATE TABLE IF NOT EXISTS drip.schema_migrations (version text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
    // Skip macOS AppleDouble sidecar files (._*.sql) that some file transfers create;
    // they are binary and would crash the SQL runner (08P01) if treated as migrations.
    const files = (await readdir(DIR)).filter(f => f.endsWith('.sql') && !f.startsWith('._')).sort();
    for (const f of files) {
      if (f.includes('role_grants')) continue; // run by superuser, not engine
      const done = await c.query('SELECT 1 FROM drip.schema_migrations WHERE version=$1', [f]);
      if (done.rowCount) continue;
      try {
        await c.query(await readFile(join(DIR, f), 'utf8'));
      } catch (err) {
        // Fail fast with a clear pointer — never boot the engine on a half-applied schema.
        throw new Error(`migration ${f} failed: ${err.message}`);
      }
      await c.query('INSERT INTO drip.schema_migrations(version) VALUES ($1)', [f]);
    }
  } finally {
    // pg שולח את statement_timeout של הבריכה ב-startup packet, ולכן RESET מחזיר את
    // החיבור לתקרת הבריכה — ולא לברירת המחדל של השרת. בלי זה חיבור אחד מתוך חמישה היה
    // חוזר לבריכה בלי תקרה בכלל, וממשיך להיות הפרצה שסגרנו.
    await c.query('RESET statement_timeout').catch(() => {});
    c.release();
  }
}
