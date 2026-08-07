/**
 * qualityWatch — תצפית על דירוג האיכות של כל המספרים.
 *
 * הבדיקה המרכזית: התראה נשלחת על *שינוי* לרעה, ולא שוב ושוב על אותו מצב. התראה
 * שחוזרת כל שעה היא התראה שמפסיקים להסתכל עליה — וזה מבטל את כל התועלת.
 *
 * Run: DATABASE_URL_TEST=postgres://postgres:test@localhost:55432/postgres node --test
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb } from './helpers.js';
import { getPool } from '../src/db.js';
import { watchNumberQuality } from '../src/qualityWatch.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);
const WEBHOOK = 'https://hook.example/alert';

// fetchImpl מזויף שאוסף את ההתראות במקום לשלוח
function collector({ ok = true } = {}) {
  const sent = [];
  return {
    sent,
    impl: async (_url, opts) => {
      sent.push(JSON.parse(opts.body).text);
      return { ok, status: ok ? 200 : 500 };
    },
  };
}

const health = (quality, tier = 'TIER_2K') => async () => ({ quality, tier });

beforeEach(async () => {
  await setupDb(pool);
  await pool.query('DELETE FROM drip.number_quality');
  // הסוויטה חולקת מסד אחד וקבצים אחרים משאירים ערוצי וואטסאפ מהפיקסצ'רים שלהם.
  // הסריקה כאן היא על *כל* המספרים במערכת, ולכן הבידוד חייב להיות מלא.
  await pool.query("DELETE FROM public.inboxes WHERE channel_type = 'Channel::Whatsapp'");
  await pool.query('DELETE FROM public.channel_whatsapp');
  await pool.query(
    `INSERT INTO public.channel_whatsapp (id, phone_number, provider_config)
     VALUES (700, '+972553328890', '{"api_key":"t","phone_number_id":"PH700"}'::jsonb)`
  );
  await pool.query(
    `INSERT INTO public.inboxes (id, account_id, name, channel_type, channel_id)
     VALUES (700, 15, 'חנה ריבקין WhatsApp', 'Channel::Whatsapp', 700)`
  );
});

test('RED על מספר שאינו רשום במנוע — מתריע', async () => {
  // בדיוק המקרה שהתגלה: המספר לא ב-drip.account_tokens, ולכן refreshHealth לא נגע בו.
  const c = collector();
  const r = await watchNumberQuality(pool, {
    fetchNumberHealthFn: health('RED'), webhookUrl: WEBHOOK, fetchImpl: c.impl,
  });
  assert.equal(r.checked, 1);
  assert.equal(r.alerts, 1);
  assert.match(c.sent[0], /RED/);
  assert.match(c.sent[0], /0553328890/); // מוצג בפורמט ישראלי מקומי
});

test('אותו RED בסבב הבא — לא מתריע שוב', async () => {
  const c1 = collector();
  await watchNumberQuality(pool, { fetchNumberHealthFn: health('RED'), webhookUrl: WEBHOOK, fetchImpl: c1.impl });
  const c2 = collector();
  const r = await watchNumberQuality(pool, { fetchNumberHealthFn: health('RED'), webhookUrl: WEBHOOK, fetchImpl: c2.impl });
  assert.equal(r.alerts, 0);
  assert.equal(c2.sent.length, 0);
});

test('החמרה מ-YELLOW ל-RED — כן מתריע', async () => {
  const c1 = collector();
  await watchNumberQuality(pool, { fetchNumberHealthFn: health('YELLOW'), webhookUrl: WEBHOOK, fetchImpl: c1.impl });
  assert.equal(c1.sent.length, 1);
  const c2 = collector();
  const r = await watchNumberQuality(pool, { fetchNumberHealthFn: health('RED'), webhookUrl: WEBHOOK, fetchImpl: c2.impl });
  assert.equal(r.alerts, 1);
  assert.match(c2.sent[0], /RED/);
});

test('חזרה ל-GREEN אחרי אזהרה — מתריע פעם אחת שנסגר', async () => {
  const c1 = collector();
  await watchNumberQuality(pool, { fetchNumberHealthFn: health('RED'), webhookUrl: WEBHOOK, fetchImpl: c1.impl });
  const c2 = collector();
  const r2 = await watchNumberQuality(pool, { fetchNumberHealthFn: health('GREEN'), webhookUrl: WEBHOOK, fetchImpl: c2.impl });
  assert.equal(r2.alerts, 1);
  assert.match(c2.sent[0], /GREEN/);
  // ולא שוב
  const c3 = collector();
  const r3 = await watchNumberQuality(pool, { fetchNumberHealthFn: health('GREEN'), webhookUrl: WEBHOOK, fetchImpl: c3.impl });
  assert.equal(r3.alerts, 0);
});

test('GREEN מלכתחילה — אין התראה', async () => {
  const c = collector();
  const r = await watchNumberQuality(pool, { fetchNumberHealthFn: health('GREEN'), webhookUrl: WEBHOOK, fetchImpl: c.impl });
  assert.equal(r.alerts, 0);
  assert.equal(c.sent.length, 0);
});

test('webhook שנפל — לא מסמן כמדווח, ומתריע שוב בסבב הבא', async () => {
  const bad = collector({ ok: false });
  const r1 = await watchNumberQuality(pool, { fetchNumberHealthFn: health('RED'), webhookUrl: WEBHOOK, fetchImpl: bad.impl });
  assert.equal(r1.alerts, 0);
  const good = collector();
  const r2 = await watchNumberQuality(pool, { fetchNumberHealthFn: health('RED'), webhookUrl: WEBHOOK, fetchImpl: good.impl });
  assert.equal(r2.alerts, 1, 'התראה שנכשלה חייבת לחזור — אחרת היא נעלמת בשקט');
});

test('טוקן פגום — נרשם ולא מתריע', async () => {
  const c = collector();
  const failing = async () => { throw new Error('Graph number health PH700 → 401'); };
  const r = await watchNumberQuality(pool, { fetchNumberHealthFn: failing, webhookUrl: WEBHOOK, fetchImpl: c.impl });
  assert.equal(r.checked, 1);
  assert.equal(r.alerts, 0);
  const { rows } = await pool.query('SELECT last_error FROM drip.number_quality WHERE phone_id = $1', ['PH700']);
  assert.match(rows[0].last_error, /401/);
});

test('בלי webhook מוגדר — סורק ורושם, לא מתריע', async () => {
  const r = await watchNumberQuality(pool, { fetchNumberHealthFn: health('RED'), webhookUrl: '' });
  assert.equal(r.checked, 1);
  assert.equal(r.alerts, 0);
  const { rows } = await pool.query('SELECT quality FROM drip.number_quality WHERE phone_id = $1', ['PH700']);
  assert.equal(rows[0].quality, 'RED');
});
