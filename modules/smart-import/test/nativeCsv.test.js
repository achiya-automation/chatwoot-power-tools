import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toNativeCsv } from '../lib/nativeCsv.js';
import { parseCsv } from '../lib/csvParser.js';

test('toNativeCsv: standard headers for Chatwoot, everything else under cwpt:', () => {
  const csv = toNativeCsv([
    { name: 'דנה כהן', phone_number: '+972527654321', additional_attributes: { company_name: 'סטודיו, דנה', country: 'ישראל' },
      custom_attributes: { 'חברה': 'X "Y"' }, __row: 2 },
    { email: 'a@b.co', __phoneRaw: '052-1', __row: 4 },
  ], 'ייבוא-נובמבר');
  const { headers, rows } = parseCsv(csv);
  assert.deepEqual(headers, ['name', 'email', 'identifier', 'phone_number', 'cwpt:company_name', 'cwpt:country',
    'cwpt:custom:חברה', 'labels', 'cwpt:row', 'cwpt:phone_raw']);
  assert.deepEqual(rows[0], ['דנה כהן', '', '', '+972527654321', 'סטודיו, דנה', 'ישראל', 'X "Y"', 'ייבוא-נובמבר', '2', '']);
  assert.deepEqual(rows[1], ['', 'a@b.co', '', '', '', '', '', 'ייבוא-נובמבר', '4', '052-1']);
});

test('toNativeCsv: no label column without a label, no raw-phone column without bad phones', () => {
  const { headers } = parseCsv(toNativeCsv([{ name: 'A', __row: 2 }]));
  assert.deepEqual(headers, ['name', 'email', 'identifier', 'phone_number', 'cwpt:row']);
});

test('toNativeCsv: a labels column from the file keeps its titles, next to the import label', () => {
  const { headers, rows } = parseCsv(toNativeCsv([{ name: 'A', __labels: 'vip, לקוחות', __row: 2 }, { name: 'B', __row: 3 }], 'ייבוא'));
  assert.deepEqual(headers, ['name', 'email', 'identifier', 'phone_number', 'labels', 'cwpt:row']);
  assert.deepEqual(rows.map((r) => r[4]), ['vip, לקוחות,ייבוא', 'ייבוא']);
  assert.deepEqual(parseCsv(toNativeCsv([{ name: 'A', __labels: 'vip', __row: 2 }])).rows[0][4], 'vip');
});
