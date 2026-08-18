/**
 * scheduled_messages.test.js — the queue behind the reply-box clock button.
 *
 * No database: runDueScheduledMessages takes `query` and `makeClientFor` as dependencies, so
 * the interesting behaviour (claim-before-send, the staleness window, per-row failure
 * isolation) is testable against fakes. Run: node --test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRunAt, runDueScheduledMessages } from '../src/scheduledMessages.js';

const NOW = Date.UTC(2026, 7, 18, 12, 0, 0);

// ── parseRunAt ───────────────────────────────────────────────────────────────

test('parseRunAt accepts a time comfortably in the future', () => {
  const d = parseRunAt(new Date(NOW + 3600_000).toISOString(), { now: NOW });
  assert.ok(d instanceof Date);
  assert.equal(d.getTime(), NOW + 3600_000);
});

test('parseRunAt rejects the past, the immediate present, and nonsense', () => {
  // "in 10 seconds" is rejected on purpose: it is indistinguishable from Send, and a row that
  // fires before the agent can cancel it is worse than no scheduling at all.
  for (const v of [
    new Date(NOW - 1000).toISOString(),
    new Date(NOW + 10_000).toISOString(),
    'not-a-date', '', null, undefined,
  ]) {
    assert.equal(parseRunAt(v, { now: NOW }), null, `${String(v)} should be rejected`);
  }
});

test('parseRunAt rejects a time beyond the horizon', () => {
  assert.equal(parseRunAt(new Date(NOW + 61 * 86400_000).toISOString(), { now: NOW }), null);
  assert.ok(parseRunAt(new Date(NOW + 59 * 86400_000).toISOString(), { now: NOW }));
});

// ── runDueScheduledMessages ──────────────────────────────────────────────────

function harness(rows, { sendImpl } = {}) {
  const updates = [];
  const sent = [];
  const query = async (sql, params) => {
    if (/UPDATE drip\.scheduled_messages\s+SET started_at/.test(sql)) return rows;
    updates.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    return [];
  };
  const makeClientFor = async () => ({
    sendText: async (cid, content) => {
      if (sendImpl) return sendImpl(cid, content);
      sent.push({ cid, content });
      return { id: 900 + sent.length };
    },
  });
  return { query, makeClientFor, updates, sent };
}

const row = (over = {}) => ({
  id: 1, account_id: 5, conversation_id: 42, content: 'שלום',
  run_at: new Date(NOW - 60_000).toISOString(), ...over,
});

test('a due row is sent and stamped with the resulting message id', async () => {
  const h = harness([row()]);
  const r = await runDueScheduledMessages({ ...h, now: () => NOW });
  assert.deepEqual(r, { due: 1, sent: 1, skipped: 0 });
  assert.deepEqual(h.sent, [{ cid: 42, content: 'שלום' }]);
  const stamp = h.updates.find(u => u.sql.includes('sent_at = now()'));
  assert.ok(stamp, 'sent_at must be written');
  assert.deepEqual(stamp.params, [1, 901]);
});

test('a row whose time passed long ago is skipped, not sent', async () => {
  // A server that was down overnight must not wake up and fire a burst of "tomorrow morning"
  // messages at customers hours late.
  const h = harness([row({ run_at: new Date(NOW - 7 * 3600_000).toISOString() })]);
  const r = await runDueScheduledMessages({ ...h, now: () => NOW });
  assert.deepEqual(r, { due: 1, sent: 0, skipped: 1 });
  assert.deepEqual(h.sent, []);
  assert.ok(h.updates.some(u => String(u.params[1]).includes('staleness')));
});

test('a row just inside the window is still sent', async () => {
  const h = harness([row({ run_at: new Date(NOW - 5 * 3600_000).toISOString() })]);
  const r = await runDueScheduledMessages({ ...h, now: () => NOW });
  assert.equal(r.sent, 1);
});

test('one failing row records its error and does not stop the others', async () => {
  const h = harness([row({ id: 1 }), row({ id: 2, conversation_id: 43 })], {
    sendImpl: cid => {
      if (cid === 42) throw new Error('Chatwoot POST → 404');
      return { id: 777 };
    },
  });
  const r = await runDueScheduledMessages({ ...h, now: () => NOW, log: { error() {} } });
  assert.equal(r.sent, 1, 'the healthy row must still go out');
  const err = h.updates.find(u => u.sql.includes('SET error') && u.params[0] === 1);
  assert.ok(err && err.params[1].includes('404'));
});

test('the claim query only ever takes rows that have not started', async () => {
  // The guard against double-sending lives in SQL, so assert it is actually in the statement.
  let claim = '';
  const query = async sql => {
    if (/SET started_at/.test(sql)) { claim = sql; return []; }
    return [];
  };
  await runDueScheduledMessages({ query, makeClientFor: async () => ({}), now: () => NOW });
  assert.match(claim, /started_at IS NULL/);
  assert.match(claim, /run_at <= now\(\)/);
  assert.match(claim, /FOR UPDATE SKIP LOCKED/);
});
