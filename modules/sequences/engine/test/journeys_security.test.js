/**
 * journeys_security.test.js — locks in the hardening from the adversarial security review:
 * per-account hook token, SSRF guard, keyword rate-limit, jrn_launch visibility, jrn_get scope.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { setupDb } from './helpers.js';
import { getPool, query } from '../src/db.js';
import {
  perAccountHookToken, assertPublicUrl, handleJourneyHook, handleJourneysAction,
} from '../src/journeys.js';

const pool = getPool({ databaseUrl: process.env.DATABASE_URL_TEST });

function fakeClient() {
  const calls = [];
  const rec = (n) => (...a) => { calls.push({ n, a }); return Promise.resolve({ id: calls.length }); };
  return { calls, sendText: rec('sendText'), toggleStatus: rec('toggleStatus'),
    sendInputSelect: rec('sendInputSelect'), sendMedia: rec('sendMedia'),
    assignConversation: rec('assignConversation'), addLabels: rec('addLabels'),
    patchAttrs: rec('patchAttrs'), patchContactAttrs: rec('patchContactAttrs') };
}
const reads = { getContact: async () => ({ name: 'דנה' }) };
const ctxWith = (client) => ({ query, reads, makeClientFor: async () => client, config: {} });

const GRAPH = {
  nodes: [{ id: 'trigger', type: 'trigger', data: {} }, { id: 'n1', type: 'message', data: { text: 'hi' } }],
  edges: [{ id: 'e1', source: 'trigger', target: 'n1' }],
};

beforeEach(async () => {
  await setupDb(pool);
  await query('TRUNCATE drip.journey_runs, drip.journeys CASCADE');
  await query('TRUNCATE public.conversations, public.accounts CASCADE').catch(() => {});
});

// ── per-account hook token ──
test('perAccountHookToken: deterministic HMAC, distinct per account', () => {
  const a = perAccountHookToken('master', 1);
  const b = perAccountHookToken('master', 2);
  assert.equal(a, createHmac('sha256', 'master').update('1').digest('hex'));
  assert.notEqual(a, b);                       // knowing account 1's token doesn't reveal account 2's
  assert.equal(a, perAccountHookToken('master', 1)); // stable
  assert.notEqual(a, perAccountHookToken('other', 1)); // depends on the master
});

// ── SSRF guard ──
test('assertPublicUrl: rejects private/loopback/link-local and non-http schemes', async () => {
  const bad = [
    'http://127.0.0.1/x', 'http://10.1.2.3/x', 'http://192.168.0.5/x', 'http://172.16.9.9/x',
    'http://169.254.169.254/latest/meta-data/', 'http://[::1]/x',
    'file:///etc/passwd', 'gopher://x/', 'ftp://x/', 'not a url',
  ];
  for (const u of bad) {
    await assert.rejects(assertPublicUrl(u), new RegExp('.'), `should reject ${u}`);
  }
});

test('assertPublicUrl: allows a public https URL (ip literal, no DNS)', async () => {
  await assert.doesNotReject(assertPublicUrl('https://8.8.8.8/hook'));
});

test('assertPublicUrl: localhost hostname resolves to loopback → rejected', async () => {
  await assert.rejects(assertPublicUrl('http://localhost:3000/x'));
});

// ── keyword rate-limit ──
test('keyword trigger is rate-limited: a second start within 30m is blocked', async () => {
  await query(`INSERT INTO drip.journeys (account_id,name,status,trigger,graph)
               VALUES (1,'kw','active',$1,$2)`,
    [JSON.stringify({ keywords: ['מבצע'] }), JSON.stringify(GRAPH)]);
  const client = fakeClient();
  const evt = (id) => ({ event: 'message_created', message_type: 'incoming', id, content: 'מבצע',
    account: { id: 1 }, conversation: { display_id: 77 }, inbox: { id: 3 } });

  await handleJourneyHook(ctxWith(client), evt(1));
  assert.equal((await query(`SELECT count(*)::int n FROM drip.journey_runs WHERE display_id=77`))[0].n, 1);
  // stop the live run, then a fresh keyword within the window must NOT start another
  await query(`UPDATE drip.journey_runs SET status='done' WHERE display_id=77`);
  await handleJourneyHook(ctxWith(client), evt(2));
  assert.equal((await query(`SELECT count(*)::int n FROM drip.journey_runs WHERE display_id=77`))[0].n, 1);
});

// ── jrn_launch visibility under agent-isolation ──
test('jrn_launch: restricted account blocks a non-assignee agent', async () => {
  await query(`INSERT INTO public.accounts (id,name,settings) VALUES (1,'a','{"restrict_agents_to_assigned":"true"}')`);
  const [{ id }] = await query(`INSERT INTO drip.journeys (account_id,name,status,trigger,graph)
                                 VALUES (1,'j','active','{}',$1) RETURNING id`, [JSON.stringify(GRAPH)]);
  await query(`INSERT INTO public.conversations (id,display_id,account_id,assignee_id) VALUES (900,55,1,7)`);
  const ctx = ctxWith(fakeClient());

  // agent 9 is NOT the assignee (7) → blocked
  await assert.rejects(
    handleJourneysAction(ctx, 'jrn_launch', { id, display_id: 55, __actor: { uid: 9, isAdmin: false } }, 1),
    /משויכת אליך/
  );
  // the real assignee (7) is allowed
  const ok = await handleJourneysAction(ctx, 'jrn_launch', { id, display_id: 55, __actor: { uid: 7, isAdmin: false } }, 1);
  assert.ok(ok.started);
  // an admin is always allowed (new conversation)
  await query(`INSERT INTO public.conversations (id,display_id,account_id,assignee_id) VALUES (901,56,1,7)`);
  const adm = await handleJourneysAction(ctx, 'jrn_launch', { id, display_id: 56, __actor: { uid: 3, isAdmin: true } }, 1);
  assert.ok(adm.started);
});

// ── jrn_get cross-account scope ──
test('jrn_get: a journey UUID from another account is not readable', async () => {
  const [{ id }] = await query(`INSERT INTO drip.journeys (account_id,name,status,trigger,graph)
                                VALUES (1,'mine','draft','{}',$1) RETURNING id`, [JSON.stringify(GRAPH)]);
  const ctx = ctxWith(fakeClient());
  const mine = await handleJourneysAction(ctx, 'jrn_get', { id }, 1);
  assert.equal(mine.name, 'mine');
  await assert.rejects(handleJourneysAction(ctx, 'jrn_get', { id }, 2), /לא נמצא/); // account 2 can't read account 1's
});
