/**
 * gate.test.js — the compliance gate wired into the REAL reconciler, against a real DB.
 *
 * compliance.test.js proves each Meta rule as pure logic. This file proves the rules are
 * actually enforced on the send path: that a blocked lead really does not get a message,
 * that a deferred lead keeps its place, and that a dropped lead is cleaned up so no later
 * action can resurrect it.
 *
 * Run: DATABASE_URL_TEST=... node --test test/gate.test.js
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb } from './helpers.js';
import { getPool, query } from '../src/db.js';
import { reconcileAccount } from '../src/reconcile.js';
import { scanInbound, suppressContact } from '../src/compliance.js';

const ACCT = 42;
const pool = getPool({ databaseUrl: process.env.DATABASE_URL_TEST });

// Records what the reconciler tried to send, so "was anything sent?" is a real assertion.
function spyClient() {
  const sent = [];
  return {
    sent,
    sendTemplate: async (cid, t) => { sent.push({ cid, ...t }); return { id: 900 + sent.length, content: 'x' }; },
    createConversation: async () => ({ id: 700 }),
    getContact: async () => ({ name: 'דנה', phone: '+972541234567' }),
    patchAttrs: async () => {},
    incomingSince: async () => false,
  };
}

beforeEach(async () => {
  await setupDb(pool);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.contacts (
    id int PRIMARY KEY, account_id int, name text, phone_number text, email text,
    custom_attributes jsonb DEFAULT '{}'::jsonb)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.conversations (
    id int PRIMARY KEY, display_id int, account_id int, contact_id int,
    custom_attributes jsonb DEFAULT '{}'::jsonb, cached_label_list text)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.messages (
    id int, conversation_id int, account_id int, message_type int, content text,
    status int, content_attributes json, created_at timestamp)`);
  await pool.query('TRUNCATE public.contacts, public.conversations, public.messages');
  await query(`TRUNCATE drip.enrollments, drip.sequence_steps, drip.sequences,
                        drip.sent_messages, drip.contact_state, drip.account_health,
                        drip.template_health, drip.compliance, drip.alerts CASCADE`);
});

/** One contact, one one-step MARKETING sequence, one active enrollment due now. */
async function seed({ contactId = 1, phone = '+972541234567', consent = false } = {}) {
  await pool.query(
    `INSERT INTO public.contacts(id, account_id, name, phone_number, custom_attributes)
     VALUES ($1, $2, 'דנה', $3, '{"sequence":"s1"}'::jsonb)`,
    [contactId, ACCT, phone]
  );
  await pool.query(
    `INSERT INTO public.conversations(id, display_id, account_id, contact_id)
     VALUES ($1, $1, $2, $3)`,
    [contactId + 500, ACCT, contactId]
  );
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id, key, display_name, enabled, enroll_enabled, send_enabled)
     VALUES ($1, 's1', 'רצף', true, true, true)
     ON CONFLICT (account_id, key) DO UPDATE SET send_enabled = true
     RETURNING id`, [ACCT]
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id, step_order, template_name, language, category, params)
     VALUES ($1, 1, 'tpl', 'he', 'MARKETING', '[]'::jsonb)
     ON CONFLICT DO NOTHING`, [seq]
  );
  await query(
    `INSERT INTO drip.enrollments(account_id, contact_id, conversation_id, sequence_id,
                                  current_step, next_send_at, status)
     VALUES ($1, $2, $3, $4, 1, now() - interval '1 minute', 'active')`,
    [ACCT, contactId, contactId + 500, seq]
  );
  if (consent) {
    await query(
      `INSERT INTO drip.contact_state(account_id, contact_id, consent_source, consent_at)
       VALUES ($1, $2, 'lead_ad', now())`, [ACCT, contactId]
    );
  }
  return seq;
}

const run = (client, opts = {}) =>
  reconcileAccount(pool, client, ACCT, new Date(), [], { tierCap: 1000, ...opts });

const enrollment = async (contactId = 1) =>
  (await query(`SELECT * FROM drip.enrollments WHERE account_id=$1 AND contact_id=$2`, [ACCT, contactId]))[0];

// ═══════════════════════════════════════════════════════════════════════════

test('GATE: no consent record → nothing is sent, and the lead is KEPT (deferred)', async () => {
  await seed({ consent: false });
  const c = spyClient();
  await run(c);
  assert.equal(c.sent.length, 0, 'a contact with no consent must not receive marketing');

  const e = await enrollment();
  assert.equal(e.status, 'active', 'the lead must not be destroyed — only deferred');
  assert.equal(e.current_step, 1, 'and must not advance');
  assert.ok(new Date(e.next_send_at) > new Date(), 'next_send_at must be pushed into the future');
});

test('GATE: with a consent record the same lead sends normally', async () => {
  await seed({ consent: true });
  const c = spyClient();
  await run(c);
  assert.equal(c.sent.length, 1);
  assert.equal(c.sent[0].name, 'tpl');
});

test('GATE: the send is recorded with its category and session flag (the caps depend on them)', async () => {
  await seed({ consent: true });
  await run(spyClient());
  const sm = (await query('SELECT * FROM drip.sent_messages WHERE account_id=$1', [ACCT]))[0];
  assert.equal(sm.category, 'MARKETING');
  assert.equal(sm.in_session, false);
  assert.equal(sm.contact_id, 1);
});

test('GATE: the per-contact daily cap blocks a second marketing template within 24h', async () => {
  await seed({ consent: true });
  await run(spyClient());                       // first send goes out

  // re-arm the same step as if a second step were due today
  await query(`UPDATE drip.enrollments SET status='active', current_step=1,
                      next_send_at = now() - interval '1 minute' WHERE account_id=$1`, [ACCT]);
  const c2 = spyClient();
  await run(c2);
  assert.equal(c2.sent.length, 0, 'max_marketing_per_day defaults to 1');

  const e = await enrollment();
  assert.equal(e.status, 'active', 'the lead waits for tomorrow — it is not failed');
});

test('GATE: a suppressed contact is dropped and the sequence attribute is cleared', async () => {
  await seed({ consent: true });
  await suppressContact(pool, ACCT, 1, 'keyword', 'הסר', 'all');

  const c = spyClient();
  await run(c);
  assert.equal(c.sent.length, 0);

  const e = await enrollment();
  assert.equal(e.status, 'stopped');

  // The attribute must be gone, or the reconciler would simply re-enrol them next tick
  // and a later bulk enroll would resurrect them.
  const ct = (await pool.query('SELECT custom_attributes FROM public.contacts WHERE id=1')).rows[0];
  assert.equal(ct.custom_attributes.sequence, undefined, 'the sequence attr must be cleared');
});

test('GATE: a paused template defers every lead using it — nobody is failed', async () => {
  await seed({ consent: true });
  await query(
    `INSERT INTO drip.template_health(account_id, template_name, language, status, quality)
     VALUES ($1, 'tpl', 'he', 'PAUSED', 'RED')`, [ACCT]
  );
  const c = spyClient();
  await run(c);
  assert.equal(c.sent.length, 0);

  const e = await enrollment();
  assert.equal(e.status, 'active', 'a 3-hour template pause must not burn the lead');
  assert.ok(new Date(e.next_send_at) > new Date());
});

test('GATE: a halted account sends nothing at all', async () => {
  await seed({ consent: true });
  await query(
    `INSERT INTO drip.account_health(account_id, halted, halt_reason)
     VALUES ($1, true, 'quality RED')`, [ACCT]
  );
  const c = spyClient();
  await run(c);
  assert.equal(c.sent.length, 0);
  assert.equal((await enrollment()).status, 'active');
});

test('GATE: marketing to a US number is dropped before it costs anything', async () => {
  await seed({ consent: true, phone: '+12125550123' });
  const c = spyClient();
  await run(c);
  assert.equal(c.sent.length, 0, 'Meta does not deliver marketing to US numbers');
  assert.equal((await enrollment()).status, 'stopped');
});

test('GATE: a Canadian +1 number is NOT treated as US', async () => {
  await seed({ consent: true, phone: '+14165550123' });   // Toronto
  const c = spyClient();
  await run(c);
  assert.equal(c.sent.length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// scanInbound — opt-out detection without a webhook
// ═══════════════════════════════════════════════════════════════════════════

test('SCAN: an inbound "הסר" suppresses the contact and stops the sequence', async () => {
  await seed({ consent: true });
  await pool.query(
    `INSERT INTO public.messages(id, conversation_id, account_id, message_type, content, created_at)
     VALUES (1, 501, $1, 0, 'הסר אותי בבקשה', now())`, [ACCT]
  );

  const r = await scanInbound(pool, ACCT, new Date());
  assert.equal(r.optOuts, 1);

  const cs = (await query('SELECT * FROM drip.contact_state WHERE account_id=$1 AND contact_id=1', [ACCT]))[0];
  assert.ok(cs.suppressed_at);
  assert.equal(cs.suppressed_reason, 'keyword');
  assert.equal(cs.suppressed_scope, 'all');
  assert.equal((await enrollment()).status, 'stopped');

  // and now the reconciler sends nothing
  const c = spyClient();
  await run(c);
  assert.equal(c.sent.length, 0);
});

test('SCAN: an ordinary reply is NOT an opt-out, but it DOES open the 24h window', async () => {
  await seed({ consent: true });
  await pool.query(
    `INSERT INTO public.messages(id, conversation_id, account_id, message_type, content, created_at)
     VALUES (1, 501, $1, 0, 'כן! מעוניין. מתי אפשר לדבר?', now())`, [ACCT]
  );

  const r = await scanInbound(pool, ACCT, new Date());
  assert.equal(r.optOuts, 0);

  const cs = (await query('SELECT * FROM drip.contact_state WHERE account_id=$1 AND contact_id=1', [ACCT]))[0];
  assert.equal(cs.suppressed_at, null);
  assert.ok(cs.last_inbound_at, 'the reply must open a customer-service window');
});

test('SCAN: an in-session send bypasses consent AND is excluded from the 24h tier budget', async () => {
  // Meta: a message delivered inside an open customer-service window counts against
  // neither the per-user marketing limit nor the portfolio messaging limit.
  await seed({ consent: false });          // deliberately NO consent
  await pool.query(
    `INSERT INTO public.messages(id, conversation_id, account_id, message_type, content, created_at)
     VALUES (1, 501, $1, 0, 'היי, יש לי שאלה', now())`, [ACCT]
  );
  await scanInbound(pool, ACCT, new Date());

  const c = spyClient();
  await run(c);
  assert.equal(c.sent.length, 1, 'a reply opens the window — the send is allowed');

  const sm = (await query('SELECT in_session FROM drip.sent_messages WHERE account_id=$1', [ACCT]))[0];
  assert.equal(sm.in_session, true, 'and must be flagged so it does not consume the tier');
});

test('SCAN: the watermark advances — the same message is not processed twice', async () => {
  await seed({ consent: true });
  await pool.query(
    `INSERT INTO public.messages(id, conversation_id, account_id, message_type, content, created_at)
     VALUES (1, 501, $1, 0, 'שלום', now())`, [ACCT]
  );
  const a = await scanInbound(pool, ACCT, new Date());
  const b = await scanInbound(pool, ACCT, new Date());
  assert.equal(a.scanned, 1);
  assert.equal(b.scanned, 0, 'the second scan must start after the first one ended');
});

test('SCAN: outgoing messages are ignored — only inbound can opt out', async () => {
  await seed({ consent: true });
  await pool.query(
    `INSERT INTO public.messages(id, conversation_id, account_id, message_type, content, created_at)
     VALUES (1, 501, $1, 1, 'הסר', now())`, [ACCT]   // message_type 1 = outgoing
  );
  const r = await scanInbound(pool, ACCT, new Date());
  assert.equal(r.optOuts, 0);
});
