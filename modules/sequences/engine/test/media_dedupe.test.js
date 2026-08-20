/**
 * media_dedupe.test.js — re-uploading a byte-identical file must hand back the URL we already
 * host, not mint a new one.
 *
 * Regression guard for 09.08.2026: the same campaign image was uploaded twice, the second upload
 * produced a fresh URL no CDN had cached, and Meta — which re-fetches the URL once per message —
 * failed 256 of 370 sends with 131053 "Media upload error".
 *
 * Run: DATABASE_URL_TEST=postgres://postgres:test@localhost:55432/postgres node --test
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setupDb } from './helpers.js';
import { createApp, warmMediaUrl } from '../src/api.js';
import { getPool, query } from '../src/db.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

// a real (tiny) JPEG: the upload route validates mime + size before hashing
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(64, 0x41),
  Buffer.from([0xff, 0xd9]),
]);

// the upload route sits behind authGate: a Chatwoot session cookie, verified over fetchImpl
const COOKIE = `cw_d_session_info=${encodeURIComponent(JSON.stringify({
  'access-token': 't', client: 'c', uid: 'u@x',
}))}`;

const fetchImpl = async (url) => (
  String(url).endsWith('/api/v1/profile')
    ? { status: 200, json: async () => ({ id: 7, accounts: [{ id: 1, role: 'administrator' }] }) }
    : { status: 404, json: async () => ({}) }
);

function makeApp() {
  return createApp({
    ...cfg,
    chatwootBaseUrl: 'http://chatwoot.invalid',
    masterAccountId: 1,
    fetchImpl,
    mediaDir: fs.mkdtempSync(path.join(os.tmpdir(), 'drip-media-')),
    publicBase: 'http://127.0.0.1:1/drip',   // unreachable on purpose: warming must fail soft
  }).listen(0);
}

async function upload(app, body) {
  const res = await fetch(`http://127.0.0.1:${app.address().port}/drip-api/media?account_id=1&format=IMAGE`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg', 'x-filename': 'card.jpg', cookie: COOKIE },
    body,
  });
  return res.json();
}

beforeEach(async () => {
  await setupDb(pool);
  await query('TRUNCATE drip.media CASCADE');
});

test('same bytes uploaded twice → same URL, one row', async () => {
  const app = makeApp();
  try {
    const first = await upload(app, JPEG);
    const second = await upload(app, JPEG);

    assert.ok(first.ok && second.ok);
    assert.equal(second.data.url, first.data.url, 'a re-upload must reuse the warm URL');
    assert.equal(second.data.deduped, true);

    const rows = await query('SELECT count(*)::int AS n FROM drip.media WHERE account_id = 1');
    assert.equal(rows[0].n, 1, 'the duplicate must not create a second row or a second file');
  } finally {
    app.close();
  }
});

test('different bytes → different URL', async () => {
  const app = makeApp();
  try {
    const a = await upload(app, JPEG);
    const b = await upload(app, Buffer.concat([JPEG, Buffer.from([0x00])]));

    assert.notEqual(b.data.url, a.data.url);
    assert.ok(!b.data.deduped);
  } finally {
    app.close();
  }
});

test('warming never throws on an unreachable host', async () => {
  // upload must survive a CDN that is down, offline CI, anything — the file is already served
  assert.equal(await warmMediaUrl('http://127.0.0.1:1/nope.jpg'), false);
});
