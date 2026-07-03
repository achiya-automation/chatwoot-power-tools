/**
 * api.test.js — Task 6 tests for store.js (handleAction) and api.js (POST /drip-api)
 *
 * Run: DATABASE_URL_TEST=postgres://postgres:test@localhost:55432/postgres node --test
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleAction, initStore, resolveDisplayId } from '../src/store.js';
import { createApp } from '../src/api.js';
import { getPool, query } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);
initStore(cfg);

beforeEach(async () => {
  await runMigrations(pool);
  await query('TRUNCATE drip.enrollments, drip.sequence_steps, drip.sequences CASCADE');
});

// ── Test from brief: save then list returns the sequence ──
test('save then list returns the sequence', async () => {
  await handleAction(1, 'save', {
    key: 'k',
    display_name: 'K',
    steps: [{ step_order: 1, template_name: 't', params: [] }],
  });
  const r = await handleAction(1, 'list', {});
  assert.equal(r.sequences[0].key, 'k');
});

// ── list returns { sequences: [...] } ──
test('list returns sequences array wrapper', async () => {
  const r = await handleAction(1, 'list', {});
  assert.ok(Array.isArray(r.sequences), 'sequences must be an array');
});

// ── save returns the saved sequence ──
test('save returns the saved sequence with steps', async () => {
  const r = await handleAction(1, 'save', {
    key: 'myseq',
    display_name: 'My Sequence',
    enabled: true,
    stop_on_reply: false,
    skip_shabbat: true,
    steps: [
      { step_order: 1, template_name: 'welcome', language: 'he', category: 'MARKETING', delay_days: 0, delay_hours: 0, params: ['@name'] },
    ],
  });
  assert.equal(r.sequence.key, 'myseq');
  assert.equal(r.sequence.display_name, 'My Sequence');
  assert.ok(Array.isArray(r.sequence.steps));
  assert.equal(r.sequence.steps[0].template_name, 'welcome');
  assert.deepEqual(r.sequence.steps[0].params, ['@name']);
  assert.equal(r.sequence.skip_shabbat, true, 'skip_shabbat must be persisted through save');
});

// ── per-step send_condition + on_condition_fail round-trip through save/list ──
test('save persists send_condition/on_condition_fail per step and list returns them', async () => {
  const r = await handleAction(1, 'save', {
    key: 'gate',
    display_name: 'Gate',
    steps: [
      { step_order: 1, template_name: 'first', params: [] },
      { step_order: 2, template_name: 'reminder', params: [], send_condition: 'no_reply', on_condition_fail: 'skip' },
    ],
  });
  assert.equal(r.sequence.steps[0].send_condition, 'always', 'unset step defaults to always');
  assert.equal(r.sequence.steps[0].on_condition_fail, 'skip', 'unset step defaults to skip');
  assert.equal(r.sequence.steps[1].send_condition, 'no_reply', 'send_condition is persisted');
  assert.equal(r.sequence.steps[1].on_condition_fail, 'skip', 'on_condition_fail is persisted');

  const l = await handleAction(1, 'list', {});
  const seq = l.sequences.find((s) => s.key === 'gate');
  assert.equal(seq.steps[1].send_condition, 'no_reply', 'send_condition survives the list round-trip');
  assert.equal(seq.steps[1].on_condition_fail, 'skip', 'on_condition_fail survives the list round-trip');
});

// ── save upserts on same key (idempotent) ──
test('save upserts on same key', async () => {
  await handleAction(1, 'save', { key: 'dup', display_name: 'First', steps: [] });
  await handleAction(1, 'save', { key: 'dup', display_name: 'Updated', steps: [] });
  const r = await handleAction(1, 'list', {});
  const seqs = r.sequences.filter((s) => s.key === 'dup');
  assert.equal(seqs.length, 1, 'upsert should not duplicate');
  assert.equal(seqs[0].display_name, 'Updated');
});

// ── delete removes the sequence ──
test('delete removes sequence', async () => {
  await handleAction(1, 'save', { key: 'del_me', display_name: 'D', steps: [] });
  const r1 = await handleAction(1, 'list', {});
  assert.equal(r1.sequences.filter((s) => s.key === 'del_me').length, 1);

  await handleAction(1, 'delete', { key: 'del_me' });
  const r2 = await handleAction(1, 'list', {});
  assert.equal(r2.sequences.filter((s) => s.key === 'del_me').length, 0);
});

// ── delete returns { data: null } shape ──
test('delete returns null data', async () => {
  await handleAction(1, 'save', { key: 'todel', display_name: 'T', steps: [] });
  const r = await handleAction(1, 'delete', { key: 'todel' });
  assert.equal(r.data, null);
});

// ── enrollments returns { data: [...] } ──
test('enrollments returns data array', async () => {
  const r = await handleAction(1, 'enrollments', {});
  assert.ok(Array.isArray(r.data), 'enrollments data must be an array');
});

// ── enrollment_status: missing conversation returns null ──
test('enrollment_status for unknown conversation returns null result', async () => {
  // account_tokens not in test DB so we test the DB path; no enrollment exists
  const r = await handleAction(1, 'enrollment_status', { conversation_id: 9999 });
  // data is null when no enrollment found
  assert.equal(r.data, null);
});

// ── steps are replaced atomically on re-save ──
test('save replaces steps atomically', async () => {
  await handleAction(1, 'save', {
    key: 'steps_test',
    display_name: 'Steps',
    steps: [
      { step_order: 1, template_name: 'first', params: [] },
      { step_order: 2, template_name: 'second', params: [] },
    ],
  });
  const r = await handleAction(1, 'save', {
    key: 'steps_test',
    display_name: 'Steps',
    steps: [
      { step_order: 1, template_name: 'only', params: [] },
    ],
  });
  assert.equal(r.sequence.steps.length, 1);
  assert.equal(r.sequence.steps[0].template_name, 'only');
});

// ── account isolation: save for acct 1 not visible from acct 2 ──
test('account isolation: sequences scoped to account_id', async () => {
  await handleAction(1, 'save', { key: 'acct1seq', display_name: 'A', steps: [] });
  const r = await handleAction(2, 'list', {});
  assert.equal(r.sequences.filter((s) => s.key === 'acct1seq').length, 0);
});

// ── set_sequence validates conversation_id (client logic covered in chatwoot.test) ──
test('set_sequence requires conversation_id', async () => {
  await assert.rejects(
    handleAction(1, 'set_sequence', { sequence: 'welcome' }),
    /conversation_id required/
  );
});

// ── save auto-generates a key when none is provided (key field hidden in UI) ──
test('save auto-generates a key when none provided', async () => {
  const r = await handleAction(1, 'save', { display_name: 'No Key Seq', steps: [] });
  assert.ok(r.sequence.key && r.sequence.key.length > 0, 'a key was generated');
  assert.match(r.sequence.key, /^seq_/, 'generated key has seq_ prefix');
});

// ── save validates input (API is public behind auth; a broken sequence must be rejected) ──
test('save rejects a step with no template_name', async () => {
  await assert.rejects(
    handleAction(1, 'save', { display_name: 'X', steps: [{ step_order: 1, params: [] }] }),
    /template_name/
  );
});

test('save rejects malformed quiet hours', async () => {
  await assert.rejects(
    handleAction(1, 'save', { display_name: 'X', steps: [], quiet_start: '25:99' }),
    /quiet_start/
  );
});

// ── resolveDisplayId: panel may send display_id OR global id → always returns display_id ──
test('resolveDisplayId maps both display_id and global id to display_id', async () => {
  // schema must match reconcile.test.js (shared test DB) — incl. custom_attributes
  await pool.query(
    `CREATE TABLE IF NOT EXISTS public.conversations (id int PRIMARY KEY, display_id int, account_id int, custom_attributes jsonb DEFAULT '{}'::jsonb)`
  );
  await pool.query('TRUNCATE public.conversations');
  await pool.query('INSERT INTO public.conversations(id, display_id, account_id) VALUES (8154, 3931, 1)');
  assert.equal(await resolveDisplayId(1, 3931), 3931, 'display_id stays display_id');
  assert.equal(await resolveDisplayId(1, 8154), 3931, 'global id resolves to display_id');
  assert.equal(await resolveDisplayId(1, 9999), 9999, 'unknown id falls back to input');
});

// ── routes order: /media + /health are PUBLIC (before the auth gate), /drip-api is GATED ──
// Regression guard: Meta must fetch template media from /media without a session — if a future
// refactor moves the auth gate above /media, every media-header send breaks silently. /health
// stays open for the container healthcheck; /drip-api (returns real phone numbers) stays closed.
test('createApp: /media + /health public, /drip-api requires a Chatwoot session', async () => {
  const app = createApp({
    databaseUrl: process.env.DATABASE_URL_TEST,
    chatwootBaseUrl: 'http://chatwoot.invalid',
    mediaDir: '/tmp',
    fetchImpl: async () => ({ status: 401, json: async () => ({}) }), // Chatwoot would reject
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  // connection:close — don't leave undici keep-alive sockets holding the server open after
  // the test (that handle leaks into the next test file and destabilizes the shared pool).
  const H = { connection: 'close' };
  try {
    const health = await fetch(`${base}/drip-api/health`, { headers: H });
    assert.equal(health.status, 200, '/health is public (container healthcheck)');

    const media = await fetch(`${base}/media/nonexistent-probe.jpg`, { headers: H });
    assert.equal(media.status, 404, '/media is public — a missing file is 404, never 401');

    const api = await fetch(`${base}/drip-api?account_id=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...H },
      body: JSON.stringify({ action: 'list' }),
    });
    assert.equal(api.status, 401, '/drip-api with no session cookie → 401 (no phone-number leak)');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    initStore(cfg); // restore global store config for any subsequent test
  }
});
