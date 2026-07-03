import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryErrorLabel, deliveryErrorChip, deliveryErrorAction } from '../../webapp/src/lib/deliveryError.js';

test('deliveryErrorLabel: known code → Hebrew explanation', () => {
  assert.match(deliveryErrorLabel('131026', '131026: Message undeliverable'), /לא נמסרה/);
  assert.match(deliveryErrorLabel('131049', null), /מעורבות תקינה/);
});

test('deliveryErrorLabel: unknown code → falls back to raw title', () => {
  assert.equal(deliveryErrorLabel('999999', '999999: weird thing'), '999999: weird thing');
});

test('deliveryErrorLabel: no code and no title → generic', () => {
  assert.equal(deliveryErrorLabel(null, null), 'המסירה נכשלה');
});

test('deliveryErrorChip: with/without code', () => {
  assert.equal(deliveryErrorChip('131026'), 'נתקע · 131026');
  assert.equal(deliveryErrorChip(null), 'נתקע');
});

test('deliveryErrorAction: known code → actionable hint; unknown → generic', () => {
  assert.match(deliveryErrorAction('131049'), /UTILITY/);       // marketing cap → suggest UTILITY
  assert.match(deliveryErrorAction('131053'), /HTTPS/);          // media error → fix the URL
  assert.match(deliveryErrorAction('999999'), /הסירו מהרצף/);   // unknown → generic next step
});
