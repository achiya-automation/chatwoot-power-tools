/**
 * drip.save_compliance — שמירת מדיניות הציות.
 *
 * הבאג שהתגלה 07.08.2026: הפונקציה נכתבה במיגרציה 020 עם 8 שדות, ומאז נוספו לטבלה
 * שבע עמודות הגדרה שהיא פשוט התעלמה מהן. המסך שלח, השרת בלע, והערך חזר לקדמותו
 * ברענון — כלומר הגדרה שנראתה שמורה ולא הייתה.
 *
 * הבדיקה השנייה חשובה לא פחות: שדה שלא נשלח חייב לשמור על ערכו. מסך אחד לא יודע
 * על שדות שמסך אחר מנהל, ואיפוס-לברירת-מחדל היה הופך כל שמירה חלקית לאיבוד נתונים.
 *
 * Run: DATABASE_URL_TEST=postgres://postgres:test@localhost:55432/postgres node --test
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb } from './helpers.js';
import { getPool } from '../src/db.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);
const ACCT = 950;

const save = (obj) => pool.query('SELECT drip.save_compliance($1::jsonb) AS r', [JSON.stringify({ account_id: ACCT, ...obj })]);
const row = async () => (await pool.query('SELECT * FROM drip.compliance WHERE account_id = $1', [ACCT])).rows[0];

beforeEach(async () => {
  await setupDb(pool);
  await pool.query('DELETE FROM drip.compliance WHERE account_id = $1', [ACCT]);
});

test('יוצר שורה לחשבון חדש', async () => {
  await save({ max_marketing_per_day: 2 });
  assert.equal(Number((await row()).max_marketing_per_day), 2);
});

test('⭐ שעות שקט נשמרות — הבאג המקורי', async () => {
  await save({ quiet_start_hour: 22, quiet_end_hour: 7, quiet_tz: 'Asia/Jerusalem' });
  const r = await row();
  assert.equal(Number(r.quiet_start_hour), 22);
  assert.equal(Number(r.quiet_end_hour), 7);
  assert.equal(r.quiet_tz, 'Asia/Jerusalem');
});

test('⭐ כל שבע העמודות שנוספו אחרי 020 נשמרות', async () => {
  await save({
    max_template_failures: 9,
    quiet_start_hour: 20,
    quiet_end_hour: 9,
    quiet_tz: 'UTC',
    saturation_release_days: 14,
    window_pull_enabled: true,
    auto_template_replace_enabled: true,
  });
  const r = await row();
  assert.equal(Number(r.max_template_failures), 9);
  assert.equal(Number(r.quiet_start_hour), 20);
  assert.equal(Number(r.quiet_end_hour), 9);
  assert.equal(r.quiet_tz, 'UTC');
  assert.equal(Number(r.saturation_release_days), 14);
  assert.equal(r.window_pull_enabled, true);
  assert.equal(r.auto_template_replace_enabled, true);
});

test('⭐⭐ שדה שלא נשלח שומר על ערכו ולא מתאפס', async () => {
  // מסך אחד לא יודע על שדות שמסך אחר מנהל. איפוס כאן = איבוד נתונים שקט.
  await save({ quiet_start_hour: 21, quiet_end_hour: 8, max_marketing_per_day: 5 });
  await save({ max_marketing_per_day: 3 });          // שמירה חלקית מטופס אחר
  const r = await row();
  assert.equal(Number(r.max_marketing_per_day), 3, 'מה שנשלח מתעדכן');
  assert.equal(Number(r.quiet_start_hour), 21, 'מה שלא נשלח נשאר');
  assert.equal(Number(r.quiet_end_hour), 8);
});

test('השדות המקוריים ממשיכים לעבוד', async () => {
  await save({
    require_consent: false, max_unengaged: 7, max_cap_failures: 4,
    consent_max_age_days: 60, block_us_marketing: false, halt_on_red: false,
  });
  const r = await row();
  assert.equal(r.require_consent, false);
  assert.equal(Number(r.max_unengaged), 7);
  assert.equal(Number(r.max_cap_failures), 4);
  assert.equal(Number(r.consent_max_age_days), 60);
  assert.equal(r.block_us_marketing, false);
  assert.equal(r.halt_on_red, false);
});

test('מילות הסרה — רשימה נשמרת, והשמטה לא מוחקת', async () => {
  await save({ opt_out_keywords: ['הסר', 'stop'] });
  assert.deepEqual((await row()).opt_out_keywords, ['הסר', 'stop']);
  await save({ max_unengaged: 2 });
  assert.deepEqual((await row()).opt_out_keywords, ['הסר', 'stop'], 'לא נשלח = לא נמחק');
  await save({ opt_out_keywords: [] });
  assert.deepEqual((await row()).opt_out_keywords, [], 'רשימה ריקה מפורשת כן מנקה');
});

test('בלי account_id — נכשל בקול', async () => {
  await assert.rejects(
    () => pool.query('SELECT drip.save_compliance($1::jsonb)', [JSON.stringify({ max_unengaged: 1 })]),
    /account_id required/
  );
});
