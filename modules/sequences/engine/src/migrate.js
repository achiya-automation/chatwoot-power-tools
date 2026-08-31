import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const OWNER_MIGRATION_MARKER = '_role_grants.sql';
const ENHANCEMENT_MIGRATIONS = new Set([
  '012_media.sql',
  '019_template_media.sql',
  '027_sso_tickets.sql',
  '028_campaign_audience_snapshots.sql',
  '029_campaign_send_snapshots.sql',
  '045_campaign_report_indexes.sql',
  '047_media_dedupe.sql',
  '048_campaign_resend_experiments.sql',
]);
const ENHANCEMENT_OWNER_MIGRATIONS = new Set([
  '051_campaign_recipients_role_grants.sql',
  '054_mobile_access_role_grants.sql',
]);

function migrationSelection(files, enabledModules) {
  const enabled = new Set(enabledModules);
  const sequences = enabled.has('sequences');
  const enhancements = enabled.has('enhancements');
  const ordinary = files.filter(f => !f.endsWith(OWNER_MIGRATION_MARKER));
  const owners = files.filter(f => f.endsWith(OWNER_MIGRATION_MARKER));
  return {
    engineFiles: sequences ? ordinary : ordinary.filter(f => enhancements && ENHANCEMENT_MIGRATIONS.has(f)),
    ownerFiles: sequences ? owners : owners.filter(f => enhancements && ENHANCEMENT_OWNER_MIGRATIONS.has(f)),
  };
}

export async function runMigrations(pool, enabledModules = ['import', 'sequences', 'enhancements']) {
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
    const { engineFiles, ownerFiles } = migrationSelection(files, enabledModules);
    for (const f of engineFiles) {
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

    // These companions create/grant SECURITY DEFINER entry points or access to Chatwoot's
    // public tables, so drip_engine cannot safely execute them itself. The installer applies
    // them as the DB owner *after* the ordinary schema is complete and records each filename
    // in the same ledger. Do not silently `continue`: a missing marker must be visible in the
    // engine logs and in the return value so a clean install cannot look complete while a
    // required owner grant is absent.
    const pendingOwnerMigrations = [];
    for (const f of ownerFiles) {
      const done = await c.query('SELECT 1 FROM drip.schema_migrations WHERE version=$1', [f]);
      if (!done.rowCount) pendingOwnerMigrations.push(f);
    }
    if (pendingOwnerMigrations.length) {
      console.warn(
        `[drip] owner migrations pending (run install.sh): ${pendingOwnerMigrations.join(', ')}`,
      );
    }
    return { pendingOwnerMigrations };
  } finally {
    // pg שולח את statement_timeout של הבריכה ב-startup packet, ולכן RESET מחזיר את
    // החיבור לתקרת הבריכה — ולא לברירת המחדל של השרת. בלי זה חיבור אחד מתוך חמישה היה
    // חוזר לבריכה בלי תקרה בכלל, וממשיך להיות הפרצה שסגרנו.
    await c.query('RESET statement_timeout').catch(() => {});
    c.release();
  }
}
