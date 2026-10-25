/**
 * journeys-webhook.test.js — no DB: an account with no active flow must drop its journeys
 * webhook (a row left from before a secret rotation fails with 404 on every event).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileJourneys } from '../src/journeys.js';

function recorder() {
  const sql = [];
  return { sql, query: async (text, params) => { sql.push({ text, params }); return []; } };
}
const hook = { journeyHookBase: 'http://drip-engine:3100', journeyHookSecret: 'x'.repeat(32) };

test('no active journeys + hook configured: drops the account webhook', async () => {
  const r = recorder();
  await reconcileJourneys({ query: r.query, config: hook, log: { warn() {} } }, 7);
  const drop = r.sql.find((q) => q.text.includes('drip.drop_journey_webhook'));
  assert.ok(drop, 'drop_journey_webhook was not called');
  assert.deepEqual(drop.params, [7]);
  assert.ok(!r.sql.some((q) => q.text.includes('ensure_journey_webhook')));
});

test('no active journeys + no hook config: touches no webhook', async () => {
  const r = recorder();
  await reconcileJourneys({ query: r.query, config: {}, log: { warn() {} } }, 7);
  assert.ok(!r.sql.some((q) => /journey_webhook/.test(q.text)));
});

test('drop failure (migration 056 not applied) is a warning, not a crash', async () => {
  const warned = [];
  const query = async (text) => { if (text.includes('drop_journey_webhook')) throw new Error('no such function'); return []; };
  await reconcileJourneys({ query, config: hook, log: { warn: (m) => warned.push(m) } }, 7);
  assert.equal(warned.length, 1);
});
