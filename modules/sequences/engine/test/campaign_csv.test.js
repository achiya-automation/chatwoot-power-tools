import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, filterRows, parseFilter, toCsv, csvFileName, errorLabel, statusKeyOf } from '../src/campaignCsv.js';

const DETAIL = {
  campaign: { id: 5, title: 'קמפיין 20/7/26', created_at: '2026-07-20 18:26' },
  recipients: [
    { contact_name: 'מגיבה', phone: '+972500000001', status: 2, attempt_count: 1, sent_at: '2026-07-20 10:00', conversation_display_id: 11, replied: true, reply_content: 'שלח לי', replied_at: '2026-07-21 08:15' },
    { contact_name: 'שותקת', phone: '+972500000002', status: 1, attempt_count: 2, sent_at: '2026-07-20 10:01', conversation_display_id: 12, replied: false },
    { contact_name: 'נכשלה', phone: '+972500000003', status: 3, attempt_count: 3, sent_at: '2026-07-20 10:02', error_title: '131049: This message was not delivered', replied: false },
  ],
  not_sent: [{ contact_name: 'לא נוסתה', phone: '+972500000004' }],
};

test('statusKeyOf + buildRows: איחוד נמענים ולא-נוסו עם statusKey סופי', () => {
  const rows = buildRows(DETAIL);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.statusKey), ['read', 'delivered', 'failed', 'notsent']);
  assert.equal(statusKeyOf(null), 'pending');
});

test('parseFilter: מסנן ערכים לא מוכרים ומאמת reply', () => {
  const f = parseFilter({ statuses: 'read,bogus,notsent', reply: 'yes' });
  assert.deepEqual([...f.statuses].sort(), ['notsent', 'read']);
  assert.equal(f.reply, 'yes');
  assert.equal(parseFilter({ reply: 'whatever' }).reply, 'all');
  assert.equal(parseFilter({}).statuses.size, 0);
});

test('filterRows: שני הצירים מצטלבים; ריק = הכל', () => {
  const rows = buildRows(DETAIL);
  assert.equal(filterRows(rows, parseFilter({})).length, 4);
  assert.equal(filterRows(rows, parseFilter({ reply: 'yes' })).length, 1);
  assert.equal(filterRows(rows, parseFilter({ reply: 'no' })).length, 3);
  assert.equal(filterRows(rows, parseFilter({ statuses: 'failed,notsent' })).length, 2);
  assert.equal(filterRows(rows, parseFilter({ statuses: 'read', reply: 'no' })).length, 0);
});

test('toCsv: BOM + כותרות + תגובה + סיבת כשל מתורגמת + קישור שיחה', () => {
  const csv = toCsv(buildRows(DETAIL), { locale: 'he', origin: 'https://cw.example', accountId: 1 });
  assert.ok(csv.startsWith('﻿'), 'BOM');
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 5);
  assert.match(lines[0], /"שם","טלפון","סטטוס","סיבה"/);
  assert.match(lines[1], /"כן","שלח לי","2026-07-21 08:15","https:\/\/cw\.example\/app\/accounts\/1\/conversations\/11"/);
  assert.match(lines[3], /Meta חסמה את ההודעה/);
  assert.match(lines[4], /"לא נוצר ניסיון שליחה"/);
});

test('toCsv: מגן הזרקת-נוסחאות על שם מוואטסאפ', () => {
  const csv = toCsv(buildRows({ recipients: [{ contact_name: '=HYPERLINK("x")', phone: '+9725', status: 2 }] }), {});
  assert.match(csv, /"'=HYPERLINK/);
});

test('errorLabel: קוד מוכר מתורגם, לא מוכר נופל לטקסט הגולמי', () => {
  assert.match(errorLabel('131026: something', 'he'), /אינו בוואטסאפ/);
  assert.match(errorLabel('131026: something', 'en'), /not be on WhatsApp/);
  assert.equal(errorLabel('999999: strange', 'he'), '999999: strange');
  assert.equal(errorLabel('', 'he'), '');
});

test('csvFileName: כותרת + תאריך, ומסומן כשמסונן', () => {
  assert.equal(csvFileName(DETAIL.campaign, { locale: 'he' }), 'דוח-קמפיין-20-7-26-2026-07-20.csv');
  assert.equal(csvFileName(DETAIL.campaign, { locale: 'he', filtered: true }), 'דוח-קמפיין-20-7-26-2026-07-20-מסונן.csv');
  assert.equal(csvFileName({ id: 9 }, { locale: 'en', filtered: true }), 'report-campaign-9-9-filtered.csv');
});
