import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost } from '../src/lib/campaignCost.js';

test('estimateCost: marketing × 100 (Israel USD rate)', () => {
  const r = estimateCost({ category: 'MARKETING', sent: 100 });
  assert.equal(r.currency, 'USD');
  assert.equal(r.total, 3.53); // 0.0353 × 100
  assert.equal(r.updated, '2026-07-09');
});

test('estimateCost: unknown category → 0 (safe)', () => {
  assert.equal(estimateCost({ category: 'FOO', sent: 10 }).total, 0);
});

test('estimateCost: zero sent → 0', () => {
  assert.equal(estimateCost({ category: 'MARKETING', sent: 0 }).total, 0);
});
