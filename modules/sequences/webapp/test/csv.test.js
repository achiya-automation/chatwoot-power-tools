import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvField, csvRow } from '../src/lib/csv.js';

test('csvField: plain values are just quoted', () => {
  assert.equal(csvField('דנה כהן'), '"דנה כהן"');
  assert.equal(csvField(42), '"42"');
  assert.equal(csvField(null), '""');
});

test('csvField: doubles embedded quotes (RFC 4180)', () => {
  assert.equal(csvField('א"ב'), '"א""ב"');
});

test('csvField: formula-leading characters get a quote prefix (CWE-1236)', () => {
  assert.equal(csvField('=SUM(A1:A9)'), '"\'=SUM(A1:A9)"');
  assert.equal(csvField('+972500000001'), '"\'+972500000001"');
  assert.equal(csvField('-1'), '"\'-1"');
  assert.equal(csvField('@cmd'), '"\'@cmd"');
  assert.equal(csvField('\tx'), '"\'\tx"');
});

test('csvField: leading carriage return is escaped too (the 5th OWASP leading char)', () => {
  assert.equal(csvField('\r=1+1'), '"\'\r=1+1"');
});

test('csvRow: joins escaped fields with commas', () => {
  assert.equal(csvRow(['a', '=b']), '"a","\'=b"');
});
