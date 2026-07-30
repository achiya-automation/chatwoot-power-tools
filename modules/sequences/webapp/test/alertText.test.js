import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertText, haltText } from '../src/lib/alertText.js';

// t מזויף: מחזיר את המפתח כשאין תרגום (בדיוק כמו translate ב-i18n.js), ומציב {vars}.
const DICT = {
  al_template_paused: 'Template "{template}" is paused by Meta.',
  al_template_burned: 'Template "{template}" hit {limit} failures.',
  al_template_burned_copy: 'Burn copy "{template}" is resting ({limit} in {window} days).',
  al_template_degrading: 'Template "{template}" is degrading — create a burn copy.',
  hz_quality_red: 'Quality dropped to RED.',
  hz_delivery_floor: 'Delivery dropped to {rate}% ({ok} of {total}).',
  haltedPrefix: 'Sending halted automatically: ',
};
const t = (key, vars = {}) => {
  const s = DICT[key];
  if (s === undefined) return key;                       // לא מתורגם → המפתח עצמו
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
};

test('alertText: translates by code and substitutes params', () => {
  const out = alertText(t, {
    code: 'template_paused',
    params: { template: 'promo_08' },
    message: 'עברית גולמית',
  });
  assert.equal(out, 'Template "promo_08" is paused by Meta.');
});

test('alertText: template-scoped code strips the :name suffix', () => {
  // הקוד נושא את שם התבנית כדי ש-ON CONFLICT ימנע כפילות — מפתח התרגום הוא רק הבסיס.
  const out = alertText(t, {
    code: 'template_burned:promo_08',
    params: { template: 'promo_08', limit: 40 },
    message: 'raw',
  });
  assert.equal(out, 'Template "promo_08" hit 40 failures.');
});

test('alertText: burn copy routes to the _copy variant, not the generic burned text', () => {
  // עותק שריפה שנח הוא מצב תקין — הנוסח הגנרי היה שולח את הנציג ליצור תבנית לחינם.
  const out = alertText(t, {
    code: 'template_burned:promo_08_burn',
    params: { template: 'promo_08_burn', limit: 40, window: 7, burnCopy: true },
    message: 'raw',
  });
  assert.equal(out, 'Burn copy "promo_08_burn" is resting (40 in 7 days).');
});

test('alertText: untranslated variant falls back to the raw message, never to the base key', () => {
  // הבסיס של degrading אומר "צרו עותק" — בדיוק העצה הלא-נכונה לתבנית שכבר יש לה עותק.
  const out = alertText(t, {
    code: 'template_degrading:promo_08',
    params: { template: 'promo_08', warnAt: 24, limit: 40, hasBurnCopy: true },
    message: 'הודעה גולמית נכונה',
  });
  assert.equal(out, 'הודעה גולמית נכונה');
});

test('alertText: unknown code falls back to the raw message', () => {
  // התראה שנוצרה לפני מיגרציה 034, או קוד חדש שאין לו עדיין תרגום — חייבת להישאר קריאה.
  const out = alertText(t, { code: 'some_future_code', params: {}, message: 'הודעה גולמית' });
  assert.equal(out, 'הודעה גולמית');
});

test('alertText: alert with no params at all does not crash', () => {
  assert.equal(alertText(t, { code: 'nope', message: 'raw' }), 'raw');
  assert.equal(alertText(t, {}), '');
  assert.equal(alertText(t, null), '');
});

test('alertText: halted shows the CAUSE, not the word "halted"', () => {
  // בלי זה כל עצירה נראית זהה, וזה בדיוק הטקסט שהמשתמש צריך כדי לדעת מה לתקן.
  const out = alertText(t, {
    code: 'halted',
    params: { cause: 'delivery_floor', rate: 41, ok: 9, total: 22, reason: 'raw he' },
    message: 'raw',
  });
  assert.equal(out, 'Sending halted automatically: Delivery dropped to 41% (9 of 22).');
});

test('alertText: halted with an untranslated cause falls back to the raw reason', () => {
  const out = alertText(t, {
    code: 'halted',
    params: { cause: 'brand_new_cause', reason: 'סיבה גולמית' },
    message: 'raw message',
  });
  assert.equal(out, 'Sending halted automatically: סיבה גולמית');
});

test('alertText: halted with no cause and no reason falls back to message', () => {
  const out = alertText(t, { code: 'halted', params: {}, message: 'raw message' });
  assert.equal(out, 'raw message');
});

test('haltText: translates by code', () => {
  assert.equal(haltText(t, 'quality_red', {}, 'raw'), 'Quality dropped to RED.');
});

test('haltText: no code (pre-034 row) returns the raw reason', () => {
  assert.equal(haltText(t, null, {}, 'סיבה ישנה'), 'סיבה ישנה');
  assert.equal(haltText(t, null, {}, null), '');
});

test('haltText: unknown code returns the raw reason, never the bare key', () => {
  assert.equal(haltText(t, 'unknown_cause', {}, 'סיבה גולמית'), 'סיבה גולמית');
  assert.equal(haltText(t, 'unknown_cause', {}, null), '');
});
