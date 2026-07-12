/**
 * contact_enroll.test.js — contact-level enrollment + lazy conversation creation.
 *
 * A lead is now a CONTACT carrying custom_attributes.sequence — NOT a pre-opened
 * conversation. The reconciler:
 *   • enroll phase: reads public.contacts with the attr → enrollment keyed by contact_id,
 *     conversation_id NULL (no conversation is created here);
 *   • send phase: when the first message is actually due, it opens a conversation
 *     (using the contact's WhatsApp contact_inbox source_id) and only then sends.
 *
 * This is the user's requirement: "create a contact only; open a conversation
 * automatically only when assigned to a sequence AND a message is sent".
 *
 * Run: DATABASE_URL_TEST=... node --test test/contact_enroll.test.js
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { setupDb, relaxCompliance } from './helpers.js';
import { reconcileAccount } from '../src/reconcile.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

beforeEach(async () => {
  await setupDb(pool);
  // Chatwoot public stand-ins (prod has the real tables).
  await pool.query(`CREATE TABLE IF NOT EXISTS public.contacts (
    id int PRIMARY KEY, account_id int, name text, phone_number text, email text,
    custom_attributes jsonb DEFAULT '{}'::jsonb)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.conversations (
    id int PRIMARY KEY, display_id int, account_id int, contact_id int,
    custom_attributes jsonb DEFAULT '{}'::jsonb)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.inboxes (
    id int PRIMARY KEY, account_id int, name text, channel_type text)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.contact_inboxes (
    id int PRIMARY KEY, contact_id int, inbox_id int, source_id text)`);
  await pool.query('TRUNCATE public.contacts, public.conversations, public.inboxes, public.contact_inboxes');
  await query('TRUNCATE drip.enrollments, drip.sequence_steps, drip.sequences, drip.no_send_windows, drip.sent_messages CASCADE');
  await relaxCompliance(pool);
});

const SUNDAY = new Date('2026-06-21T10:00:00Z'); // weekday daytime, not shabbat

// Seed a contact + its WhatsApp contact_inbox (the source_id survives conversation deletion).
async function seedContact(id, seq, { withInbox = true } = {}) {
  await query(
    `INSERT INTO public.contacts(id, account_id, name, phone_number, custom_attributes)
     VALUES ($1, 1, 'דנה', '+972500000000', $2::jsonb)`,
    [id, JSON.stringify(seq == null ? {} : { sequence: seq })]
  );
  if (withInbox) {
    await query(`INSERT INTO public.inboxes(id, account_id, name, channel_type) VALUES (26, 1, 'WA', 'Channel::Whatsapp') ON CONFLICT DO NOTHING`);
    await query(`INSERT INTO public.contact_inboxes(id, contact_id, inbox_id, source_id) VALUES ($1::int, $1::int, 26, 'src-' || $1::int)`, [id]);
  }
}

async function seedSeq(key, { stepDelayDays = 0, steps = 1 } = {}) {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,enabled,skip_shabbat) VALUES (1,$1,$1,true,false) RETURNING id`,
    [key]
  ))[0].id;
  for (let i = 1; i <= steps; i++) {
    await query(
      `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days) VALUES ($1,$2,$3,$4)`,
      [seq, i, `t${i}`, i === 1 ? stepDelayDays : 1]
    );
  }
  return seq;
}

function makeClient(calls) {
  return {
    createConversation: async ({ sourceId, inboxId, contactId }) => {
      calls.created.push({ sourceId, inboxId, contactId });
      return { id: 9000 + calls.created.length };
    },
    sendTemplate: async (cid, t) => { calls.sent.push({ cid, name: t.name }); return { id: 500 + calls.sent.length, content: 'body' }; },
    getContact: async () => ({ name: 'דנה', phone: '+972500000000' }),
    patchAttrs: async () => {},
    incomingSince: async () => false,
  };
}

// ── enroll only: a contact with the attr enrolls, with NO conversation created ──
test('a contact with the sequence attr enrolls (contact-keyed) and opens NO conversation yet', async () => {
  await seedSeq('cl', { stepDelayDays: 1 }); // first step in the future → enrolled but not sent this cycle
  await seedContact(101, 'cl');
  const calls = { created: [], sent: [] };
  await reconcileAccount(pool, makeClient(calls), 1, SUNDAY);

  const e = (await query('SELECT contact_id, conversation_id, current_step, status FROM drip.enrollments WHERE account_id=1 AND contact_id=101'))[0];
  assert.ok(e, 'enrollment exists, keyed by contact_id');
  assert.equal(e.current_step, 1);
  assert.equal(e.status, 'active');
  assert.equal(e.conversation_id, null, 'NO conversation opened at enroll time');
  assert.equal(calls.created.length, 0, 'createConversation NOT called at enroll');
  assert.equal(calls.sent.length, 0, 'nothing sent (first step not due yet)');
});

// ── lazy creation: when the first message is due, a conversation is opened then sent ──
test('first due send opens a conversation (using the contact source_id) and sends into it', async () => {
  await seedSeq('cl', { stepDelayDays: 0 }); // first step immediate → enroll + send same cycle
  await seedContact(102, 'cl');
  const calls = { created: [], sent: [] };
  await reconcileAccount(pool, makeClient(calls), 1, SUNDAY);

  assert.equal(calls.created.length, 1, 'exactly one conversation created');
  assert.equal(calls.created[0].sourceId, 'src-102', 'created with the contact WhatsApp source_id');
  assert.equal(calls.created[0].inboxId, 26);
  assert.equal(calls.created[0].contactId, 102);
  assert.equal(calls.sent.length, 1, 'one message sent');
  assert.equal(calls.sent[0].cid, 9001, 'sent into the freshly-created conversation');

  const e = (await query('SELECT conversation_id, current_step FROM drip.enrollments WHERE account_id=1 AND contact_id=102'))[0];
  assert.equal(e.conversation_id, 9001, 'enrollment now carries the created conversation id');
  const sm = (await query('SELECT conversation_id FROM drip.sent_messages WHERE account_id=1'))[0];
  assert.equal(sm.conversation_id, 9001, 'send history records the created conversation');
});

// ── reuse: a contact that already has a conversation gets the first send THERE ──
// (the requirement is "open a conversation IF there isn't one" — don't duplicate).
test('first send reuses the contact existing conversation instead of opening a new one', async () => {
  await seedSeq('rz', { stepDelayDays: 0 });
  await seedContact(108, 'rz');
  await query(`INSERT INTO public.conversations(id, display_id, account_id, contact_id) VALUES (6060, 6060, 1, 108)`);
  const calls = { created: [], sent: [] };
  await reconcileAccount(pool, makeClient(calls), 1, SUNDAY);
  assert.equal(calls.created.length, 0, 'must NOT open a new conversation when the contact already has one');
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.sent[0].cid, 6060, 'sent into the existing conversation');
  const e = (await query('SELECT conversation_id FROM drip.enrollments WHERE account_id=1 AND contact_id=108'))[0];
  assert.equal(e.conversation_id, 6060, 'enrollment bound to the existing conversation');
});

// ── an existing conversation is reused — no second conversation is opened ──
test('a subsequent send reuses the existing conversation (no second createConversation)', async () => {
  const seq = await seedSeq('cl', { stepDelayDays: 0, steps: 2 });
  await seedContact(103, 'cl');
  // Pre-existing enrollment already past its first send: conversation_id set, on step 2, due.
  await query(
    `INSERT INTO drip.enrollments(account_id,contact_id,conversation_id,sequence_id,current_step,next_send_at,status,last_sent_at)
     VALUES (1,103,7777,$1,2,'2020-01-01 00:00:00+00','active', now()-interval '1 day')`,
    [seq]
  );
  const calls = { created: [], sent: [] };
  await reconcileAccount(pool, makeClient(calls), 1, SUNDAY);

  assert.equal(calls.created.length, 0, 'must NOT open a new conversation when one already exists');
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.sent[0].cid, 7777, 'sent into the existing conversation');
});

// ── opt-out: emptying the contact attr stops the active enrollment ──
test('emptying the contact sequence attr stops the enrollment', async () => {
  const seq = await seedSeq('cl', { stepDelayDays: 1 });
  await seedContact(104, ''); // attr present but empty = opt-out
  await query(
    `INSERT INTO drip.enrollments(account_id,contact_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,104,$1,1,now()+interval '1 day','active')`,
    [seq]
  );
  const calls = { created: [], sent: [] };
  await reconcileAccount(pool, makeClient(calls), 1, SUNDAY);
  const e = (await query('SELECT status FROM drip.enrollments WHERE account_id=1 AND contact_id=104'))[0];
  assert.equal(e.status, 'stopped');
});

// ── switch: changing the contact attr to a new sequence resets to step 1 ──
test('changing the contact sequence attr switches to the new sequence (reset to step 1)', async () => {
  const a = await seedSeq('seqA', { stepDelayDays: 1 });
  await seedSeq('seqB', { stepDelayDays: 1 });
  await seedContact(105, 'seqB'); // attr points to B
  await query(
    `INSERT INTO drip.enrollments(account_id,contact_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,105,$1,2,now()+interval '1 day','active')`,
    [a]
  );
  const calls = { created: [], sent: [] };
  await reconcileAccount(pool, makeClient(calls), 1, SUNDAY);
  const e = (await query(`SELECT current_step, sequence_id FROM drip.enrollments WHERE account_id=1 AND contact_id=105`))[0];
  const b = (await query(`SELECT id FROM drip.sequences WHERE key='seqB'`))[0].id;
  assert.equal(e.current_step, 1, 'reset to step 1 for the new sequence');
  assert.equal(e.sequence_id, b);
});

// ── a failing patchAttrs (cosmetic seq_* write) must NOT roll back an already-sent message ──
// Regression: in production patchAttrs needed a GET the AgentBot token can't do; a throw there
// rolled back the send tx AFTER the irreversible WhatsApp send → the next tick re-sent. The
// send must commit regardless of a cosmetic-attr failure.
test('a patchAttrs failure after the send still commits the advance (no re-send)', async () => {
  await seedSeq('pa', { stepDelayDays: 0 }); // 1 immediate step
  await seedContact(109, 'pa');
  const calls = { created: [], sent: [] };
  const client = { ...makeClient(calls), patchAttrs: async () => { throw new Error('GET /conversations/x → 401'); } };

  await reconcileAccount(pool, client, 1, SUNDAY);
  assert.equal(calls.sent.length, 1, 'sent once');
  const e = (await query('SELECT status FROM drip.enrollments WHERE account_id=1 AND contact_id=109'))[0];
  assert.equal(e.status, 'completed', 'advanced/committed despite the patchAttrs failure');

  await reconcileAccount(pool, client, 1, SUNDAY);
  assert.equal(calls.sent.length, 1, 'no re-send on the next cycle (the send was committed, not rolled back)');
});

// ── loop guard: a COMPLETED enrollment with the same attr is NOT re-enrolled ──
test('a completed enrollment with the same sequence attr is not re-enrolled (no loop)', async () => {
  const seq = await seedSeq('lp', { stepDelayDays: 0 });
  await seedContact(106, 'lp');
  await query(`INSERT INTO drip.enrollments(account_id,contact_id,sequence_id,current_step,status) VALUES (1,106,$1,1,'completed')`, [seq]);
  const calls = { created: [], sent: [] };
  await reconcileAccount(pool, makeClient(calls), 1, SUNDAY);
  const rows = await query('SELECT status FROM drip.enrollments WHERE account_id=1 AND contact_id=106');
  assert.equal(rows.length, 1, 'no duplicate enrollment');
  assert.equal(rows[0].status, 'completed', 'stays completed — no re-run on its own');
  assert.equal(calls.sent.length, 0, 'no re-send');
  assert.equal(calls.created.length, 0, 'no conversation opened');
});

// ── re-run: deleting the completed enrollment (panel re-assign) re-runs the sequence ──
test('deleting a completed enrollment re-runs the sequence (panel re-assign)', async () => {
  const seq = await seedSeq('rr', { stepDelayDays: 0 });
  await seedContact(107, 'rr');
  await query(`INSERT INTO drip.enrollments(account_id,contact_id,sequence_id,current_step,status) VALUES (1,107,$1,1,'completed')`, [seq]);
  const calls = { created: [], sent: [] };
  await reconcileAccount(pool, makeClient(calls), 1, SUNDAY);
  assert.equal(calls.sent.length, 0, 'standing completed does not re-run on its own (loop guard)');
  // simulate the panel re-assign: DELETE the enrollment (what actionSetSequence does)
  await query('DELETE FROM drip.enrollments WHERE account_id=1 AND contact_id=107');
  await reconcileAccount(pool, makeClient(calls), 1, SUNDAY);
  assert.equal(calls.sent.length, 1, 're-sent once — the sequence re-ran from step 1');
  assert.equal(calls.created.length, 1, 'opened a conversation on the fresh run');
});

// ── switch #1: enroll_enabled=false stops NEW entries (migration 018) ──────────
test('enroll_enabled=false: a contact carrying the attr is NOT enrolled (stop new entries)', async () => {
  // Sends are on (send_enabled=true) but entries are off — a brand-new contact with the
  // sequence attr must not be added. (Existing runs keep going; that's covered elsewhere.)
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,enroll_enabled,send_enabled,skip_shabbat)
     VALUES (1,'noentry','noentry',false,true,false) RETURNING id`
  ))[0].id;
  await query(`INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days) VALUES ($1,1,'t1',0)`, [seq]);
  await seedContact(202, 'noentry');
  const calls = { created: [], sent: [] };
  await reconcileAccount(pool, makeClient(calls), 1, SUNDAY);
  const e = (await query('SELECT id FROM drip.enrollments WHERE account_id=1 AND contact_id=202'))[0];
  assert.equal(e, undefined, 'enroll_enabled=false must not enroll a new contact');
  assert.deepEqual(calls.sent, [], 'nothing sent');
});
