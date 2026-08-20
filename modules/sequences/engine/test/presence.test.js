/**
 * presence.test.js — הרזולוציה של ההגדרות, מיפוי המצבים לקריאות Meta, וקידום הסמן.
 *
 * Run: node --test test/presence.test.js   (ללא DB — ה-query מוזרק)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsFor, relayAgentTyping, tickPresence, _internals } from '../src/presence.js';

const noop = () => {};

/** query מזויף: מחזיר תשובה לפי סדר הקריאות, ומתעד את מה שנשאל. */
function fakeQuery(responses) {
  const calls = [];
  const fn = async (sql, params) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    return responses.shift() ?? [];
  };
  fn.calls = calls;
  return fn;
}

/** fetch מזויף שמתעד את גוף הבקשה. */
function fakeFetch(ok = true) {
  const sent = [];
  const fn = async (url, opts) => {
    sent.push({ url, body: JSON.parse(opts.body) });
    return { ok, status: ok ? 200 : 400, text: async () => 'boom' };
  };
  fn.sent = sent;
  return fn;
}

// עודכן 06.08.2026 יחד עם a256633: ברירת המחדל הפכה לכבויה לגמרי אחרי שתיבות
// לקוחות ירשו סימון-נקרא שאיש לא ביקש. הפעלה — רק במפורש פר-תיבה.
test('ברירת מחדל: הכל כבוי — בלי נקרא ובלי מקליד', async () => {
  const s = await settingsFor(fakeQuery([[]]), 1, 38);
  assert.equal(s.read_receipts, false);
  assert.equal(s.typing_mode, 'off');
});

test('שורת התיבה גוברת על ברירת המחדל של החשבון', async () => {
  const q = fakeQuery([[{ inbox_id: 38, typing_mode: 'auto', read_receipts: false }]]);
  const s = await settingsFor(q, 11, 38);
  assert.equal(s.typing_mode, 'auto');
  assert.equal(s.read_receipts, false);
  // ההשהיות שלא נדרסו נשארות מברירת המחדל
  assert.equal(s.read_delay_min, 2);
  // השאילתה חייבת לבקש את שתי הרמות ולהעדיף את הגבוהה
  assert.match(q.calls[0].sql, /inbox_id IN \(0, \$2\)/);
  assert.match(q.calls[0].sql, /ORDER BY inbox_id DESC/);
});

test('payload של Meta: "נקרא" בלי מחוון, "מקליד" עם', async () => {
  const f = fakeFetch();
  await _internals.send({ phoneId: 'P', token: 'T', wamid: 'wamid.X', typing: false }, f);
  await _internals.send({ phoneId: 'P', token: 'T', wamid: 'wamid.X', typing: true }, f);
  assert.equal(f.sent[0].body.status, 'read');
  assert.equal(f.sent[0].body.typing_indicator, undefined);
  assert.deepEqual(f.sent[1].body.typing_indicator, { type: 'text' });
  assert.match(f.sent[0].url, /\/P\/messages$/);
});

test('שגיאת Meta מתורגמת לחריגה ולא נבלעת', async () => {
  await assert.rejects(
    () => _internals.send({ phoneId: 'P', token: 'T', wamid: 'w' }, fakeFetch(false)),
    /400/
  );
});

test('הקלדת נציג: מכה ב-Meta פעם אחת, ואז ממודדת', async () => {
  _internals.lastTyping.clear();
  const row = [{ inbox_id: 38, source_id: 'wamid.A', phone_id: 'P', token: 'T' }];
  const f = fakeFetch();
  const deps = { query: fakeQuery([row, [{ typing_mode: 'agent' }]]), fetchImpl: f, log: noop };

  assert.deepEqual(await relayAgentTyping(deps, 11, 900), { sent: true });
  assert.equal(f.sent.length, 1);
  // האירוע נורה על כל תו — הפגיעה השנייה חייבת להיחסם
  assert.deepEqual(await relayAgentTyping(deps, 11, 900), { throttled: true });
  assert.equal(f.sent.length, 1);
});

test('הקלדת נציג מכובדת ע"י typing_mode=off', async () => {
  _internals.lastTyping.clear();
  const row = [{ inbox_id: 38, source_id: 'wamid.A', phone_id: 'P', token: 'T' }];
  const f = fakeFetch();
  const deps = { query: fakeQuery([row, [{ typing_mode: 'off' }]]), fetchImpl: f, log: noop };
  assert.deepEqual(await relayAgentTyping(deps, 11, 901), { sent: false, reason: 'disabled' });
  assert.equal(f.sent.length, 0);
});

test('שיחה בלי הודעה נכנסת בוואטסאפ לא מפילה כלום', async () => {
  _internals.lastTyping.clear();
  const deps = { query: fakeQuery([[]]), fetchImpl: fakeFetch(), log: noop };
  const r = await relayAgentTyping(deps, 11, 902);
  assert.equal(r.sent, false);
});

test('הסמן מתקדם גם כשכל ההודעות סוננו החוצה', async () => {
  // אחרת תיבה פעילה בערוץ אחר משאירה את הלולאה תקועה על אותו טווח לנצח
  const q = fakeQuery([[{ last_message_id: 100 }], [], [{ id: 180 }]]);
  const r = await tickPresence({ query: q, fetchImpl: fakeFetch(), log: noop });
  assert.equal(r.processed, 0);
  assert.equal(r.cursor, 180);
  const update = q.calls.find((c) => c.sql.startsWith('UPDATE drip.presence_cursor'));
  assert.deepEqual(update.params, [180]);
});

test('אין הודעות חדשות → אין כתיבה לסמן', async () => {
  const q = fakeQuery([[{ last_message_id: 100 }], [], [{ id: 100 }]]);
  await tickPresence({ query: q, fetchImpl: fakeFetch(), log: noop });
  assert.equal(q.calls.some((c) => c.sql.startsWith('UPDATE')), false);
});

test('הסינון תופס רק נכנסות, לא-פרטיות, whatsapp_cloud עם wamid', async () => {
  const q = fakeQuery([[{ last_message_id: 0 }], [], [{ id: 0 }]]);
  await tickPresence({ query: q, fetchImpl: fakeFetch(), log: noop });
  const sel = q.calls[1].sql;
  assert.match(sel, /msg\.message_type = 0/);
  assert.match(sel, /msg\.private = false/);
  assert.match(sel, /msg\.source_id LIKE 'wamid\.%'/);
  assert.match(sel, /cw\.provider = 'whatsapp_cloud'/);
});

test('שיחה שאדם כבר ענה בה לא מסומנת כנקראה', async () => {
  // ההגדרה היא פר-תיבה אבל נועדה להחיות בוט. בלי הסינון הזה הלקוח מקבל ✓✓ כחול
  // בשיחה שאדם מנהל ולא ענה בה — 95% מהסימונים בתיבה 38 היו כאלה (10.08.2026).
  const q = fakeQuery([[{ last_message_id: 0 }], [], [{ id: 0 }]]);
  await tickPresence({ query: q, fetchImpl: fakeFetch(), log: noop });
  const sel = q.calls[1].sql;
  assert.match(sel, /NOT EXISTS/);
  // חייב לעבור דרך הקבוע המשותף: sender_type='User' לבדו מחמיץ תשובה מהטלפון
  // ב-coexistence, שמסומנת רק ב-content_attributes.external_echo
  assert.match(sel, /external_echo/);
  assert.match(sel, /m\.conversation_id = msg\.conversation_id/);
  assert.match(sel, /m\.id < msg\.id/);
});

// ── לולאת רענון ה"מקליד" (06.08.2026) ────────────────────────────────────
// הבאג שנמדד חי: ירייה אחת של "מקליד" מתה 25ש' אחרי שנשלחה, בעוד שתשובת הבוט
// מגיעה אחרי 10-15ש' עד 5 דקות. בלי conversation_id בשליפה אין למה לרענן.

test('השליפה מביאה conversation_id — בלעדיו לולאת הרענון מתה בשקט', async () => {
  const q = fakeQuery([[{ last_message_id: 0 }], [], [{ id: 0 }]]);
  await tickPresence({ query: q, fetchImpl: fakeFetch(), log: noop });
  assert.match(q.calls[1].sql, /msg\.conversation_id/);
});

test('סימן העצירה: הודעה חדשה יותר בשיחה עוצרת את הרענון', async () => {
  const q = fakeQuery([[{ '?column?': 1 }]]);
  assert.equal(await _internals.hasNewerMessage(q, 900, 500), true);
  assert.match(q.calls[0].sql, /id > \$2/);
  assert.match(q.calls[0].sql, /private = false/); // פתק פנימי של נציג הוא לא תשובה ללקוח
  assert.deepEqual(q.calls[0].params, [900, 500]);
});

test('אין הודעה חדשה → ממשיכים לרענן', async () => {
  assert.equal(await _internals.hasNewerMessage(fakeQuery([[]]), 900, 500), false);
});

test('בלי conversation_id לא מרעננים בכלל (אין איך לדעת מתי לעצור)', async () => {
  const q = fakeQuery([[]]);
  assert.equal(await _internals.hasNewerMessage(q, null, 500), true);
  assert.equal(q.calls.length, 0); // לא ניגשים ל-DB סתם
});

test('הרענון מתוזמן אחרי תפוגת ה-25ש\' של Meta, ולא לפניה', async () => {
  // רענון מוקדם מדי = "מקליד" רצוף בלי נשימה; מאוחר מדי = חורים ארוכים
  assert.ok(_internals.TYPING_REFRESH_MIN_S > 25, 'חייב להיות אחרי התפוגה');
  assert.ok(_internals.TYPING_REFRESH_MAX_S <= 35, 'פסק ארוך מדי נראה כמו נטישה');
  assert.ok(_internals.TYPING_MAX_WAIT_MS >= 5 * 60_000, 'חייב לכסות את ההשהיה העמוקה של הבוט (עד 5 דק\')');
});
