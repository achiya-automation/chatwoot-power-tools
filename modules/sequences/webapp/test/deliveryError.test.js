import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '../src/i18n.js';
import { deliveryErrorLabel, deliveryErrorChip, deliveryErrorAction } from '../src/lib/deliveryError.js';

// The Hebrew LABELS/ACTIONS are covered by engine/test/delivery_error.test.js; here we
// lock the English path. afterEach restores Hebrew so a stray 'en' state never leaks.
afterEach(() => setLocale('he'));

// ── Hebrew default sanity: node starts in 'he', and the afterEach reset holds ──
test('deliveryErrorLabel defaults to Hebrew when the locale is untouched', () => {
  assert.match(deliveryErrorLabel('131026', null), /לא נמסרה/);
});

// ── English: deliveryErrorLabel ──
test('deliveryErrorLabel en: known code → English explanation', () => {
  setLocale('en');
  assert.match(deliveryErrorLabel('131026', '131026: Message undeliverable'), /was not delivered/);
  assert.match(deliveryErrorLabel('131049', null), /healthy engagement/);
});

test('deliveryErrorLabel en: unknown code → raw title; no code + no title → generic', () => {
  setLocale('en');
  assert.equal(deliveryErrorLabel('999999', '999999: weird thing'), '999999: weird thing');
  assert.equal(deliveryErrorLabel(null, null), 'Delivery failed');
});

// ── English: deliveryErrorChip ──
test('deliveryErrorChip en: with/without code', () => {
  setLocale('en');
  assert.equal(deliveryErrorChip('131026'), 'Stuck · 131026');
  assert.equal(deliveryErrorChip(null), 'Stuck');
});

// ── English: deliveryErrorAction ──
test('deliveryErrorAction en: known code → actionable hint; unknown → generic', () => {
  setLocale('en');
  assert.match(deliveryErrorAction('131049'), /UTILITY/); // marketing cap → suggest UTILITY
  assert.match(deliveryErrorAction('131053'), /HTTPS/); // media error → fix the URL
  assert.match(deliveryErrorAction('999999'), /remove them from the sequence/); // unknown → generic
});
