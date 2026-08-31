import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { setupDb } from './helpers.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
before(async () => { getPool(cfg); await setupDb(getPool(cfg)); });

test('migrations create drip.sequences', async () => {
  const rows = await query("SELECT to_regclass('drip.sequences') AS t");
  assert.equal(rows[0].t, 'drip.sequences');
});
test('runMigrations is idempotent', async () => {
  await runMigrations(getPool(cfg)); // second run must not throw
  assert.ok(true);
});

test('presence schema defaults fail closed for newly inserted settings', async () => {
  const accountId = 2_147_483_000;
  try {
    const rows = await query(
      `INSERT INTO drip.presence_settings (account_id, inbox_id)
       VALUES ($1, 0)
       ON CONFLICT (account_id, inbox_id) DO UPDATE SET updated_at = now()
       RETURNING read_receipts, typing_mode`,
      [accountId]
    );
    assert.equal(rows[0].read_receipts, false);
    assert.equal(rows[0].typing_mode, 'off');
  } finally {
    await query('DELETE FROM drip.presence_settings WHERE account_id = $1', [accountId]);
  }
});
