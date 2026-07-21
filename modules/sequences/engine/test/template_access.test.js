/**
 * template_access.test.js — the second door into the Template Studio (migration 032).
 *
 * Before this, only an administrator of the account (or a super-admin) could reach a tpl_*
 * action. Now an administrator can also grant a named agent access. What must hold:
 *
 *  - an agent with no grant is still refused (unchanged behaviour);
 *  - an agent WITH a grant reaches the real handler;
 *  - a granted agent still cannot manage the grant list — otherwise access spreads by itself;
 *  - tpl_my_access answers every member of the account (that's what the sidebar asks), and
 *    its answer comes from the session, never from a client-sent payload.__isAdmin.
 *
 * Same HTTP plumbing as templates_api.test.js: the real createApp() over a loopback server,
 * mocking only Chatwoot's /api/v1/profile (authGate's fetchImpl).
 *
 * Run: DATABASE_URL_TEST=postgres://localhost:5432/drip_test node --test test/template_access.test.js
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setupDb } from './helpers.js';
import { getPool, query } from '../src/db.js';
import { initStore } from '../src/store.js';
import { createApp } from '../src/api.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);
initStore(cfg);

const ACCT = 9701;        // dedicated account id for this file
const ADMIN_UID = 801;
const AGENT_UID = 802;    // the agent an administrator lets in
const OTHER_UID = 803;    // an agent nobody let in

beforeEach(async () => {
  await setupDb(pool);
  await query('TRUNCATE drip.template_access');
});

function sessionCookie() {
  const info = { 'access-token': 'AT', client: 'CL', uid: 'a@b.com', 'token-type': 'Bearer', expiry: '9999999999' };
  return `cw_d_session_info=${encodeURIComponent(JSON.stringify(info))}`;
}

const chatwootFetch = (profile) => async (_url, opts) =>
  (opts?.headers?.['access-token'] ? { status: 200, json: async () => profile } : { status: 401 });

const asAdmin = () => chatwootFetch({ id: ADMIN_UID, accounts: [{ id: ACCT, role: 'administrator' }] });
const asAgent = (uid) => chatwootFetch({ id: uid, accounts: [{ id: ACCT, role: 'agent' }] });

async function withApp(fetchImpl, fn) {
  const app = createApp({
    databaseUrl: process.env.DATABASE_URL_TEST,
    chatwootBaseUrl: 'http://chatwoot.invalid',
    mediaDir: '/tmp',
    fetchImpl,
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    initStore(cfg); // restore global store config (createApp mutates it)
  }
}

const post = (base, action, payload) =>
  fetch(`${base}/drip-api?account_id=${ACCT}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie() },
    body: JSON.stringify({ action, payload: payload || {} }),
  });

const grant = (uid) =>
  query('INSERT INTO drip.template_access (account_id, user_id) VALUES ($1, $2)', [ACCT, uid]);

// ── the grant opens the door ───────────────────────────────────────────────────────────────

test('agent without a grant → tpl_list 403', async () => {
  await withApp(asAgent(OTHER_UID), async (base) => {
    const res = await post(base, 'tpl_list');
    assert.equal(res.status, 403);
  });
});

test('agent WITH a grant → tpl_list 200 and reaches the real handler', async () => {
  await grant(AGENT_UID);
  await withApp(asAgent(AGENT_UID), async (base) => {
    const res = await post(base, 'tpl_list');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    // No WhatsApp channel for this account in the test DB → an empty list from the real
    // handler, which is what proves the request got past the gate rather than being stubbed.
    assert.deepEqual(body.data.wabas, []);
    // A granted agent is not an administrator — no access-management button for them.
    assert.equal(body.data.is_admin, false);
  });
});

test('a grant for ANOTHER account does not open this one', async () => {
  await query('INSERT INTO drip.template_access (account_id, user_id) VALUES ($1, $2)', [ACCT + 1, AGENT_UID]);
  await withApp(asAgent(AGENT_UID), async (base) => {
    assert.equal((await post(base, 'tpl_list')).status, 403);
  });
});

// ── but never the door to the grant list itself ────────────────────────────────────────────

test('granted agent still cannot read or write the grant list', async () => {
  await grant(AGENT_UID);
  await withApp(asAgent(AGENT_UID), async (base) => {
    assert.equal((await post(base, 'tpl_access')).status, 403);
    const res = await post(base, 'tpl_set_access', { user_ids: [OTHER_UID] });
    assert.equal(res.status, 403);
  });
  // …and nothing was written.
  const rows = await query('SELECT user_id FROM drip.template_access WHERE account_id = $1', [ACCT]);
  assert.deepEqual(rows.map((x) => Number(x.user_id)), [AGENT_UID]);
});

// ── the administrator's own screen ─────────────────────────────────────────────────────────

test('administrator saves a grant list — replaces, dedupes, and records who granted it', async () => {
  await grant(OTHER_UID);   // an earlier grant that this save drops
  await withApp(asAdmin(), async (base) => {
    const res = await post(base, 'tpl_set_access', { user_ids: [AGENT_UID, AGENT_UID, 0, -5] });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).data, { user_ids: [AGENT_UID] });

    const read = await post(base, 'tpl_access');
    assert.deepEqual((await read.json()).data, { user_ids: [AGENT_UID] });
  });
  const rows = await query('SELECT user_id, granted_by FROM drip.template_access WHERE account_id = $1', [ACCT]);
  assert.deepEqual(rows.map((x) => Number(x.user_id)), [AGENT_UID]);
  assert.equal(rows[0].granted_by, String(ADMIN_UID));
});

test('an empty list revokes everyone', async () => {
  await grant(AGENT_UID);
  await withApp(asAdmin(), async (base) => {
    assert.equal((await post(base, 'tpl_set_access', { user_ids: [] })).status, 200);
  });
  const rows = await query('SELECT 1 FROM drip.template_access WHERE account_id = $1', [ACCT]);
  assert.equal(rows.length, 0);
});

// ── tpl_my_access: open to every member, answered from the session only ────────────────────

test('tpl_my_access answers a plain agent with allowed:false (200, not 403)', async () => {
  await withApp(asAgent(OTHER_UID), async (base) => {
    const res = await post(base, 'tpl_my_access');
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).data, { allowed: false, admin: false });
  });
});

test('tpl_my_access reports allowed:true once granted, and admin:true for an administrator', async () => {
  await grant(AGENT_UID);
  await withApp(asAgent(AGENT_UID), async (base) => {
    assert.deepEqual((await (await post(base, 'tpl_my_access')).json()).data, { allowed: true, admin: false });
  });
  await withApp(asAdmin(), async (base) => {
    assert.deepEqual((await (await post(base, 'tpl_my_access')).json()).data, { allowed: true, admin: true });
  });
});

test('a client-sent __isAdmin cannot forge access', async () => {
  await withApp(asAgent(OTHER_UID), async (base) => {
    const res = await post(base, 'tpl_my_access', { __isAdmin: true, __actor: { uid: String(ADMIN_UID) } });
    assert.deepEqual((await res.json()).data, { allowed: false, admin: false });
  });
});

// ── the demotion bug: a mobile-door cookie must never outrank the browser's own session ────
//
// A browser that once opened the panel as a Chatwoot dashboard app keeps a drip_session cookie
// for 60 days. Those claims name an account but no role, so while they were tried FIRST the
// account's own administrator arrived as a plain member and every tpl_ action answered 403 —
// with their real Chatwoot session sitting unread in the same request.

import { sign, SESSION } from '../src/sso.js';

const SSO_SECRET = 'test-secret';

// A request from a desktop browser that has BOTH credentials, as the real bug did.
const bothCookies = (uid, accountId) => {
  const info = { 'access-token': 'AT', client: 'CL', uid: 'a@b.com', 'token-type': 'Bearer', expiry: '9999999999' };
  const session = sign(SESSION, { u: uid, a: accountId, exp: Date.now() + 60_000 }, SSO_SECRET);
  return `cw_d_session_info=${encodeURIComponent(JSON.stringify(info))}; drip_session=${session}`;
};

async function withSsoApp(fetchImpl, fn) {
  const app = createApp({
    databaseUrl: process.env.DATABASE_URL_TEST,
    chatwootBaseUrl: 'http://chatwoot.invalid',
    mediaDir: '/tmp',
    ssoSecret: SSO_SECRET,
    pool,
    fetchImpl,
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    initStore(cfg);
  }
}

test('an administrator holding a roleless drip_session cookie is still an administrator', async () => {
  await withSsoApp(asAdmin(), async (base) => {
    const res = await fetch(`${base}/drip-api?account_id=${ACCT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: bothCookies(ADMIN_UID, ACCT) },
      body: JSON.stringify({ action: 'tpl_my_access', payload: {} }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).data, { allowed: true, admin: true });
  });
});

test('the drip_session cookie still authorizes when there is no Chatwoot session at all', async () => {
  // The cookie-less WebView it was built for: no cw_d_session_info, so the mobile door decides.
  await withSsoApp(asAdmin(), async (base) => {
    const session = sign(SESSION, { u: AGENT_UID, a: ACCT, exp: Date.now() + 60_000 }, SSO_SECRET);
    const res = await fetch(`${base}/drip-api?account_id=${ACCT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `drip_session=${session}` },
      body: JSON.stringify({ action: 'templates', payload: {} }),
    });
    assert.notEqual(res.status, 401);   // it got in — the door still works
    assert.notEqual(res.status, 403);
  });
});
