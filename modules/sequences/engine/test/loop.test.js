/**
 * loop.test.js — השומר מפני סבבים שנערמים זה על זה.
 *
 * Run: node --test test/loop.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLoop } from '../src/loop.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('סבב איטי לא מאפשר לסבב הבא להיכנס מעליו', async () => {
  let concurrent = 0;
  let peak = 0;
  let starts = 0;
  const warns = [];

  const loop = startLoop(10, '[test]', async () => {
    starts += 1;
    concurrent += 1;
    peak = Math.max(peak, concurrent);
    await sleep(120); // סבב שנמשך פי 12 מהמרווח — בדיוק המקרה של בריכה תפוסה
    concurrent -= 1;
  }, { warn: (m) => warns.push(m) });

  await sleep(300);
  clearInterval(loop.timer);

  assert.equal(peak, 1, 'לא נכנסו שני סבבים במקביל');
  assert.ok(starts <= 3, `לכל היותר 3 סבבים ב-300ms (התחילו ${starts})`);
  // בלי השומר היו כאן ~30 סבבים; עם השומר הדילוגים מדווחים פעם אחת לכל סבב איטי.
  assert.ok(warns.length >= 1 && warns.every((m) => /skipped \d+ cycle/.test(m)),
    `דיווח דילוגים מצטבר: ${JSON.stringify(warns)}`);
});

test('סבב שנכשל משחרר את הנעילה ומדווח בפורמט שאפשר לגרפ', async () => {
  const errors = [];
  let runs = 0;

  const loop = startLoop(10, '[presence]', async () => {
    runs += 1;
    throw new Error('timeout exceeded when trying to connect');
  }, { error: (...a) => errors.push(a.join(' ')) });

  await sleep(60);
  clearInterval(loop.timer);

  assert.ok(runs > 1, 'כישלון לא נועל את הלולאה לתמיד');
  assert.ok(errors[0].startsWith('[presence] tick error: timeout exceeded'),
    `פורמט הלוג נשמר: ${errors[0]}`);
});

test('isRunning משקף סבב באוויר — הכיבוי המסודר נשען עליו', async () => {
  let release;
  const loop = startLoop(10, '[drip]', () => new Promise((r) => { release = r; }));

  assert.equal(loop.isRunning(), false, 'לפני הטיק הראשון');
  await sleep(30);
  assert.equal(loop.isRunning(), true, 'בזמן טיק תקוע');

  clearInterval(loop.timer); // עוצרים את השעון קודם, אחרת ייכנס סבב חדש ונמדוד אותו
  release();
  await sleep(5);
  assert.equal(loop.isRunning(), false, 'אחרי שהטיק הסתיים');
});
