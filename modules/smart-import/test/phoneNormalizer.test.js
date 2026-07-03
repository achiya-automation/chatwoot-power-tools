import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../lib/phoneNormalizer.js';

test('local mobile 05X → +9725X', () => {
  assert.equal(normalizePhone('0501234567'), '+972501234567');
});
test('strips spaces and dashes', () => {
  assert.equal(normalizePhone('050-123 4567'), '+972501234567');
});
test('already +972 stays', () => {
  assert.equal(normalizePhone('+972501234567'), '+972501234567');
});
test('972 without plus gets plus', () => {
  assert.equal(normalizePhone('972501234567'), '+972501234567');
});
test('00 international prefix → +', () => {
  assert.equal(normalizePhone('00972501234567'), '+972501234567');
});
test('9 digits without leading zero → +972', () => {
  assert.equal(normalizePhone('501234567'), '+972501234567');
});
test('foreign + number stays', () => {
  assert.equal(normalizePhone('+14155552671'), '+14155552671');
});
test('empty / junk → null', () => {
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('abc'), null);
  assert.equal(normalizePhone('123'), null);
});
test('Israeli landline 02-XXXXXXX → +97221234567', () => {
  assert.equal(normalizePhone('02-1234567'), '+97221234567');
});
test('Israeli landline 03-XXXXXXX → +97231234567', () => {
  assert.equal(normalizePhone('03-1234567'), '+97231234567');
});
test('Israeli landline with spaces 04 1234567 → +97241234567', () => {
  assert.equal(normalizePhone('04 1234567'), '+97241234567');
});
