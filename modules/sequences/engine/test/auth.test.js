/**
 * auth.test.js — session auth gate for the drip dashboard.
 *
 * Chatwoot authenticates its API with devise_token_auth HEADERS
 * (access-token / client / uid), NOT the Rails session cookie. The browser SPA
 * keeps those credentials in a JS-readable `cw_d_session_info` cookie and replays
 * them as headers on every API call. The gate must do the same: parse
 * cw_d_session_info out of the forwarded Cookie header and verify it against
 * GET /api/v1/profile using those headers.
 *
 * (The original gate forwarded the raw Cookie header instead — Chatwoot ignores
 * cookies for /api/v1/profile, so it 401'd even a logged-in admin. That was the bug.)
 *
 * No DB needed: unit tests inject fetch into isAuthenticated(); integration tests
 * inject fetch via config so nothing hits Postgres or the real Chatwoot.
 *
 * Run: node --test test/auth.test.js
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthenticated, authGate, resolveUserAccess, canAccessAccount } from '../src/auth.js';
import { createApp } from '../src/api.js';

const BASE = 'http://chatwoot.test';

// Build a realistic cw_d_session_info cookie (URL-encoded JSON, exactly as the
// browser sends it), wrapped with another cookie so parsing must pick it out.
function sessionCookie(fields = {}) {
  const info = {
    'access-token': 'AT', client: 'CL', uid: 'a@b.com',
    'token-type': 'Bearer', expiry: '9999999999', ...fields,
  };
  return `user.id=1; cw_d_session_info=${encodeURIComponent(JSON.stringify(info))}; user.expires_at=x`;
}

// Minimal express-style req/res doubles so the gate can be unit-tested without a
// live server or DB. status()/json()/send()/type()/set() chain like express; next() flags
// pass-through. method/path default to a plain API GET — a navigation is opted into per test.
function runGate(gate, headers, query = {}, { method = 'GET', path = '/drip-api' } = {}) {
  const req = { headers, query, method, path };
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
    type(t) { this.headers['Content-Type'] = t; return this; },
    set(k, v) { this.headers[k] = v; return this; },
  };
  let nexted = false;
  return gate(req, res, () => { nexted = true; }).then(() => ({
    passed: nexted,
    status: res.statusCode,
    body: res.body,
    headers: res.headers,
  }));
}

// A browser/WebView navigating to the panel (as opposed to the SPA's fetch() calls).
const NAV = { method: 'GET', path: '/' };
const NAV_ACCEPT = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };

// ── no cookie → false, and Chatwoot is never called ──
test('isAuthenticated returns false for an empty cookie without calling Chatwoot', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { status: 200 }; };
  assert.equal(await isAuthenticated('', BASE, fetchImpl), false);
  assert.equal(called, false, 'must not call Chatwoot when there is no cookie');
});

// ── a cookie jar WITHOUT cw_d_session_info → false, and Chatwoot is never called ──
// (e.g. only non-auth cookies present — there is nothing to verify, so don't even ask)
test('isAuthenticated returns false when cw_d_session_info is absent, without calling Chatwoot', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { status: 200 }; };
  assert.equal(await isAuthenticated('user.id=1; foo=bar', BASE, fetchImpl), false);
  assert.equal(called, false, 'no session info → nothing to verify → no Chatwoot call');
});

// ── valid session → token parsed from cw_d_session_info → sent as HEADERS → 200 → true ──
// This is the contract: Chatwoot is verified with devise-token-auth headers, NOT the cookie.
test('isAuthenticated parses cw_d_session_info and verifies via devise-token-auth headers', async () => {
  const seen = {};
  const fetchImpl = async (url, opts) => {
    seen.url = url;
    seen.opts = opts;
    return { status: 200 };
  };
  const ok = await isAuthenticated(sessionCookie(), BASE, fetchImpl);
  assert.equal(ok, true);
  assert.equal(seen.url, `${BASE}/api/v1/profile`, 'verifies against the profile endpoint');
  assert.equal(seen.opts.headers['access-token'], 'AT', 'sends the access-token header');
  assert.equal(seen.opts.headers.client, 'CL', 'sends the client header');
  assert.equal(seen.opts.headers.uid, 'a@b.com', 'sends the uid header');
  assert.equal(seen.opts.headers['token-type'], 'Bearer', 'sends the token-type header');
  assert.equal(seen.opts.headers.Cookie, undefined, 'must NOT forward the raw cookie (Chatwoot ignores it → 401)');
  assert.equal(seen.opts.redirect, 'manual', 'a login redirect must not be followed/counted as auth');
});

// ── stale / invalid session → Chatwoot 401 → false ──
test('isAuthenticated returns false when Chatwoot profile responds 401', async () => {
  const fetchImpl = async () => ({ status: 401 });
  assert.equal(await isAuthenticated(sessionCookie(), BASE, fetchImpl), false);
});

// ── malformed cw_d_session_info (not JSON) → false, fail-closed, no crash, no call ──
test('isAuthenticated returns false (fail-closed) for an unparseable cw_d_session_info', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { status: 200 }; };
  assert.equal(await isAuthenticated('cw_d_session_info=not%20json', BASE, fetchImpl), false);
  assert.equal(called, false, 'garbage cookie → never reaches Chatwoot');
});

// ── cw_d_session_info present but missing the token triple → false, no call ──
test('isAuthenticated returns false when the session info lacks access-token/client/uid', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { status: 200 }; };
  const cookie = `cw_d_session_info=${encodeURIComponent(JSON.stringify({ foo: 'bar' }))}`;
  assert.equal(await isAuthenticated(cookie, BASE, fetchImpl), false);
  assert.equal(called, false);
});

// ── fail-closed: a Chatwoot outage (network throw) must DENY, not crash/allow ──
test('isAuthenticated returns false (fail-closed) when the Chatwoot call throws', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  assert.equal(await isAuthenticated(sessionCookie(), BASE, fetchImpl), false);
});

// ───────────────────────── authGate middleware ─────────────────────────────

// ── no cookie → 401 unauthorized, next() never called ──
test('authGate denies a request with no cookie (401, no pass-through)', async () => {
  const gate = authGate({ chatwootBaseUrl: BASE, fetchImpl: async () => ({ status: 200 }) });
  const r = await runGate(gate, {});
  assert.equal(r.passed, false);
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { ok: false, error: 'unauthorized' });
});

// ── a denial must never be cacheable ──
// A proxy or CDN that stamps `Cache-Control: max-age` on every .js/.css response will also
// cache this 401 — pinning it to a bundle's URL and serving it to logged-in users, who then
// get a blank dashboard until the cache expires. Marking denials no-store closes that door
// even when the proxy in front is misconfigured.
test('authGate marks every denial no-store (a cached 401 would blank the dashboard)', async () => {
  const gate = authGate({
    chatwootBaseUrl: BASE,
    fetchImpl: async () => ({ status: 401 }),
    masterAccountId: 1,
  });
  const noCookie = await runGate(gate, {});
  assert.equal(noCookie.headers['Cache-Control'], 'no-store');

  const badCookie = await runGate(gate, { cookie: sessionCookie() });
  assert.equal(badCookie.status, 401);
  assert.equal(badCookie.headers['Cache-Control'], 'no-store');
});

// ───────────────── denying a NAVIGATION: sign-in page, not raw JSON ─────────────────
//
// Chatwoot's MOBILE app opens a dashboard app in a react-native-webview whose cookie jar is
// EMPTY for the Chatwoot origin: the native app authenticates over the API (devise headers in
// AsyncStorage) and never runs the web SPA — and cw_d_session_info is written by the SPA's
// JavaScript, never Set-Cookie'd by Rails. So the WebView carries no session, the gate denies,
// and `{"ok":false,"error":"unauthorized"}` is literally what the agent reads on their phone.
//
// A navigation must therefore be denied with a PAGE that lets them sign in (Chatwoot's own
// /app/login, same-origin iframe → its SPA writes the cookie into this very jar), while the
// SPA's fetch() calls keep getting the machine-readable JSON they parse.

test('authGate denies a NAVIGATION with the sign-in page, not raw JSON', async () => {
  const gate = authGate({ chatwootBaseUrl: BASE, fetchImpl: async () => ({ status: 200 }) });
  const r = await runGate(gate, NAV_ACCEPT, {}, NAV);
  assert.equal(r.passed, false);
  assert.equal(r.status, 401);
  assert.match(r.headers['Content-Type'], /html/, 'a navigation gets HTML, not JSON');
  assert.match(String(r.body), /<iframe[^>]+src="\/app\/login"/, 'embeds Chatwoot login same-origin');
  assert.match(String(r.body), /cw_d_session_info/, 'polls for the cookie the SPA writes on success');
  assert.equal(r.headers['Cache-Control'], 'no-store', 'a denial is never cacheable');
});

// An EXPIRED session arrives here with cw_d_session_info still in the jar — the gate only knows
// it's stale because Chatwoot rejected it. A page that reloaded on the cookie's mere PRESENCE
// would reload, be denied, reload… forever. It must reload only when the value CHANGES (a fresh
// login mints a new token), which is also what the cookie-less phone case needs.
test('the sign-in page reloads on a CHANGED session cookie, never on its mere presence', async () => {
  const gate = authGate({ chatwootBaseUrl: BASE, fetchImpl: async () => ({ status: 401 }) });
  const r = await runGate(gate, { ...NAV_ACCEPT, cookie: sessionCookie() }, {}, NAV);
  assert.equal(r.status, 401, 'a stale cookie is still a denial');
  const html = String(r.body);

  assert.match(html, /cw_d_session_info=\(\[\^;\]\*\)/, 'reads the cookie VALUE, not just its name');
  assert.match(html, /now\s*!==?\s*before|before\s*!==?\s*now/, 'compares against the value seen at load');
  assert.doesNotMatch(
    html,
    /if\s*\(\s*document\.cookie\.indexOf\('cw_d_session_info='\)\s*!==\s*-1\s*\)\s*location\.reload/,
    'presence-only reload = infinite loop for an expired session'
  );
});

test('authGate still denies the SPA fetch() calls with JSON (Accept: */*)', async () => {
  const gate = authGate({ chatwootBaseUrl: BASE, fetchImpl: async () => ({ status: 200 }) });
  const r = await runGate(gate, { accept: '*/*' }, {}, { method: 'GET', path: '/' });
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { ok: false, error: 'unauthorized' }, 'fetch() must keep parsing JSON');
});

// The API is a machine contract: never hand it a page, even if a client sends a browser Accept.
test('authGate never serves the sign-in page on /drip-api, whatever the Accept header', async () => {
  const gate = authGate({ chatwootBaseUrl: BASE, fetchImpl: async () => ({ status: 200 }) });
  const r = await runGate(gate, NAV_ACCEPT, {}, { method: 'GET', path: '/drip-api' });
  assert.deepEqual(r.body, { ok: false, error: 'unauthorized' });

  const post = await runGate(gate, NAV_ACCEPT, {}, { method: 'POST', path: '/drip-api' });
  assert.deepEqual(post.body, { ok: false, error: 'unauthorized' }, 'a POST is never a navigation');
});

// 403 (wrong tenant) is a real answer, not a missing session — a sign-in page would loop forever.
test('authGate answers a forbidden tenant with JSON even on a navigation', async () => {
  const gate = authGate({
    chatwootBaseUrl: BASE,
    masterAccountId: 1,
    fetchImpl: async () => ({ status: 200, json: async () => ({ id: 9, accounts: [{ id: 7, role: 'agent' }] }) }),
  });
  const r = await runGate(gate, { ...NAV_ACCEPT, cookie: sessionCookie() }, { account_id: '99' }, NAV);
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, { ok: false, error: 'forbidden' }, 'signing in again would not help');
});

// ── valid cookie passes, and a repeat is served from cache (one Chatwoot call) ──
test('authGate passes a valid session cookie and caches it — one Chatwoot call for repeats', async () => {
  let calls = 0;
  const gate = authGate({ chatwootBaseUrl: BASE, fetchImpl: async () => { calls++; return { status: 200 }; } });
  const cookie = sessionCookie();
  const a = await runGate(gate, { cookie });
  const b = await runGate(gate, { cookie });
  assert.equal(a.passed, true, 'logged-in admin must not be blocked');
  assert.equal(b.passed, true);
  assert.equal(calls, 1, 'second identical request must be served from cache, not re-verified');
});

// ── failures are never cached → a re-login is picked up on the very next request ──
test('authGate never caches a rejection — each failed cookie is re-verified', async () => {
  let calls = 0;
  const gate = authGate({ chatwootBaseUrl: BASE, fetchImpl: async () => { calls++; return { status: 401 }; } });
  const cookie = sessionCookie();
  const a = await runGate(gate, { cookie });
  const b = await runGate(gate, { cookie });
  assert.equal(a.passed, false);
  assert.equal(a.status, 401);
  assert.equal(b.passed, false);
  assert.equal(calls, 2, 'a rejected cookie must be re-checked, not cached');
});

// ───────────────────── resolveUserAccess + per-account authorization ──────────
// The profile carries accounts:[{id, role}]. A super-admin is an administrator of the
// MASTER account; everyone else is limited to the accounts they belong to.

const profileFetch = (profile) => async () => ({ status: 200, json: async () => profile });

test('resolveUserAccess flags super-admin (administrator of the master account)', async () => {
  const access = await resolveUserAccess(
    sessionCookie(), BASE,
    profileFetch({ id: 1, accounts: [{ id: 1, role: 'administrator' }, { id: 5, role: 'agent' }] }),
    1
  );
  assert.equal(access.ok, true);
  assert.equal(access.isSuperAdmin, true);
  assert.deepEqual(access.accounts.map((a) => a.id), [1, 5]);
});

test('resolveUserAccess: administrator of a NON-master account is not a super-admin', async () => {
  const access = await resolveUserAccess(
    sessionCookie(), BASE,
    profileFetch({ id: 48, accounts: [{ id: 7, role: 'administrator' }] }),
    1
  );
  assert.equal(access.isSuperAdmin, false);
  assert.deepEqual(access.accounts.map((a) => a.id), [7]);
});

test('resolveUserAccess: an AGENT of the master account is not a super-admin', async () => {
  const access = await resolveUserAccess(
    sessionCookie(), BASE, profileFetch({ id: 9, accounts: [{ id: 1, role: 'agent' }] }), 1
  );
  assert.equal(access.isSuperAdmin, false);
});

test('resolveUserAccess returns null when there is no session / Chatwoot rejects / is down', async () => {
  assert.equal(await resolveUserAccess('', BASE, profileFetch({}), 1), null);
  assert.equal(await resolveUserAccess(sessionCookie(), BASE, async () => ({ status: 401 }), 1), null);
  assert.equal(await resolveUserAccess(sessionCookie(), BASE, async () => { throw new Error('down'); }, 1), null);
});

test('resolveUserAccess tolerates a 200 with an unreadable body (valid session, no accounts)', async () => {
  const access = await resolveUserAccess(sessionCookie(), BASE, async () => ({ status: 200 }), 1);
  assert.equal(access.ok, true);
  assert.deepEqual(access.accounts, []);
  assert.equal(access.isSuperAdmin, false);
});

test('canAccessAccount: super-admin reaches any account; a member only their own', () => {
  const sa = { ok: true, isSuperAdmin: true, accounts: [{ id: 1, role: 'administrator' }] };
  const member = { ok: true, isSuperAdmin: false, accounts: [{ id: 7, role: 'administrator' }] };
  assert.equal(canAccessAccount(sa, 7), true);
  assert.equal(canAccessAccount(sa, 999), true);
  assert.equal(canAccessAccount(member, 7), true);
  assert.equal(canAccessAccount(member, 1), false, 'a member cannot reach a foreign account');
  assert.equal(canAccessAccount(member, 0), true, 'no specific account (shell) is allowed once authed');
  assert.equal(canAccessAccount(null, 7), false);
});

test('authGate: a member is FORBIDDEN (403) from a foreign account', async () => {
  const gate = authGate({
    chatwootBaseUrl: BASE, masterAccountId: 1,
    fetchImpl: profileFetch({ id: 48, accounts: [{ id: 7, role: 'administrator' }] }),
  });
  const r = await runGate(gate, { cookie: sessionCookie() }, { account_id: '1' });
  assert.equal(r.status, 403);
  assert.equal(r.passed, false, 'tenant isolation: account 7 member must not reach account 1');
});

test('authGate: a member PASSES for their own account', async () => {
  const gate = authGate({
    chatwootBaseUrl: BASE, masterAccountId: 1,
    fetchImpl: profileFetch({ id: 48, accounts: [{ id: 7, role: 'administrator' }] }),
  });
  const r = await runGate(gate, { cookie: sessionCookie() }, { account_id: '7' });
  assert.equal(r.passed, true);
});

test('authGate: a super-admin PASSES for any account (the cross-account manager case)', async () => {
  const gate = authGate({
    chatwootBaseUrl: BASE, masterAccountId: 1,
    fetchImpl: profileFetch({ id: 1, accounts: [{ id: 1, role: 'administrator' }] }),
  });
  const r = await runGate(gate, { cookie: sessionCookie() }, { account_id: '7' });
  assert.equal(r.passed, true, 'super-admin manages account 7 without being a member');
});

test('authGate coalesces a concurrent burst (one dashboard load, same cookie) into ONE Chatwoot call', async () => {
  let calls = 0;
  const gate = authGate({
    chatwootBaseUrl: BASE, masterAccountId: 1,
    fetchImpl: async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 15)); // simulate Rails latency so the burst overlaps
      return { status: 200, json: async () => ({ id: 1, accounts: [{ id: 1, role: 'administrator' }] }) };
    },
  });
  const cookie = sessionCookie();
  const results = await Promise.all(Array.from({ length: 5 }, () => runGate(gate, { cookie })));
  assert.ok(results.every((r) => r.passed), 'every request in the burst is authorized');
  assert.equal(calls, 1, 'five concurrent verifies for one session collapse to a single Rails call');
});

// ───────── integration: the gate wired into the real express app ─────────────
// Drives createApp() over HTTP with Chatwoot verification stubbed via config.fetchImpl:
// a request carrying the access-token header (i.e. a parsed cw_d_session_info) ⇒ 200,
// otherwise 401. Proves route ORDER: health is public (before the gate), API + static
// catch-all are behind it. No DB needed — the gate answers before any handler.

let server;
let srvUrl;

before(async () => {
  const app = createApp({
    databaseUrl: process.env.DATABASE_URL_TEST,
    chatwootBaseUrl: BASE,
    fetchImpl: async (_url, opts) => ({ status: opts?.headers?.['access-token'] ? 200 : 401 }),
  });
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      srvUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => new Promise((resolve) => server.close(resolve)));

// ── health stays public (it sits before the gate; no info, used by Docker healthcheck) ──
test('GET /drip-api/health is public (200) without any cookie', async () => {
  const res = await fetch(`${srvUrl}/drip-api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

// ── the leak the brief is about: enrollments (real phone numbers) blocked for a stranger ──
test('POST /drip-api (enrollments) without a cookie → 401 and no data leaks', async () => {
  const res = await fetch(`${srvUrl}/drip-api?account_id=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'enrollments' }),
  });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, error: 'unauthorized' });
});

// ── the SPA/static shell is guarded too — a stranger can't even load the UI ──
test('GET / (static SPA) without a cookie → 401', async () => {
  const res = await fetch(`${srvUrl}/`);
  assert.equal(res.status, 401);
});

// ── a logged-in admin (valid cw_d_session_info cookie) passes the gate (not 401) ──
test('GET / with a valid session cookie passes the gate (not 401)', async () => {
  const res = await fetch(`${srvUrl}/`, { headers: { cookie: sessionCookie() } });
  assert.notEqual(res.status, 401, 'a logged-in admin must pass the gate');
});

// ── end to end: what Chatwoot's mobile WebView actually gets — a sign-in page, not JSON ──
// The phone sends a browser Accept and no cookie. Before this, it rendered the raw string
// {"ok":false,"error":"unauthorized"} on screen.
test('GET / from a cookie-less WebView (browser Accept) serves the sign-in page', async () => {
  const res = await fetch(`${srvUrl}/?embed=1&account_id=7`, {
    headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
  });
  assert.equal(res.status, 401);
  assert.match(res.headers.get('content-type') || '', /html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const html = await res.text();
  assert.match(html, /<iframe[^>]+src="\/app\/login"/);
  assert.doesNotMatch(html, /\{"ok":false/, 'the agent must never read raw JSON on their phone');
});
