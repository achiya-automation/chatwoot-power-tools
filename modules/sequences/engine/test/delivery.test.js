import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { setupDb, relaxCompliance } from './helpers.js';
import { parseExternalError, reconcileDeliveries } from '../src/reconcile.js';

/*
 * delivery.test.js — Phase 4 delivery tracking ("who got stuck in a sequence").
 *  - parseExternalError: Chatwoot's DOUBLE-ENCODED content_attributes → {code,title}.
 *  - reconcileDeliveries: reads public.messages.status and flags failed/delivered,
 *    turning the enrollment 'failed' on an undeliverable send (131026 etc.).
 *  - sent_history / list_enrollments expose delivery_status + last_error to the UI.
 * (public.conversations/contacts/messages are scaffolded by deploy/run-tests.sh.)
 */

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

// fake Chatwoot client — records the seq_state patches so we can assert on them
function fakeClient() {
  const patches = [];
  return { patches, patchAttrs: async (cid, attrs) => { patches.push({ cid, attrs }); } };
}

beforeEach(async () => {
  await setupDb(pool);
  await query('TRUNCATE drip.enrollments, drip.sequence_steps, drip.sequences, drip.sent_messages CASCADE');
  await pool.query('TRUNCATE public.conversations, public.contacts, public.messages');
  await relaxCompliance(pool);
});

async function seed({ status = 'completed', step = 2 } = {}) {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name) VALUES (1,'k','רצף') RETURNING id`
  ))[0].id;
  await query(`INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name) VALUES ($1,1,'t1'),($1,2,'t2')`, [seq]);
  const enr = (await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,status)
     VALUES (1,7001,$1,$2,$3) RETURNING id`, [seq, step, status]
  ))[0].id;
  return { seq, enr };
}

// insert a public.messages row with DOUBLE-ENCODED content_attributes (production shape)
async function seedMessage(id, msgStatus, externalError) {
  const attrs = externalError ? JSON.stringify({ external_error: externalError }) : null;
  await pool.query(
    `INSERT INTO public.messages (id, conversation_id, status, content_attributes)
     VALUES ($1, 7001, $2, CASE WHEN $3::text IS NULL THEN NULL ELSE to_json($3::text) END)`,
    [id, msgStatus, attrs]
  );
}

async function seedSent(enr, seq, messageId, stepOrder = 2) {
  return (await query(
    `INSERT INTO drip.sent_messages(account_id,conversation_id,enrollment_id,sequence_id,step_order,template_name,message_id)
     VALUES (1,7001,$1,$2,$3,'t2',$4) RETURNING id`,
    [enr, seq, stepOrder, messageId]
  ))[0].id;
}

// ── parseExternalError (pure) ──────────────────────────────────────────────────
test('parseExternalError: double-encoded "131026: …" → code+title', () => {
  const text = JSON.stringify(JSON.stringify({ external_error: '131026: Message undeliverable' }));
  const r = parseExternalError(text);
  assert.equal(r.code, '131026');
  assert.equal(r.title, '131026: Message undeliverable');
});

test('parseExternalError: "(#132012) …" form → numeric code', () => {
  const text = JSON.stringify(JSON.stringify({ external_error: '(#132012) Parameter format does not match' }));
  assert.equal(parseExternalError(text).code, '132012');
});

test('parseExternalError: plain object (not double-encoded) still works', () => {
  const text = JSON.stringify({ external_error: '131047: Re-engagement message' });
  assert.equal(parseExternalError(text).code, '131047');
});

test('parseExternalError: null / no error → null', () => {
  assert.equal(parseExternalError(null), null);
  assert.equal(parseExternalError(JSON.stringify(JSON.stringify({}))), null);
});

// ── reconcileDeliveries ─────────────────────────────────────────────────────────
test('failed send (status=3) → sent_messages failed + enrollment failed + seq_state patch', async () => {
  const { seq, enr } = await seed({ status: 'completed' });
  await seedMessage(900, 3, '131026: Message undeliverable');
  const sentId = await seedSent(enr, seq, 900);

  const client = fakeClient();
  await reconcileDeliveries(pool, client, 1);

  const sm = (await query('SELECT delivery_status, error_code, error_title FROM drip.sent_messages WHERE id=$1', [sentId]))[0];
  assert.equal(sm.delivery_status, 'failed');
  assert.equal(sm.error_code, '131026');
  assert.equal(sm.error_title, '131026: Message undeliverable');

  const e = (await query('SELECT status FROM drip.enrollments WHERE id=$1', [enr]))[0];
  assert.equal(e.status, 'failed', 'enrollment flagged stuck');

  assert.equal(client.patches.length, 1);
  assert.deepEqual(client.patches[0], { cid: 7001, attrs: { seq_state: 'failed' } });
});

test('delivered send (status=2) → sent_messages delivered, enrollment untouched', async () => {
  const { seq, enr } = await seed({ status: 'completed' });
  await seedMessage(901, 2, null);
  const sentId = await seedSent(enr, seq, 901);

  const client = fakeClient();
  await reconcileDeliveries(pool, client, 1);

  const sm = (await query('SELECT delivery_status FROM drip.sent_messages WHERE id=$1', [sentId]))[0];
  assert.equal(sm.delivery_status, 'delivered');
  const e = (await query('SELECT status FROM drip.enrollments WHERE id=$1', [enr]))[0];
  assert.equal(e.status, 'completed');
  assert.equal(client.patches.length, 0);
});

test('unconfirmed send (status=0) → stays pending (re-checked next tick)', async () => {
  const { seq, enr } = await seed();
  await seedMessage(902, 0, null);
  const sentId = await seedSent(enr, seq, 902);

  await reconcileDeliveries(pool, fakeClient(), 1);
  const sm = (await query('SELECT delivery_status FROM drip.sent_messages WHERE id=$1', [sentId]))[0];
  assert.equal(sm.delivery_status, 'pending');
});

test('a re-assigned/deleted enrollment is NOT wrongly failed', async () => {
  const { seq, enr } = await seed({ status: 'completed' });
  await seedMessage(903, 3, '131026: Message undeliverable');
  // sent_messages keeps the OLD enrollment_id, but that enrollment is gone
  await seedSent(enr, seq, 903);
  await query('DELETE FROM drip.enrollments WHERE id=$1', [enr]);

  const client = fakeClient();
  await reconcileDeliveries(pool, client, 1);
  // message still marked failed (history truth) but no enrollment to flag, no patch
  assert.equal(client.patches.length, 0);
  const sm = (await query('SELECT delivery_status FROM drip.sent_messages WHERE message_id=903'))[0];
  assert.equal(sm.delivery_status, 'failed');
});

// insert a sent_messages row already marked failed (to simulate prior retry attempts)
async function seedFailedSent(enr, seq, stepOrder, code = '131049') {
  await query(
    `INSERT INTO drip.sent_messages(account_id,conversation_id,enrollment_id,sequence_id,step_order,template_name,delivery_status,error_code)
     VALUES (1,7001,$1,$2,$3,'t1','failed',$4)`,
    [enr, seq, stepOrder, code]
  );
}

// ── transient marketing-cap retries (131049 / 130472) ───────────────────────────
// Meta's per-user marketing frequency cap is TRANSIENT — it lifts as the user's window
// resets. So instead of abandoning the lead, reschedule the same step after a backoff.
test('transient cap (131049) reschedules a retry instead of failing the enrollment', async () => {
  const { seq, enr } = await seed({ status: 'active', step: 2 }); // step 1 sent → advanced to 2
  await seedMessage(910, 3, '131049: This message was not delivered to maintain healthy ecosystem engagement');
  await seedSent(enr, seq, 910, 1); // the FAILED send was step 1
  const client = fakeClient();
  const NOW = new Date('2026-06-23T12:00:00Z');
  await reconcileDeliveries(pool, client, 1, NOW, { maxDeliveryRetries: 3, deliveryRetryHours: 24 });

  const sm = (await query('SELECT delivery_status, error_code FROM drip.sent_messages WHERE message_id=910'))[0];
  assert.equal(sm.delivery_status, 'failed', 'send recorded failed (history + retry counting)');
  assert.equal(sm.error_code, '131049');

  const e = (await query('SELECT status, current_step, next_send_at FROM drip.enrollments WHERE id=$1', [enr]))[0];
  assert.equal(e.status, 'active', 'NOT failed — scheduled to retry');
  assert.equal(e.current_step, 1, 'reset to the failed step (1) to re-send it');
  assert.ok(new Date(e.next_send_at) > NOW, 'next_send_at backed off into the future');
  assert.equal(client.patches.length, 0, 'no "stuck" patch — it is retrying');
});

// ── ⭐ the LAST cap failure must ALSO rewind the pointer, not just suppress ──────
// When cap_failures hits max_cap_failures the contact is suppressed — but the enrollment
// deliberately stays active, because a reply opens a service window where Meta's cap does
// not apply, and then "she gets everything she missed". That promise was broken: this branch
// returned WITHOUT re-arming, so current_step stayed on the step AFTER the one that never
// arrived. The lead was left standing past a message she never saw, and the moment she
// replied she'd be served the continuation of a story she never heard the start of.
// (banana-book, 2026-07-14: 293 leads past an undelivered step, 197 of them 3 steps ahead.)
test('⭐ the cap failure that SUPPRESSES her still rewinds current_step to the failed step', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name) VALUES (1,'cap','רצף') RETURNING id`
  ))[0].id;
  await query(`INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name) VALUES ($1,1,'t1'),($1,2,'t2')`, [seq]);
  await pool.query(`INSERT INTO public.contacts(id,account_id,name) VALUES (555,1,'דנה')`);
  const enr = (await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,contact_id,sequence_id,current_step,status)
     VALUES (1,7001,555,$1,2,'active') RETURNING id`, [seq]
  ))[0].id;

  // she is one failure away from the cap (default max_cap_failures = 2).
  // contact_state is not truncated by beforeEach, so upsert rather than insert.
  await query(
    `INSERT INTO drip.contact_state(account_id,contact_id,cap_failures) VALUES (1,555,1)
     ON CONFLICT (account_id,contact_id) DO UPDATE SET cap_failures = 1, suppressed_at = NULL`
  );

  // step 1 was the send that Meta blocked — she never saw it
  await seedMessage(930, 3, '131049: This message was not delivered to maintain healthy ecosystem engagement');
  await seedSent(enr, seq, 930, 1);

  await reconcileDeliveries(pool, fakeClient(), 1, new Date('2026-06-23T12:00:00Z'),
    { maxDeliveryRetries: 3, deliveryRetryHours: 24 });

  const cs = (await query('SELECT cap_failures, suppressed_at, suppressed_reason FROM drip.contact_state WHERE contact_id=555'))[0];
  assert.equal(Number(cs.cap_failures), 2, 'the failure was counted');
  assert.ok(cs.suppressed_at, 'and she is suppressed — we stop initiating marketing');

  const e = (await query('SELECT status, current_step FROM drip.enrollments WHERE id=$1', [enr]))[0];
  assert.equal(e.status, 'active', 'enrollment stays active — a reply can still revive her');
  assert.equal(e.current_step, 1,
    'pointer rewound to the step she never received — otherwise a reply serves her step 2 first');
});

test('130472 (frequency-cap experiment) also retries', async () => {
  const { seq, enr } = await seed({ status: 'active', step: 2 });
  await seedMessage(912, 3, '130472: User is part of an experiment');
  await seedSent(enr, seq, 912, 1);
  await reconcileDeliveries(pool, fakeClient(), 1, new Date('2026-06-23T12:00:00Z'), { maxDeliveryRetries: 3, deliveryRetryHours: 24 });
  const e = (await query('SELECT status, current_step FROM drip.enrollments WHERE id=$1', [enr]))[0];
  assert.equal(e.status, 'active');
  assert.equal(e.current_step, 1);
});

test('transient cap gives up (failed) after maxDeliveryRetries attempts', async () => {
  const { seq, enr } = await seed({ status: 'active', step: 1 });
  await seedFailedSent(enr, seq, 1); // attempt 1 (already failed)
  await seedFailedSent(enr, seq, 1); // attempt 2 (already failed)
  await seedMessage(913, 3, '131049: still capped');
  await seedSent(enr, seq, 913, 1); // attempt 3 → at the cap of 3
  const client = fakeClient();
  await reconcileDeliveries(pool, client, 1, new Date(), { maxDeliveryRetries: 3, deliveryRetryHours: 24 });
  const e = (await query('SELECT status FROM drip.enrollments WHERE id=$1', [enr]))[0];
  assert.equal(e.status, 'failed', 'after 3 attempts → give up gracefully');
  assert.deepEqual(client.patches[0], { cid: 7001, attrs: { seq_state: 'failed' } });
});

test('permanent code (131026) still fails immediately — no retry', async () => {
  const { seq, enr } = await seed({ status: 'active', step: 2 });
  await seedMessage(914, 3, '131026: Message undeliverable');
  await seedSent(enr, seq, 914, 1);
  await reconcileDeliveries(pool, fakeClient(), 1, new Date(), { maxDeliveryRetries: 3, deliveryRetryHours: 24 });
  const e = (await query('SELECT status FROM drip.enrollments WHERE id=$1', [enr]))[0];
  assert.equal(e.status, 'failed', '131026 is permanent (bad number) — not retried');
});

// ── read-side functions expose delivery info to the UI ──────────────────────────
test('sent_history includes delivery_status + error_title', async () => {
  const { seq, enr } = await seed({ status: 'completed' });
  await seedMessage(904, 3, '131026: Message undeliverable');
  await seedSent(enr, seq, 904);
  await reconcileDeliveries(pool, fakeClient(), 1);

  const hist = (await query('SELECT drip.sent_history(1, 7001) AS r'))[0].r;
  assert.equal(hist.length, 1);
  assert.equal(hist[0].delivery_status, 'failed');
  assert.equal(hist[0].error_title, '131026: Message undeliverable');
});

test('list_enrollments surfaces last_error + failed_step for stuck leads', async () => {
  await query(`INSERT INTO public.contacts (id, name, phone_number) VALUES (601,'דנה','+972500000000')`);
  await query(`INSERT INTO public.conversations (id, display_id, account_id, contact_id) VALUES (8001,7001,1,601)`);
  const { seq, enr } = await seed({ status: 'completed' });
  await seedMessage(905, 3, '131026: Message undeliverable');
  await seedSent(enr, seq, 905);
  await reconcileDeliveries(pool, fakeClient(), 1);

  const list = (await query('SELECT drip.list_enrollments(1) AS r'))[0].r;
  const row = list.find((x) => x.conversation_id === 7001);
  assert.equal(row.status, 'failed');
  assert.equal(row.last_error_code, '131026');
  assert.equal(row.last_error, '131026: Message undeliverable');
  assert.equal(row.failed_step, 2);
});
