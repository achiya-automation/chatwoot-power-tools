/**
 * send_cap.test.js — per-tick send cap (MAX_SENDS_PER_TICK).
 *
 * Safety guardrail: a large backlog of due enrollments (e.g. a bulk import of leads,
 * or re-enabling a sequence with hundreds assigned) must NOT blast every message in a
 * single cycle. reconcileAccount accepts { maxSendsPerTick }; the SEND phase processes
 * at most that many due enrollments per cycle and leaves the rest due for the next tick,
 * so a backlog drains gradually instead of all at once.
 *
 * Run: DATABASE_URL_TEST=... node --test test/send_cap.test.js
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { reconcileAccount } from '../src/reconcile.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

beforeEach(async () => {
  await runMigrations(pool);
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
});

const SUNDAY = new Date('2026-06-21T10:00:00Z'); // weekday daytime, not shabbat

function makeClient(calls) {
  return {
    createConversation: async ({ contactId }) => { calls.created.push(contactId); return { id: 9000 + calls.created.length }; },
    sendTemplate: async (cid) => { calls.sent.push(cid); return { id: 500 + calls.sent.length, content: 'body' }; },
    getContact: async () => ({ name: 'דנה', phone: '+972500000000' }),
    patchAttrs: async () => {},
    incomingSince: async () => false,
  };
}

// n contacts all due NOW (step 1 immediate); step 2 is +1 day so a sent lead drops out of "due".
async function seedDue(n) {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,enabled,skip_shabbat)
     VALUES (1,'cap','cap',true,false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days)
     VALUES ($1,1,'t1',0),($1,2,'t2',1)`,
    [seq]
  );
  await query(`INSERT INTO public.inboxes(id, account_id, name, channel_type)
               VALUES (26,1,'WA','Channel::Whatsapp') ON CONFLICT DO NOTHING`);
  for (let i = 1; i <= n; i++) {
    const phone = '+97250' + String(1000000 + i);
    await query(
      `INSERT INTO public.contacts(id,account_id,name,phone_number,custom_attributes)
       VALUES ($1::int,1,'דנה',$2,'{"sequence":"cap"}'::jsonb)`,
      [i, phone]
    );
    await query(`INSERT INTO public.contact_inboxes(id,contact_id,inbox_id,source_id)
                 VALUES ($1::int,$1::int,26,'src-' || $1::int)`, [i]);
  }
}

const dueCount = async () =>
  (await query(
    `SELECT count(*)::int AS c FROM drip.enrollments
      WHERE account_id=1 AND status='active' AND current_step=1 AND next_send_at <= $1`,
    [SUNDAY]
  ))[0].c;

test('maxSendsPerTick caps sends per cycle; the rest stay due for the next tick', async () => {
  await seedDue(5);
  const calls = { created: [], sent: [] };

  await reconcileAccount(pool, makeClient(calls), 1, SUNDAY, [], { maxSendsPerTick: 2 });
  assert.equal(calls.sent.length, 2, 'only 2 sent under the cap of 2');
  assert.equal(await dueCount(), 3, '3 remain at step 1, still due for the next tick');

  await reconcileAccount(pool, makeClient(calls), 1, SUNDAY, [], { maxSendsPerTick: 2 });
  assert.equal(calls.sent.length, 4, 'two more sent on the second tick (total 4)');
  assert.equal(await dueCount(), 1, '1 still waiting');

  await reconcileAccount(pool, makeClient(calls), 1, SUNDAY, [], { maxSendsPerTick: 2 });
  assert.equal(calls.sent.length, 5, 'the last one sent on the third tick');
  assert.equal(await dueCount(), 0, 'backlog drained');
});

test('no cap (default) sends all due in one cycle — unchanged behavior', async () => {
  await seedDue(5);
  const calls = { created: [], sent: [] };
  await reconcileAccount(pool, makeClient(calls), 1, SUNDAY); // no opts → unlimited
  assert.equal(calls.sent.length, 5, 'all 5 sent when uncapped');
});
