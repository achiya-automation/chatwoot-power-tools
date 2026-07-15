import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidLabelTitle, normalizeLabelTitle } from '../lib/labelTitle.js';

test('normalizes spaces in a Hebrew label title to underscores', () => {
  assert.equal(
    normalizeLabelTitle('2026 ריבקין סטרני טרם טרם'),
    '2026_ריבקין_סטרני_טרם_טרם',
  );
});

test('normalizes unsupported punctuation and repeated separators', () => {
  assert.equal(normalizeLabelTitle('  /לקוחות  חדשים!  '), 'לקוחות_חדשים');
});

test('validates titles using Chatwoot label rules', () => {
  assert.equal(isValidLabelTitle('2026_לקוחות-חדשים'), true);
  assert.equal(isValidLabelTitle('לקוחות חדשים'), false);
  assert.equal(isValidLabelTitle('_לקוחות'), false);
  assert.equal(isValidLabelTitle('א'), false);
});
