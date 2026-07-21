/**
 * templates_graph.test.js — Template Studio: Graph client, pagination, capabilities,
 * and the tpl_list dispatcher action.
 *
 * Pure mock-fetch: no network, and every handleTemplatesAction call below passes a mock
 * `reads` directly, so `makeDbReads`/db.js's real `query` is never invoked and no DB
 * connection opens. Runs without DATABASE_URL_TEST.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  listWabaTemplates, metaError, wabaCapabilities, _resetCapCacheForTests, handleTemplatesAction,
} from '../src/templates.js';

beforeEach(() => _resetCapCacheForTests());

// ── listWabaTemplates: pagination ───────────────────────────────────────────

const page2 = { data: [{ id: '2', name: 'b', status: 'PENDING', category: 'UTILITY', language: 'he', components: [] }] };
// Realistic paging.next: Meta embeds access_token itself. The code under test must strip
// it before refetching — this shape is exactly what reproduced the double-token bug.
const page1 = {
  data: [{ id: '1', name: 'a', status: 'APPROVED', category: 'MARKETING', language: 'he', components: [], quality_score: { score: 'GREEN' } }],
  paging: { next: 'https://graph.facebook.com/v21.0/W1/message_templates?access_token=SECRET_TOKEN&after=abc' },
};
const okFetch = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes('after=abc') ? page2 : page1) });

test('listWabaTemplates follows pagination, stripping access_token from paging.next and re-authenticating via the header', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), headers: (opts && opts.headers) || {} });
    return okFetch(url);
  };
  const all = await listWabaTemplates('W1', 'tok', fetchImpl);
  assert.deepEqual(all.map((t) => t.name), ['a', 'b']);

  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.includes('after=abc'), 'second fetch keeps the real pagination cursor');
  assert.ok(!calls[1].url.includes('access_token'), 'second fetch must not carry access_token in the URL');
  assert.equal(calls[1].headers.Authorization, 'Bearer tok', 'second fetch must still authenticate via the header');
});

test('listWabaTemplates rejects with a metaError when a page fetch fails', async () => {
  const failFetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'boom', code: 1 } }) });
  await assert.rejects(() => listWabaTemplates('W1', 'tok', failFetch), (e) => {
    assert.match(e.message, /boom/);
    assert.equal(e.metaCode, 1);
    return true;
  });
});

test('listWabaTemplates requests include last_updated_time in the fields parameter', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), headers: (opts && opts.headers) || {} });
    return okFetch(url);
  };
  await listWabaTemplates('W1', 'tok', fetchImpl);
  assert.ok(calls.length > 0, 'expected at least one fetch call');
  assert.ok(calls.some((c) => c.url.includes('last_updated_time')), 'fields parameter must include last_updated_time');
});

// ── metaError ────────────────────────────────────────────────────────────────

test('metaError prefers user-facing message and keeps code', () => {
  const e = metaError({ error: { message: 'Invalid parameter', error_user_title: 'Name taken', error_user_msg: 'Pick another name', code: 100, error_subcode: 2388023 } });
  assert.match(e.message, /Name taken/);
  assert.equal(e.metaCode, 100);
});

test('metaError falls back to a generic message when there is no user-facing text, and handles a body with no error field at all', () => {
  const withCode = metaError({ error: { code: 190, error_subcode: 463 } });
  assert.equal(withCode.message, 'Meta API error');
  assert.equal(withCode.metaCode, 190);
  assert.equal(withCode.metaSubcode, 463);

  const empty = metaError({});
  assert.equal(empty.message, 'Meta API error');
  assert.equal(empty.metaCode, null);
  assert.equal(empty.metaSubcode, null);
});

// ── wabaCapabilities ─────────────────────────────────────────────────────────

test('wabaCapabilities: both Graph calls succeed → flows+mediaUpload true, no reason', async () => {
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/app?')) return { ok: true, status: 200, json: async () => ({ id: 'app999' }) };
    if (u.includes('/flows?')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'f1', name: 'Flow', status: 'PUBLISHED', extra: 'drop-me' }] }) };
    throw new Error(`unexpected url: ${u}`);
  };
  const cap = await wabaCapabilities('W1', 'tokA', fetchImpl);
  assert.deepEqual(cap, {
    flows: true,
    flowsList: [{ id: 'f1', name: 'Flow', status: 'PUBLISHED' }],   // extra Graph fields dropped
    mediaUpload: true,
    appId: 'app999',
  });
});

test('wabaCapabilities: flows call fails → flows false with bilingual reason, mediaUpload unaffected', async () => {
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/app?')) return { ok: true, status: 200, json: async () => ({ id: 'app1' }) };
    if (u.includes('/flows?')) return { ok: false, status: 403, json: async () => ({ error: { message: 'Unsupported request', error_user_title: 'Flows not enabled' } }) };
    throw new Error(`unexpected url: ${u}`);
  };
  const cap = await wabaCapabilities('W1', 'tokB', fetchImpl);
  assert.equal(cap.flows, false);
  assert.deepEqual(cap.flowsList, []);
  assert.equal(cap.mediaUpload, true);
  assert.equal(cap.appId, 'app1');
  assert.match(cap.reason_en, /Flows/);
  assert.ok(cap.reason_he.length > 0);
});

test('wabaCapabilities: app call fails → mediaUpload false with bilingual reason, flows unaffected', async () => {
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/app?')) return { ok: false, status: 400, json: async () => ({ error: { message: 'Invalid OAuth access token' } }) };
    if (u.includes('/flows?')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    throw new Error(`unexpected url: ${u}`);
  };
  const cap = await wabaCapabilities('W1', 'tokC', fetchImpl);
  assert.equal(cap.mediaUpload, false);
  assert.equal(cap.appId, null);
  assert.equal(cap.flows, true);
  assert.deepEqual(cap.flowsList, []);
  assert.match(cap.reason_en, /Media upload/);
  assert.ok(cap.reason_he.length > 0);
});

test('wabaCapabilities caches per token; hits the network again only after _resetCapCacheForTests', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const u = String(url);
    if (u.includes('/app?')) return { ok: true, status: 200, json: async () => ({ id: 'appD' }) };
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  await wabaCapabilities('W1', 'tokD', fetchImpl);
  const callsAfterFirst = calls;
  await wabaCapabilities('W1', 'tokD', fetchImpl);          // same token, within TTL → cache hit
  assert.equal(calls, callsAfterFirst, 'second call within TTL must not hit the network again');

  _resetCapCacheForTests();
  await wabaCapabilities('W1', 'tokD', fetchImpl);
  assert.ok(calls > callsAfterFirst, 'after reset, must fetch again');
});

test('wabaCapabilities re-fetches once the 10-minute TTL elapses', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const u = String(url);
    if (u.includes('/app?')) return { ok: true, status: 200, json: async () => ({ id: 'appE' }) };
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  const realNow = Date.now;
  try {
    Date.now = () => 1_000_000;
    await wabaCapabilities('W1', 'tokE', fetchImpl);
    const callsAfterFirst = calls;

    Date.now = () => 1_000_000 + 9 * 60 * 1000;         // +9 min → still within TTL
    await wabaCapabilities('W1', 'tokE', fetchImpl);
    assert.equal(calls, callsAfterFirst);

    Date.now = () => 1_000_000 + 11 * 60 * 1000;        // +11 min → TTL elapsed
    await wabaCapabilities('W1', 'tokE', fetchImpl);
    assert.ok(calls > callsAfterFirst);
  } finally {
    Date.now = realNow;
  }
});

// ── handleTemplatesAction / tpl_list ─────────────────────────────────────────

test('tpl_list groups channels by WABA and attaches templates', async () => {
  const reads = { getWhatsappCredsAll: async () => [
    { inboxId: 1, name: 'A', phone: '+1', token: 'tok', phoneId: 'p1', wabaId: 'W1' },
    { inboxId: 2, name: 'B', phone: '+2', token: 'tok', phoneId: 'p2', wabaId: 'W1' },
  ] };
  const res = await handleTemplatesAction(1, 'tpl_list', {}, { reads, fetchImpl: okFetch, query: async () => [] });
  assert.equal(res.data.wabas.length, 1);
  assert.equal(res.data.wabas[0].inboxes.length, 2);
  assert.equal(res.data.wabas[0].templates.length, 2);
});

test('tpl_list groups multiple WABAs, uses the FIRST channel token per WABA, and inbox_id filters to just one WABA without fetching the other', async () => {
  const reads = { getWhatsappCredsAll: async () => [
    { inboxId: 1, name: 'A', phone: '+1', token: 't1', phoneId: 'p1', wabaId: 'W1' },
    { inboxId: 2, name: 'B', phone: '+2', token: 't1b', phoneId: 'p2', wabaId: 'W1' },   // shares W1, later token
    { inboxId: 3, name: 'C', phone: '+3', token: 't2', phoneId: 'p3', wabaId: 'W2' },
  ] };
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const u = String(url);
    calls.push({ url: u, headers: (opts && opts.headers) || {} });
    if (u.includes('/app?')) return { ok: true, status: 200, json: async () => ({ id: 'app1' }) };
    if (u.includes('/flows?')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    if (u.includes('/message_templates?')) {
      const wabaId = u.split('/message_templates')[0].split('/').pop();
      return { ok: true, status: 200, json: async () => ({ data: [{ id: `${wabaId}-1`, name: `tpl-${wabaId}`, status: 'APPROVED', category: 'MARKETING', language: 'he', components: [] }] }) };
    }
    throw new Error(`unexpected url: ${u}`);
  };

  const all = await handleTemplatesAction(1, 'tpl_list', {}, { reads, fetchImpl });
  assert.deepEqual(all.data.wabas.map((w) => w.wabaId), ['W1', 'W2']);
  assert.equal(all.data.wabas[0].inboxes.length, 2);
  assert.ok(calls.some((c) => c.url.includes('/W1/message_templates') && c.headers.Authorization === 'Bearer t1'), 'uses the FIRST W1 channel token, via the header');
  assert.ok(!calls.some((c) => c.headers.Authorization === 'Bearer t1b'), 'never queries with the second channel of the same WABA');

  calls.length = 0;
  const filtered = await handleTemplatesAction(1, 'tpl_list', { inbox_id: 3 }, { reads, fetchImpl });
  assert.equal(filtered.data.wabas.length, 1);
  assert.equal(filtered.data.wabas[0].wabaId, 'W2');
  assert.ok(!calls.some((c) => c.url.includes('/W1/')), 'inbox_id filter must not fetch the other WABA at all');
});

test('tpl_list with an inbox_id not belonging to the account throws, before any Graph call', async () => {
  const reads = { getWhatsappCredsAll: async () => [
    { inboxId: 1, name: 'A', phone: '+1', token: 't1', phoneId: 'p1', wabaId: 'W1' },
  ] };
  const fetchImpl = async () => { throw new Error('must not be called'); };
  await assert.rejects(
    () => handleTemplatesAction(1, 'tpl_list', { inbox_id: 999 }, { reads, fetchImpl }),
    /inbox not found in this account/
  );
});

test('handleTemplatesAction: unknown tpl_ action throws', async () => {
  const reads = { getWhatsappCredsAll: async () => [] };
  await assert.rejects(
    () => handleTemplatesAction(1, 'tpl_bogus', {}, { reads, fetchImpl: async () => { throw new Error('must not be called'); } }),
    /unknown action/
  );
});

test('tpl_list response never leaks token or phoneId, at any depth', async () => {
  const reads = { getWhatsappCredsAll: async () => [
    { inboxId: 1, name: 'A', phone: '+1', token: 'SECRET_TOKEN', phoneId: 'SECRET_PHONE_ID', wabaId: 'W1' },
    { inboxId: 2, name: 'B', phone: '+2', token: 'SECRET_TOKEN_2', phoneId: 'SECRET_PHONE_ID_2', wabaId: 'W1' },
  ] };
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/app?')) return { ok: true, status: 200, json: async () => ({ id: 'app1' }) };
    if (u.includes('/flows?')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    if (u.includes('/message_templates?')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 't1', name: 'welcome', status: 'APPROVED', category: 'MARKETING', language: 'he', components: [] }] }) };
    throw new Error(`unexpected url: ${u}`);
  };
  const res = await handleTemplatesAction(1, 'tpl_list', {}, { reads, fetchImpl });
  const dump = JSON.stringify(res);
  assert.ok(!dump.includes('SECRET_TOKEN'), 'token value must never appear in the response');
  assert.ok(!dump.includes('SECRET_PHONE_ID'), 'phoneId value must never appear in the response');
  assert.ok(!/"token"/.test(dump), 'no "token" key anywhere in the response');
  assert.ok(!/"phoneId"/.test(dump), 'no "phoneId" key anywhere in the response');
});

test('tpl_list run with pagination: no fetched URL ever contains access_token, auth rides only in the header', async () => {
  const reads = { getWhatsappCredsAll: async () => [
    { inboxId: 1, name: 'A', phone: '+1', token: 'SECRET_TOKEN', phoneId: 'p1', wabaId: 'W1' },
  ] };
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const u = String(url);
    calls.push({ url: u, headers: (opts && opts.headers) || {} });
    if (u.includes('/app?')) return { ok: true, status: 200, json: async () => ({ id: 'app1' }) };
    if (u.includes('/flows?')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    if (u.includes('after=abc')) return { ok: true, status: 200, json: async () => page2 };
    if (u.includes('/message_templates?')) return { ok: true, status: 200, json: async () => page1 };
    throw new Error(`unexpected url: ${u}`);
  };

  await handleTemplatesAction(1, 'tpl_list', {}, { reads, fetchImpl });

  assert.ok(calls.length >= 4, 'expected app + flows + 2 template pages (pagination) to all have run');
  assert.ok(calls.every((c) => !c.url.includes('access_token')), 'no fetched URL may ever contain access_token');
  assert.ok(calls.every((c) => c.headers.Authorization === 'Bearer SECRET_TOKEN'), 'every Graph call authenticates via the Bearer header');
});
