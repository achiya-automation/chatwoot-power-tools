/**
 * sso.test.js — signed tickets that let Chatwoot's mobile app into the panel without a 2nd login.
 *
 * These tickets are the ONLY thing standing between "the phone just works" and "anyone who ever
 * saw the URL owns the lead list", so the adversarial cases matter more than the happy path:
 * forged signatures, expired tickets, replayed tickets, and — the subtle one — a burned ticket
 * being re-offered as a session cookie.
 *
 * Run: node --test test/sso.test.js   (no DB needed — the burn ledger is faked)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify, burn, newJti, TICKET, SESSION } from '../src/sso.js';

const SECRET = 'shared-with-chatwoot';
const future = () => Date.now() + 60_000;

// ── happy path ────────────────────────────────────────────────────────────────
test('a ticket signed by Chatwoot verifies and yields its claims', () => {
  const t = sign(TICKET, { u: 42, a: 7, exp: future(), jti: 'abc' }, SECRET);
  const claims = verify(TICKET, t, SECRET);
  assert.equal(claims.u, 42, 'the user Chatwoot authenticated');
  assert.equal(claims.a, 7, 'the account the tab belongs to');
});

// ── the whole point: nobody can mint one ──────────────────────────────────────
test('a ticket signed with the WRONG secret is refused', () => {
  const t = sign(TICKET, { u: 42, a: 7, exp: future(), jti: 'abc' }, 'attacker-guess');
  assert.equal(verify(TICKET, t, SECRET), null);
});

test('tampering with the claims breaks the signature', () => {
  const t = sign(TICKET, { u: 42, a: 7, exp: future(), jti: 'abc' }, SECRET);
  const [payload, sig] = t.split('.');
  const evil = Buffer.from(JSON.stringify({ u: 42, a: 999, exp: future(), jti: 'abc' })).toString('base64url');
  assert.equal(verify(TICKET, `${evil}.${sig}`, SECRET), null, 'cannot swap in another account');
  assert.notEqual(payload, evil);
});

test('an expired ticket is refused', () => {
  const t = sign(TICKET, { u: 42, a: 7, exp: Date.now() - 1, jti: 'abc' }, SECRET);
  assert.equal(verify(TICKET, t, SECRET), null);
});

test('a ticket with no expiry is refused (fail closed)', () => {
  const t = sign(TICKET, { u: 42, a: 7, jti: 'abc' }, SECRET);
  assert.equal(verify(TICKET, t, SECRET), null);
});

test('garbage and a missing secret fail closed rather than throw', () => {
  for (const junk of ['', 'x', 'x.', '.y', 'not-a-token', 'a.b.c', null, undefined]) {
    assert.equal(verify(TICKET, junk, SECRET), null, `junk: ${JSON.stringify(junk)}`);
  }
  const t = sign(TICKET, { u: 1, a: 1, exp: future(), jti: 'j' }, SECRET);
  assert.equal(verify(TICKET, t, ''), null, 'no secret configured → refuse, never accept');
});

// ── THE replay hole: a spent ticket must not become a session ─────────────────
// The ticket is single-use, enforced by the burn ledger. But the session cookie we mint is NOT
// burnable (it has to survive many requests). If both were signed the same way, an attacker who
// scraped a ticket from a log — already burned, therefore "safe" — could simply present it as the
// session cookie and walk straight past the ledger. Domain separation inside the HMAC is what
// makes that impossible. This test is the reason that prefix exists.
test('a ticket cannot be replayed as a session cookie, and vice versa', () => {
  const claims = { u: 42, a: 7, exp: future(), jti: 'abc' };
  const ticket = sign(TICKET, claims, SECRET);
  const session = sign(SESSION, claims, SECRET);

  assert.notEqual(ticket, session, 'the two kinds must not produce identical tokens');
  assert.equal(verify(SESSION, ticket, SECRET), null, 'a burned ticket must NOT pass as a session');
  assert.equal(verify(TICKET, session, SECRET), null, 'a session must NOT pass as a fresh ticket');
});

// ── single use ────────────────────────────────────────────────────────────────
test('burn() succeeds once and refuses every replay', async () => {
  const rows = new Set();
  const pool = {
    query: async (sql, params) => {
      if (sql.startsWith('INSERT')) {
        if (rows.has(params[0])) return { rowCount: 0 };   // primary-key conflict
        rows.add(params[0]);
        return { rowCount: 1 };
      }
      return { rowCount: 0 };                              // the opportunistic DELETE
    },
  };
  const jti = newJti();
  assert.equal(await burn(pool, jti, future()), true, 'first use wins');
  assert.equal(await burn(pool, jti, future()), false, 'replay loses');
  assert.equal(await burn(pool, jti, future()), false, 'and keeps losing');
});

test('burn() refuses a ticket with no jti (an unburnable ticket is a permanent key)', async () => {
  const pool = { query: async () => ({ rowCount: 1 }) };
  assert.equal(await burn(pool, undefined, future()), false);
  assert.equal(await burn(pool, '', future()), false);
});

test('newJti() is unique', () => {
  const seen = new Set(Array.from({ length: 500 }, () => newJti()));
  assert.equal(seen.size, 500);
});
