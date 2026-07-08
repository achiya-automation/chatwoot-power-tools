import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendBudget } from '../src/reconcile.js';

const HOUR = 3600000, MIN = 60000;

test('unlimited tier with no static cap → unlimited', () => {
  assert.equal(sendBudget({ tierCap: Infinity }), Infinity);
});

test('unlimited tier honours the static per-tick fallback', () => {
  assert.equal(sendBudget({ tierCap: Infinity, staticCap: 30 }), 30);
});

test('TIER_250 spreads over ~1h → ceil(250*60s/1h) = 5 per tick', () => {
  // 250 * 60000 / 3600000 = 4.17 → ceil = 5
  assert.equal(sendBudget({ tierCap: 250, used24h: 0, intervalMs: MIN, spreadWindowMs: HOUR }), 5);
});

test('TIER_1K spreads over ~1h → ceil(1000*60s/1h) = 17 per tick', () => {
  assert.equal(sendBudget({ tierCap: 1000, used24h: 0, intervalMs: MIN, spreadWindowMs: HOUR }), 17);
});

test('never exceeds the tier — 24h remaining caps the per-tick budget', () => {
  // only 3 conversations left in the window, though per-tick smoothing would allow 5
  assert.equal(sendBudget({ tierCap: 250, used24h: 247, intervalMs: MIN, spreadWindowMs: HOUR }), 3);
});

test('tier fully used → 0 (blocks further sends until the 24h window frees up)', () => {
  assert.equal(sendBudget({ tierCap: 250, used24h: 250, intervalMs: MIN, spreadWindowMs: HOUR }), 0);
  assert.equal(sendBudget({ tierCap: 250, used24h: 300, intervalMs: MIN, spreadWindowMs: HOUR }), 0);
});

test('at least 1 per tick while the tier has room (a small tier never starves)', () => {
  // 50 * 60000 / 86400000 = 0.035 → ceil would be <1; clamp to 1 so sending never stalls
  assert.equal(sendBudget({ tierCap: 50, used24h: 0, intervalMs: MIN, spreadWindowMs: 24 * HOUR }), 1);
});

test('higher tier ships faster — a larger backlog stays close to schedule', () => {
  // the whole point of the tier-aware budget: bigger tier → more per tick → less delay
  const t250 = sendBudget({ tierCap: 250, used24h: 0, intervalMs: MIN, spreadWindowMs: HOUR });
  const t10k = sendBudget({ tierCap: 10000, used24h: 0, intervalMs: MIN, spreadWindowMs: HOUR });
  assert.ok(t10k > t250);
});
