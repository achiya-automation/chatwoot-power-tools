import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateFor, isNoSendNow } from '../src/schedule.js';

const SEQ = { skip_shabbat: true, quiet_start: '21:00:00', quiet_end: '08:00:00' };

/** 21:30 שעון ישראל ביום שני = 18:30 UTC. בתוך שעות השקט. */
const MONDAY_2130 = new Date('2026-07-13T18:30:00Z');
/** מוצאי שבת עוד לא יצא: שבת 13:00 שעון ישראל. */
const SATURDAY_1300 = new Date('2026-07-11T10:00:00Z');
const SHABBAT = [{ starts_at: '2026-07-10T16:00:00Z', ends_at: '2026-07-11T17:30:00Z' }];

test('⭐ ליד חדש ב-21:30 — נשלח מיד, שעות השקט לא חוסמות', () => {
  const gate = gateFor(SEQ, 1, MONDAY_2130, []);
  assert.equal(isNoSendNow(gate), false, 'שלב 1 חייב לעבור בלילה — הליד מחכה לתשובה עכשיו');
});

test('שלב 2 באותה שעה — כן נחסם. הוא מעקב, לא תשובה', () => {
  const gate = gateFor(SEQ, 2, MONDAY_2130, []);
  assert.equal(isNoSendNow(gate), true, 'הודעת מעקב ב-21:30 חייבת לחכות לבוקר');
});

test('⛔ שבת — גם ליד חדש נחסם. לעולם.', () => {
  const gate = gateFor(SEQ, 1, SATURDAY_1300, SHABBAT);
  assert.equal(isNoSendNow(gate), true, 'עקיפת שעות שקט אסור שתפתח חור בשבת');
});

test('ליד חדש באמצע היום — עובר (שפוי)', () => {
  const noon = new Date('2026-07-13T09:00:00Z');          // 12:00 שעון ישראל
  assert.equal(isNoSendNow(gateFor(SEQ, 1, noon, [])), false);
  assert.equal(isNoSendNow(gateFor(SEQ, 5, noon, [])), false);
});
