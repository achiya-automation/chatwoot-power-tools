import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImportLog } from '../lib/importLog.js';

test('summary counts by status', () => {
  const log = new ImportLog();
  log.add(1, 'דנה', 'created', 10, '');
  log.add(2, 'רון', 'updated', 11, '');
  log.add(3, 'גיל', 'failed', null, 'phone taken');
  const s = log.summary();
  assert.deepEqual(s, { created: 1, updated: 1, skipped: 0, failed: 1, total: 3 });
});

test('toCsv has header and escapes commas/quotes', () => {
  const log = new ImportLog();
  log.add(1, 'כהן, דנה', 'failed', null, 'said "no"');
  const csv = log.toCsv();
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'row,name,status,contact_id,reason');
  assert.equal(lines[1], '1,"כהן, דנה",failed,,"said ""no"""');
});

test('topError returns the most frequent failure reason', () => {
  const log = new ImportLog();
  log.add(1, 'א', 'failed', null, 'Email is invalid');
  log.add(2, 'ב', 'failed', null, 'Email is invalid');
  log.add(3, 'ג', 'failed', null, 'Phone taken');
  log.add(4, 'ד', 'created', 10, '');
  assert.deepEqual(log.topError(), { reason: 'Email is invalid', count: 2 });
});

test('topError is null when nothing failed', () => {
  const log = new ImportLog();
  log.add(1, 'א', 'created', 10, '');
  assert.equal(log.topError(), null);
});

// ── הזרקת נוסחאות ל-CSV (07.08.2026) ────────────────────────────────────────────
// שם איש קשר מגיע מהקובץ שהלקוח העלה. ערך שמתחיל ב-‎= + - @ מתפרש כנוסחה כשפותחים
// את הדוח באקסל/Sheets — גם בקובץ שיורד וגם בצרופה שנשלחת במייל.
test('ערך שמתחיל בסימן נוסחה מנוטרל בגרש', () => {
  const log = new ImportLog();
  log.add({}, '=HYPERLINK("http://evil","x")', 'created', '');
  log.add({}, '+1234', 'created', '');
  log.add({}, '-5', 'created', '');
  log.add({}, '@SUM(A1)', 'created', '');
  const csv = log.toCsv();
  assert.ok(csv.includes(`"'=HYPERLINK`), 'נוסחת = מנוטרלת');
  assert.ok(csv.includes("'+1234"), 'נוסחת + מנוטרלת');
  assert.ok(csv.includes("'-5"), 'נוסחת - מנוטרלת');
  assert.ok(csv.includes("'@SUM(A1)"), 'נוסחת @ מנוטרלת');
});

test('שם רגיל לא משתנה', () => {
  const log = new ImportLog();
  log.add({}, 'ישראל ישראלי', 'created', '');
  assert.ok(log.toCsv().includes('ישראל ישראלי'));
  assert.ok(!log.toCsv().includes("'ישראל"));
});
