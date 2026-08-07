import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendBudget } from '../src/lib/sendBudget.js';

test('sendBudget: plain cap and usage', () => {
  const b = sendBudget({ used_24h: 312, cap: 2000, inbox: { id: 21, name: 'Sales', phone: '+972501234567' } });
  assert.equal(b.used, 312);
  assert.equal(b.cap, 2000);
  assert.equal(b.remaining, 1688);
  assert.equal(b.unlimited, false);
  assert.deepEqual(b.inbox, { id: 21, name: 'Sales', phone: '+972501234567' });
});

test('sendBudget: cap -1 is unlimited — no remaining number is claimed', () => {
  const b = sendBudget({ used_24h: 5000, cap: -1, inbox: null });
  assert.equal(b.unlimited, true);
  assert.equal(b.remaining, null);
  assert.equal(b.used, 5000);
});

test('sendBudget: remaining never goes negative (sends outside the engine can overshoot)', () => {
  assert.equal(sendBudget({ used_24h: 2400, cap: 2000 }).remaining, 0);
});

test('sendBudget: exactly at the cap → 0 left', () => {
  assert.equal(sendBudget({ used_24h: 2000, cap: 2000 }).remaining, 0);
});

test('sendBudget: nothing sent yet → the whole cap is left', () => {
  const b = sendBudget({ used_24h: 0, cap: 1000 });
  assert.equal(b.used, 0);
  assert.equal(b.remaining, 1000);
});

test('sendBudget: missing usage block (older engine) → null, screen stays as it was', () => {
  for (const bad of [undefined, null, '', 0, 'usage']) assert.equal(sendBudget(bad), null);
});

test('sendBudget: unusable cap → null rather than a made-up number', () => {
  assert.equal(sendBudget({ used_24h: 12 }), null);
  assert.equal(sendBudget({ used_24h: 12, cap: null }), null);
  assert.equal(sendBudget({ used_24h: 12, cap: 'many' }), null);
});

test('sendBudget: numeric strings from the wire are accepted', () => {
  const b = sendBudget({ used_24h: '312', cap: '2000' });
  assert.equal(b.used, 312);
  assert.equal(b.remaining, 1688);
});

test('sendBudget: missing/garbage used_24h counts as zero used', () => {
  assert.equal(sendBudget({ cap: 500 }).used, 0);
  assert.equal(sendBudget({ used_24h: 'lots', cap: 500 }).used, 0);
  assert.equal(sendBudget({ used_24h: -7, cap: 500 }).used, 0);
});

test('sendBudget: fractional values are truncated to whole messages', () => {
  const b = sendBudget({ used_24h: 12.9, cap: 100.7 });
  assert.equal(b.used, 12);
  assert.equal(b.cap, 100);
  assert.equal(b.remaining, 88);
});

test('sendBudget: no inbox chosen → inbox is null (caller must not attribute the figures)', () => {
  assert.equal(sendBudget({ used_24h: 10, cap: 250 }).inbox, null);
  assert.equal(sendBudget({ used_24h: 10, cap: 250, inbox: null }).inbox, null);
});
