/**
 * rotate.test.js — התבנית היא מתכלה, והמנוע מחליף אותה בעצמו.
 *
 * למה זו לא "תחזוקה": נמענת שמטא חסמה מקבלת 69% בתבנית בתולית ו-14.5% אחרי 10 כישלונות.
 * ההידרדרות מהירה מכדי שאדם יעקוב אחריה, והשבוע שבו אף אחד לא מסתכל — הלקוח צונח
 * ל-14% ומאשים את המערכת.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextVersion, _sameFamily } from '../src/rotate.js';
import { templateFamily } from '../src/reconcile.js';

test('nextVersion: מעלה גרסה בשתי הסדרות — הרגילה ומאגר השריפה', () => {
  assert.equal(nextVersion('bb_new_01_btn_v4'), 'bb_new_01_btn_v5');
  assert.equal(nextVersion('bb_new_02_burn1'),  'bb_new_02_burn2');
  assert.equal(nextVersion('bb_new_01_burn9'),  'bb_new_01_burn10');   // לא לקטוע ב-9
  assert.equal(nextVersion('bb_postshoot_01'),  'bb_postshoot_01_v2'); // בלי סיומת → פותח סדרה
});

test('nextVersion: הרוטציה לא שוברת את שומר הכפילויות', () => {
  // ⚠️ אם הגרסה החדשה תיפול למשפחה אחרת, שומר הכפילויות יחשוב שזו הודעה חדשה —
  // והלקוחה תקבל את אותה הודעה פעמיים. זה הטסט שמונע את זה.
  for (const n of ['bb_new_01_btn_v4', 'bb_new_02_burn1', 'bb_new_07_v2', 'bb_new_21_v3']) {
    assert.ok(_sameFamily(n, nextVersion(n)), `${n} → ${nextVersion(n)} עזב את המשפחה`);
  }
  // ועותק שריפה וגרסה רגילה של אותה הודעה — אותה משפחה
  assert.equal(templateFamily('bb_new_01_burn2'), templateFamily('bb_new_01_btn_v5'));
});

test('nextVersion: לא מתבלבל ממספר בשם ההודעה', () => {
  // bb_new_10 היא ההודעה העשירית — לא "גרסה 10". הסיומת היא _v/_burn בלבד.
  assert.equal(nextVersion('bb_new_10_v3'), 'bb_new_10_v4');
  assert.equal(templateFamily(nextVersion('bb_new_10_v3')), 'bb_new_10');
});
