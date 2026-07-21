/**
 * templates_poll.test.js — Template Studio: pending-status poll (Task 7).
 *
 * Pure mock-query + mock-fetch, same style as templates_write.test.js: every call below
 * passes mock `query`/`fetchImpl` directly, so neither db.js's real pool nor a real Graph
 * call is ever touched. Runs without DATABASE_URL_TEST.
 *
 * Run: DATABASE_URL_TEST=postgres://localhost:5432/drip_test node --test test/templates_poll.test.js
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pollTemplateStatuses, _resetPollForTests } from '../src/templates.js';

beforeEach(() => _resetPollForTests());

// A mock `query` that answers the three shapes pollTemplateStatuses issues:
//   1) the recent-audit WABA scan   → wabas
//   2) the per-WABA token lookup    → tokens[wabaId]
//   3) syncWabaToChatwoot's UPDATE  → counted into `updates`
function makeQuery(wabas, tokens, updates) {
  return async (text, params) => {
    if (text.includes('FROM drip.template_audit')) return wabas.map((waba_id) => ({ waba_id }));
    if (text.includes('FROM public.channel_whatsapp') && text.includes('api_key')) {
      const token = tokens[params[0]];
      return token ? [{ token }] : [];
    }
    if (text.includes('UPDATE public.channel_whatsapp')) { updates.push(params); return [{ id: 1 }]; }
    throw new Error(`unexpected query: ${text}`);
  };
}

test('poll: unchanged hash issues exactly one UPDATE across two polls 11 minutes apart', async () => {
  const updates = [];
  const query = makeQuery(['W1'], { W1: 't1' }, updates);
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return { ok: true, status: 200, json: async () => ({ data: [{ id: '1', name: 'promo', status: 'APPROVED', category: 'MARKETING', language: 'he', components: [] }] }) };
  };

  const t0 = new Date('2026-01-01T00:00:00Z');
  await pollTemplateStatuses({ query, fetchImpl }, t0);
  assert.equal(updates.length, 1, 'first poll sees an unseen WABA → treated as changed → one sync UPDATE');
  assert.ok(fetchCalls > 0, 'first poll actually fetched from Graph');

  const t1 = new Date(t0.getTime() + 11 * 60 * 1000);   // +11 min → past the 10-min throttle
  await pollTemplateStatuses({ query, fetchImpl }, t1);
  assert.equal(updates.length, 1, 'same template list on the second poll → hash unchanged → no second UPDATE');
});

test('poll: throttles to 10 minutes — a call 1 minute later is a no-op, fetch not called', async () => {
  const updates = [];
  const query = makeQuery(['W1'], { W1: 't1' }, updates);
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };

  const t0 = new Date('2026-01-01T00:00:00Z');
  await pollTemplateStatuses({ query, fetchImpl }, t0);
  const callsAfterFirst = fetchCalls;
  assert.ok(callsAfterFirst > 0, 'first poll fetches');

  const t1 = new Date(t0.getTime() + 60 * 1000);   // +1 min → still inside the throttle window
  await pollTemplateStatuses({ query, fetchImpl }, t1);
  assert.equal(fetchCalls, callsAfterFirst, 'throttled poll must not call fetch at all');
});

test('poll: a changed list on a later poll issues a second UPDATE', async () => {
  const updates = [];
  const query = makeQuery(['W1'], { W1: 't1' }, updates);
  let version = 'v1';
  const fetchImpl = async () => ({
    ok: true, status: 200,
    json: async () => ({ data: [{ id: '1', name: version, status: 'APPROVED', category: 'MARKETING', language: 'he', components: [] }] }),
  });

  const t0 = new Date('2026-01-01T00:00:00Z');
  await pollTemplateStatuses({ query, fetchImpl }, t0);
  assert.equal(updates.length, 1, 'first poll (unseen WABA) syncs once');

  version = 'v2';   // the template list actually changed on Meta's side
  const t1 = new Date(t0.getTime() + 11 * 60 * 1000);
  await pollTemplateStatuses({ query, fetchImpl }, t1);
  assert.equal(updates.length, 2, 'changed list on the second poll must issue a second UPDATE');
});

test('poll: per-WABA error isolation — first WABA throws, second WABA still syncs', async () => {
  const updates = [];
  const query = makeQuery(['W1', 'W2'], { W1: 't1', W2: 't2' }, updates);
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/W1/')) throw new Error('network down for W1');
    return { ok: true, status: 200, json: async () => ({ data: [{ id: '2', name: 'ok', status: 'APPROVED', category: 'MARKETING', language: 'he', components: [] }] }) };
  };

  const realConsoleError = console.error;
  const errs = [];
  console.error = (...args) => errs.push(args);
  try {
    await pollTemplateStatuses({ query, fetchImpl }, new Date('2026-01-01T00:00:00Z'));
  } finally {
    console.error = realConsoleError;
  }

  assert.equal(updates.length, 1, 'W2 still syncs even though W1 failed');
  assert.equal(updates[0][1], 'W2', 'the UPDATE that did go through is for W2, not the failing W1');
  assert.ok(errs.some((a) => String(a[0]).includes('W1') || String(a.join(' ')).includes('W1')), 'the W1 failure is logged, not swallowed silently');
});
