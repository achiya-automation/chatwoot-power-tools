import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { setupDb, relaxCompliance } from './helpers.js';
import { handleAction, initStore } from '../src/store.js';

/*
 * projected_schedule.test.js — the action that powers the panel's "this message goes out
 * on <date> at <hour>" for steps not yet sent. The engine stores next_send_at only for the
 * current step; the action projects the rest cumulatively (and pushes shabbat/chag forward
 * when skip_shabbat). Returns [{ step_order, send_at }] in Israel time (YYYY-MM-DD HH:MM).
 */

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);
initStore(cfg);

beforeEach(async () => {
  await setupDb(pool);
  await query('TRUNCATE drip.enrollments, drip.sequence_steps, drip.sequences, drip.no_send_windows CASCADE');
  await pool.query('TRUNCATE public.conversations, public.contacts');
  await relaxCompliance(pool);
});

test('projected_schedule returns cumulative dates for current + future steps (Israel time)', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,'p','P',false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days,send_hour)
     VALUES ($1,1,'a',2,20),($1,2,'b',3,19),($1,3,'c',3,19)`,
    [seq]
  );
  await query(`INSERT INTO public.conversations (id, display_id, account_id, contact_id) VALUES (9001, 305, 1, 700)`);
  // current step 2, next_send_at = Mon 2026-06-29 19:00 IDT (= 16:00 UTC)
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,305,$1,2,'2026-06-29 16:00:00+00','active')`,
    [seq]
  );
  const { data } = await handleAction(1, 'projected_schedule', { conversation_id: 305 });
  const byStep = Object.fromEntries(data.map((d) => [d.step_order, d.send_at]));
  assert.equal(byStep[2], '2026-06-29 19:00'); // current step = anchor exactly
  assert.equal(byStep[3], '2026-07-02 19:00'); // +3 days @19:00 = Thu 07-02
  assert.equal(byStep[1], undefined);          // already sent — not projected
});

test('projected_schedule pushes a future step off shabbat when skip_shabbat (action loads windows)', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,'ps','PS',true) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days,send_hour)
     VALUES ($1,1,'a',0,19),($1,2,'b',1,19)`,
    [seq]
  );
  // Future window (kept "fresh" relative to now): covers all of 2030-06-08.
  await query(
    `INSERT INTO drip.no_send_windows(starts_at,ends_at,kind)
     VALUES ('2030-06-08T00:00:00+03','2030-06-09T00:00:00+03','shabbat')`
  );
  await query(`INSERT INTO public.conversations (id, display_id, account_id, contact_id) VALUES (9002, 306, 1, 701)`);
  // current step 1, anchor = 2030-06-07 19:00 IDT (16:00 UTC). step 2 = +1d @19:00 = 06-08 19:00
  // → inside the window → must skip to 06-09 19:00.
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,306,$1,1,'2030-06-07 16:00:00+00','active')`,
    [seq]
  );
  const { data } = await handleAction(1, 'projected_schedule', { conversation_id: 306 });
  const byStep = Object.fromEntries(data.map((d) => [d.step_order, d.send_at]));
  assert.equal(byStep[2], '2030-06-09 19:00'); // Sunday (Saturday skipped)
});

test('projected_schedule returns [] when the conversation has no active enrollment', async () => {
  await query(`INSERT INTO public.conversations (id, display_id, account_id, contact_id) VALUES (9003, 307, 1, 702)`);
  const { data } = await handleAction(1, 'projected_schedule', { conversation_id: 307 });
  assert.deepEqual(data, []);
});
