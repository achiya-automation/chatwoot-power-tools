import { inNoSendWindow } from './calendar.js';

// Get Asia/Jerusalem wall-clock parts from a Date
const parts = (date) => {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const g = (t) => f.find((p) => p.type === t)?.value;
  return { wd: g('weekday'), hm: `${g('hour')}:${g('minute')}` };
};

// Returns true if hm is inside quiet window [qs, qe)
// Supports cross-midnight windows (e.g. 22:00→08:00)
const inQuiet = (hm, qs, qe) => (qs <= qe ? hm >= qs && hm < qe : hm >= qs || hm < qe);

/**
 * Returns true if a message should NOT be sent right now.
 *
 * Shabbat + yom-tov use exact Hebcal candle-lighting → havdalah windows when the
 * calendar is fresh. If no fresh window data exists (first boot, prolonged fetch
 * failure) it FAILS CLOSED to a conservative rule (Friday 16:00+ and all Saturday)
 * so a message is NEVER sent on shabbat even without Hebcal data.
 *
 * @param {Object}   opts
 * @param {Date}     opts.now         - current time
 * @param {Array}    opts.windows     - no-send windows from calendar.loadWindows()
 * @param {boolean}  opts.skipShabbat - gate shabbat+yom-tov blocking
 * @param {string}   opts.quietStart  - HH:MM quiet window start (optional)
 * @param {string}   opts.quietEnd    - HH:MM quiet window end (optional)
 */
export function isNoSendNow({ now, windows, skipShabbat = false, quietStart, quietEnd } = {}) {
  // Quiet hours (always, independent of shabbat)
  if (quietStart && quietEnd) {
    const { hm } = parts(now);
    if (inQuiet(hm, quietStart, quietEnd)) return true;
  }

  if (skipShabbat) {
    const fresh = Array.isArray(windows)
      && windows.some((w) => new Date(w.ends_at).getTime() >= now.getTime());
    if (fresh) {
      if (inNoSendWindow(windows, now)) return true;
    } else {
      // 🔒 fail-closed: never send on shabbat even without Hebcal data.
      // Conservative — earliest IL candle-lighting is ~16:05 (Jerusalem, winter).
      const { wd, hm } = parts(now);
      if (wd === 'Sat') return true;
      if (wd === 'Fri' && hm >= '16:00') return true;
    }
  }

  return false;
}

/**
 * The UTC instant of `hour`:00 Asia/Jerusalem on the Jerusalem calendar day of `ref`.
 * Handles DST (IDT=UTC+3 summer, IST=UTC+2 winter) by deriving Jerusalem's offset at `ref`
 * from Intl, so "send at 10:00" lands on local 10:00 year-round.
 * @param {Date}   ref
 * @param {number} hour - 0..23 (Jerusalem wall-clock hour)
 * @returns {Date}
 */
export function atJerusalemHour(ref, hour) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(ref).map((x) => [x.type, x.value]));
  // Jerusalem offset at ref = (wall-clock read as UTC) − (actual UTC instant)
  const offsetMs = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ref.getTime();
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, hour, 0, 0) - offsetMs);
}

// JS getDay()-style weekday (0=Sun .. 6=Sat) in Jerusalem.
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export const jerusalemDow = (date) =>
  DOW[new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' }).format(date)];

/**
 * Shift `date` FORWARD to the nearest day whose Jerusalem weekday is in allowedDow,
 * re-snapping to sendHour each day so the wall-clock hour is preserved. A full or
 * empty set is a no-op (handled by the caller). Used by the day-of-week preference.
 * @param {Date}     date
 * @param {number[]} allowedDow - JS weekdays 0..6
 * @param {number|null} sendHour
 * @returns {Date}
 */
function shiftToAllowedDow(date, allowedDow, sendHour) {
  let d = date;
  for (let i = 0; i < 7; i += 1) {
    if (allowedDow.includes(jerusalemDow(d))) return d;
    const tomorrow = new Date(d.getTime() + 86_400_000);
    d = (sendHour == null || sendHour === '') ? tomorrow : atJerusalemHour(tomorrow, Number(sendHour));
  }
  return date; // unreachable for a non-empty partial set
}

/**
 * Push `date` FORWARD out of any shabbat/yom-tov no-send window, so a step that
 * lands inside one is delivered on the next working day at its hour — instead of
 * waiting for havdalah and firing late motzaei-shabbat. Re-snaps to sendHour each
 * day when given (preserving the intended wall-clock hour). A date outside all
 * windows (or no/empty windows) is returned unchanged. The caller applies this only
 * when the sequence opts into shabbat-skipping (skip_shabbat).
 * @param {Date}        date
 * @param {Array}       windows  - no-send windows from calendar.loadWindows()
 * @param {number|null} sendHour - Jerusalem hour 0..23 to re-snap to each day, or null
 * @returns {Date}
 */
export function skipNoSendWindows(date, windows, sendHour = null) {
  if (!Array.isArray(windows) || windows.length === 0) return date;
  let d = date;
  // Cap: the longest IL chag+shabbat run is ~3 days; 21 is a safe upper bound.
  for (let i = 0; i < 21; i += 1) {
    if (!inNoSendWindow(windows, d)) return d;
    const tomorrow = new Date(d.getTime() + 86_400_000);
    d = (sendHour == null || sendHour === '') ? tomorrow : atJerusalemHour(tomorrow, Number(sendHour));
  }
  return d;
}

/**
 * Calculates the next send time. Three layered modes, all optional and composable:
 *   • relative (default) — add delayDays/delayHours to `from`
 *   • absolute date      — when `sendDate` (YYYY-MM-DD) is given, ignore the delay and land
 *                          on that calendar date (broadcast-style, same date for every lead)
 *   • hour-of-day        — when `sendHour` (0..23) is given, snap to that exact Jerusalem hour
 *   • day-of-week        — when `allowedDow` is a partial set, shift forward to the nearest allowed day
 * Snapping per step makes cumulative "after N days at HH:00" schedules land exactly.
 * @param {Date}            from       - base timestamp (previous send / enroll time)
 * @param {number}          delayDays  - whole days to add
 * @param {number}          delayHours - additional hours to add
 * @param {number|null}     sendHour   - Jerusalem hour 0..23 to land on, or null for delay-only
 * @param {string|null}     sendDate   - YYYY-MM-DD absolute date, or null for relative
 * @param {number[]|null}   allowedDow - preferred JS weekdays 0..6, or null/full for any day
 * @param {Array|null}      windows    - no-send windows; when given, a landing inside a
 *                                       shabbat/yom-tov window is pushed to the next working day
 * @returns {Date}
 */
export function nextSendAt(from, delayDays = 0, delayHours = 0, sendHour = null, sendDate = null, allowedDow = null, windows = null) {
  let result;
  if (sendDate) {
    // Absolute calendar date at sendHour Jerusalem (default 09:00). Noon-UTC anchors the
    // correct Jerusalem calendar day before snapping (IL is UTC+2/+3, so 12:00Z = same date).
    const [y, m, d] = String(sendDate).split('-').map(Number);
    const anchor = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0));
    result = atJerusalemHour(anchor, (sendHour == null || sendHour === '') ? 9 : Number(sendHour));
  } else {
    const base = new Date(from.getTime() + (delayDays * 24 + delayHours) * 3_600_000);
    result = (sendHour == null || sendHour === '') ? base : atJerusalemHour(base, Number(sendHour));
  }
  if (Array.isArray(allowedDow) && allowedDow.length > 0 && allowedDow.length < 7) {
    result = shiftToAllowedDow(result, allowedDow, sendHour);
  }
  // Shabbat/yom-tov: push a landing inside a no-send window forward to the next working
  // day at its hour. Caller passes windows only when the sequence opts in (skip_shabbat).
  if (Array.isArray(windows) && windows.length > 0) {
    result = skipNoSendWindows(result, windows, sendHour);
  }
  return result;
}

/**
 * Project the cumulative send dates for the current + future steps of a running
 * enrollment — so the panel can show "this message goes out on <date> at <hour>"
 * for steps not yet sent. The engine only persists next_send_at for the CURRENT
 * step; later steps are derived here exactly as the reconciler will compute them
 * (same nextSendAt, same per-step hour snap, same shabbat/chag skip).
 *
 * @param {Array}  steps       - sequence steps (snake_case: step_order, delay_days,
 *                               delay_hours, send_hour, send_date, allowed_dow)
 * @param {number} currentStep - the enrollment's current step (its next_send_at = anchor)
 * @param {Date}   anchor      - the current step's stored next_send_at
 * @param {Array}  windows     - no-send windows, already gated on skip_shabbat by the caller
 *                               (pass [] to disable skipping)
 * @returns {Object<number, Date>} map of step_order → projected Date (current + future only)
 */
export function projectSchedule(steps, currentStep, anchor, windows = []) {
  const out = {};
  if (!Array.isArray(steps) || steps.length === 0 || !anchor) return out;
  const cur = Number(currentStep) || 0;
  const ordered = [...steps].sort((a, b) => Number(a.step_order) - Number(b.step_order));
  let prev = null;
  for (const s of ordered) {
    const so = Number(s.step_order);
    if (so < cur) continue;          // already sent — no projection needed
    if (so === cur) {                // current step: the engine already computed its next_send_at
      out[so] = anchor;
      prev = anchor;
      continue;
    }
    // future step: accumulate from the previous projected date, exactly like the reconciler
    const next = nextSendAt(
      prev || anchor,
      s.delay_days || 0, s.delay_hours || 0,
      s.send_hour, s.send_date, s.allowed_dow, windows
    );
    out[so] = next;
    prev = next;
  }
  return out;
}

/**
 * Advance a base time by a recurring interval, for self-repeating steps (e.g. "every month").
 * Month math uses calendar months (setUTCMonth) so it stays on roughly the same date/time.
 * @param {Date}   from
 * @param {number} interval - count (>=1)
 * @param {string} unit     - 'day' | 'week' | 'month'
 * @returns {Date}
 */
export function addInterval(from, interval = 1, unit = 'day') {
  const n = Math.max(1, Number(interval) || 1);
  if (unit === 'week') return new Date(from.getTime() + n * 7 * 86_400_000);
  if (unit === 'month') {
    const d = new Date(from);
    d.setUTCMonth(d.getUTCMonth() + n);
    return d;
  }
  return new Date(from.getTime() + n * 86_400_000); // 'day' (default)
}
