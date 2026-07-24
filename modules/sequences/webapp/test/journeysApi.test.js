import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as journeysApi from '../src/api/journeysApi.js';

// Same harness as templatesApi.test.js: hookable global fetch.
const originalFetch = global.fetch;
let mockFetch;
global.fetch = async (...args) => {
  if (mockFetch) return mockFetch(...args);
  return originalFetch(...args);
};

const okData = (data) => new Response(JSON.stringify({ ok: true, data }));

// Capture one engine call: returns { url, body } after invoking fn.
async function captureCall(fn, data = null) {
  let url = null;
  let body = null;
  mockFetch = async (u, options) => {
    url = u;
    body = JSON.parse(options.body);
    return okData(data);
  };
  const result = await fn();
  return { url, body, result };
}

// ---------------------------------------------------------------------------
// jrn_* engine actions — names + payload shapes
// ---------------------------------------------------------------------------

test('listJourneys → jrn_list with empty payload', async () => {
  const { url, body, result } = await captureCall(() => journeysApi.listJourneys(7), []);
  assert.ok(url.includes('?account_id=7'));
  assert.equal(body.action, 'jrn_list');
  assert.deepEqual(body.payload, {});
  assert.deepEqual(result, []);
});

test('getJourney → jrn_get {id}', async () => {
  const { body, result } = await captureCall(
    () => journeysApi.getJourney(7, 'uuid-1'),
    { id: 'uuid-1', name: 'x' }
  );
  assert.equal(body.action, 'jrn_get');
  assert.deepEqual(body.payload, { id: 'uuid-1' });
  assert.equal(result.id, 'uuid-1');
});

test('saveJourney → jrn_save with {id?, name, trigger, graph}', async () => {
  const journey = {
    name: 'קליטת ליד',
    trigger: { inbox_ids: [3], keywords: ['שלום'], on_new_conversation: true, manual: false },
    graph: { nodes: [], edges: [] },
  };
  const { body } = await captureCall(() => journeysApi.saveJourney(7, journey), { id: 'new', ...journey });
  assert.equal(body.action, 'jrn_save');
  assert.deepEqual(body.payload, journey);
  assert.ok(!('id' in body.payload)); // create — no id key at all

  const { body: body2 } = await captureCall(
    () => journeysApi.saveJourney(7, { id: 'uuid-1', ...journey }),
    { id: 'uuid-1' }
  );
  assert.equal(body2.payload.id, 'uuid-1'); // update — id included
});

test('deleteJourney → jrn_delete {id}', async () => {
  const { body } = await captureCall(() => journeysApi.deleteJourney(7, 'uuid-1'), { deleted: true });
  assert.equal(body.action, 'jrn_delete');
  assert.deepEqual(body.payload, { id: 'uuid-1' });
});

test('setJourneyStatus → jrn_set_status {id, status}', async () => {
  const { body } = await captureCall(
    () => journeysApi.setJourneyStatus(7, 'uuid-1', 'active'),
    { id: 'uuid-1', status: 'active' }
  );
  assert.equal(body.action, 'jrn_set_status');
  assert.deepEqual(body.payload, { id: 'uuid-1', status: 'active' });
});

test('getJourneyMeta → jrn_meta with empty payload', async () => {
  const { body, result } = await captureCall(
    () => journeysApi.getJourneyMeta(7),
    { inboxes: [{ id: 1, name: 'WA', channel_type: 'Channel::Whatsapp' }] }
  );
  assert.equal(body.action, 'jrn_meta');
  assert.deepEqual(body.payload, {});
  assert.equal(result.inboxes.length, 1);
});

test('listJourneyRuns → jrn_runs {id}', async () => {
  const { body } = await captureCall(() => journeysApi.listJourneyRuns(7, 'uuid-1'), []);
  assert.equal(body.action, 'jrn_runs');
  assert.deepEqual(body.payload, { id: 'uuid-1' });
});

test('launchJourney → jrn_launch {id, display_id, contact_id}', async () => {
  const { body } = await captureCall(
    () => journeysApi.launchJourney(7, 'uuid-1', 42, 99),
    { started: true, run_id: 'r1' }
  );
  assert.equal(body.action, 'jrn_launch');
  assert.deepEqual(body.payload, { id: 'uuid-1', display_id: 42, contact_id: 99 });
});

test('stopJourneyRun → jrn_stop_run {run_id}', async () => {
  const { body } = await captureCall(() => journeysApi.stopJourneyRun(7, 'r1'), { stopped: true });
  assert.equal(body.action, 'jrn_stop_run');
  assert.deepEqual(body.payload, { run_id: 'r1' });
});

test('403 from the engine surfaces err.forbidden (admin gating)', async () => {
  mockFetch = async () => new Response(JSON.stringify({ error: 'Admin only' }), { status: 403 });
  await assert.rejects(journeysApi.listJourneys(7), (err) => err.forbidden === true);
});

// ---------------------------------------------------------------------------
// same-origin Chatwoot helpers — need a fake document with the session cookie
// ---------------------------------------------------------------------------

const SESSION = { 'access-token': 'tok1', client: 'cli1', uid: 'u@x.com', expiry: '999', 'token-type': 'Bearer' };
const withSession = () => {
  globalThis.document = {
    cookie: `foo=1; cw_d_session_info=${encodeURIComponent(JSON.stringify(SESSION))}`,
  };
};
const withoutDocumentCookie = () => {
  globalThis.document = { cookie: '' };
};

test('ensureAttributeDefinition posts the definition with session headers', async () => {
  withSession();
  let captured = null;
  mockFetch = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ id: 1 }), { status: 200 });
  };
  const ok = await journeysApi.ensureAttributeDefinition(7, 'budget', 'conversation');
  assert.equal(ok, true);
  assert.equal(captured.url, '/api/v1/accounts/7/custom_attribute_definitions');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers['access-token'], 'tok1');
  assert.equal(captured.options.headers.client, 'cli1');
  assert.equal(captured.options.headers.uid, 'u@x.com');
  assert.deepEqual(JSON.parse(captured.options.body), {
    attribute_display_name: 'budget',
    attribute_key: 'budget',
    attribute_model: 'conversation_attribute',
    attribute_display_type: 0,
  });
});

test('ensureAttributeDefinition: contact scope maps to contact_attribute', async () => {
  withSession();
  let body = null;
  mockFetch = async (url, options) => {
    body = JSON.parse(options.body);
    return new Response('{}', { status: 200 });
  };
  await journeysApi.ensureAttributeDefinition(7, 'city', 'contact');
  assert.equal(body.attribute_model, 'contact_attribute');
});

test('ensureAttributeDefinition swallows 409/422/403 (already exists / no permission)', async () => {
  withSession();
  for (const status of [409, 422, 403]) {
    mockFetch = async () => new Response('{}', { status });
    const ok = await journeysApi.ensureAttributeDefinition(7, 'k', 'contact');
    assert.equal(ok, false); // silent best-effort — never throws
  }
});

test('ensureAttributeDefinition without a session cookie is a silent no-op', async () => {
  withoutDocumentCookie();
  let called = false;
  mockFetch = async () => {
    called = true;
    return new Response('{}');
  };
  const ok = await journeysApi.ensureAttributeDefinition(7, 'k', 'contact');
  assert.equal(ok, false);
  assert.equal(called, false);
});

test('fetchChatwootMeta normalizes array and {payload} shapes, empty on failure', async () => {
  withSession();
  mockFetch = async (url) => {
    if (url.endsWith('/agents')) return new Response(JSON.stringify([{ id: 1, name: 'דנה' }]));
    if (url.endsWith('/teams')) return new Response('{}', { status: 500 }); // failure → []
    if (url.endsWith('/labels')) {
      return new Response(JSON.stringify({ payload: [{ id: 2, title: 'vip' }] }));
    }
    throw new Error(`unexpected ${url}`);
  };
  const meta = await journeysApi.fetchChatwootMeta(7);
  assert.deepEqual(meta.agents, [{ id: 1, name: 'דנה' }]);
  assert.deepEqual(meta.teams, []);
  assert.deepEqual(meta.labels, [{ id: 2, title: 'vip' }]);
});

test('fetchChatwootMeta without a session returns empty lists', async () => {
  withoutDocumentCookie();
  const meta = await journeysApi.fetchChatwootMeta(7);
  assert.deepEqual(meta, { agents: [], teams: [], labels: [] });
});
