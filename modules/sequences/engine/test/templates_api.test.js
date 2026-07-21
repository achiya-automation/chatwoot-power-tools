/**
 * templates_api.test.js — Task 8: wiring tpl_* through the HTTP layer, admin enforcement,
 * and the template-example (Resumable Upload) route.
 *
 *  - store.js dispatches every tpl_* action straight to handleTemplatesAction (no per-action
 *    case in the switch).
 *  - api.js gates every tpl_* action AND the new upload route to administrators only
 *    (req.dripAccess, set by authGate — a mobile-ticket session carries role:'' on its one
 *    account and is correctly denied), and overwrites any client-sent payload.__actor with
 *    the session's own identity before it can reach the audit log.
 *  - templates.js's uploadExampleMedia() drives Meta's two-step Resumable Upload API for a
 *    template header's example media.
 *
 * HTTP-level tests drive the real createApp() over a loopback server, mocking only Chatwoot's
 * /api/v1/profile (authGate's fetchImpl) and, where a Graph call is unavoidable, the global
 * fetch — routed so it intercepts ONLY graph.facebook.com and passes everything else (i.e. the
 * test's own request to the local server) through to the real fetch. Unit-level tests call
 * uploadExampleMedia directly with injected deps, same style as templates_write.test.js.
 *
 * Run: DATABASE_URL_TEST=postgres://localhost:5432/drip_test node --test test/templates_api.test.js
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setupDb } from './helpers.js';
import { getPool, query } from '../src/db.js';
import { initStore } from '../src/store.js';
import { createApp } from '../src/api.js';
import { uploadExampleMedia, _resetCapCacheForTests } from '../src/templates.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);
initStore(cfg);

const ACCT = 9601;       // dedicated account id for this file's HTTP tests
const ADMIN_UID = 777;   // the session's own user id — must be the one that ends up audited

beforeEach(async () => {
  await setupDb(pool);
  await pool.query('TRUNCATE public.inboxes, public.channel_whatsapp');
  await query('TRUNCATE drip.template_audit CASCADE');
  _resetCapCacheForTests();
});

// ── HTTP test plumbing (same shape as auth.test.js's sessionCookie/profileFetch) ───────────

function sessionCookie() {
  const info = { 'access-token': 'AT', client: 'CL', uid: 'a@b.com', 'token-type': 'Bearer', expiry: '9999999999' };
  return `cw_d_session_info=${encodeURIComponent(JSON.stringify(info))}`;
}

// authGate's fetchImpl: a request carrying the access-token header (a parsed session cookie)
// gets Chatwoot's profile back; anything else is unauthenticated.
const chatwootFetch = (profile) => async (_url, opts) =>
  (opts?.headers?.['access-token'] ? { status: 200, json: async () => profile } : { status: 401 });

async function withApp(fetchImpl, fn) {
  const app = createApp({
    databaseUrl: process.env.DATABASE_URL_TEST,
    chatwootBaseUrl: 'http://chatwoot.invalid',
    mediaDir: '/tmp',
    fetchImpl,
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    initStore(cfg); // restore global store config for any subsequent test (createApp mutates it)
  }
}

// Swaps globalThis.fetch for the duration of an async block, routing ONLY graph.facebook.com
// calls to `graphFetch` — everything else (the test's own request to the local loopback
// server) goes through the real fetch. Always restored, even if the block throws.
async function withGraphMock(graphFetch, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) =>
    (String(url).startsWith('https://graph.facebook.com') ? graphFetch(url, opts) : real(url, opts));
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const seedChannel = async (accountId, inboxId, channelId, providerConfig) => {
  await pool.query(
    `INSERT INTO public.channel_whatsapp (id, phone_number, provider, provider_config)
     VALUES ($1, '+972500000000', 'whatsapp_cloud', $2::jsonb)`,
    [channelId, JSON.stringify(providerConfig)]
  );
  await pool.query(
    `INSERT INTO public.inboxes (id, account_id, name, channel_type, channel_id)
     VALUES ($1, $2, 'WA', 'Channel::Whatsapp', $3)`,
    [inboxId, accountId, channelId]
  );
};

// ── (a) tpl_list without administrator role → 403 ──────────────────────────────────────────

test('POST /drip-api tpl_list without administrator role → 403', async () => {
  const fetchImpl = chatwootFetch({ id: 1, accounts: [{ id: ACCT, role: 'agent' }] });
  await withApp(fetchImpl, async (base) => {
    const res = await fetch(`${base}/drip-api?account_id=${ACCT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie() },
      body: JSON.stringify({ action: 'tpl_list' }),
    });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { ok: false, error: 'administrator role required' });
  });
});

// ── (b) tpl_list with administrator role → 200, reaches the real handler ──────────────────

test('POST /drip-api tpl_list with administrator role → 200 and reaches the real handler', async () => {
  const fetchImpl = chatwootFetch({ id: ADMIN_UID, accounts: [{ id: ACCT, role: 'administrator' }] });
  await withApp(fetchImpl, async (base) => {
    const res = await fetch(`${base}/drip-api?account_id=${ACCT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie() },
      body: JSON.stringify({ action: 'tpl_list' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    // No WhatsApp channel is configured for this account in the test DB, so the real
    // handleTemplatesAction (reached via store.js's tpl_ dispatch) legitimately returns an
    // empty list — proving the request passed the admin gate into the actual handler, not a
    // stub.
    assert.deepEqual(body.data, { wabas: [], is_admin: true });
  });
});

// ── (c) upload route without administrator role → 403 before any body processing ──────────

test('POST /drip-api/template-example without administrator role → 403 (guard runs before express.raw)', async () => {
  const fetchImpl = chatwootFetch({ id: 1, accounts: [{ id: ACCT, role: 'agent' }] });
  await withApp(fetchImpl, async (base) => {
    const res = await fetch(`${base}/drip-api/template-example?account_id=${ACCT}&inbox_id=1`, {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg', cookie: sessionCookie() },
      body: Buffer.from('irrelevant-bytes'), // would be read by express.raw() if the guard didn't block first
    });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { ok: false, error: 'administrator role required' });
  });
});

// ── (d) trust boundary: a client-sent payload.__actor is always overwritten ────────────────

test('a client-sent payload.__actor is overwritten with the session user id, never trusted', async () => {
  const inboxId = 8801;
  await seedChannel(ACCT, inboxId, 8811, { api_key: 'tok-actor-test', phone_number_id: 'PH1', business_account_id: 'WABA-ACTOR' });

  const fetchImpl = chatwootFetch({ id: ADMIN_UID, accounts: [{ id: ACCT, role: 'administrator' }] });
  // The Graph write is made to fail — actionTplCreate's catch branch still audits the attempt
  // (attempt = action) before re-throwing, which is exactly the code path that reads
  // payload.__actor. The failure itself is not what this test is about.
  const graphFetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'boom (expected)' } }) });

  await withGraphMock(graphFetch, () => withApp(fetchImpl, async (base) => {
    await fetch(`${base}/drip-api?account_id=${ACCT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie() },
      body: JSON.stringify({
        action: 'tpl_create',
        payload: {
          inbox_id: inboxId,
          template: { name: 'ok_name', category: 'MARKETING', language: 'he', components: [{ type: 'BODY', text: 'hi' }] },
          __actor: { uid: 'attacker-uid', name: 'Attacker' },
        },
      }),
    });
  }));

  const rows = await query('SELECT actor_uid FROM drip.template_audit WHERE account_id=$1', [ACCT]);
  assert.equal(rows.length, 1, 'the write attempt must still be audited');
  assert.equal(rows[0].actor_uid, String(ADMIN_UID), "the server's own session uid must win");
  assert.notEqual(rows[0].actor_uid, 'attacker-uid', 'a client-sent __actor must never reach the audit log');
});

// ── (e) uploadExampleMedia: resumable-upload mechanics (unit-level, mocked deps) ──────────

test('uploadExampleMedia: opens a session then pushes bytes with the OAuth scheme, returns the handle', async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method, headers: opts.headers || {}, body: opts.body });
    if (u.includes('/app?fields=id')) return { ok: true, status: 200, json: async () => ({ id: 'APP1' }) };
    if (u.includes('/flows?')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    if (u.includes('/uploads?')) return { ok: true, status: 200, json: async () => ({ id: 'upload:SESS123' }) };
    if (u.includes('SESS123')) return { ok: true, status: 200, json: async () => ({ h: 'HANDLE_ABC' }) };
    throw new Error(`unexpected url: ${u}`);
  };
  const reads = { getWhatsappCredsAll: async () => [{ inboxId: 1, token: 'tok', wabaId: 'W1' }] };
  const buf = Buffer.from('fake-image-bytes');

  const result = await uploadExampleMedia({ accountId: 1, inboxId: 1, mime: 'image/jpeg', buf }, { reads, fetchImpl });
  assert.deepEqual(result, { handle: 'HANDLE_ABC' });

  const sessionCall = calls.find((c) => c.url.includes('/uploads?'));
  assert.match(sessionCall.url, new RegExp(`file_length=${buf.length}\\b`), 'passes the real byte length');
  assert.match(sessionCall.url, /file_type=image%2Fjpeg/, 'passes the mime type');
  assert.equal(sessionCall.headers.Authorization, 'Bearer tok', 'session-open call authenticates like every other Graph call');

  const byteCall = calls.find((c) => c.url.includes('SESS123'));
  assert.equal(byteCall.headers.Authorization, 'OAuth tok', "the byte-push call uses the 'OAuth' scheme, not Bearer");
  assert.equal(byteCall.headers.file_offset, '0');
  assert.equal(byteCall.body, buf, 'the raw buffer is forwarded unchanged, not JSON-wrapped');
});

test('uploadExampleMedia: mediaUpload:false rejects with the bilingual reason before any upload call', async () => {
  const reads = { getWhatsappCredsAll: async () => [{ inboxId: 1, token: 'tok', wabaId: 'W1' }] };
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/app?fields=id')) throw new Error('feature not enabled for this business');
    if (u.includes('/flows?')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    throw new Error(`must not reach the upload API when the capability is off: ${u}`);
  };

  await assert.rejects(
    uploadExampleMedia({ accountId: 1, inboxId: 1, mime: 'image/jpeg', buf: Buffer.from('x') }, { reads, fetchImpl }),
    (e) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /feature not enabled/);
      assert.match(e.reasonHe, /העלאת מדיה/);
      return true;
    }
  );
});

// ── route-level: the same two cases, driven over real HTTP ────────────────────────────────

test('POST /drip-api/template-example: admin + valid upload → {ok:true,data:{handle}}', async () => {
  const inboxId = 8901;
  await seedChannel(ACCT, inboxId, 8911, { api_key: 'tok-upload-test', phone_number_id: 'PH2', business_account_id: 'WABA-UPLOAD' });

  const graphFetch = async (url) => {
    const u = String(url);
    if (u.includes('/app?fields=id')) return { ok: true, status: 200, json: async () => ({ id: 'APPX' }) };
    if (u.includes('/flows?')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    if (u.includes('/uploads?')) return { ok: true, status: 200, json: async () => ({ id: 'upload:SESSX' }) };
    if (u.includes('SESSX')) return { ok: true, status: 200, json: async () => ({ h: 'HANDLE_XYZ' }) };
    throw new Error(`unexpected graph url in test: ${u}`);
  };
  const fetchImpl = chatwootFetch({ id: ADMIN_UID, accounts: [{ id: ACCT, role: 'administrator' }] });

  await withGraphMock(graphFetch, () => withApp(fetchImpl, async (base) => {
    const res = await fetch(`${base}/drip-api/template-example?account_id=${ACCT}&inbox_id=${inboxId}`, {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg', 'x-filename': 'sample.jpg', cookie: sessionCookie() },
      body: Buffer.from('fake-jpeg-bytes'),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, data: { handle: 'HANDLE_XYZ' } });
  }));
});

// ── (f) upload route: capabilities.mediaUpload===false → 400 with the reason ──────────────

test('POST /drip-api/template-example: mediaUpload capability off → 400 with the bilingual reason', async () => {
  const inboxId = 8902;
  await seedChannel(ACCT, inboxId, 8912, { api_key: 'tok-nocap-test', phone_number_id: 'PH3', business_account_id: 'WABA-NOCAP' });

  const graphFetch = async (url) => {
    const u = String(url);
    if (u.includes('/app?fields=id')) return { ok: false, status: 400, json: async () => ({ error: { message: 'Feature unavailable' } }) };
    if (u.includes('/flows?')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
    throw new Error(`must not reach the upload API when the capability is off: ${u}`);
  };
  const fetchImpl = chatwootFetch({ id: ADMIN_UID, accounts: [{ id: ACCT, role: 'administrator' }] });

  await withGraphMock(graphFetch, () => withApp(fetchImpl, async (base) => {
    const res = await fetch(`${base}/drip-api/template-example?account_id=${ACCT}&inbox_id=${inboxId}`, {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg', cookie: sessionCookie() },
      body: Buffer.from('fake-jpeg-bytes'),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /העלאת מדיה/, 'default (he) locale surfaces the Hebrew reason');
  }));
});
