import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tierToCap, getDailyCap, DEFAULT_CAP, _resetTierCache } from '../src/meta.js';

const creds = { getWhatsappCreds: async () => ({ token: 't', phoneId: 'p' }) };

test('tierToCap maps Meta tiers to numeric 24h caps', () => {
  assert.equal(tierToCap('TIER_250'), 250);
  assert.equal(tierToCap('TIER_1K'), 1000);
  assert.equal(tierToCap('TIER_10K'), 10000);
  assert.equal(tierToCap('TIER_100K'), 100000);
  assert.equal(tierToCap('UNLIMITED'), Infinity);
  assert.equal(tierToCap('tier_1k'), 1000);           // case-insensitive
});

test('tierToCap falls back to DEFAULT_CAP for unknown/null tier', () => {
  assert.equal(tierToCap(null), DEFAULT_CAP);
  assert.equal(tierToCap('TIER_WEIRD'), DEFAULT_CAP);
  assert.equal(tierToCap(undefined), DEFAULT_CAP);
});

test('getDailyCap reads the tier via injected fetch and maps it', async () => {
  _resetTierCache();
  const cap = await getDailyCap(creds, 7, new Date(), { fetchTierFn: async () => 'TIER_1K' });
  assert.equal(cap, 1000);
});

test('getDailyCap caches within refreshMs (no second fetch)', async () => {
  _resetTierCache();
  let calls = 0;
  const fetchTierFn = async () => { calls++; return 'TIER_250'; };
  await getDailyCap(creds, 7, new Date('2026-07-08T10:00:00Z'), { fetchTierFn, refreshMs: 3600000 });
  await getDailyCap(creds, 7, new Date('2026-07-08T10:30:00Z'), { fetchTierFn, refreshMs: 3600000 });
  assert.equal(calls, 1);   // second served from cache
});

test('getDailyCap re-fetches after refreshMs elapses', async () => {
  _resetTierCache();
  let calls = 0;
  const fetchTierFn = async () => { calls++; return 'TIER_250'; };
  await getDailyCap(creds, 7, new Date('2026-07-08T10:00:00Z'), { fetchTierFn, refreshMs: 1000 });
  await getDailyCap(creds, 7, new Date('2026-07-08T12:00:00Z'), { fetchTierFn, refreshMs: 1000 });
  assert.equal(calls, 2);
});

test('getDailyCap never throws — DEFAULT_CAP when the first fetch fails', async () => {
  _resetTierCache();
  const cap = await getDailyCap(creds, 9, new Date(), { fetchTierFn: async () => { throw new Error('graph down'); } });
  assert.equal(cap, DEFAULT_CAP);
});

test('getDailyCap keeps the last known cap on a later failure (never unthrottles up)', async () => {
  _resetTierCache();
  await getDailyCap(creds, 5, new Date('2026-07-08T10:00:00Z'), { fetchTierFn: async () => 'TIER_1K', refreshMs: 1000 });
  const cap = await getDailyCap(creds, 5, new Date('2026-07-08T12:00:00Z'), { fetchTierFn: async () => { throw new Error('x'); }, refreshMs: 1000 });
  assert.equal(cap, 1000);   // stale cache, not DEFAULT_CAP
});

test('getDailyCap falls back to DEFAULT_CAP when creds are missing', async () => {
  _resetTierCache();
  const cap = await getDailyCap({ getWhatsappCreds: async () => null }, 3, new Date(), { fetchTierFn: async () => 'TIER_10K' });
  assert.equal(cap, DEFAULT_CAP);
});
