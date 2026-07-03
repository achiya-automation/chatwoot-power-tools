import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSchedule,
  sequenceDuration,
  formatOffset,
  formatDuration,
  estimateFinishDate,
  formatWhen,
} from '../../webapp/src/lib/timeline.js';

// Compare only the cumulative-offset core; computeSchedule also returns sendHour/sendDate/repeatUnit.
const core = ({ days, hours, totalHours }) => ({ days, hours, totalHours });

test('computeSchedule accumulates per-step delays from enrollment', () => {
  const steps = [
    { delayDays: 0, delayHours: 0 }, // immediate
    { delayDays: 1, delayHours: 0 }, // +1 day → day 1
    { delayDays: 3, delayHours: 2 }, // +3d2h → day 4, 2h
  ];
  const sched = computeSchedule(steps);
  assert.deepEqual(core(sched[0]), { days: 0, hours: 0, totalHours: 0 });
  assert.deepEqual(core(sched[1]), { days: 1, hours: 0, totalHours: 24 });
  assert.deepEqual(core(sched[2]), { days: 4, hours: 2, totalHours: 98 });
});

test('computeSchedule normalizes hours ≥ 24 into days', () => {
  const sched = computeSchedule([{ delayDays: 0, delayHours: 30 }]); // 30h → 1d 6h
  assert.deepEqual(core(sched[0]), { days: 1, hours: 6, totalHours: 30 });
});

test('computeSchedule clamps negative/garbage delays to zero', () => {
  const sched = computeSchedule([{ delayDays: -5, delayHours: -2 }, { delayDays: 'x', delayHours: 3 }]);
  assert.deepEqual(core(sched[0]), { days: 0, hours: 0, totalHours: 0 });
  assert.deepEqual(core(sched[1]), { days: 0, hours: 3, totalHours: 3 });
});

test('computeSchedule snaps to sendHour on the same calendar day (bb_new shape)', () => {
  // mirrors bb_new: immediate → 6h follow-up → daily steps snapped to an exact hour
  const steps = [
    { delayDays: 0 },                // day0 h0  (immediate)
    { delayDays: 0, delayHours: 6 }, // +6h → day0 h6  (video follow-up)
    { delayDays: 1, sendHour: 10 },  // +1d → day1 h6, snap 10 → day1 h10
    { delayDays: 1, sendHour: 19 },  // +1d → day2 h10, snap 19 → day2 h19
    { delayDays: 2, sendHour: 17 },  // +2d → day4 h19, snap 17 → day4 h17
  ];
  const sched = computeSchedule(steps);
  assert.deepEqual(core(sched[1]), { days: 0, hours: 6, totalHours: 6 });
  assert.deepEqual({ days: sched[2].days, hours: sched[2].hours, sendHour: sched[2].sendHour }, { days: 1, hours: 10, sendHour: 10 });
  assert.deepEqual({ days: sched[4].days, hours: sched[4].hours }, { days: 4, hours: 17 }); // the "שלב 5" from the screenshot
});

test('computeSchedule surfaces sendDate and recurring unit', () => {
  const sched = computeSchedule([{ sendDate: '2026-12-25', sendHour: 9 }, { delayDays: 60, sendHour: 9, repeatInterval: 1, repeatUnit: 'month' }]);
  assert.equal(sched[0].sendDate, '2026-12-25');
  assert.equal(sched[1].repeatUnit, 'month');
});

test('sequenceDuration equals the last cumulative offset', () => {
  const steps = [{ delayDays: 0 }, { delayDays: 1 }, { delayDays: 3, delayHours: 2 }];
  assert.deepEqual(sequenceDuration(steps), { days: 4, hours: 2, totalHours: 98 });
  assert.deepEqual(sequenceDuration([]), { days: 0, hours: 0, totalHours: 0 });
});

test('formatOffset reads naturally in Hebrew (delay-only)', () => {
  assert.equal(formatOffset({ days: 0, hours: 0 }), 'מיד');
  assert.equal(formatOffset({ days: 1, hours: 0 }), 'כעבור יום');
  assert.equal(formatOffset({ days: 3, hours: 0 }), 'כעבור 3 ימים');
  assert.equal(formatOffset({ days: 0, hours: 1 }), 'כעבור שעה');
  assert.equal(formatOffset({ days: 1, hours: 2 }), 'כעבור יום ו-2 שעות');
});

test('formatOffset shows the time-of-day when sendHour is set', () => {
  assert.equal(formatOffset({ days: 4, hours: 17, sendHour: 17 }), 'כעבור 4 ימים בשעה 17:00');
  assert.equal(formatOffset({ days: 1, hours: 10, sendHour: 10 }), 'כעבור יום בשעה 10:00');
  assert.equal(formatOffset({ days: 0, hours: 9, sendHour: 9 }), 'היום בשעה 09:00');
  assert.equal(formatOffset({ days: 0, hours: 0, sendHour: 0 }), 'היום בשעה 00:00'); // midnight is valid
});

test('formatOffset shows an absolute date and recurring suffix', () => {
  assert.equal(formatOffset({ days: 0, hours: 0, sendDate: '2026-06-25' }), 'בתאריך 25.06');
  assert.equal(formatOffset({ sendDate: '2026-06-25', sendHour: 9 }), 'בתאריך 25.06 בשעה 09:00');
  assert.equal(formatOffset({ days: 60, hours: 9, sendHour: 9, repeatUnit: 'month' }), 'כעבור 60 ימים בשעה 09:00 · ואז כל חודש');
});

test('formatDuration reads naturally in Hebrew', () => {
  assert.equal(formatDuration({ days: 0, hours: 0 }), 'מיידי');
  assert.equal(formatDuration({ days: 14, hours: 0 }), '14 ימים');
  assert.equal(formatDuration({ days: 1, hours: 0 }), 'יום');
});

test('estimateFinishDate offsets from the given start time', () => {
  const from = new Date('2026-06-21T09:00:00Z');
  const steps = [{ delayDays: 0 }, { delayDays: 2, delayHours: 3 }]; // +51h
  const finish = estimateFinishDate(steps, from);
  assert.equal(finish.toISOString(), '2026-06-23T12:00:00.000Z');
});

// ── formatWhen: weekday + date + time for a scheduled (not-yet-sent) step ──
// Renders the engine's projected "YYYY-MM-DD HH:MM" (Israel time) as a human "מתי יישלח".

test('formatWhen renders weekday + date + time', () => {
  assert.equal(formatWhen('2026-07-02 19:00'), 'ה׳ 2.7 · 19:00'); // Thursday
  assert.equal(formatWhen('2026-06-21 09:05'), 'א׳ 21.6 · 09:05'); // Sunday
  assert.equal(formatWhen('2026-06-29 19:00'), 'ב׳ 29.6 · 19:00'); // Monday
});

test('formatWhen returns the input unchanged when not a parseable datetime', () => {
  assert.equal(formatWhen(''), '');
  assert.equal(formatWhen('בקרוב'), 'בקרוב');
  assert.equal(formatWhen(null), '');
});
