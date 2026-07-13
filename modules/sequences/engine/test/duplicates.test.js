/**
 * duplicates.test.js — הכלל שהלקוחה חיה לפיו: לעולם לא לקבל את אותה הודעה פעמיים.
 *
 * הרקע: `enrollments.current_step` הוא מספר, והמספרים ברצף זזים. כשהוסיפו שלב באמצע
 * הרצף של בננה בוק, כל מי שהיה אחריו התחיל להצביע על הודעה שכבר קיבל — **35 לקוחות
 * קיבלו את אותה הודעה פעמיים**. השומר בנתיב השליחה משווה לפי *משפחת התבנית*, כי
 * תאומה טרייה (`_v2`/`_v3`) היא אותו תוכן במעטפה חדשה — לא הודעה חדשה.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateFamily } from '../src/reconcile.js';

test('templateFamily: תאומה היא אותו תוכן — לא הודעה חדשה', () => {
  // כל הווריאציות של אותה הודעה חייבות להתמפות לאותו מפתח
  for (const n of ['bb_new_08', 'bb_new_08_v2', 'bb_new_08_v3']) {
    assert.equal(templateFamily(n), 'bb_new_08', n);
  }
  for (const n of ['bb_new_01', 'bb_new_01_btn', 'bb_new_01_btn_v3']) {
    assert.equal(templateFamily(n), 'bb_new_01', n);
  }
  assert.equal(templateFamily('bb_new_video_followup_btn_v3'), 'bb_new_video_followup');
});

test('templateFamily: הודעות שונות נשארות שונות — בלי התנגשויות', () => {
  assert.notEqual(templateFamily('bb_new_01_btn_v3'), templateFamily('bb_new_10_v3'));
  assert.notEqual(templateFamily('bb_new_08_v3'), templateFamily('bb_new_09_v3'));
  assert.notEqual(templateFamily('bb_existing_02'), templateFamily('bb_postshoot_02'));
  // מספר דו-ספרתי אינו סיומת גרסה
  assert.equal(templateFamily('bb_new_21_v3'), 'bb_new_21');
});

test('templateFamily: קלט ריק לא מפיל', () => {
  assert.equal(templateFamily(null), '');
  assert.equal(templateFamily(undefined), '');
  assert.equal(templateFamily(''), '');
});

test('templateFamily: עותק שריפה הוא אותו תוכן — לא הודעה חדשה', () => {
  // מאגר השריפה: נמענת שמטא חסמה מקבלת עותק נפרד של אותה הודעה, כדי לא לשרוף את
  // התבנית שהלידים החדשים נוחתים עליה. אבל זה **אותו טקסט** — ולכן שומר הכפילויות
  // חייב לזהות את זה, אחרת לקוחה שכבר קיבלה את ההודעה תקבל אותה שוב מהעותק.
  assert.equal(templateFamily('bb_new_01_burn1'), 'bb_new_01');
  assert.equal(templateFamily('bb_new_01_btn_v4'), 'bb_new_01');
  assert.equal(templateFamily('bb_new_01_burn1'), templateFamily('bb_new_01_btn_v4'));
  assert.equal(templateFamily('bb_new_video_followup_burn1'), 'bb_new_video_followup');
  assert.equal(templateFamily('bb_new_video_followup_burn1'),
               templateFamily('bb_new_video_followup_btn_v3'));
  // עותקי שריפה שונים של הודעות שונות נשארים שונים
  assert.notEqual(templateFamily('bb_new_09_burn1'), templateFamily('bb_new_10_burn1'));
});
