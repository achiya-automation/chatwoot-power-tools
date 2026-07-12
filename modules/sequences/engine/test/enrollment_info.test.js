import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { setupDb, relaxCompliance } from './helpers.js';

/*
 * enrollment_info.test.js — dashboard wiring:
 *  - list_enrollments / enrollment_status now JOIN public.contacts → contact name + phone
 *    (was NULL → "לא תועד בדשבורד").
 *  - bulk-enroll-by-label query (cached_label_list) + labels aggregation.
 * (public.conversations/contacts are scaffolded by deploy/run-tests.sh.)
 */

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

beforeEach(async () => {
  await setupDb(pool);
  await query('TRUNCATE drip.enrollments, drip.sequence_steps, drip.sequences CASCADE');
  await pool.query('TRUNCATE public.conversations, public.contacts');
  await relaxCompliance(pool);
});

async function seedSeq(key) {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name) VALUES (1,$1,$1) RETURNING id`, [key]
  ))[0].id;
  await query(`INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name) VALUES ($1,1,'t')`, [seq]);
  return seq;
}

test('list_enrollments joins contact name + phone (dashboard shows the lead, not "—")', async () => {
  await query(`INSERT INTO public.contacts (id, name, phone_number) VALUES (501, 'דנה', '+972500000000')`);
  await query(`INSERT INTO public.conversations (id, display_id, account_id, contact_id) VALUES (8001, 4001, 1, 501)`);
  const seq = await seedSeq('k1');
  await query(`INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,status) VALUES (1,4001,$1,1,'completed')`, [seq]);

  const list = (await query('SELECT drip.list_enrollments(1) AS r'))[0].r;
  const row = list.find((e) => e.conversation_id === 4001);
  assert.ok(row, 'completed enrollment IS listed on the dashboard');
  assert.equal(row.contact_name, 'דנה');
  assert.equal(row.phone, '+972500000000');
});

test('enrollment_status joins contact name + phone (sidebar panel)', async () => {
  await query(`INSERT INTO public.contacts (id, name, phone_number) VALUES (502, 'רון', '+972511111111')`);
  await query(`INSERT INTO public.conversations (id, display_id, account_id, contact_id) VALUES (8002, 4002, 1, 502)`);
  const seq = await seedSeq('k2');
  await query(`INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,status) VALUES (1,4002,$1,1,'active')`, [seq]);

  const st = (await query('SELECT drip.enrollment_status(1, 4002) AS r'))[0].r;
  assert.equal(st.contact_name, 'רון');
  assert.equal(st.phone, '+972511111111');
});

test('enrollment_status returns the current enrollment_id (panel isolates the run history)', async () => {
  await query(`INSERT INTO public.contacts (id, name, phone_number) VALUES (560, 'גל', '+972500000560')`);
  await query(`INSERT INTO public.conversations (id, display_id, account_id, contact_id) VALUES (8560, 4560, 1, 560)`);
  const seq = await seedSeq('eid');
  const enr = (await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,status) VALUES (1,4560,$1,2,'active') RETURNING id`,
    [seq]
  ))[0].id;
  const st = (await query('SELECT drip.enrollment_status(1, 4560) AS r'))[0].r;
  assert.equal(st.enrollment_id, enr);
});

// ── enrollment_status fallback to the contact attr during the reconciler gap (013) ──
// set_sequence writes the `sequence` attr + deletes the enrollment; the reconciler re-enrolls
// within ~1 min. In that gap the panel must still show the just-assigned sequence, not "none".
test('enrollment_status falls back to the contact sequence attr as "pending" when no enrollment exists yet', async () => {
  await query(`INSERT INTO public.contacts (id, name, phone_number, custom_attributes) VALUES (503, 'דנה', '+972522222222', '{"sequence":"k3"}')`);
  await query(`INSERT INTO public.conversations (id, display_id, account_id, contact_id) VALUES (8003, 4003, 1, 503)`);
  await seedSeq('k3'); // 1 step, no enrollment row

  const st = (await query('SELECT drip.enrollment_status(1, 4003) AS r'))[0].r;
  assert.equal(st.sequence_key, 'k3', 'shows the assigned sequence even before the reconciler enrolls');
  assert.equal(st.status, 'pending');
  assert.equal(st.total_steps, 1);
  assert.equal(st.contact_name, 'דנה');
});

test('enrollment_status returns null for a contact with no attr and no enrollment (truly unassigned)', async () => {
  await query(`INSERT INTO public.contacts (id, name, phone_number) VALUES (504, 'רון', '+972533333333')`);
  await query(`INSERT INTO public.conversations (id, display_id, account_id, contact_id) VALUES (8004, 4004, 1, 504)`);
  const st = (await query('SELECT drip.enrollment_status(1, 4004) AS r'))[0].r;
  assert.equal(st, null);
});

test('enrollment_status prefers a real enrollment over the pending fallback', async () => {
  await query(`INSERT INTO public.contacts (id, name, phone_number, custom_attributes) VALUES (505, 'מיה', '+972544444444', '{"sequence":"k4"}')`);
  await query(`INSERT INTO public.conversations (id, display_id, account_id, contact_id) VALUES (8005, 4005, 1, 505)`);
  const seq = await seedSeq('k4');
  await query(`INSERT INTO drip.enrollments(account_id,contact_id,conversation_id,sequence_id,current_step,status) VALUES (1,505,4005,$1,1,'active')`, [seq]);
  const st = (await query('SELECT drip.enrollment_status(1, 4005) AS r'))[0].r;
  assert.equal(st.status, 'active', 'a live enrollment wins over the attr-based pending fallback');
});

// ── times must be Israel local time, not the engine's UTC session (014) ──
test('sent_history + enrollment_status show times in Israel local time (UTC+3), not UTC', async () => {
  await query(`INSERT INTO public.contacts (id, name) VALUES (601, 'רגינה')`);
  await query(`INSERT INTO public.conversations (id, display_id, account_id, contact_id) VALUES (9601, 4601, 1, 601)`);
  const seq = await seedSeq('tz');
  // 14:07 UTC → 17:07 Asia/Jerusalem (summer, +3) — the exact bug from the panel screenshot.
  await query(`INSERT INTO drip.enrollments(account_id,contact_id,conversation_id,sequence_id,current_step,status,next_send_at) VALUES (1,601,4601,$1,1,'active','2026-06-25 14:07:00+00')`, [seq]);
  await query(`INSERT INTO drip.sent_messages(account_id,conversation_id,sequence_id,step_order,template_name,sent_at) VALUES (1,4601,$1,1,'t','2026-06-24 14:07:24+00')`, [seq]);

  const hist = (await query('SELECT drip.sent_history(1, 4601) AS r'))[0].r;
  assert.equal(hist[0].sent_at, '2026-06-24 17:07', 'sent_at rendered in Israel time');
  const st = (await query('SELECT drip.enrollment_status(1, 4601) AS r'))[0].r;
  assert.equal(st.next_send_at, '2026-06-25 17:07', 'next_send_at rendered in Israel time');
});

test('bulk: conversations found by label (exact, not substring)', async () => {
  await query(`INSERT INTO public.conversations (id, display_id, account_id, cached_label_list) VALUES
    (9001, 5001, 1, 'מכירות, דחוף'),
    (9002, 5002, 1, 'מכירות'),
    (9003, 5003, 1, 'מכירות-משנה'),
    (9004, 5004, 1, 'אחר')`);
  const rows = await query(
    `SELECT display_id FROM public.conversations
      WHERE account_id=1 AND string_to_array(cached_label_list, ', ') @> ARRAY['מכירות']
      ORDER BY display_id`
  );
  // 'מכירות-משנה' must NOT match 'מכירות' (exact token, not LIKE)
  assert.deepEqual(rows.map((r) => r.display_id), [5001, 5002]);
});

test('labels aggregation returns counts per label', async () => {
  await query(`INSERT INTO public.conversations (id, display_id, account_id, cached_label_list) VALUES
    (9101, 5101, 1, 'מכירות, דחוף'),
    (9102, 5102, 1, 'מכירות'),
    (9103, 5103, 1, '')`);
  const rows = await query(
    `SELECT label, count(*)::int AS count
       FROM public.conversations c, LATERAL unnest(string_to_array(c.cached_label_list, ', ')) AS label
      WHERE c.account_id=1 AND coalesce(c.cached_label_list,'') <> ''
      GROUP BY label`
  );
  const m = Object.fromEntries(rows.map((r) => [r.label, r.count]));
  assert.equal(m['מכירות'], 2);
  assert.equal(m['דחוף'], 1);
});
