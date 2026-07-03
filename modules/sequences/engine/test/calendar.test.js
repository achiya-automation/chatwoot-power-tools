import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseHebcal, inNoSendWindow, refreshCalendar, loadWindows } from '../src/calendar.js';
import { getPool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';

// ── parseHebcal (pure) ──────────────────────────────────────────────────────

test('parseHebcal: regular shabbat → one window, kind=shabbat', () => {
  const json = { items: [
    { category: 'candles',  date: '2026-09-04T18:19:00+03:00', title: 'Candle lighting: 18:19' },
    { category: 'havdalah', date: '2026-09-05T19:35:00+03:00', title: 'Havdalah: 19:35' },
  ]};
  const w = parseHebcal(json);
  assert.equal(w.length, 1);
  assert.equal(w[0].starts_at, '2026-09-04T18:19:00+03:00');
  assert.equal(w[0].ends_at,   '2026-09-05T19:35:00+03:00');
  assert.equal(w[0].kind, 'shabbat');
});

test('parseHebcal: 2-day yom-tov (Rosh Hashana) → ONE window, nested candle ignored, kind=yomtov', () => {
  // The 2nd-day candle (19:26, lit from existing flame) must NOT open a second window.
  const json = { items: [
    { category: 'candles',  date: '2026-09-11T18:10:00+03:00', title: 'Candle lighting: 18:10' },
    { category: 'holiday',  date: '2026-09-12', title: 'Rosh Hashana 5787', yomtov: true },
    { category: 'candles',  date: '2026-09-12T19:26:00+03:00', title: 'Candle lighting: 19:26' },
    { category: 'holiday',  date: '2026-09-13', title: 'Rosh Hashana II', yomtov: true },
    { category: 'havdalah', date: '2026-09-13T19:24:00+03:00', title: 'Havdalah: 19:24' },
  ]};
  const w = parseHebcal(json);
  assert.equal(w.length, 1, 'two consecutive candles + one havdalah = ONE window');
  assert.equal(w[0].starts_at, '2026-09-11T18:10:00+03:00');
  assert.equal(w[0].ends_at,   '2026-09-13T19:24:00+03:00');
  assert.equal(w[0].kind, 'yomtov');
});

test('parseHebcal: 1-day yom-tov (Yom Kippur) → window kind=yomtov', () => {
  const json = { items: [
    { category: 'candles',  date: '2026-09-20T17:58:00+03:00', title: 'Candle lighting' },
    { category: 'holiday',  date: '2026-09-21', title: 'Yom Kippur', yomtov: true },
    { category: 'havdalah', date: '2026-09-21T19:14:00+03:00', title: 'Havdalah' },
  ]};
  const w = parseHebcal(json);
  assert.equal(w.length, 1);
  assert.equal(w[0].kind, 'yomtov');
});

test('parseHebcal: shabbat during chol-hamoed → kind=shabbat (no yomtov in range)', () => {
  const json = { items: [
    { category: 'candles',  date: '2026-04-03T18:19:00+03:00', title: 'Candle lighting' },
    { category: 'holiday',  date: '2026-04-03', title: 'Pesach II (CH’’M)' },        // yomtov undefined
    { category: 'holiday',  date: '2026-04-04', title: 'Pesach III (CH’’M)' },
    { category: 'havdalah', date: '2026-04-04T19:37:00+03:00', title: 'Havdalah' },
  ]};
  const w = parseHebcal(json);
  assert.equal(w.length, 1);
  assert.equal(w[0].kind, 'shabbat');
});

test('parseHebcal: chol-hamoed weekdays (no candles/havdalah) → no windows', () => {
  const json = { items: [
    { category: 'holiday', date: '2026-04-05', title: 'Pesach IV (CH’’M)' },
    { category: 'holiday', date: '2026-04-06', title: 'Pesach V (CH’’M)' },
    { category: 'zmanim',  date: '2026-04-05T10:00:00+03:00', title: 'Whatever' },
  ]};
  assert.deepEqual(parseHebcal(json), []);
});

test('parseHebcal: dangling candle with no closing havdalah is dropped (year boundary)', () => {
  const json = { items: [
    { category: 'candles', date: '2026-12-31T16:05:00+02:00', title: 'Candle lighting' },
  ]};
  assert.deepEqual(parseHebcal(json), []);
});

// ── inNoSendWindow (pure) ───────────────────────────────────────────────────

const RH = [{ starts_at: '2026-09-11T18:10:00+03:00', ends_at: '2026-09-13T19:24:00+03:00', kind: 'yomtov' }];

test('inNoSendWindow: now inside window → true', () => {
  assert.equal(inNoSendWindow(RH, new Date('2026-09-12T12:00:00+03:00')), true);
});
test('inNoSendWindow: now after window → false', () => {
  assert.equal(inNoSendWindow(RH, new Date('2026-09-14T12:00:00+03:00')), false);
});
test('inNoSendWindow: start is inclusive, end is exclusive', () => {
  assert.equal(inNoSendWindow(RH, new Date('2026-09-11T18:10:00+03:00')), true);  // start inclusive
  assert.equal(inNoSendWindow(RH, new Date('2026-09-13T19:24:00+03:00')), false); // end exclusive
});
test('inNoSendWindow: empty windows → false', () => {
  assert.equal(inNoSendWindow([], new Date('2026-09-12T12:00:00+03:00')), false);
});

// ── refreshCalendar + loadWindows (DB) ──────────────────────────────────────

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);
beforeEach(async () => {
  await runMigrations(pool);
  await pool.query('TRUNCATE drip.no_send_windows');
});

const fixtureFor = (year) => year === 2026 ? { items: [
  { category: 'candles',  date: '2026-09-11T18:10:00+03:00' },
  { category: 'holiday',  date: '2026-09-12', yomtov: true },
  { category: 'candles',  date: '2026-09-12T19:26:00+03:00' },
  { category: 'holiday',  date: '2026-09-13', yomtov: true },
  { category: 'havdalah', date: '2026-09-13T19:24:00+03:00' },
]} : { items: [] };

test('refreshCalendar: fetches + upserts when calendar is empty/stale', async () => {
  const years = [];
  const fetchFn = async (y) => { years.push(y); return fixtureFor(y); };
  const res = await refreshCalendar(pool, fetchFn, new Date('2026-06-21T09:00:00+03:00'));
  assert.ok(res.fetched > 0, 'reports windows fetched');
  assert.ok(years.includes(2026) && years.includes(2027), 'fetches current + next year');
  const w = await loadWindows(pool);
  assert.equal(w.length, 1);
  assert.equal(w[0].kind, 'yomtov');
});

test('refreshCalendar: no-op when calendar already covers next 60 days', async () => {
  const fetchFn1 = async (y) => fixtureFor(y);
  await refreshCalendar(pool, fetchFn1, new Date('2026-06-21T09:00:00+03:00'));
  let called = false;
  const fetchFn2 = async (y) => { called = true; return fixtureFor(y); };
  const res = await refreshCalendar(pool, fetchFn2, new Date('2026-06-21T09:00:00+03:00'));
  assert.equal(called, false, 'does not fetch when coverage is sufficient');
  assert.equal(res.fetched, 0);
});

test('refreshCalendar: idempotent — running twice yields same row count', async () => {
  const fetchFn = async (y) => fixtureFor(y);
  await refreshCalendar(pool, fetchFn, new Date('2026-06-21T09:00:00+03:00'));
  // force a re-fetch by clearing then re-running with same data
  await pool.query('TRUNCATE drip.no_send_windows');
  await refreshCalendar(pool, fetchFn, new Date('2026-06-21T09:00:00+03:00'));
  await pool.query('TRUNCATE drip.no_send_windows');
  await refreshCalendar(pool, fetchFn, new Date('2026-06-21T09:00:00+03:00'));
  const w = await loadWindows(pool);
  assert.equal(w.length, 1, 'no duplicate rows on conflict');
});
