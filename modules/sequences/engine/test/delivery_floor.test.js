import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDeliveryFloor } from '../src/compliance.js';

// pool מדומה: מזהה כל שאילתה לפי תוכן ומחזיר את התשובה המתאימה. אוסף את השאילתות
// כדי לאמת ש-haltAccount נקרא (או לא) בכל תרחיש.
function mockPool({ ok, bad, halted = false, haltReason = null }) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql.trim());
      if (/AS first_ever/.test(sql)) return { rows: [{ ok, bad }] };
      if (/SELECT \* FROM drip\.account_health/.test(sql)) {
        return { rows: [{ halted, halt_reason: haltReason }] };
      }
      // loadSettings (כשלא מעבירים settings מפורש) — חשבון בלי שורה → DEFAULT
      if (/FROM drip\.(compliance|blanket_consent)/.test(sql)) return { rows: [] };
      return { rows: [] };   // INSERT של haltAccount / raiseAlert
    },
  };
}
const halts = (p) => p.calls.filter((s) => /INSERT INTO drip\.account_health/.test(s)).length;
const resumes = (p) => p.calls.filter((s) => /UPDATE drip\.account_health SET halted = false/.test(s)).length;

test('מדגם קטן מדי → null, לא שופט מסירה', async () => {
  const pool = mockPool({ ok: 5, bad: 2 });          // n=7 < 20
  assert.equal(await checkDeliveryFloor(pool, 7), null);
  assert.equal(halts(pool), 0);
});

test('מדגם קטן בחשבון עצור אינו הוכחת התאוששות — לא משחרר בחצות', async () => {
  const pool = mockPool({
    ok: 0,
    bad: 0,
    halted: true,
    haltReason: 'שיעור ההגעה צנח אתמול',
  });
  assert.equal(await checkDeliveryFloor(pool, 7), null);
  assert.equal(resumes(pool), 0);
});

test('מסירה תקינה → לא עוצר', async () => {
  const pool = mockPool({ ok: 90, bad: 5 });         // 95% ≥ 70, n=95
  const r = await checkDeliveryFloor(pool, 7);
  assert.deepEqual(r, { rate: 95, n: 95, halted: false });
  assert.equal(halts(pool), 0);
  assert.match(
    pool.calls.find((sql) => /AS first_ever/.test(sql)),
    /first_ever AND ds = 'failed' AND error_code = '131049'/,
    'only a first-ever 131049 is excluded; successful openers and other errors stay visible'
  );
});

test('מסירה צונחת על מדגם מספיק → עוצר את החשבון', async () => {
  const pool = mockPool({ ok: 10, bad: 20, halted: false });  // 33% < 70, n=30
  const r = await checkDeliveryFloor(pool, 7);
  assert.equal(r.halted, true);
  assert.equal(r.rate, 33);
  assert.equal(halts(pool), 1);                      // haltAccount נקרא בדיוק פעם אחת
});

test('כבר עצור → לא עוצר שוב (בלי הצפת התראות)', async () => {
  const pool = mockPool({ ok: 10, bad: 20, halted: true });   // צניחה אבל כבר halted
  const r = await checkDeliveryFloor(pool, 7);
  assert.equal(r.halted, true);
  assert.equal(halts(pool), 0);                      // לא נעצר שוב
});

test('הסף מכוונן פר-חשבון — סף מחמיר עוצר גם על מסירה בינונית', async () => {
  const pool = mockPool({ ok: 80, bad: 20, halted: false });  // 80%
  assert.equal((await checkDeliveryFloor(pool, 7, { min_delivery_rate: 90 })).halted, true);   // 80<90 → עוצר
  const pool2 = mockPool({ ok: 80, bad: 20, halted: false });
  assert.equal((await checkDeliveryFloor(pool2, 7, { min_delivery_rate: 70 })).halted, false);  // 80≥70 → לא
});
