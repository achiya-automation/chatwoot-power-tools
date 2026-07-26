/**
 * campaign_csv_route.test.js — GET /drip-api/campaign-csv דרך שרת אמיתי:
 * הורדת attachment (הנתיב שמחליף את הורדת ה-blob שנחסמה ב-Safari בתוך iframe),
 * סינון בצד השרת, שער ההרשאות, ובידוד דיירים.
 * אותה תשתית כמו templates_api.test.js (createApp על loopback + מוק ל-profile).
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setupDb } from './helpers.js';
import { getPool, query } from '../src/db.js';
import { initStore } from '../src/store.js';
import { createApp } from '../src/api.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);
initStore(cfg);

const ACCT = 9701;

beforeEach(async () => {
  await setupDb(pool);
  await pool.query(`DELETE FROM public.campaigns WHERE account_id = ${ACCT}`);
  await pool.query(`DELETE FROM public.messages WHERE account_id = ${ACCT}`);
  await pool.query(`DELETE FROM public.conversations WHERE account_id = ${ACCT}`);
  await query(`DELETE FROM drip.campaign_send_snapshots WHERE account_id = ${ACCT}`);
  await query(`DELETE FROM drip.campaign_audience_snapshots WHERE account_id = ${ACCT}`);
});

function sessionCookie() {
  const info = { 'access-token': 'AT', client: 'CL', uid: 'a@b.com', 'token-type': 'Bearer', expiry: '9999999999' };
  return `cw_d_session_info=${encodeURIComponent(JSON.stringify(info))}`;
}
const chatwootFetch = (profile) => async (_url, opts) =>
  (opts?.headers?.['access-token'] ? { status: 200, json: async () => profile } : { status: 401 });

async function withApp(fn) {
  const app = createApp({
    databaseUrl: process.env.DATABASE_URL_TEST,
    chatwootBaseUrl: 'http://chatwoot.invalid',
    mediaDir: '/tmp',
    publicBase: 'https://cw.example/drip',
    fetchImpl: chatwootFetch({ id: 1, accounts: [{ id: ACCT, role: 'agent' }] }),
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally {
    await new Promise((resolve) => server.close(resolve));
    initStore(cfg);
  }
}

async function seedCampaign() {
  await pool.query(
    `INSERT INTO public.campaigns (id, account_id, inbox_id, title, campaign_type, campaign_status, created_at)
     VALUES (97011, ${ACCT}, 1, 'קמפיין בדיקה', 1, 1, now() - interval '1 day')`
  );
  // שני נמענים מהלדג'ר: אחת נקראה והגיבה, אחד נכשל
  await query(
    `INSERT INTO drip.campaign_send_snapshots (account_id, campaign_id, contact_id, contact_name, phone, source_id, message_id, conversation_id, status, error_title, attempted_at)
     VALUES (${ACCT}, 97011, 1, 'מגיבה', '+972500000001', 'wamid.A', 970111, 970121, 2, NULL, now() - interval '20 hours'),
            (${ACCT}, 97011, 2, 'חסום',  '+972500000002', 'wamid.B', 970112, 970122, 3, '131049: blocked', now() - interval '20 hours')`
  );
  await pool.query(
    `INSERT INTO public.conversations (id, display_id, account_id, contact_id) VALUES (970121, 111, ${ACCT}, 1), (970122, 222, ${ACCT}, 2)`
  );
  // תגובה נכנסת בשיחה הראשונה
  await pool.query(
    `INSERT INTO public.messages (id, conversation_id, account_id, message_type, content, status, created_at)
     VALUES (970131, 970121, ${ACCT}, 0, 'מעוניינת', 0, now() - interval '19 hours')`
  );
  // קהל היעד כלל גם מישהי שלא נוסתה
  await query(
    `INSERT INTO drip.campaign_audience_snapshots (account_id, campaign_id, contact_id, contact_name, phone)
     VALUES (${ACCT}, 97011, 1, 'מגיבה', '+972500000001'),
            (${ACCT}, 97011, 2, 'חסום', '+972500000002'),
            (${ACCT}, 97011, 3, 'לא נוסתה', '+972500000003')`
  );
}

test('campaign-csv: attachment מלא עם BOM, תגובה, סיבת כשל וקישור שיחה', async () => {
  await seedCampaign();
  await withApp(async (base) => {
    const res = await fetch(`${base}/drip-api/campaign-csv?account_id=${ACCT}&campaign_id=97011&locale=he`,
      { headers: { cookie: sessionCookie() } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    const cd = res.headers.get('content-disposition');
    assert.match(cd, /attachment/);
    assert.match(cd, /filename\*=UTF-8''/);
    assert.match(decodeURIComponent(cd), /דוח-קמפיין-בדיקה/);
    // response.text() מסיר BOM לפי תקן ה-encoding — בודקים את הבייטים הגולמיים
    const buf = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM bytes');
    const text = buf.toString('utf8').replace(/^﻿/, '');
    const lines = text.split('\r\n');
    assert.equal(lines.length, 4); // כותרת + 2 נמענים + 1 לא נוסתה
    assert.match(text, /"מגיבה".*"כן","מעוניינת"/);
    assert.match(text, /Meta חסמה את ההודעה/);
    assert.match(text, /"לא נוסתה".*"לא נוצר ניסיון שליחה"/);
    assert.match(text, new RegExp(`https://cw\\.example/app/accounts/${ACCT}/conversations/111`));
  });
});

test('campaign-csv: סינון סטטוס + תגובה בצד השרת, ושם קובץ מסומן מסונן', async () => {
  await seedCampaign();
  await withApp(async (base) => {
    const failed = await fetch(`${base}/drip-api/campaign-csv?account_id=${ACCT}&campaign_id=97011&statuses=failed`,
      { headers: { cookie: sessionCookie() } });
    const failedText = await failed.text();
    assert.equal(failedText.split('\r\n').length, 2); // כותרת + נכשל אחד
    assert.match(failedText, /"חסום"/);
    assert.match(decodeURIComponent(failed.headers.get('content-disposition')), /-מסונן\.csv/);

    const replied = await fetch(`${base}/drip-api/campaign-csv?account_id=${ACCT}&campaign_id=97011&reply=yes`,
      { headers: { cookie: sessionCookie() } });
    const repliedText = await replied.text();
    assert.equal(repliedText.split('\r\n').length, 2);
    assert.match(repliedText, /"מגיבה"/);

    const noReply = await fetch(`${base}/drip-api/campaign-csv?account_id=${ACCT}&campaign_id=97011&reply=no`,
      { headers: { cookie: sessionCookie() } });
    assert.equal((await noReply.text()).split('\r\n').length, 3); // חסום + לא נוסתה
  });
});

test('campaign-csv: בלי session → 401; חשבון זר → 403; קמפיין לא קיים → 404', async () => {
  await seedCampaign();
  await withApp(async (base) => {
    const anon = await fetch(`${base}/drip-api/campaign-csv?account_id=${ACCT}&campaign_id=97011`);
    assert.equal(anon.status, 401);

    const foreign = await fetch(`${base}/drip-api/campaign-csv?account_id=${ACCT + 1}&campaign_id=97011`,
      { headers: { cookie: sessionCookie() } });
    assert.equal(foreign.status, 403, 'account the session is not a member of');

    const missing = await fetch(`${base}/drip-api/campaign-csv?account_id=${ACCT}&campaign_id=424242`,
      { headers: { cookie: sessionCookie() } });
    assert.equal(missing.status, 404);
  });
});
