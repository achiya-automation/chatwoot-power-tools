import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNoSendNow, nextSendAt, addInterval, jerusalemDow, skipNoSendWindows, projectSchedule } from '../src/schedule.js';

const D = (s) => new Date(s);

// Window fixtures (loadWindows returns starts_at/ends_at — strings or Dates both ok)
const summerShabbat = [{ starts_at: '2026-06-19T19:13:00+03:00', ends_at: '2026-06-20T20:25:00+03:00', kind: 'shabbat' }];
const winterShabbat = [{ starts_at: '2026-01-02T16:05:00+02:00', ends_at: '2026-01-03T17:20:00+02:00', kind: 'shabbat' }];
const pesach        = [{ starts_at: '2026-04-01T18:18:00+03:00', ends_at: '2026-04-02T19:36:00+03:00', kind: 'yomtov'  }];

test('quiet hours block (cross-midnight), independent of windows', () => {
  assert.equal(isNoSendNow({ now: D('2026-06-17T22:30:00+03:00'), quietStart: '22:00', quietEnd: '08:00' }), true);
  assert.equal(isNoSendNow({ now: D('2026-06-17T12:00:00+03:00'), quietStart: '22:00', quietEnd: '08:00' }), false);
});

test('window: shabbat blocks after candle-lighting and all Saturday', () => {
  assert.equal(isNoSendNow({ now: D('2026-06-19T19:30:00+03:00'), windows: summerShabbat, skipShabbat: true }), true); // after 19:13 candle
  assert.equal(isNoSendNow({ now: D('2026-06-20T12:00:00+03:00'), windows: summerShabbat, skipShabbat: true }), true); // Saturday
});

test('window: summer Friday 18:30 BEFORE candle is NOT blocked (no over-block)', () => {
  // The old fixed-18:00 rule wrongly blocked 18:00–19:13; the exact window allows it.
  assert.equal(isNoSendNow({ now: D('2026-06-19T18:30:00+03:00'), windows: summerShabbat, skipShabbat: true }), false);
});

test('window: WINTER Friday 16:30 IS blocked (the gap the old 18:00 rule missed)', () => {
  assert.equal(isNoSendNow({ now: D('2026-01-02T16:30:00+02:00'), windows: winterShabbat, skipShabbat: true }), true);
});

test('window: yom-tov blocks the whole day; erev only after candle-lighting', () => {
  assert.equal(isNoSendNow({ now: D('2026-04-02T10:00:00+03:00'), windows: pesach, skipShabbat: true }), true);  // Pesach day
  assert.equal(isNoSendNow({ now: D('2026-04-01T19:00:00+03:00'), windows: pesach, skipShabbat: true }), true);  // erev, after candle
  assert.equal(isNoSendNow({ now: D('2026-04-01T10:00:00+03:00'), windows: pesach, skipShabbat: true }), false); // erev morning, before candle
});

test('skipShabbat=false does not block even inside a window', () => {
  assert.equal(isNoSendNow({ now: D('2026-06-20T12:00:00+03:00'), windows: summerShabbat, skipShabbat: false }), false);
});

test('normal weekday is not blocked', () => {
  assert.equal(isNoSendNow({ now: D('2026-06-17T10:00:00+03:00'), windows: summerShabbat, skipShabbat: true, quietStart: '22:00', quietEnd: '08:00' }), false);
});

// ── fail-closed fallback (no fresh window data) ─────────────────────────────

test('fallback: no windows → blocks Friday 16:00+ and all Saturday', () => {
  assert.equal(isNoSendNow({ now: D('2026-06-19T19:00:00+03:00'), skipShabbat: true }), true);  // Fri eve
  assert.equal(isNoSendNow({ now: D('2026-06-20T12:00:00+03:00'), skipShabbat: true }), true);  // Saturday
  assert.equal(isNoSendNow({ now: D('2026-01-02T16:30:00+02:00'), skipShabbat: true }), true);  // winter Fri 16:30
  assert.equal(isNoSendNow({ now: D('2026-06-19T15:00:00+03:00'), skipShabbat: true }), false); // Fri before 16:00
});

test('fallback: stale windows (all past) → conservative rule, never sends Saturday', () => {
  const stale = [{ starts_at: '2020-01-03T16:00:00+02:00', ends_at: '2020-01-04T17:00:00+02:00', kind: 'shabbat' }];
  assert.equal(isNoSendNow({ now: D('2026-06-20T12:00:00+03:00'), windows: stale, skipShabbat: true }), true); // Sat via fallback
});

test('nextSendAt adds days+hours', () => {
  const r = nextSendAt(D('2026-06-17T10:00:00+03:00'), 1, 2);
  assert.equal(r.getTime(), D('2026-06-18T12:00:00+03:00').getTime());
});

test('nextSendAt with zero delay returns same time', () => {
  const from = D('2026-06-17T10:00:00+03:00');
  assert.equal(nextSendAt(from, 0, 0).getTime(), from.getTime());
});

test('nextSendAt snaps to a Jerusalem hour (summer IDT = UTC+3)', () => {
  // +1 day from Sun 15:00 IDT, land on 10:00 Jerusalem → 10:00 IDT = 07:00 UTC
  const r = nextSendAt(D('2026-06-21T15:00:00+03:00'), 1, 0, 10);
  assert.equal(r.toISOString(), '2026-06-22T07:00:00.000Z');
});

test('nextSendAt snaps across DST (winter IST = UTC+2)', () => {
  // 19:00 Jerusalem in January = 17:00 UTC
  const r = nextSendAt(D('2026-01-11T08:00:00Z'), 0, 0, 19);
  assert.equal(r.toISOString(), '2026-01-11T17:00:00.000Z');
});

test('nextSendAt with null sendHour keeps delay-only behavior', () => {
  const from = D('2026-06-17T10:00:00+03:00');
  assert.equal(nextSendAt(from, 2, 0, null).getTime(), D('2026-06-19T10:00:00+03:00').getTime());
});

// ── recurring (addInterval) ────────────────────────────────────────────────────
test('addInterval: day/week add fixed spans', () => {
  const from = D('2026-06-17T10:00:00Z');
  assert.equal(addInterval(from, 1, 'day').toISOString(), '2026-06-18T10:00:00.000Z');
  assert.equal(addInterval(from, 2, 'week').toISOString(), '2026-07-01T10:00:00.000Z');
});

test('addInterval: month advances a calendar month (and crosses the year)', () => {
  assert.equal(addInterval(D('2026-01-15T08:00:00Z'), 1, 'month').toISOString(), '2026-02-15T08:00:00.000Z');
  assert.equal(addInterval(D('2026-12-10T08:00:00Z'), 1, 'month').toISOString(), '2027-01-10T08:00:00.000Z');
});

test('addInterval: defaults to a positive day step', () => {
  assert.equal(addInterval(D('2026-06-17T10:00:00Z'), 0, 'day').toISOString(), '2026-06-18T10:00:00.000Z');
});

// ── absolute date ───────────────────────────────────────────────────────────────
test('nextSendAt: absolute sendDate lands on that date at sendHour, ignoring the delay', () => {
  // 2026-06-25 at 09:00 IDT (UTC+3) = 06:00 UTC, regardless of `from`/delay
  const r = nextSendAt(D('2026-01-01T00:00:00Z'), 5, 3, 9, '2026-06-25');
  assert.equal(r.toISOString(), '2026-06-25T06:00:00.000Z');
});

test('nextSendAt: absolute sendDate defaults to 09:00 Jerusalem when no sendHour', () => {
  const r = nextSendAt(D('2026-01-01T00:00:00Z'), 0, 0, null, '2026-06-25');
  assert.equal(r.toISOString(), '2026-06-25T06:00:00.000Z'); // 09:00 IDT
});

// ── day-of-week preference ──────────────────────────────────────────────────────
test('nextSendAt: allowedDow shifts forward to the nearest allowed weekday', () => {
  // +1 day from Sun 2026-06-21 15:00 → Mon 06-22 10:00. allowedDow=[3,4] (Wed,Thu)
  // → shift to Wed 2026-06-24 10:00 IDT = 07:00 UTC.
  const r = nextSendAt(D('2026-06-21T15:00:00+03:00'), 1, 0, 10, null, [3, 4]);
  assert.equal(jerusalemDow(r), 3); // Wednesday
  assert.equal(r.toISOString(), '2026-06-24T07:00:00.000Z');
});

test('nextSendAt: allowedDow already-satisfied is a no-op', () => {
  // Mon 06-22 10:00 is dow 1; allowedDow includes 1 → unchanged.
  const r = nextSendAt(D('2026-06-21T15:00:00+03:00'), 1, 0, 10, null, [1, 2]);
  assert.equal(r.toISOString(), '2026-06-22T07:00:00.000Z');
});

test('nextSendAt: allowedDow full or empty set is a no-op', () => {
  const base = nextSendAt(D('2026-06-21T15:00:00+03:00'), 1, 0, 10).getTime();
  assert.equal(nextSendAt(D('2026-06-21T15:00:00+03:00'), 1, 0, 10, null, [0, 1, 2, 3, 4, 5, 6]).getTime(), base);
  assert.equal(nextSendAt(D('2026-06-21T15:00:00+03:00'), 1, 0, 10, null, []).getTime(), base);
});

// ── projectSchedule: cumulative projected dates for current + future steps ──
// Powers the panel's "this message will go out on <date> at <hour>" for steps
// that haven't been sent yet (the engine only stores next_send_at for the current step).

test('projectSchedule: current step is the anchor; future steps accumulate at their hour', () => {
  const steps = [
    { step_order: 1, delay_days: 2, send_hour: 20 },
    { step_order: 2, delay_days: 3, send_hour: 19 },
    { step_order: 3, delay_days: 3, send_hour: 19 },
  ];
  const anchor = D('2026-06-29T19:00:00+03:00'); // Mon — step 2's stored next_send_at
  const sched = projectSchedule(steps, 2, anchor, []);
  assert.equal(sched[2].toISOString(), anchor.toISOString());     // current = anchor exactly
  assert.equal(sched[3].toISOString(), '2026-07-02T16:00:00.000Z'); // +3d @19:00 = Thu 07-02
  assert.equal(sched[1], undefined);                              // already sent — no projection
});

test('projectSchedule: a future step landing on shabbat is pushed forward when windows given', () => {
  const steps = [
    { step_order: 1, delay_days: 0, send_hour: 19 },
    { step_order: 2, delay_days: 2, send_hour: 19 },
  ];
  const anchor = D('2026-06-18T19:00:00+03:00'); // Thu — step 1 (current)
  const withSkip = projectSchedule(steps, 1, anchor, summerShabbat);
  assert.equal(withSkip[2].toISOString(), '2026-06-21T16:00:00.000Z'); // Sun (Sat skipped)
  const noSkip = projectSchedule(steps, 1, anchor, []);
  assert.equal(noSkip[2].toISOString(), '2026-06-20T16:00:00.000Z');   // Sat (no skip)
});

test('projectSchedule: empty steps or no anchor returns an empty map', () => {
  assert.deepEqual(projectSchedule([], 1, new Date(), []), {});
  assert.deepEqual(projectSchedule([{ step_order: 1 }], 1, null, []), {});
});

// ── nextSendAt + windows: a step landing on shabbat/chag is pushed forward ──

test('nextSendAt: windows push a shabbat landing to the next working day', () => {
  // Tue 06-16 10:00 + 4 days at 19:00 → Sat 06-20 19:00 (inside the shabbat window)
  // → with windows, skip to Sun 06-21 19:00 IDT = 16:00 UTC.
  const r = nextSendAt(D('2026-06-16T10:00:00+03:00'), 4, 0, 19, null, null, summerShabbat);
  assert.equal(r.toISOString(), '2026-06-21T16:00:00.000Z');
});

test('nextSendAt: without windows the same step stays on shabbat (back-compat)', () => {
  const r = nextSendAt(D('2026-06-16T10:00:00+03:00'), 4, 0, 19);
  assert.equal(r.toISOString(), '2026-06-20T16:00:00.000Z'); // Sat 19:00 IDT, no skip
});

test('nextSendAt: windows leave a weekday landing untouched', () => {
  // Tue 06-16 + 1 day at 19:00 → Wed 06-17 19:00, not in any window → unchanged.
  const r = nextSendAt(D('2026-06-16T10:00:00+03:00'), 1, 0, 19, null, null, summerShabbat);
  assert.equal(r.toISOString(), '2026-06-17T16:00:00.000Z');
});

// ── skipNoSendWindows: push a date FORWARD out of any shabbat/yom-tov window ──
// Used so a step that lands on shabbat/chag is delivered on the next working day
// at its hour, instead of waiting for havdalah and firing late motzaei-shabbat.

test('skipNoSendWindows: a weekday outside any window is unchanged', () => {
  const d = D('2026-06-17T10:00:00+03:00'); // Wednesday
  assert.equal(skipNoSendWindows(d, summerShabbat, null).getTime(), d.getTime());
});

test('skipNoSendWindows: empty/missing windows is a no-op', () => {
  const d = D('2026-06-20T12:00:00+03:00'); // Saturday, but no windows given
  assert.equal(skipNoSendWindows(d, [], null).getTime(), d.getTime());
  assert.equal(skipNoSendWindows(d, undefined, null).getTime(), d.getTime());
});

test('skipNoSendWindows: Saturday noon pushes to Sunday same time (no sendHour)', () => {
  // summerShabbat ends Sat 20:25; Sat 12:00 is inside → push to Sun 12:00.
  const r = skipNoSendWindows(D('2026-06-20T12:00:00+03:00'), summerShabbat, null);
  assert.equal(r.toISOString(), D('2026-06-21T12:00:00+03:00').toISOString());
});

test('skipNoSendWindows: Friday eve at sendHour=19 lands on Sunday 19:00', () => {
  // Fri 19:30 is after candle (19:13) → inside. Snapping per day to 19:00:
  // Sat 19:00 is still inside (< 20:25) → Sun 19:00 (outside). Sun 19:00 IDT = 16:00 UTC.
  const r = skipNoSendWindows(D('2026-06-19T19:30:00+03:00'), summerShabbat, 19);
  assert.equal(r.toISOString(), '2026-06-21T16:00:00.000Z');
});

test('skipNoSendWindows: yom-tov pushes past the whole holiday day', () => {
  // Pesach window 04-01T18:18 → 04-02T19:36. A send at 04-02 10:00 (inside) → 04-03 10:00.
  const r = skipNoSendWindows(D('2026-04-02T10:00:00+03:00'), pesach, null);
  assert.equal(r.toISOString(), D('2026-04-03T10:00:00+03:00').toISOString());
});
