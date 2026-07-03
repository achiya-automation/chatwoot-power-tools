import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXlsxAoA } from '../lib/xlsxReader.js';

test('splits array-of-arrays into headers + string rows', () => {
  const { headers, rows } = parseXlsxAoA([['שם', 'טלפון'], ['דנה', 501234567], ['רון', '0529']]);
  assert.deepEqual(headers, ['שם', 'טלפון']);
  assert.deepEqual(rows, [['דנה', '501234567'], ['רון', '0529']]);
});

test('pads short rows to header length', () => {
  const { rows } = parseXlsxAoA([['a', 'b', 'c'], ['1']]);
  assert.deepEqual(rows[0], ['1', '', '']);
});

test('skips fully empty rows', () => {
  const { rows } = parseXlsxAoA([['a'], [''], ['x']]);
  assert.deepEqual(rows, [['x']]);
});
