import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMigrations } from '../src/migrate.js';

const OWNER_FILES = [
  '024_auto_onboard_role_grants.sql',
  '033_journeys_role_grants.sql',
  '051_campaign_recipients_role_grants.sql',
  '053_presence_role_grants.sql',
  '054_mobile_access_role_grants.sql',
];

function fakePool(doneOwnerFiles = []) {
  const done = new Set(doneOwnerFiles);
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT 1 FROM drip.schema_migrations WHERE version=')) {
        const filename = params[0];
        if (filename.endsWith('_role_grants.sql')) {
          return { rowCount: done.has(filename) ? 1 : 0 };
        }
        // Keep the test focused: ordinary migrations are already applied.
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    },
    release() {},
  };
  return { pool: { async connect() { return client; } }, calls };
}

test('owner-only migrations are checked and reported instead of silently skipped', async () => {
  const { pool, calls } = fakePool();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = message => warnings.push(message);
  try {
    const result = await runMigrations(pool);
    assert.deepEqual(result.pendingOwnerMigrations, OWNER_FILES);
  } finally {
    console.warn = originalWarn;
  }

  const checked = calls
    .filter(call => call.sql.startsWith('SELECT 1 FROM drip.schema_migrations WHERE version='))
    .map(call => call.params[0])
    .filter(filename => filename.endsWith('_role_grants.sql'));
  assert.deepEqual(checked, OWNER_FILES);
  assert.equal(warnings.length, 1);
  for (const filename of OWNER_FILES) assert.match(warnings[0], new RegExp(filename));
});

test('recorded owner-only migrations produce no pending warning', async () => {
  const { pool } = fakePool(OWNER_FILES);
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = message => warnings.push(message);
  try {
    const result = await runMigrations(pool);
    assert.deepEqual(result.pendingOwnerMigrations, []);
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(warnings, []);
});

test('dashboard-only migration plan keeps campaign and mobile-access grants but excludes sequence owners', async () => {
  const { pool, calls } = fakePool([
    '051_campaign_recipients_role_grants.sql',
    '054_mobile_access_role_grants.sql',
  ]);
  const result = await runMigrations(pool, ['enhancements']);
  assert.deepEqual(result.pendingOwnerMigrations, []);

  const checked = calls
    .filter(call => call.sql.startsWith('SELECT 1 FROM drip.schema_migrations WHERE version='))
    .map(call => call.params[0]);
  assert.deepEqual(checked.filter(name => !name.endsWith('_role_grants.sql')), [
    '012_media.sql',
    '019_template_media.sql',
    '027_sso_tickets.sql',
    '028_campaign_audience_snapshots.sql',
    '029_campaign_send_snapshots.sql',
    '045_campaign_report_indexes.sql',
    '047_media_dedupe.sql',
    '048_campaign_resend_experiments.sql',
  ]);
  assert.deepEqual(checked.filter(name => name.endsWith('_role_grants.sql')), [
    '051_campaign_recipients_role_grants.sql',
    '054_mobile_access_role_grants.sql',
  ]);
  assert.ok(!checked.includes('001_drip_schema.sql'));
  assert.ok(!checked.includes('024_auto_onboard_role_grants.sql'));
  assert.ok(!checked.includes('033_journeys_role_grants.sql'));
  assert.ok(!checked.includes('053_presence_role_grants.sql'));
});
