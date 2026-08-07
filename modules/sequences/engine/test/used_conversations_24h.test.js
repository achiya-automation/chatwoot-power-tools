/**
 * drip.used_conversations_24h — כמה שיחות שהעסק יזם נפתחו ב-24 השעות האחרונות.
 *
 * זה המספר שהמנוע חוסם לפיו וגם המספר שהמסך מציג, ולכן שגיאה כאן היא או חסימת שליחות
 * מותרות או — הגרוע יותר — חריגה מהתקרה של מטא וקבלת 131049. הבדיקות מכסות את מה
 * שנשבר בפועל: קמפיין ידני שלא נספר, וספירה כפולה כשאותה שיחה מופיעה בשני המקורות.
 *
 * Run: DATABASE_URL_TEST=postgres://postgres:test@localhost:55432/postgres node --test
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb } from './helpers.js';
import { getPool } from '../src/db.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

const ACCT = 900;
const INBOX = 91;          // התיבה שנבחרה לרצפים
const OTHER_INBOX = 92;    // מספר אחר של אותו חשבון

async function used() {
  const { rows } = await pool.query('SELECT drip.used_conversations_24h($1) AS c', [ACCT]);
  return Number(rows[0].c);
}

// conv → שיחה בתיבה מסוימת; msg → הודעה יוצאת; drip → שורה ביומן השליחות של המנוע.
const conv = (id, inboxId = INBOX) => pool.query(
  'INSERT INTO public.conversations (id, display_id, account_id, inbox_id) VALUES ($1,$1,$2,$3)',
  [id, ACCT, inboxId]
);
const campaignMsg = (id, convId, { hoursAgo = 1, status = 0, campaignId = 7 } = {}) => pool.query(
  `INSERT INTO public.messages (id, conversation_id, account_id, message_type, status, content_attributes, created_at)
   VALUES ($1,$2,$3,1,$4,$5, now() - make_interval(hours => $6))`,
  [id, convId, ACCT, status, JSON.stringify({ campaign_id: campaignId }), hoursAgo]
);
const dripSend = (convId, { hoursAgo = 1, inSession = false } = {}) => pool.query(
  `INSERT INTO drip.sent_messages (account_id, conversation_id, step_order, sent_at, in_session)
   VALUES ($1,$2,1, now() - make_interval(hours => $3), $4)`,
  [ACCT, convId, hoursAgo, inSession]
);

beforeEach(async () => {
  await setupDb(pool);
  await pool.query('DELETE FROM public.messages WHERE account_id = $1', [ACCT]);
  await pool.query('DELETE FROM public.conversations WHERE account_id = $1', [ACCT]);
  await pool.query('DELETE FROM drip.sent_messages WHERE account_id = $1', [ACCT]);
  await pool.query('DELETE FROM drip.account_tokens WHERE account_id = $1', [ACCT]);
  await pool.query(
    `INSERT INTO drip.account_tokens (account_id, chatwoot_token, inbox_id) VALUES ($1,'t',$2)`,
    [ACCT, INBOX]
  );
});

test('אין שליחות — אפס', async () => {
  assert.equal(await used(), 0);
});

test('שליחת מנוע נספרת; חמישה שלבים לאותו לקוח הם שיחה אחת', async () => {
  await conv(1);
  await dripSend(1); await dripSend(1); await dripSend(1);
  assert.equal(await used(), 1);
});

test('⭐ קמפיין ידני מ-Chatwoot על המספר הנבחר נספר גם הוא', async () => {
  // זה הבאג: לפני 042 הקמפיין לא נספר, והמנוע האמין שיש לו 2,000 פנויים כשבפועל לא.
  await conv(1);
  await campaignMsg(10, 1);
  assert.equal(await used(), 1);
});

test('⭐ אותה שיחה בשני המקורות נספרת פעם אחת', async () => {
  await conv(1);
  await dripSend(1);
  await campaignMsg(10, 1);
  assert.equal(await used(), 1);
});

test('שיחות שונות מצטברות', async () => {
  await conv(1); await conv(2); await conv(3);
  await dripSend(1);
  await campaignMsg(10, 2);
  await campaignMsg(11, 3);
  assert.equal(await used(), 3);
});

test('קמפיין ממספר אחר של אותו חשבון לא נספר', async () => {
  // התקרה שייכת למספר. ספירת שליחות ממספר אחר הייתה מנפחת את הניצול של מספר שקט.
  await conv(1, OTHER_INBOX);
  await campaignMsg(10, 1);
  assert.equal(await used(), 0);
});

test('הודעה רגילה (לא קמפיין) לא נספרת', async () => {
  await conv(1);
  await pool.query(
    `INSERT INTO public.messages (id, conversation_id, account_id, message_type, status, content_attributes, created_at)
     VALUES (10,1,$1,1,0,'{}'::json, now())`, [ACCT]
  );
  assert.equal(await used(), 0);
});

test('שליחה שנכשלה לא פתחה שיחה ולכן לא נספרת', async () => {
  await conv(1);
  await campaignMsg(10, 1, { status: 3 });
  assert.equal(await used(), 0);
});

test('in_session לא צורך מהמכסה — הודעה בתוך חלון השירות', async () => {
  await conv(1);
  await dripSend(1, { inSession: true });
  assert.equal(await used(), 0);
});

test('מעבר לחלון 24 השעות — לא נספר', async () => {
  await conv(1); await conv(2);
  await dripSend(1, { hoursAgo: 25 });
  await campaignMsg(10, 2, { hoursAgo: 25 });
  assert.equal(await used(), 0);
});

test('לא נבחר מספר לרצפים — קמפיינים לא מיוחסים לאף מספר', async () => {
  await pool.query('UPDATE drip.account_tokens SET inbox_id = NULL WHERE account_id = $1', [ACCT]);
  await conv(1);
  await campaignMsg(10, 1);
  await dripSend(1);
  assert.equal(await used(), 1); // שליחת המנוע כן; הקמפיין אין למה לייחס
});
