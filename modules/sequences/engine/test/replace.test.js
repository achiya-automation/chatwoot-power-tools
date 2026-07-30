import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { setupDb, relaxCompliance } from './helpers.js';
import {
  nextVersionName, nextBurnName,
  maybeCreateReplacements, adoptApprovedReplacements,
  REPLACE_FAILS_7D, ACCOUNT_MAX_PER_30D,
} from '../src/replace.js';

// ── החלפת-תבנית אוטומטית בריאה ──────────────────────────────────────────────
// טריגר = שחיקה נמדדת; בלמי קצב קשיחים; אימוץ רק אחרי אישור מטא; דחייה = אדם.

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);
const NOW = new Date('2026-06-21T10:00:00Z');
const D = 86_400_000;
const at = (ms) => new Date(NOW.getTime() + ms).toISOString();

const reads = { getWhatsappCreds: async () => ({ wabaId: 'W', token: 'T', phoneId: 'P' }) };

beforeEach(async () => {
  await setupDb(pool);
  await query('TRUNCATE drip.enrollments, drip.sequence_steps, drip.sequences, drip.sent_messages, drip.template_health, drip.template_replacements, drip.alerts CASCADE');
  await relaxCompliance(pool);
  await query(`UPDATE drip.compliance SET auto_template_replace_enabled = true WHERE account_id = 1`);
});

/** רצף פעיל עם שלב על התבנית + fails כשלים בחלון הנע */
async function seedWorn({ tpl = 'tp_a', fails = REPLACE_FAILS_7D, key = 'rp' } = {}) {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,enabled) VALUES (1,$1,$1,true) RETURNING id`,
    [key]
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days) VALUES ($1,1,$2,0)`,
    [seq, tpl]
  );
  if (fails > 0) {
    await query(
      `INSERT INTO drip.sent_messages(account_id,conversation_id,template_name,delivery_status,sent_at)
       SELECT 1, 9000 + gs, $1, 'failed', $2::timestamptz FROM generate_series(1, $3) gs`,
      [tpl, at(-1 * D), fails]
    );
  }
  return seq;
}

const rowsOf = async () => query(`SELECT * FROM drip.template_replacements ORDER BY id`);
const alertCodes = async () => (await query(`SELECT code FROM drip.alerts ORDER BY id`)).map((r) => r.code);

test('nextVersionName מעלה גרסה ושומר משפחה', () => {
  assert.equal(nextVersionName('bb_new_00_intro'), 'bb_new_00_intro_v2');
  assert.equal(nextVersionName('bb_new_00_intro_v2'), 'bb_new_00_intro_v3');
  assert.equal(nextVersionName('bb_new_01_btn_v4'), 'bb_new_01_btn_v5');
});

test('nextBurnName בוחר מספר פנוי ומתעלם ממשפחות אחרות', () => {
  assert.equal(nextBurnName('f', []), 'f_burn1');
  assert.equal(nextBurnName('f', ['f_burn1', 'f_burn2']), 'f_burn3');
  assert.equal(nextBurnName('f', ['other_burn9']), 'f_burn1');
});

test('שחיקה מעל הסף ⇒ שני עותקים נוצרים + שורת pending + התראה', async () => {
  await seedWorn();
  const calls = [];
  const made = await maybeCreateReplacements(pool, reads, 1, NOW, {
    createCopyFn: async (_w, _t, src, name) => { calls.push(`${src}→${name}`); return { name, id: '1', status: 'PENDING' }; },
  });
  assert.deepEqual(made, [{ old: 'tp_a', next: 'tp_a_v2', burn: 'tp_a_burn1' }]);
  assert.deepEqual(calls, ['tp_a→tp_a_v2', 'tp_a→tp_a_burn1']);
  const rows = await rowsOf();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'pending_approval');
  assert.ok((await alertCodes()).includes('template_replace_created'));
});

test('מתחת לסף או דגל כבוי ⇒ כלום', async () => {
  await seedWorn({ fails: REPLACE_FAILS_7D - 1 });
  assert.deepEqual(await maybeCreateReplacements(pool, reads, 1, NOW, { createCopyFn: async () => ({}) }), []);
  await query(`UPDATE drip.compliance SET auto_template_replace_enabled = false WHERE account_id = 1`);
  await query(
    `INSERT INTO drip.sent_messages(account_id,conversation_id,template_name,delivery_status,sent_at)
     SELECT 1, 9500 + gs, 'tp_a','failed',$1::timestamptz FROM generate_series(1,5) gs`, [at(-1 * D)]
  );
  assert.deepEqual(await maybeCreateReplacements(pool, reads, 1, NOW, { createCopyFn: async () => ({}) }), []);
  assert.equal((await rowsOf()).length, 0);
});

test('בלם משפחה: החלפה מלפני 3 ימים חוסמת יצירה נוספת', async () => {
  await seedWorn();
  await query(
    `INSERT INTO drip.template_replacements(account_id,family,old_name,new_name,status,created_at)
     VALUES (1,'tp_a','tp_a','tp_a_v2','rejected',$1)`, [at(-3 * D)]
  );
  const made = await maybeCreateReplacements(pool, reads, 1, NOW, { createCopyFn: async () => ({}) });
  assert.deepEqual(made, []);
  assert.equal((await rowsOf()).length, 1); // רק השורה הישנה
});

test('בלם חשבון: 3 החלפות בחודש ⇒ התראת rate_capped ואפס יצירה', async () => {
  await seedWorn();
  for (let i = 0; i < ACCOUNT_MAX_PER_30D; i++) {
    await query(
      `INSERT INTO drip.template_replacements(account_id,family,old_name,new_name,status,created_at)
       VALUES (1,$1,$1,$1||'_v2','adopted',$2)`, [`other_${i}`, at(-5 * D)]
    );
  }
  const made = await maybeCreateReplacements(pool, reads, 1, NOW, { createCopyFn: async () => ({}) });
  assert.deepEqual(made, []);
  assert.ok((await alertCodes()).includes('template_replace_rate_capped'));
});

test('כשל יצירה (כפילות) ⇒ שורת rejected + התראה, בלי retry', async () => {
  await seedWorn();
  const made = await maybeCreateReplacements(pool, reads, 1, NOW, {
    createCopyFn: async () => { throw new Error('template content is a duplicate'); },
  });
  assert.deepEqual(made, []);
  const rows = await rowsOf();
  assert.equal(rows[0].status, 'rejected');
  assert.match(rows[0].reason, /duplicate/);
  assert.ok((await alertCodes()).includes('template_replace_failed'));
});

test('אימוץ רק כששני העותקים APPROVED — ואז השלב מוסב', async () => {
  const seq = await seedWorn({ fails: 0 });
  await query(`UPDATE drip.sequence_steps SET template_burn='tp_a_burn0' WHERE sequence_id=$1`, [seq]);
  await query(
    `INSERT INTO drip.template_replacements(account_id,family,old_name,new_name,new_burn,status)
     VALUES (1,'tp_a','tp_a','tp_a_v2','tp_a_burn1','pending_approval')`
  );
  await query(
    `INSERT INTO drip.template_health(account_id,template_name,language,status)
     VALUES (1,'tp_a_v2','he','APPROVED'),(1,'tp_a_burn1','he','PENDING')`
  );
  // ה-burn עוד ממתין ⇒ אין אימוץ
  assert.equal((await adoptApprovedReplacements(pool, 1, NOW)).length, 0);
  await query(`UPDATE drip.template_health SET status='APPROVED' WHERE template_name='tp_a_burn1'`);
  // עכשיו שניהם מאושרים ⇒ אימוץ
  assert.equal((await adoptApprovedReplacements(pool, 1, NOW)).length, 1);
  const step = (await query(`SELECT template_name, template_burn FROM drip.sequence_steps WHERE sequence_id=$1`, [seq]))[0];
  assert.equal(step.template_name, 'tp_a_v2');
  assert.equal(step.template_burn, 'tp_a_burn1');
  const row = (await rowsOf())[0];
  assert.equal(row.status, 'adopted');
  assert.ok((await alertCodes()).includes('template_replace_adopted'));
});
