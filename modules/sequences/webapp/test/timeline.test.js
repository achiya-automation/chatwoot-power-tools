import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '../src/i18n.js';
import { formatOffset, formatDuration, formatWhen } from '../src/lib/timeline.js';

// The i18n-bearing humanizers read the live locale. The Hebrew path is covered by
// engine/test/timeline.test.js; here we lock down the English grammar — singular vs.
// plural ("1 day" / "2 days", "1 hour" / "2 hours"), the weekday names, and the
// time-of-day / recurring suffixes. afterEach restores Hebrew so a stray 'en' state
// never leaks into a later test.
afterEach(() => setLocale('he'));

// ── Hebrew default sanity: node starts in 'he', and the afterEach reset holds ──
test('formatOffset defaults to Hebrew when the locale is untouched', () => {
  assert.equal(formatOffset({ days: 0, hours: 0 }), 'מיד');
  assert.equal(formatOffset({ days: 3, hours: 0 }), 'כעבור 3 ימים');
});

// ── English: formatOffset, delay-only (singular vs. plural) ──
test('formatOffset en: delay-only reads with correct plurals', () => {
  setLocale('en');
  assert.equal(formatOffset({ days: 0, hours: 0 }), 'immediately');
  assert.equal(formatOffset({ days: 1, hours: 0 }), 'after 1 day');
  assert.equal(formatOffset({ days: 3, hours: 0 }), 'after 3 days');
  assert.equal(formatOffset({ days: 0, hours: 1 }), 'after 1 hour');
  assert.equal(formatOffset({ days: 0, hours: 2 }), 'after 2 hours');
  assert.equal(formatOffset({ days: 1, hours: 2 }), 'after 1 day and 2 hours');
});

// ── English: formatOffset with a time-of-day (sendHour) ──
test('formatOffset en: shows the time-of-day when sendHour is set', () => {
  setLocale('en');
  assert.equal(formatOffset({ days: 4, hours: 17, sendHour: 17 }), 'after 4 days at 17:00');
  assert.equal(formatOffset({ days: 1, hours: 10, sendHour: 10 }), 'after 1 day at 10:00'); // singular day
  assert.equal(formatOffset({ days: 0, hours: 9, sendHour: 9 }), 'today at 09:00');
  assert.equal(formatOffset({ days: 0, hours: 0, sendHour: 0 }), 'today at 00:00'); // midnight is valid
});

// ── English: formatOffset with an absolute date and a recurring suffix ──
test('formatOffset en: absolute date and recurring suffix', () => {
  setLocale('en');
  assert.equal(formatOffset({ days: 0, hours: 0, sendDate: '2026-06-25' }), 'on 25.06');
  assert.equal(formatOffset({ sendDate: '2026-06-25', sendHour: 9 }), 'on 25.06 at 09:00');
  assert.equal(
    formatOffset({ days: 60, hours: 9, sendHour: 9, repeatUnit: 'month' }),
    'after 60 days at 09:00 · then every month',
  );
});

// ── English: formatDuration (singular/plural + the zero case) ──
test('formatDuration en: singular/plural and the "Immediate" zero case', () => {
  setLocale('en');
  assert.equal(formatDuration({ days: 0, hours: 0 }), 'Immediate');
  assert.equal(formatDuration({ days: 1, hours: 0 }), '1 day');
  assert.equal(formatDuration({ days: 14, hours: 0 }), '14 days');
  assert.equal(formatDuration({ days: 1, hours: 2 }), '1 day and 2 hours');
});

// ── English: formatWhen (weekday + date + time) ──
test('formatWhen en: renders the English weekday + date + time', () => {
  setLocale('en');
  assert.equal(formatWhen('2026-07-02 19:00'), 'Thu 2.7 · 19:00'); // Thursday
  assert.equal(formatWhen('2026-06-21 09:05'), 'Sun 21.6 · 09:05'); // Sunday
  assert.equal(formatWhen('2026-06-29 19:00'), 'Mon 29.6 · 19:00'); // Monday
});

test('formatWhen en: returns the input unchanged when not a datetime', () => {
  setLocale('en');
  assert.equal(formatWhen(''), '');
  assert.equal(formatWhen('later'), 'later');
  assert.equal(formatWhen(null), '');
});
