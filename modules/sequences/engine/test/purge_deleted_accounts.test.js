/**
 * purge_deleted_accounts.test.js — מחיקת חשבון ב-Chatwoot לא נגעה בסכימת drip, ולכן מידע
 * אישי של אנשי קשר (טלפון, שם) נשאר שם ללא הגבלת זמן. נמדד בייצור 4.9.2026: 75,135 שורות
 * ב-10 טבלאות, של שלושה חשבונות שכבר לא קיימים — כולל טוקני API ב-drip.account_tokens.
 *
 * הבדיקה מאמתת את שתי התכונות שמונעות נזק: הפונקציה מוחקת בדיוק את מה ששייך לחשבון שאיננו,
 * ולא נוגעת בשורה של חשבון חי — גם כשהן יושבות באותה טבלה.
 *
 * Run: node --test test/purge_deleted_accounts.test.js   (דורש DATABASE_URL_TEST)
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb } from './helpers.js';
import { getPool, query } from '../src/db.js';

const pool = getPool({ databaseUrl: process.env.DATABASE_URL_TEST });

beforeEach(async () => {
  await setupDb(pool);
  await query('TRUNCATE drip.campaign_send_snapshots, drip.contact_state CASCADE');
  await query('DELETE FROM public.accounts WHERE id IN (901, 902)');
  await query("INSERT INTO public.accounts (id, name) VALUES (901, 'live account')");
  // 902 בכוונה לא נוצר — הוא מייצג חשבון שנמחק.
  // ‏status הוא integer (2 = sent, כמו ב-campaign_recipients של Chatwoot), ו-source_id
  // ו-status_updated_at הם NOT NULL — הכנסה חסרה נופלת ב-beforeEach ולא בבדיקה עצמה.
  await query(`INSERT INTO drip.campaign_send_snapshots
      (account_id, campaign_id, contact_id, contact_name, phone, source_id,
       status, attempted_at, status_updated_at)
    VALUES (901, 1, 1, 'לקוח חי',             '972500000001', 'wamid.A', 2, now(), now()),
           (902, 1, 2, 'לקוח של חשבון שנמחק', '972500000002', 'wamid.B', 2, now(), now()),
           (902, 1, 3, 'עוד אחד',             '972500000003', 'wamid.C', 2, now(), now())`);
});

test('הצילום מדווח רק על שורות של חשבון שאיננו', async () => {
  const rows = await query(
    "SELECT tbl, rows_left FROM drip.deleted_account_footprint() WHERE tbl = 'campaign_send_snapshots'"
  );
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].rows_left), 2);
});

test('הניקוי מוחק את השורות היתומות ומשאיר את החשבון החי ללא פגע', async () => {
  await query('SELECT * FROM drip.purge_deleted_accounts()');

  const left = await query('SELECT account_id, phone FROM drip.campaign_send_snapshots ORDER BY account_id');
  assert.equal(left.length, 1, 'רק שורת החשבון החי אמורה לשרוד');
  assert.equal(Number(left[0].account_id), 901);
  assert.equal(left[0].phone, '972500000001');

  const after = await query('SELECT count(*)::int AS n FROM drip.deleted_account_footprint()');
  assert.equal(after[0].n, 0, 'הרצה שנייה כבר לא מוצאת מה למחוק');
});

test('הניקוי אידמפוטנטי — הרצה חוזרת אינה מוחקת דבר נוסף', async () => {
  await query('SELECT * FROM drip.purge_deleted_accounts()');
  const second = await query('SELECT count(*)::int AS n FROM drip.purge_deleted_accounts()');
  assert.equal(second[0].n, 0);
  const live = await query('SELECT count(*)::int AS n FROM drip.campaign_send_snapshots');
  assert.equal(live[0].n, 1);
});
