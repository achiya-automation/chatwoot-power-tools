import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../lib/csvParser.js';

test('parses simple comma CSV with headers', () => {
  const { headers, rows } = parseCsv('name,phone\nדנה,0501234567\nרון,0529876543');
  assert.deepEqual(headers, ['name', 'phone']);
  assert.deepEqual(rows, [['דנה', '0501234567'], ['רון', '0529876543']]);
});

test('strips UTF-8 BOM', () => {
  const { headers } = parseCsv('﻿name,email\nx,y@z.com');
  assert.deepEqual(headers, ['name', 'email']);
});

test('detects semicolon delimiter', () => {
  const { headers, rows } = parseCsv('שם;טלפון\nדנה;050');
  assert.deepEqual(headers, ['שם', 'טלפון']);
  assert.deepEqual(rows, [['דנה', '050']]);
});

test('handles quoted field with comma', () => {
  const { rows } = parseCsv('name,note\n"כהן, דנה","הערה, עם פסיק"');
  assert.deepEqual(rows[0], ['כהן, דנה', 'הערה, עם פסיק']);
});

test('handles quoted field with newline and escaped quote', () => {
  const { rows } = parseCsv('a,b\n"line1\nline2","say ""hi"""');
  assert.deepEqual(rows[0], ['line1\nline2', 'say "hi"']);
});

test('ignores trailing empty line', () => {
  const { rows } = parseCsv('a,b\n1,2\n');
  assert.equal(rows.length, 1);
});

test('a quote inside a field is text, as Hebrew writes דוא"ל and בע"מ', () => {
  const { headers, rows } = parseCsv('שם,דוא"ל,חברה\nרינה,r@x.com,רינה בע"מ\nדנה,"d@x.com","סטודיו ""דנה"""\n');
  assert.deepEqual(headers, ['שם', 'דוא"ל', 'חברה']);
  assert.deepEqual(rows, [['רינה', 'r@x.com', 'רינה בע"מ'], ['דנה', 'd@x.com', 'סטודיו "דנה"']]);
});

test('a quote inside a header does not hide the delimiter', () => {
  const { headers, rows } = parseCsv('דוא"ל;שם;טלפון\nd@x.com;דנה;050');
  assert.deepEqual(headers, ['דוא"ל', 'שם', 'טלפון']);
  assert.deepEqual(rows, [['d@x.com', 'דנה', '050']]);
});
