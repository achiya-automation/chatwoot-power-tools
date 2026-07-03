import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { reconcileAccount } from '../src/reconcile.js';

/*
 * history.test.js — send-history (drip.sent_messages + drip.sent_history RPC).
 * Transparency feature: record exactly which template messages the reconciler
 * delivered, so the conversation panel can show "what was already sent, and when".
 */

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

beforeEach(async () => {
  await runMigrations(pool);
  await query('TRUNCATE drip.enrollments, drip.sequence_steps, drip.sequences, drip.no_send_windows, drip.sent_messages CASCADE');
});

// A client whose sendTemplate returns { id, content } like the real chatwoot.js.
const clientReturning = (content) => ({
  sendTemplate: async () => ({ id: 1, content }),
  getContact: async () => ({ name: 'L', phone: '050' }),
  patchAttrs: async () => {},
  incomingSince: async () => false,
});

test('reconcile records a sent_messages row with template, step and rendered content', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,'h','H',false) RETURNING id`
  ))[0].id;
  // two steps so the enrollment advances (not just completes) — proves the history
  // INSERT and the advance UPDATE coexist in one transaction without conflict.
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days) VALUES ($1,1,'welcome',0),($1,2,'followup',3)`,
    [seq]
  );
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,77,$1,1,'2020-01-01 00:00:00+00','active')`,
    [seq]
  );
  await reconcileAccount(pool, clientReturning('שלום דנה'), 1, new Date());

  const rows = await query(
    `SELECT conversation_id, step_order, template_name, content FROM drip.sent_messages WHERE account_id=1`
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].conversation_id, 77);
  assert.equal(rows[0].step_order, 1);
  assert.equal(rows[0].template_name, 'welcome');
  assert.equal(rows[0].content, 'שלום דנה');

  // advance still committed alongside the history insert
  const e = (await query('SELECT current_step,status FROM drip.enrollments WHERE conversation_id=77'))[0];
  assert.equal(e.current_step, 2);
  assert.equal(e.status, 'active');
});

test('history is still recorded when the client returns a bare id (no content object)', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,'b','B',false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days) VALUES ($1,1,'t',0)`,
    [seq]
  );
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,78,$1,1,'2020-01-01 00:00:00+00','active')`,
    [seq]
  );
  // legacy/mock client returning a number — must not crash; logs empty content.
  const client = { sendTemplate: async () => 1, getContact: async () => ({ name: 'L' }), patchAttrs: async () => {}, incomingSince: async () => false };
  await reconcileAccount(pool, client, 1, new Date());
  const rows = await query(`SELECT content FROM drip.sent_messages WHERE conversation_id=78`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content, ''); // empty content, but the send IS logged
});

test('sent_history RPC returns rows in send order; [] (not null) when none', async () => {
  const empty = (await query(`SELECT drip.sent_history(1, 999) AS r`))[0].r;
  assert.deepEqual(empty, []);

  // inserted out of order → must come back ordered by sent_at ascending
  await query(
    `INSERT INTO drip.sent_messages(account_id,conversation_id,step_order,template_name,content,sent_at)
     VALUES (1,5,2,'b','B','2026-01-02 10:00+00'),
            (1,5,1,'a','A','2026-01-01 10:00+00')`
  );
  const hist = (await query(`SELECT drip.sent_history(1, 5) AS r`))[0].r;
  assert.equal(hist.length, 2);
  assert.equal(hist[0].template_name, 'a'); // earlier sent_at first
  assert.equal(hist[0].content, 'A');
  assert.equal(hist[1].template_name, 'b');
  assert.match(hist[0].sent_at, /^2026-01-01 12:00$/); // YYYY-MM-DD HH24:MI in Israel time (10:00 UTC + 2h winter)
});

test('history survives enrollment deletion — a re-assign/reset keeps the record', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,'s','S',false) RETURNING id`
  ))[0].id;
  const enr = (await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,90,$1,1,'2020-01-01 00:00:00+00','active') RETURNING id`,
    [seq]
  ))[0].id;
  await query(
    `INSERT INTO drip.sent_messages(account_id,conversation_id,enrollment_id,step_order,template_name,content)
     VALUES (1,90,$1,1,'x','X')`,
    [enr]
  );
  // simulate "restart" / re-assign from the panel, which deletes the enrollment
  await query(`DELETE FROM drip.enrollments WHERE id=$1`, [enr]);
  const hist = (await query(`SELECT drip.sent_history(1, 90) AS r`))[0].r;
  assert.equal(hist.length, 1, 'sent history must NOT be cascaded away by reset');
  assert.equal(hist[0].template_name, 'x');
});

test('sent_history exposes enrollment_id so the panel can isolate the current run', async () => {
  // Two runs' worth of history on the SAME conversation (a re-assign reset keeps old rows).
  // The panel uses enrollment_id to show only the CURRENT run — so step N of run B is not
  // mistakenly painted with step N of run A (the "message 2 before message 1" bug).
  await query(
    `INSERT INTO drip.sent_messages(account_id,conversation_id,enrollment_id,step_order,template_name,content,sent_at)
     VALUES (1,7,'11111111-1111-1111-1111-111111111111',1,'old_a','A','2026-01-01 10:00+00'),
            (1,7,'11111111-1111-1111-1111-111111111111',2,'old_b','B','2026-01-02 10:00+00'),
            (1,7,'22222222-2222-2222-2222-222222222222',1,'new_a','C','2026-01-03 10:00+00')`
  );
  const hist = (await query(`SELECT drip.sent_history(1, 7) AS r`))[0].r;
  assert.equal(hist.length, 3);
  assert.equal(hist[0].enrollment_id, '11111111-1111-1111-1111-111111111111');
  assert.equal(hist[2].enrollment_id, '22222222-2222-2222-2222-222222222222');
});
