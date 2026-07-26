import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, countRows, filterRows, rowsToCsv, statusKeyOf, STATUS_KEYS } from '../src/lib/campaignRows.js';

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

const LABELS = {
  name: 'שם', phone: 'טלפון', status: 'סטטוס', reason: 'סיבה', attempts: 'ניסיונות', when: 'זמן',
  replied: 'הגיב', replyText: 'תוכן', replyWhen: 'זמן תגובה', conversation: 'שיחה',
  yes: 'כן', no: 'לא', noAttempt: 'לא נוצר ניסיון שליחה',
  statusLabel: (key) => `st:${key}`,
  errorLabel: (raw) => `err:${raw}`,
  conversationUrl: (id) => `https://cw.example/app/accounts/1/conversations/${id}`,
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

test('rowsToCsv: כותרות + BOM + כל העמודות, כולל תגובה וקישור לשיחה', () => {
  const rows = filterRows(buildRows(DETAIL), { statuses: new Set(['read']) });
  const csv = rowsToCsv(rows, LABELS);
  assert.ok(csv.startsWith('﻿'), 'BOM כדי ש-Excel יפתח עברית');
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 3); // כותרת + 2 שורות
  assert.equal(lines[0], '"שם","טלפון","סטטוס","סיבה","ניסיונות","זמן","הגיב","תוכן","זמן תגובה","שיחה"'.replace(/^/, '﻿'));
  assert.match(lines[1], /"כן"/);
  assert.match(lines[1], /"שלח לי"/);
  assert.match(lines[1], /conversations\/11/);
  assert.match(lines[2], /"לא"/);
});

test('rowsToCsv: לא-נוסה מקבל סיבה מפורשת, ושורת כשל מקבלת הסבר מתורגם', () => {
  const rows = buildRows(DETAIL);
  const csv = rowsToCsv(rows, LABELS);
  assert.match(csv, /"st:notsent","לא נוצר ניסיון שליחה"/);
  assert.match(csv, /"st:failed","err:131049: blocked"/);
});

test('rowsToCsv: מגן הזרקת-נוסחאות עדיין חל על שם מהוואטסאפ', () => {
  const rows = buildRows({ recipients: [{ contact_name: '=HYPERLINK("http://evil")', phone: '+972500000001', status: 2 }] });
  const csv = rowsToCsv(rows, LABELS);
  assert.match(csv, /"'=HYPERLINK/);
});
