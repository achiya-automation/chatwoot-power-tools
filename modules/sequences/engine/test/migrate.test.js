import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
before(async () => { getPool(cfg); await runMigrations(getPool(cfg)); });

test('migrations create drip.sequences', async () => {
  const rows = await query("SELECT to_regclass('drip.sequences') AS t");
  assert.equal(rows[0].t, 'drip.sequences');
});
test('runMigrations is idempotent', async () => {
  await runMigrations(getPool(cfg)); // second run must not throw
  assert.ok(true);
});
