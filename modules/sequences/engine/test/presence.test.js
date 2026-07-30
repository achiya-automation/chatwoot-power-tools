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

test('ברירת מחדל שמרנית: קריאה כן, "מקליד" רק מנציג', async () => {
  const s = await settingsFor(fakeQuery([[]]), 1, 38);
  assert.equal(s.read_receipts, true);
  assert.equal(s.typing_mode, 'agent');
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
  assert.match(sel, /m\.message_type = 0/);
  assert.match(sel, /m\.private = false/);
  assert.match(sel, /m\.source_id LIKE 'wamid\.%'/);
  assert.match(sel, /cw\.provider = 'whatsapp_cloud'/);
});
