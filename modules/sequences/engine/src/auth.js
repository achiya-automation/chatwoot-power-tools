/**
 * auth.js — session gate for the publicly-reachable drip dashboard.
 *
 * The panel and its API sit behind Caddy (/drip/ → engine) on the open web, so
 * every request (except the health check) must prove it carries a logged-in
 * Chatwoot session.
 *
 * ⚠️ Chatwoot authenticates its API with devise_token_auth HEADERS
 * (access-token / client / uid) — NOT the Rails session cookie. Its browser SPA
 * keeps those credentials in a JS-readable `cw_d_session_info` cookie and replays
 * them as headers on every API call. We do the same: parse cw_d_session_info out
 * of the forwarded Cookie header and verify it against GET /api/v1/profile using
 * those headers. (Forwarding the raw cookie 401s even a logged-in admin — Chatwoot
 * ignores cookies on /api/v1/profile. That was the original lockout bug.)
 *
 * Chatwoot stays the single source of truth — we never need its session secret.
 */

import { createHash } from 'node:crypto';

/**
 * Pull the devise-token-auth credentials out of a forwarded Cookie header.
 * `cw_d_session_info` is URL-encoded JSON ({access-token, client, uid, …}).
 * Returns the headers Chatwoot expects, or null if the cookie is absent /
 * unparseable / missing the token triple (→ caller fails closed).
 *
 * @param {string} cookieHeader - raw Cookie request header
 * @returns {{'access-token':string, client:string, uid:string, 'token-type':string, expiry:string}|null}
 */
export function sessionAuthHeaders(cookieHeader) {
  if (!cookieHeader) return null;
  const part = cookieHeader
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('cw_d_session_info='));
  if (!part) return null;
  const raw = part.slice('cw_d_session_info='.length);

  // The browser stores it URL-encoded; try decoded first, then raw as a fallback.
  let info;
  for (const parse of [() => JSON.parse(decodeURIComponent(raw)), () => JSON.parse(raw)]) {
    try { info = parse(); break; } catch { /* try next strategy */ }
  }
  if (!info || typeof info !== 'object') return null;

  const accessToken = info['access-token'];
  const { client, uid } = info;
  if (!accessToken || !client || !uid) return null; // not a usable session → fail closed

  return {
    'access-token': accessToken,
    client,
    uid,
    'token-type': info['token-type'] || 'Bearer',
    expiry: info.expiry != null ? String(info.expiry) : '',
  };
}

/**
 * isAuthenticated(cookieHeader, baseUrl, fetchImpl) → Promise<boolean>
 *
 * Verifies a raw Cookie header against Chatwoot's GET /api/v1/profile, sending the
 * devise-token-auth credentials parsed from cw_d_session_info as HEADERS.
 * fetchImpl is injectable for tests; defaults to the global fetch.
 */
export async function isAuthenticated(cookieHeader, baseUrl, fetchImpl = globalThis.fetch) {
  const headers = sessionAuthHeaders(cookieHeader);
  if (!headers) return false; // no parseable session → nothing to verify
  try {
    const res = await fetchImpl(`${baseUrl}/api/v1/profile`, {
      headers,
      redirect: 'manual',
    });
    return res.status === 200;
  } catch {
    // Chatwoot unreachable → fail closed (deny). Better a locked-out admin than an open panel.
    return false;
  }
}

const MASTER_DEFAULT = 1;

/**
 * resolveUserAccess(cookieHeader, baseUrl, fetchImpl, masterAccountId)
 *   → Promise<{ ok, userId, accounts:[{id,role}], isSuperAdmin } | null>
 *
 * Like isAuthenticated, but also reads the user's accounts + roles out of the Chatwoot
 * profile so the gate can authorize PER ACCOUNT (tenant isolation) and the dashboard can
 * offer an account picker. A super-admin is an *administrator of the master account* — they
 * may reach any drip-managed account; everyone else is limited to accounts they belong to.
 * Returns null when there's no parseable session, Chatwoot rejects it, or Chatwoot is
 * unreachable (fail closed). fetchImpl is injectable for tests.
 */
export async function resolveUserAccess(
  cookieHeader, baseUrl, fetchImpl = globalThis.fetch, masterAccountId = MASTER_DEFAULT
) {
  const headers = sessionAuthHeaders(cookieHeader);
  if (!headers) return null;
  try {
    const res = await fetchImpl(`${baseUrl}/api/v1/profile`, { headers, redirect: 'manual' });
    if (res.status !== 200) return null;
    // A logged-in profile carries accounts:[{id, role, ...}]. Tolerate a missing/invalid
    // body (treat as "no accounts") rather than throwing — the session itself is valid.
    let body = {};
    try { body = (await res.json()) || {}; } catch { body = {}; }
    const accounts = Array.isArray(body.accounts)
      ? body.accounts
          .filter((a) => a && a.id != null)
          .map((a) => ({ id: Number(a.id), role: String(a.role || '') }))
      : [];
    const isSuperAdmin = accounts.some(
      (a) => a.id === Number(masterAccountId) && a.role === 'administrator'
    );
    return { ok: true, userId: body.id ?? null, accounts, isSuperAdmin };
  } catch {
    // Chatwoot unreachable → fail closed (deny). Better a locked-out admin than an open panel.
    return null;
  }
}

/**
 * canAccessAccount(access, accountId) → boolean.
 * A super-admin reaches any account. A regular user reaches only the accounts they belong
 * to. An accountId of 0/undefined (e.g. the SPA shell, which carries no account) is allowed
 * once the session itself is proven — there's no tenant data to leak yet.
 */
export function canAccessAccount(access, accountId) {
  if (!access || !access.ok) return false;
  const id = Number(accountId);
  if (!id) return true;
  if (access.isSuperAdmin) return true;
  return access.accounts.some((a) => a.id === id);
}

/**
 * authGate(config) → express middleware.
 *
 * Two layers: (1) the session must be a valid logged-in Chatwoot user, and (2) the request's
 * ?account_id (when present) must be one the user is authorized for. Stashes the resolved
 * access on req.dripAccess so handlers (e.g. the `accounts` picker) can reuse it.
 * config.fetchImpl is injectable for tests; config.masterAccountId sets the super-admin account.
 */
export function authGate(config) {
  const fetchImpl = config.fetchImpl || globalThis.fetch;
  const master = config.masterAccountId || MASTER_DEFAULT;
  const TTL_MS = 30_000;
  // Positive-only cache: sha256(cookie) → { access, expiry }. We never store the raw cookie,
  // and failures are never cached, so a logged-out/expired session is re-checked at once.
  const cache = new Map();
  // Single-flight: sha256(cookie) → in-flight resolve Promise. A dashboard load fires several
  // API calls at once with the SAME cookie; without this each would hit Chatwoot's /profile
  // separately (a burst that overloads Rails and slows every call). Instead the first verify
  // runs and the rest await its result.
  const inflight = new Map();

  return async function gate(req, res, next) {
    const cookie = req.headers.cookie || '';
    if (!cookie) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const key = createHash('sha256').update(cookie).digest('hex');
    let access = null;
    const hit = cache.get(key);
    if (hit && hit.expiry > Date.now()) {
      access = hit.access;                                   // fresh positive → skip Rails
    } else if (inflight.has(key)) {
      access = await inflight.get(key);                      // a verify is already running → join it
    } else {
      const p = resolveUserAccess(cookie, config.chatwootBaseUrl, fetchImpl, master);
      inflight.set(key, p);
      try { access = await p; } finally { inflight.delete(key); }
      if (access && access.ok) cache.set(key, { access, expiry: Date.now() + TTL_MS });
    }
    if (!access || !access.ok) return res.status(401).json({ ok: false, error: 'unauthorized' });

    req.dripAccess = access;

    // Tenant isolation: a logged-in user may only act on accounts they belong to (a
    // super-admin on any). Stops ?account_id=N from reading another tenant's leads.
    const acc = parseInt(req.query?.account_id || '0', 10);
    if (acc && !canAccessAccount(access, acc)) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    return next();
  };
}
