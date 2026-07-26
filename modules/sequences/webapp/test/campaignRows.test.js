import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, countRows, filterRows, statusKeyOf, STATUS_KEYS } from '../src/lib/campaignRows.js';

const DETAIL = {
  recipients: [
    { contact_name: 'נקרא והגיב', phone: '+972500000001', status: 2, attempt_count: 1, sent_at: '2026-07-20 10:00', conversation_display_id: 11, replied: true, reply_content: 'שלח לי', replied_at: '2026-07-20 11:00' },
    { contact_name: 'נקרא בלי תגובה', phone: '+972500000002', status: 2, attempt_count: 1, sent_at: '2026-07-20 10:01', conversation_display_id: 12, replied: false },
    { contact_name: 'נמסר', phone: '+972500000003', status: 1, attempt_count: 2, sent_at: '2026-07-20 10:02', conversation_display_id: 13, replied: false },
    { contact_name: 'נשלח', phone: '+972500000004', status: 0, attempt_count: 1, sent_at: '2026-07-20 10:03', replied: false },
    { contact_name: 'נכשל', phone: '+972500000005', status: 3, attempt_count: 3, sent_at: '2026-07-20 10:04', error_title: '131049: blocked', replied: false },
    { contact_name: 'ללא סטטוס', phone: '+972500000006', status: null, replied: false },
  ],
  not_sent: [{ contact_name: 'לא נוסה', phone: '+972500000007' }],
};

test('statusKeyOf: כל ערך סטטוס ממופה למצב סופי אחד; לא-מספר נופל ל-pending', () => {
  assert.equal(statusKeyOf(0), 'sent');
  assert.equal(statusKeyOf(1), 'delivered');
  assert.equal(statusKeyOf(2), 'read');
  assert.equal(statusKeyOf(3), 'failed');
  assert.equal(statusKeyOf(null), 'pending');
  assert.equal(statusKeyOf(undefined), 'pending');
});

test('buildRows: מאחד נמענים + לא-נוסו, ושומר על כל השדות', () => {
  const rows = buildRows(DETAIL);
  assert.equal(rows.length, 7);
  assert.equal(rows.at(-1).statusKey, 'notsent');
  assert.equal(rows.at(-1).attempts, 0);
  const first = rows[0];
  assert.equal(first.statusKey, 'read');
  assert.equal(first.replied, true);
  assert.equal(first.reply_content, 'שלח לי');
  assert.equal(first.conversation_display_id, 11);
  // סיבת כשל נשמרת רק לשורה שנכשלה — כדי שלא תיגרר לשורה שנמסרה אחרי retry
  assert.equal(rows[4].error_title, '131049: blocked');
  assert.equal(rows[2].error_title, '');
});

test('buildRows: קלט ריק/חסר לא מפוצץ', () => {
  assert.deepEqual(buildRows(), []);
  assert.deepEqual(buildRows({}), []);
  assert.deepEqual(buildRows({ recipients: null, not_sent: null }), []);
});

test('countRows: הקטגוריות זרות וסכומן = מספר השורות', () => {
  const rows = buildRows(DETAIL);
  const counts = countRows(rows);
  assert.equal(counts.read, 2);
  assert.equal(counts.delivered, 1);
  assert.equal(counts.sent, 1);
  assert.equal(counts.failed, 1);
  assert.equal(counts.pending, 1);
  assert.equal(counts.notsent, 1);
  assert.equal(STATUS_KEYS.reduce((sum, k) => sum + counts[k], 0), rows.length);
  assert.equal(counts.replied, 1);
  assert.equal(counts.noreply, 6);
  assert.equal(counts.replied + counts.noreply, rows.length);
});

test('filterRows: בחירה ריקה = הכל; שני הצירים מצטלבים', () => {
  const rows = buildRows(DETAIL);
  assert.equal(filterRows(rows, {}).length, 7);
  assert.equal(filterRows(rows, { statuses: new Set() }).length, 7);
  assert.equal(filterRows(rows, { statuses: new Set(['failed']) }).length, 1);
  assert.equal(filterRows(rows, { statuses: new Set(['read', 'failed']) }).length, 3);
  assert.equal(filterRows(rows, { reply: 'yes' }).length, 1);
  assert.equal(filterRows(rows, { reply: 'no' }).length, 6);
  // חיתוך: נקראו ולא הגיבו
  const readNoReply = filterRows(rows, { statuses: new Set(['read']), reply: 'no' });
  assert.equal(readNoReply.length, 1);
  assert.equal(readNoReply[0].contact_name, 'נקרא בלי תגובה');
  // חיתוך ריק הוא תוצאה חוקית, לא שגיאה
  assert.equal(filterRows(rows, { statuses: new Set(['notsent']), reply: 'yes' }).length, 0);
});

