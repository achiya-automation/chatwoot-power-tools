/**
 * sso.js — signed tickets that let Chatwoot's MOBILE app into the panel without a second login.
 *
 * The problem this solves: the mobile app opens a dashboard app in a WebView whose cookie jar is
 * EMPTY for the Chatwoot origin (the native app authenticates over the API with devise headers and
 * never runs the web SPA, and cw_d_session_info is written by that SPA's JavaScript — Rails never
 * Set-Cookie's it). So the phone arrives with no session at all. Chatwoot offers no auth contract
 * for dashboard apps (chatwoot#8552) and the appContext it postMessages is unsigned, so there is
 * nothing on the client worth trusting.
 *
 * What we CAN trust: the app fetches `GET /api/v1/accounts/:id/dashboard_apps` **with its devise
 * headers**, so Rails knows exactly who is asking. A small jbuilder override there signs a ticket
 * with a secret shared with this engine and appends it to the panel URL. The WebView opens that
 * URL, we verify the signature, and hand back a real session cookie. Chatwoot stays the authority
 * on identity — it is the one that signed.
 *
 * Two token KINDS share this code but must never be interchangeable:
 *   't' — the ticket in the URL. Single-use (burned in Postgres) and short-lived.
 *   's' — the session cookie we mint after a ticket is accepted. Not burnable, longer-lived.
 * They are separated by a prefix inside the HMAC input. Without that, a ticket already burned
 * could simply be replayed as a session cookie and the single-use guarantee would be worthless.
 */

import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

export const TICKET = 't';
export const SESSION = 's';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');

// Domain separation: the kind is INSIDE the signed material, so a 't' signature never verifies
// as an 's' one. See the header comment — this is what makes single-use actually hold.
const mac = (kind, payloadB64, secret) =>
  createHmac('sha256', secret).update(`${kind}:${payloadB64}`).digest();

/** sign(kind, payload, secret) → "<base64url(json)>.<base64url(hmac)>" */
export function sign(kind, payload, secret) {
  const p = b64u(JSON.stringify(payload));
  return `${p}.${b64u(mac(kind, p, secret))}`;
}

/**
 * verify(kind, token, secret, now) → payload | null.
 * Fails closed on: no secret, malformed token, bad signature, missing/expired `exp`.
 */
export function verify(kind, token, secret, now = Date.now()) {
  if (!token || !secret) return null;
  const s = String(token);
  const dot = s.indexOf('.');
  if (dot < 1 || dot === s.length - 1) return null;

  const p = s.slice(0, dot);
  const sig = unb64u(s.slice(dot + 1));
  const expect = mac(kind, p, secret);
  // Length check first — timingSafeEqual throws on a length mismatch.
  if (sig.length !== expect.length || !timingSafeEqual(sig, expect)) return null;

  let payload;
  try { payload = JSON.parse(unb64u(p).toString('utf8')); } catch { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (!Number.isFinite(payload.exp) || payload.exp <= now) return null;
  return payload;
}

/**
 * burn(pool, jti, exp) → true only the FIRST time this jti is seen.
 *
 * The ticket rides in a URL, and a URL leaks: it lands in the reverse proxy's access log, in the
 * app's memory, in any crash report. Single-use is what keeps a leaked ticket worthless — by the
 * time anyone could replay it, the agent's own WebView has already spent it. The INSERT is the
 * atomic test-and-set: two concurrent requests race on the primary key and exactly one wins.
 *
 * Expired rows are swept opportunistically — no cron, no growth.
 */
export async function burn(pool, jti, exp, now = Date.now()) {
  if (!jti) return false;
  const r = await pool.query(
    'INSERT INTO drip.used_tickets(jti, exp) VALUES ($1, $2) ON CONFLICT (jti) DO NOTHING',
    [String(jti), Math.floor(exp)]
  );
  if (r.rowCount === 1) {
    // Cheap opportunistic GC; failure here must never break a valid login.
    pool.query('DELETE FROM drip.used_tickets WHERE exp < $1', [now]).catch(() => {});
    return true;
  }
  return false;
}

/** newJti() — the ticket's single-use id. Exported so Chatwoot's side and tests agree on shape. */
export const newJti = () => randomUUID();
