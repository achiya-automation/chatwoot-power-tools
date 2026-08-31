import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, parseEnabledModules } from '../src/config.js';

test('loadConfig reads env with defaults', () => {
  const cfg = loadConfig({ DATABASE_URL: 'postgres://x', CHATWOOT_BASE_URL: 'http://r:3000' });
  assert.equal(cfg.databaseUrl, 'postgres://x');
  assert.equal(cfg.port, 3100);
  assert.equal(cfg.reconcileIntervalMs, 60000);
  assert.deepEqual(cfg.enabledModules, ['import', 'sequences', 'enhancements']);
});

test('module selection is normalized, deduplicated and rejects unknown names', () => {
  assert.deepEqual(parseEnabledModules('import,sequences,import'), ['import', 'sequences']);
  assert.throws(() => parseEnabledModules('import,unknown'), /unknown CWPT_ENABLED_MODULES/);
});

test('import-only mode does not require a database connection', () => {
  const cfg = loadConfig({
    CWPT_ENABLED_MODULES: 'import',
    CHATWOOT_BASE_URL: 'http://r:3000',
  });
  assert.equal(cfg.databaseUrl, '');
  assert.equal(cfg.databaseFeaturesEnabled, false);
});

test('database-backed modules still fail closed without DATABASE_URL', () => {
  assert.throws(
    () => loadConfig({ CWPT_ENABLED_MODULES: 'enhancements', CHATWOOT_BASE_URL: 'http://r:3000' }),
    /DATABASE_URL/,
  );
});

test('loadConfig throws when CHATWOOT_BASE_URL missing', () => {
  const env = { DATABASE_URL: 'postgres://x', PORT: '3100' };
  assert.throws(() => loadConfig(env), /CHATWOOT_BASE_URL/);
});

test('loadConfig has no hardcoded achiya domain', () => {
  const env = { DATABASE_URL: 'postgres://x', CHATWOOT_BASE_URL: 'http://rails:3000', PORT: '3100' };
  const cfg = loadConfig(env);
  assert.ok(!JSON.stringify(cfg).includes('achiya'));
});
