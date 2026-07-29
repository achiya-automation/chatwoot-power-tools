import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDeliveryFloor } from '../src/compliance.js';

// pool מדומה: מזהה כל שאילתה לפי תוכן ומחזיר את התשובה המתאימה. אוסף את השאילתות
// כדי לאמת ש-haltAccount / resumeAccount נקראו (או לא) בכל תרחיש.
function mockPool({ ok, bad, halted = false, haltReason = null }) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql.trim());
      if (/FILTER \(WHERE ds IN/.test(sql)) return { rows: [{ ok, bad }] };
      if (/SELECT \* FROM drip\.account_health/.test(sql)) {
        return { rows: [{ halted, halt_reason: haltReason }] };
      }
      // loadSettings (כשלא מעבירים settings מפורש) — חשבון בלי שורה → DEFAULT
      if (/FROM drip\.(compliance|blanket_consent)/.test(sql)) return { rows: [] };
      return { rows: [] };   // INSERT של haltAccount / UPDATE של resumeAccount / raiseAlert
    },
  };
}
const halts = (p) => p.calls.filter((s) => /INSERT INTO drip\.account_health/.test(s)).length;
const resumes = (p) => p.calls.filter((s) => /SET halted = false/.test(s)).length;
const FLOOR_REASON = 'שיעור ההגעה צנח ל-55% (11 מתוך 20 היום)';

test('מדגם קטן מדי → null, לא שופט מסירה', async () => {
  const pool = mockPool({ ok: 5, bad: 2 });          // n=7 < 30
  assert.equal(await checkDeliveryFloor(pool, 7), null);
  assert.equal(halts(pool), 0);
  assert.equal(resumes(pool), 0);                    // לא עצור — אין מה לשחרר
});

test('מסירה תקינה → לא עוצר', async () => {
  const pool = mockPool({ ok: 90, bad: 5 });         // 95% ≥ 45, n=95
  const r = await checkDeliveryFloor(pool, 7);
  assert.deepEqual(r, { rate: 95, n: 95, halted: false });
  assert.equal(halts(pool), 0);
});

test('קריסה אמיתית על מדגם מספיק → עוצר את החשבון', async () => {
  const pool = mockPool({ ok: 5, bad: 30, halted: false });  // 14% < 45, n=35
  const r = await checkDeliveryFloor(pool, 7);
  assert.equal(r.halted, true);
  assert.equal(r.rate, 14);
  assert.equal(halts(pool), 1);                      // haltAccount נקרא בדיוק פעם אחת
});

test('יום חלש (55%) איננו קריסה — הרעש שעצר את החשבון ב-29/07 לא עוצר יותר', async () => {
  // 11/20 בדיוק המספרים של עצירת-השווא: מתחת לסף הישן (70), מעל החדש (45) —
  // ומעכשיו גם מתחת למדגם המינימלי (20 < 30). שתי הגנות נפרדות, כל אחת מספיקה.
  const pool = mockPool({ ok: 11, bad: 9, halted: false });
  assert.equal(await checkDeliveryFloor(pool, 7), null);   // n=20 < 30 — לא שופטים
  const pool2 = mockPool({ ok: 22, bad: 18, halted: false });  // אותו יחס על n=40
  assert.equal((await checkDeliveryFloor(pool2, 7)).halted, false);  // 55% ≥ 45
  assert.equal(halts(pool2), 0);
});

test('כבר עצור וממשיך לצנוח → לא עוצר שוב (בלי הצפת התראות)', async () => {
  const pool = mockPool({ ok: 5, bad: 30, halted: true, haltReason: FLOOR_REASON });
  const r = await checkDeliveryFloor(pool, 7);
  assert.equal(r.halted, true);
  assert.equal(halts(pool), 0);                      // לא נעצר שוב
  assert.equal(resumes(pool), 0);                    // ובוודאי לא שוחרר
});

test('⭐ עצירת-רצפה משתחררת לבד כשהשיעור מתאושש', async () => {
  const pool = mockPool({ ok: 30, bad: 10, halted: true, haltReason: FLOOR_REASON });  // 75%
  const r = await checkDeliveryFloor(pool, 7);
  assert.equal(r.halted, false);
  assert.equal(resumes(pool), 1);
});

test('⭐ עצירת-רצפה משתחררת לבד ביום חדש (מדגם קטן) — בלי זה מבוי סתום לנצח', async () => {
  // עצור ⇒ אין שליחות ⇒ המדגם לא גדל ⇒ בלי השחרור הזה החשבון לא חוזר לעולם.
  const pool = mockPool({ ok: 0, bad: 0, halted: true, haltReason: FLOOR_REASON });
  assert.equal(await checkDeliveryFloor(pool, 7), null);
  assert.equal(resumes(pool), 1);
});

test('⛔ עצירת RED של מטא איננה משתחררת על-ידי בלם הרצפה', async () => {
  // הבלם משחרר רק עצירות שהוא יצר. עצירת דירוג-איכות שייכת ל-auto-resume של meta.js
  // (משתחררת רק כשמטא מחזירה GREEN) — התאוששות מסירה איננה ראיה שהדירוג חזר.
  const pool = mockPool({ ok: 30, bad: 10, halted: true, haltReason: 'דירוג האיכות של המספר ירד ל-RED.' });
  const r = await checkDeliveryFloor(pool, 7);
  assert.equal(r.halted, false);                     // הדיווח משקף את המדגם...
  assert.equal(resumes(pool), 0);                    // ...אבל העצירה נשארת
});

test('הסף מכוונן פר-חשבון — סף מחמיר עוצר גם על מסירה בינונית', async () => {
  const pool = mockPool({ ok: 80, bad: 20, halted: false });  // 80%
  assert.equal((await checkDeliveryFloor(pool, 7, { min_delivery_rate: 90 })).halted, true);   // 80<90 → עוצר
  const pool2 = mockPool({ ok: 80, bad: 20, halted: false });
  assert.equal((await checkDeliveryFloor(pool2, 7, { min_delivery_rate: 70 })).halted, false);  // 80≥70 → לא
});
