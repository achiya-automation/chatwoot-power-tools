import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { setupDb, relaxCompliance } from './helpers.js';
import { reconcileAccount } from '../src/reconcile.js';

// ── משיכת חלון (window-pull) ─────────────────────────────────────────────────
// הודעה נכנסת פותחת חלון שירות של 24h. שלב שמתוזמן מעבר לסוף החלון מוקדם אל
// תוכו (now+1h) — שלב אחד לכל חלון, ורק כשהדגל window_pull_enabled דולק.
// אף תרחיש כאן לא אמור לשלוח בפועל: המשיכה מציבה next_send_at בעתיד (+1h),
// כך שהטיק הנוכחי לא מגיע לשלב השליחה — ו-client.sendTemplate זורק אם כן.

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

const NOW = new Date('2026-06-21T10:00:00Z'); // יום ראשון, שעות יום בישראל
const H = 3_600_000;
const at = (msOffset) => new Date(NOW.getTime() + msOffset).toISOString();

const client = {
  sendTemplate: async () => { throw new Error('window-pull tests must not send'); },
  getContact: async () => ({ name: 'D' }),
  patchAttrs: async () => {},
  incomingSince: async () => false,
  outgoingByHumanSince: async () => false,
};

beforeEach(async () => {
  await setupDb(pool);
  await query('TRUNCATE drip.enrollments, drip.sequence_steps, drip.sequences, drip.no_send_windows, drip.sent_messages, drip.contact_state CASCADE');
  await relaxCompliance(pool);
  await query(`UPDATE drip.compliance SET window_pull_enabled = true WHERE account_id = 1`);
});

async function seed({ nextSendMs = 72 * H, lastInboundMs = -1 * H, status = 'active',
                      sendEnabled = true, contactId = 42 } = {}) {
  const key = `wp_${contactId}`; // מפתח ייחודי פר-שתילה — (account_id, key) הוא unique
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat,send_enabled)
     VALUES (1,$2,$2,false,$1) RETURNING id`,
    [sendEnabled, key]
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days)
     VALUES ($1,1,'a',0),($1,2,'b',3)`,
    [seq]
  );
  const enr = (await query(
    `INSERT INTO drip.enrollments(account_id,contact_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,$4,$4,$1,2,$2,$3) RETURNING id`, // conversation_id=contact_id, ייחודי פר-שתילה
    [seq, at(nextSendMs), status, contactId]
  ))[0].id;
  await query(
    `INSERT INTO drip.contact_state(account_id,contact_id,last_inbound_at)
     VALUES (1,$1,$2)`,
    [contactId, at(lastInboundMs)]
  );
  return { seq, enr };
}

const nextSendOf = async (enrId) => new Date(
  (await query(`SELECT next_send_at FROM drip.enrollments WHERE id=$1`, [enrId]))[0].next_send_at
).getTime();

test('שלב שמעבר לסוף החלון נמשך אל תוכו — now+1h בדיוק', async () => {
  const { enr } = await seed(); // בשל בעוד 72h, תגובה לפני שעה
  await reconcileAccount(pool, client, 1, NOW);
  assert.equal(await nextSendOf(enr), NOW.getTime() + H);
});

test('הדגל כבוי — שום דבר לא זז', async () => {
  await query(`UPDATE drip.compliance SET window_pull_enabled = false WHERE account_id = 1`);
  const { enr } = await seed();
  await reconcileAccount(pool, client, 1, NOW);
  assert.equal(await nextSendOf(enr), NOW.getTime() + 72 * H);
});

test('משיכה אחת לחלון: נשלח משהו אחרי ההודעה הנכנסת — אין משיכה נוספת', async () => {
  const { seq, enr } = await seed();
  await query(
    `INSERT INTO drip.sent_messages(account_id,contact_id,conversation_id,enrollment_id,sequence_id,step_order,template_name,sent_at)
     VALUES (1,42,70,$1,$2,1,'a',$3)`,
    [enr, seq, at(-0.5 * H)] // שליחה אחרי התגובה (לפני שעה) — החלון כבר נוצל
  );
  await reconcileAccount(pool, client, 1, NOW);
  assert.equal(await nextSendOf(enr), NOW.getTime() + 72 * H);
});

test('תגובה חדשה אחרי השליחה פותחת משיכה נוספת', async () => {
  const { seq, enr } = await seed({ lastInboundMs: -10 * 60_000 }); // תגובה לפני 10 דק׳
  await query(
    `INSERT INTO drip.sent_messages(account_id,contact_id,conversation_id,enrollment_id,sequence_id,step_order,template_name,sent_at)
     VALUES (1,42,70,$1,$2,1,'a',$3)`,
    [enr, seq, at(-0.5 * H)] // השליחה קדמה לתגובה האחרונה
  );
  await reconcileAccount(pool, client, 1, NOW);
  assert.equal(await nextSendOf(enr), NOW.getTime() + H);
});

test('שלב שכבר נופל בתוך החלון נשאר במקומו (אין מלחמת-משיכות עם דחיות שקט)', async () => {
  const { enr } = await seed({ nextSendMs: 20 * H }); // חלון עד +23h, השלב ב-+20h
  await reconcileAccount(pool, client, 1, NOW);
  assert.equal(await nextSendOf(enr), NOW.getTime() + 20 * H);
});

test('חלון ישן (תגובה לפני 30 שעות) — אין משיכה', async () => {
  const { enr } = await seed({ lastInboundMs: -30 * H });
  await reconcileAccount(pool, client, 1, NOW);
  assert.equal(await nextSendOf(enr), NOW.getTime() + 72 * H);
});

test('opt-out מפורש לא נמשך; רוויה (saturated) כן', async () => {
  const optOut = await seed({ contactId: 42 });
  await query(
    `UPDATE drip.contact_state SET suppressed_at=$1, suppressed_reason='opt_out' WHERE contact_id=42`,
    [at(-2 * H)] // suppressed לפני שעתיים
  );
  const sat = await seed({ contactId: 43 });
  await query(
    `UPDATE drip.contact_state SET suppressed_at=$1, suppressed_reason='saturated', cap_failures=5 WHERE contact_id=43`,
    [at(-2 * H)]
  );
  await reconcileAccount(pool, client, 1, NOW);
  assert.equal(await nextSendOf(optOut.enr), NOW.getTime() + 72 * H, 'opt-out נשאר במקומו');
  assert.equal(await nextSendOf(sat.enr), NOW.getTime() + H, 'saturated נמשך — זה נתיב היציאה שלו');
});

test('רצף מושהה (send_enabled=false) או הרשמה עצורה — אין משיכה', async () => {
  const paused = await seed({ sendEnabled: false, contactId: 42 });
  const stopped = await seed({ status: 'stopped', contactId: 43 });
  await reconcileAccount(pool, client, 1, NOW);
  assert.equal(await nextSendOf(paused.enr), NOW.getTime() + 72 * H);
  assert.equal(await nextSendOf(stopped.enr), NOW.getTime() + 72 * H);
});
