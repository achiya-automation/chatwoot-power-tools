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
