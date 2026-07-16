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
import { sign, verify, burn, TICKET, SESSION } from './sso.js';

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
 * The page a *navigation* gets when it carries no session — instead of the raw 401 JSON.
 *
 * Why this exists: Chatwoot's MOBILE app opens a dashboard app in a react-native-webview, and
 * that WebView's cookie jar is EMPTY for the Chatwoot origin. The native app authenticates over
 * the API (devise headers kept in AsyncStorage) and never runs the web SPA — and cw_d_session_info
 * is written by the SPA's JavaScript, never Set-Cookie'd by Rails. So the phone always arrives
 * cookie-less, the gate denies, and the WebView renders the denial body: the agent literally reads
 * `{"ok":false,"error":"unauthorized"}` on screen.
 *
 * Chatwoot gives us nothing to fix that with: dashboard apps have no auth contract at all
 * (chatwoot#8552, open since 2023), the URL is never templated (chatwoot#13756), and the
 * appContext postMessage is unsigned — so its `currentAgent` is a hint, never a credential.
 *
 * The one honest fix is to let the user prove themselves to Chatwoot *inside that WebView*:
 * Chatwoot's own /app/login is same-origin and allows framing (frame-ancestors 'self'), so it
 * runs in the iframe below. On success its SPA writes cw_d_session_info into this very cookie
 * jar, the poll sees it, and the reload lands on the real panel — with every later /drip request
 * carrying the session. The security model is untouched: no shared secret, no bypass, no trust in
 * anything the host page claims. It also upgrades the desktop expired-session case, which used to
 * dump the same JSON into the Chatwoot sidebar.
 *
 * Inline <style>/<script> are allowed by the CSP already in front of this route
 * (script-src 'self' 'unsafe-inline'; frame-src 'self').
 */
const SIGN_IN_PAGE = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>התחברות</title>
<style>html,body{margin:0;height:100%;background:#fff}iframe{display:block;width:100%;height:100%;border:0}</style>
</head>
<body>
<iframe src="/app/login" title="התחברות ל-Chatwoot"></iframe>
<script>
  // ה-SPA של Chatwoot כותב את cw_d_session_info בהתחברות מוצלחת. ה-iframe הוא same-origin,
  // אז ה-cookie מופיע גם כאן — וברגע שהוא נכתב, טוענים מחדש ונכנסים לפאנל עצמו.
  //
  // משווים את הערך למצב הפתיחה, ולא בודקים רק אם הוא קיים: סשן שפג תוקף מגיע לכאן עם
  // cookie קיים אך פסול (השער אימת אותו מול Chatwoot ודחה). בדיקת-קיום הייתה מזהה אותו,
  // מרעננת, נדחית שוב — ולולאת רענון אינסופית במקום מסך התחברות.
  function sess() {
    var m = document.cookie.match(/(?:^|;\\s*)cw_d_session_info=([^;]*)/);
    return m ? m[1] : '';
  }
  var before = sess();
  setInterval(function () {
    var now = sess();
    if (now && now !== before) location.reload();  // התחברות חדשה = טוקן חדש = ערך שונה
  }, 500);
</script>
</body>
</html>`;

/**
 * A navigation is a browser/WebView asking for a PAGE — it sends a `text/html` Accept. The SPA's
 * own fetch() calls do not (they send a wildcard or `application/json`) and must keep getting the
 * JSON they parse. /drip-api is a machine contract: never a navigation, whatever Accept claims.
 */
function isNavigation(req) {
  return (
    req.method === 'GET' &&
    !String(req.path || '').startsWith('/drip-api') &&
    /\btext\/html\b/i.test(req.headers?.accept || '')
  );
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

  // ── the mobile door (see src/sso.js) ───────────────────────────────────────
  // Empty secret = this door does not exist. Never default it: a guessable secret here would let
  // anyone mint themselves a ticket into any account.
  const ssoSecret = config.ssoSecret || '';
  // The session cookie is scoped to the panel's own path, so it is never sent to Chatwoot itself.
  // Derived from PUBLIC_BASE_URL (…/drip) — in dev, where the panel is served at the root, '/'.
  const cookiePath = (() => {
    try { return new URL(config.publicBase).pathname.replace(/\/+$/, '') || '/'; } catch { return '/'; }
  })();
  const SESSION_MS = 60 * 24 * 60 * 60 * 1000;   // 60d — matches Chatwoot's own token_lifespan

  // Turn ticket/session claims into the same shape resolveUserAccess() returns, so everything
  // downstream (tenant isolation, the accounts picker) is identical whichever door was used.
  // Chatwoot signed these claims, so they are as trustworthy as its /profile answer — but they
  // name exactly ONE account: the tab the ticket was minted for. Never a super-admin.
  const accessFromClaims = (c) => ({
    ok: true,
    userId: c.u ?? null,
    accounts: [{ id: Number(c.a), role: '' }],
    isSuperAdmin: false,
  });
  // Positive-only cache: sha256(cookie) → { access, expiry }. We never store the raw cookie,
  // and failures are never cached, so a logged-out/expired session is re-checked at once.
  const cache = new Map();
  // Single-flight: sha256(cookie) → in-flight resolve Promise. A dashboard load fires several
  // API calls at once with the SAME cookie; without this each would hit Chatwoot's /profile
  // separately (a burst that overloads Rails and slows every call). Instead the first verify
  // runs and the rest await its result.
  const inflight = new Map();

  // An auth failure must NEVER be cacheable.
  //
  // The SPA's assets are served through this gate, and a reverse proxy / CDN in front of it
  // will happily stamp `Cache-Control: public, max-age=…` on anything ending in .js or .css —
  // including this 401. One unauthenticated request for a bundle (a crawler, a logged-out tab,
  // a curl) is then enough to pin a 401 at the edge for that exact filename, and every
  // logged-in user gets the cached 401 instead of the bundle: the dashboard renders blank
  // until the cache expires. Because Vite hashes the filename, a fresh deploy is exactly when
  // a never-before-requested asset URL exists to be poisoned — so it breaks right after every
  // release, which is the worst possible time. Deny responses are marked no-store here, and
  // the proxy snippet no longer blanket-stamps this route (see lib/proxy-caddy.sh).
  //
  // A denial that is a NAVIGATION and is about a MISSING session (401, not 403) gets the sign-in
  // page instead of the JSON — see SIGN_IN_PAGE for why the phone always arrives cookie-less.
  // 403 stays JSON on purpose: the session is fine, the tenant is wrong, and offering a login
  // there would just loop the user through a sign-in that changes nothing.
  const deny = (req, res, status, error) => {
    res.set('Cache-Control', 'no-store');
    if (status === 401 && isNavigation(req)) {
      return res.status(401).type('html').send(SIGN_IN_PAGE);
    }
    return res.status(status).json({ ok: false, error });
  };

  // Our own session cookie — minted after a ticket was accepted, then presented on every later
  // request. We signed it, so it needs no Chatwoot round-trip.
  const sessionFromCookie = (cookie) => {
    if (!ssoSecret || !cookie) return null;
    const part = cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('drip_session='));
    if (!part) return null;
    const claims = verify(SESSION, part.slice('drip_session='.length), ssoSecret);
    return claims ? accessFromClaims(claims) : null;
  };

  // Inspect a URL ticket without consuming it. The gate first decides which mobile credential
  // authorizes the requested account; an unrelated but valid ticket must not burn itself or
  // overwrite a session that already matches the request.
  const claimsFromTicket = (req) => {
    const k = req.query?.k;
    if (!ssoSecret || !k || !config.pool) return null;
    return verify(TICKET, k, ssoSecret);
  };

  // Consume the selected ticket (single use), then hand back a session cookie so the SPA's
  // subsequent fetch() calls authenticate normally.
  const sessionFromTicket = async (claims, res) => {
    if (!claims) return null;
    // Express 4 does not catch a rejected async middleware promise. A ticket-store outage must
    // fail closed here while still allowing an already-valid cookie/browser session to continue.
    let spent = false;
    try { spent = await burn(config.pool, claims.jti, claims.exp); } catch { return null; }
    if (!spent) return null;                                             // already spent → refuse

    const exp = Date.now() + SESSION_MS;
    res.cookie('drip_session', sign(SESSION, { u: claims.u, a: claims.a, exp }, ssoSecret), {
      httpOnly: true,          // a dashboard-app script must never be able to read the session
      secure: true,
      sameSite: 'lax',
      path: cookiePath,        // scoped to the panel — not sent to Chatwoot
      maxAge: SESSION_MS,
    });
    return accessFromClaims(claims);
  };

  return async function gate(req, res, next) {
    const cookie = req.headers.cookie || '';
    const acc = parseInt(req.query?.account_id || '0', 10);

    // Pick the credential that authorizes this account. A fresh matching URL ticket beats a stale
    // cookie when the WebView moves from account A to B; a ticket for A must not displace a cookie
    // that already authorizes B. Only the selected ticket is consumed and allowed to mint a cookie.
    const ticketClaims = claimsFromTicket(req);
    const ticketCandidate = ticketClaims ? accessFromClaims(ticketClaims) : null;
    const cookieAccess = sessionFromCookie(cookie);

    if (ticketCandidate && (!acc || canAccessAccount(ticketCandidate, acc))) {
      const ticketAccess = await sessionFromTicket(ticketClaims, res);
      if (ticketAccess) {
        req.dripAccess = ticketAccess;
        return next();
      }
    }

    if (cookieAccess && (!acc || canAccessAccount(cookieAccess, acc))) {
      req.dripAccess = cookieAccess;
      return next();
    }

    // If neither mobile credential authorizes the requested account, fall through to the regular
    // Chatwoot browser session. This is required by injected surfaces (campaign statistics,
    // sequences navigation), which carry cw_d_session_info but no URL ticket of their own.
    const mobileMismatch = Boolean(acc && (
      (ticketCandidate && !canAccessAccount(ticketCandidate, acc)) ||
      (cookieAccess && !canAccessAccount(cookieAccess, acc))
    ));

    if (!cookie) {
      return mobileMismatch
        ? deny(req, res, 403, 'forbidden')
        : deny(req, res, 401, 'unauthorized');
    }

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
    if (!access || !access.ok) {
      return mobileMismatch
        ? deny(req, res, 403, 'forbidden')
        : deny(req, res, 401, 'unauthorized');
    }

    req.dripAccess = access;

    // Tenant isolation: a logged-in user may only act on accounts they belong to (a
    // super-admin on any). Stops ?account_id=N from reading another tenant's leads.
    if (acc && !canAccessAccount(access, acc)) {
      return deny(req, res, 403, 'forbidden');
    }
    return next();
  };
}
