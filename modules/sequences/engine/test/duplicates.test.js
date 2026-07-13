/**
 * duplicates.test.js — הכלל שהלקוחה חיה לפיו: לעולם לא לקבל את אותה הודעה פעמיים.
 *
 * הרקע: `enrollments.current_step` הוא מספר, והמספרים ברצף זזים. כשהוסיפו שלב באמצע
 * הרצף של REDACTED REDACTED, כל מי שהיה אחריו התחיל להצביע על הודעה שכבר קיבל — **35 לקוחות
 * קיבלו את אותה הודעה פעמיים**. השומר בנתיב השליחה משווה לפי *משפחת התבנית*, כי
 * תאומה טרייה (`_v2`/`_v3`) היא אותו תוכן במעטפה חדשה — לא הודעה חדשה.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateFamily } from '../src/reconcile.js';

test('templateFamily: תאומה היא אותו תוכן — לא הודעה חדשה', () => {
  // כל הווריאציות של אותה הודעה חייבות להתמפות לאותו מפתח
  for (const n of ['REDACTED', 'REDACTED', 'REDACTED']) {
    assert.equal(templateFamily(n), 'REDACTED', n);
  }
  for (const n of ['REDACTED', 'REDACTED', 'REDACTED']) {
    assert.equal(templateFamily(n), 'REDACTED', n);
  }
  assert.equal(templateFamily('REDACTED'), 'REDACTED');
});

test('templateFamily: הודעות שונות נשארות שונות — בלי התנגשויות', () => {
  assert.notEqual(templateFamily('REDACTED'), templateFamily('REDACTED'));
  assert.notEqual(templateFamily('REDACTED'), templateFamily('REDACTED'));
  assert.notEqual(templateFamily('REDACTED'), templateFamily('REDACTED'));
  // מספר דו-ספרתי אינו סיומת גרסה
  assert.equal(templateFamily('REDACTED'), 'REDACTED');
});

test('templateFamily: קלט ריק לא מפיל', () => {
  assert.equal(templateFamily(null), '');
  assert.equal(templateFamily(undefined), '');
  assert.equal(templateFamily(''), '');
});
