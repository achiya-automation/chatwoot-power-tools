import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyNewLeads } from '../src/notify.js';

const LEAD = {
  id: 'a1', template_name: 'bb_new_01_btn_v4', delivery_status: 'delivered',
  error_code: null, error_title: null, name: 'אושרת', phone_number: '+972501234567',
  cap_failures: 0,
};
const BLOCKED = { ...LEAD, id: 'b2', delivery_status: 'failed', error_code: '131049', cap_failures: 2 };

/** pool מזויף: שאילתה 1 = הלידים, 2 = הספירה של היום, 3 = סימון alerted_at. */
function fakePool(leads) {
  const marked = [];
  return {
    marked,
    query: async (sql, params) => {
      if (/UPDATE drip\.sent_messages SET alerted_at/.test(sql)) { marked.push(...params[0]); return {}; }
      if (/count\(\*\)/.test(sql)) return { rows: [{ total: 10, delivered: 8 }] };
      return { rows: leads };
    },
  };
}
const capture = (sent, ok = true) => async (_url, o) => {
  sent.push(JSON.parse(o.body).text);
  return { ok, status: ok ? 200 : 502 };
};

test('ליד שנמסר → התראת הצלחה עם אחוז היום', async () => {
  const pool = fakePool([LEAD]); const sent = [];
  const n = await notifyNewLeads(pool, 7, { webhookUrl: 'https://x/y', fetchImpl: capture(sent) });

  assert.equal(n, 1);
  assert.match(sent[0], /✅ ליד חדש קיבל/);
  assert.match(sent[0], /0501234567/);          // +972 → 0, כמו שהוא מחייג
  assert.match(sent[0], /לידים חדשים היום: 8\/10 נמסרו \(80%\)/);
  assert.deepEqual(pool.marked, ['a1']);
});

test('ליד שנחסם → סיבה בעברית + היסטוריית החסימות', async () => {
  const sent = [];
  await notifyNewLeads(fakePool([BLOCKED]), 7, { webhookUrl: 'https://x/y', fetchImpl: capture(sent) });

  assert.match(sent[0], /🔴 ליד חדש לא קיבל/);
  assert.match(sent[0], /מכסה אישית לשיווק/);   // ולא "131049"
  assert.match(sent[0], /כבר חסמה אותה 2 פעמים/);
});

test('⚠️ עומס → סיכום אחד, לא הצפה של הטלפון', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ ...LEAD, id: `x${i}` }));
  many[0] = { ...BLOCKED, id: 'x0' };
  const sent = [];
  const n = await notifyNewLeads(fakePool(many), 7, { webhookUrl: 'https://x/y', fetchImpl: capture(sent) });

  assert.equal(sent.length, 1, 'הודעת וואטסאפ אחת, לא 30');
  assert.match(sent[0], /30 לידים חדשים/);
  assert.match(sent[0], /✅ נמסרו: 29/);
  assert.match(sent[0], /🔴 נחסמו: 1/);
  assert.equal(n, 30);
});

test('⛔ webhook נפל → alerted_at לא נחתם, ההתראה חוזרת בטיק הבא', async () => {
  const pool = fakePool([LEAD]); const sent = [];
  await assert.rejects(
    notifyNewLeads(pool, 7, { webhookUrl: 'https://x/y', fetchImpl: capture(sent, false) }),
    /webhook 502/
  );
  assert.deepEqual(pool.marked, [], 'התראה שלא נשלחה חייבת לא להיספר כנשלחה');
});

test('אין webhook מוגדר → כבוי, בלי לגעת ב-DB', async () => {
  const pool = fakePool([LEAD]);
  assert.equal(await notifyNewLeads(pool, 7, { webhookUrl: '' }), 0);
  assert.deepEqual(pool.marked, []);
});
