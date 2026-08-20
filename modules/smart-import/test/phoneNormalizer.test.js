import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../lib/phoneNormalizer.js';

test('local mobile 05X → +9725X', () => {
  assert.equal(normalizePhone('0501234567'), '+972501234567');
});
test('strips spaces and dashes', () => {
  assert.equal(normalizePhone('050-123 4567'), '+972501234567');
});
test('already +972 stays', () => {
  assert.equal(normalizePhone('+972501234567'), '+972501234567');
});
test('972 without plus gets plus', () => {
  assert.equal(normalizePhone('972501234567'), '+972501234567');
});
test('00 international prefix → +', () => {
  assert.equal(normalizePhone('00972501234567'), '+972501234567');
});
test('9 digits without leading zero → +972', () => {
  assert.equal(normalizePhone('501234567'), '+972501234567');
});
test('foreign + number stays', () => {
  assert.equal(normalizePhone('+14155552671'), '+14155552671');
});
test('empty / junk → null', () => {
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('abc'), null);
  assert.equal(normalizePhone('123'), null);
});
test('Israeli landline 02-XXXXXXX → +97221234567', () => {
  assert.equal(normalizePhone('02-1234567'), '+97221234567');
});
test('Israeli landline 03-XXXXXXX → +97231234567', () => {
  assert.equal(normalizePhone('03-1234567'), '+97231234567');
});
test('Israeli landline with spaces 04 1234567 → +97241234567', () => {
  assert.equal(normalizePhone('04 1234567'), '+97241234567');
});

// Excel strips '+' from numeric cells — a bare foreign number must survive the round-trip.
test('restores + on bare foreign numbers (Excel strips it)', () => {
  assert.equal(normalizePhone('17187159550'), '+17187159550');   // US
  assert.equal(normalizePhone('4367683181856'), '+4367683181856'); // AT
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('12345678'), null); // 8 digits — too short for anything
});

// מגדלי דוד incident: a 10-digit cell (Israeli mobile typed with one digit too many)
// was "restored" to +5252446876 — a Mexican-looking number a campaign would happily
// message. No 5X country code produces a 10-digit E.164, so this shape is never foreign.
test('bare 10-digit starting with 5 is a broken Israeli mobile, not a foreign number', () => {
  assert.equal(normalizePhone('5252446876'), null);
  assert.equal(normalizePhone('5444419830'), null);
});

// ── 972 + מספר מקומי שנשאר עם האפס (07.08.2026) ────────────────────────────────
// הטעות הנפוצה בקבצים של לקוחות: מישהו הוסיף 972 למספר שכבר התחיל ב-0. עד התיקון
// התוצאה נשמרה כ-‎+9720501234567 — ספרה אחת יותר מדי, נראה תקין, ומת בכל שליחה.
// זה בדיוק המקרה שמנגנון האזהרה על "טלפון לא קריא" לא תופס, כי הוא כן התפרש.
test('972 עם אפס מקומי → האפס יורד', () => {
  assert.equal(normalizePhone('9720501234567'), '+972501234567');
  assert.equal(normalizePhone('+9720501234567'), '+972501234567');
  assert.equal(normalizePhone('009720501234567'), '+972501234567');
  assert.equal(normalizePhone('972-050-1234567'), '+972501234567');
});

test('972 עם קו נייח שנשאר עם אפס', () => {
  assert.equal(normalizePhone('972031234567'), '+97231234567');
});

test('972 תקין נשאר כמו שהוא', () => {
  assert.equal(normalizePhone('972501234567'), '+972501234567');
  assert.equal(normalizePhone('+97231234567'), '+97231234567');
});

test('מספר זר לא נפגע מהטיפול הישראלי', () => {
  assert.equal(normalizePhone('+14155552671'), '+14155552671');
  assert.equal(normalizePhone('0014155552671'), '+14155552671');
  assert.equal(normalizePhone('+442071234567'), '+442071234567');
});

test('972 קצר מדי → null ולא מספר חלקי', () => {
  assert.equal(normalizePhone('97250'), null);
  assert.equal(normalizePhone('+9720'), null);
});
