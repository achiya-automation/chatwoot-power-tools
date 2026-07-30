/**
 * ⭐ הבדיקה הקריטית: ליד חדש חייב לקבל את ההודעה. תמיד. בלי יוצא מן הכלל.
 * כל תרחיש שבו הוא *לא* מקבל = באג שעולה ללקוח כסף.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSend, DEFAULT_SETTINGS } from '../src/compliance.js';

// ליד חדש בדיוק כפי שהמנוע רואה אותו: אין רשומת contact_state, אז cState = {}
const NEW_LEAD = {};
// ⚠️ בפרודקשן loadSettings מזריק blanket_consent מ-drip.blanket_consent (הצהרת בעל
// המידע — ההסכמה שייכת למפרסם, לא לנו). בלעדיו כל ליד חדש נדחה ב-no_consent, וזה
// בדיוק הטסט: לוודא שהשדה הזה באמת מגיע, ושליד חדש עובר איתו.
const settings = { ...DEFAULT_SETTINGS, max_template_failures: 10, max_cap_failures: 4,
                   blanket_consent: { source: 'client_declaration', declared_at: '2026-07-12' } };
const base = {
  category: 'MARKETING', contact: NEW_LEAD, phone: '+972541234567',
  settings, health: {}, template: { status: 'APPROVED', failures: 0 },
  sentToday: 0, inSession: false,
};

test('⭐ ליד חדש עובר — התרחיש הבסיסי', () => {
  assert.deepEqual(canSend(base), { ok: true });
});

test('⭐⭐ ליד חדש עובר מעל הבלם הרגיל, אבל לא מעל מדרגת החירום הקשיחה', () => {
  // זה הבאג שהיה הורג את הלקוח: הזנב הרווי שורף תבנית → הבלם נסגר →
  // וליד חדש, ששווה 91%, לא מקבל כלום. הבלם חייב לחול רק על מי שכבר נחסם.
  const burned = { status: 'APPROVED', failures: 40 };
  assert.deepEqual(canSend({ ...base, template: burned }), { ok: true });
  assert.equal(
    canSend({ ...base, template: { status: 'APPROVED', failures: 48 } }).reason,
    'template_burned'
  );
});

test('🔴 בלי blanket_consent — כל ליד חדש נדחה. זה המתג שמשתק לקוח.', () => {
  // אם השורה ב-drip.blanket_consent נמחקת/פגה, כל ליד חדש מקבל no_consent ושום
  // הודעה לא יוצאת — בשקט מוחלט. זה הכשל הכי שקט והכי יקר שיש.
  const noBlanket = { ...settings, blanket_consent: null };
  const v = canSend({ ...base, settings: noBlanket });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'no_consent');
  // …ועם הצהרה פר-איש-קשר — עובר גם בלי blanket
  assert.equal(canSend({ ...base, settings: noBlanket,
                         contact: { consent_at: '2026-07-12T00:00:00Z' } }).ok, true);
});

test('🔴 ליד חדש נחסם רק כשצריך — ואלה כל המקרים', () => {
  // מספר אמריקאי: מטא לא מוסרת שיווק ל-US, נקודה.
  assert.equal(canSend({ ...base, phone: '+12125550123' }).ok, false);
  // תבנית לא מאושרת: אין מה לשלוח.
  assert.equal(canSend({ ...base, template: { status: 'PENDING' } }).ok, false);
  // חשבון עצור: מטא חסמה אותנו.
  assert.equal(canSend({ ...base, health: { halted: true } }).ok, false);
  // כבר קיבל היום: המכסה היומית.
  assert.equal(canSend({ ...base, sentToday: 1 }).ok, false);
});

test('⭐ תבנית לא ידועה = fail-open — חוסר ידע לא משתק לקוח', () => {
  assert.deepEqual(canSend({ ...base, template: null }), { ok: true });
});

test('⭐ ליד שכבר נחסם עובר רק אחרי מדרגת הצינון המתאימה', () => {
  for (const n of [1, 2, 3]) {
    assert.equal(canSend({
      ...base,
      contact: {
        ...NEW_LEAD,
        cap_failures: n,
        last_cap_failure_at: '2026-01-01T00:00:00Z',
      },
    }).ok, true, `${n} חסימות אחרי מנוחה`);
  }
  // ב-4 — נעצר (defer, לא drop: תגובה תפשיר אותו)
  const v = canSend({ ...base, contact: { ...NEW_LEAD, cap_failures: 4 } });
  assert.equal(v.ok, false);
  assert.equal(v.action, 'defer');
});
