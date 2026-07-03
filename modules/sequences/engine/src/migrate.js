import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function runMigrations(pool) {
  await pool.query('CREATE SCHEMA IF NOT EXISTS drip');
  await pool.query('CREATE TABLE IF NOT EXISTS drip.schema_migrations (version text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  // Skip macOS AppleDouble sidecar files (._*.sql) that some file transfers create;
  // they are binary and would crash the SQL runner (08P01) if treated as migrations.
  const files = (await readdir(DIR)).filter(f => f.endsWith('.sql') && !f.startsWith('._')).sort();
  for (const f of files) {
    if (f.includes('role_grants')) continue; // run by superuser, not engine
    const done = await pool.query('SELECT 1 FROM drip.schema_migrations WHERE version=$1', [f]);
    if (done.rowCount) continue;
    try {
      await pool.query(await readFile(join(DIR, f), 'utf8'));
    } catch (err) {
      // Fail fast with a clear pointer — never boot the engine on a half-applied schema.
      throw new Error(`migration ${f} failed: ${err.message}`);
    }
    await pool.query('INSERT INTO drip.schema_migrations(version) VALUES ($1)', [f]);
  }
}
