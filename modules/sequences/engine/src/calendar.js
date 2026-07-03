// Shabbat & yom-tov "no-send" windows, sourced from Hebcal (Jerusalem) and
// stored in drip.no_send_windows. Replaces the old hard-coded HOLIDAYS set and
// the fixed "Friday 18:00" rule with exact candle-lighting → havdalah windows.
//
// Jerusalem (geonameid 281184) is used deliberately: it has the EARLIEST candle
// lighting in Israel (b=40, the Jerusalem custom) and havdalah by tzeit (M=on) —
// the widest, strictest window, safe for recipients anywhere in the country.

const HEBCAL_BASE = 'https://www.hebcal.com/hebcal';

/**
 * Fetch one civil year of the Israeli Jewish calendar (candles/havdalah/holidays).
 * @param {number} year
 * @returns {Promise<object>} raw Hebcal JSON ({ items: [...] })
 */
export async function fetchHebcal(year) {
  const url = `${HEBCAL_BASE}?v=1&cfg=json&maj=on&min=off&mod=off&nx=off`
    + `&year=${year}&i=on&c=on&geo=geoname&geonameid=281184&b=40&M=on`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Hebcal HTTP ${res.status}`);
  return res.json();
}

/**
 * Turn Hebcal items into no-send windows.
 *
 * Each `candles` event opens a window; the next `havdalah` closes it. A candle
 * that arrives while a window is already open is IGNORED — this is the 2nd day
 * of a yom-tov (or a yom-tov adjacent to shabbat), which Hebcal lists as a fresh
 * candle event but which must NOT split the single continuous rest period.
 *
 * A window is tagged `yomtov` if any `holiday` item with `yomtov:true` falls on
 * a date within [start, end]; otherwise `shabbat` (includes shabbat chol-hamoed).
 *
 * @param {object} json - Hebcal JSON
 * @returns {{starts_at:string, ends_at:string, kind:string}[]}
 */
export function parseHebcal(json) {
  const items = (json && json.items) || [];
  const yomtovDays = new Set(
    items
      .filter((i) => i.category === 'holiday' && i.yomtov === true)
      .map((i) => i.date.slice(0, 10))
  );

  const events = items
    .filter((i) => i.category === 'candles' || i.category === 'havdalah')
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const windows = [];
  let start = null;
  for (const ev of events) {
    if (ev.category === 'candles') {
      if (start === null) start = ev.date; // open; nested candles ignored
    } else if (start !== null) {
      // havdalah closes the open window
      const sd = start.slice(0, 10);
      const ed = ev.date.slice(0, 10);
      let kind = 'shabbat';
      for (const d of yomtovDays) {
        if (d >= sd && d <= ed) { kind = 'yomtov'; break; }
      }
      windows.push({ starts_at: start, ends_at: ev.date, kind });
      start = null; // close
    }
    // havdalah with no open window → boundary artifact, ignore
  }
  return windows; // dangling open window (no closing havdalah) is dropped
}

/**
 * Is `now` inside any no-send window? Start inclusive, end exclusive.
 * @param {{starts_at:(string|Date), ends_at:(string|Date)}[]} windows
 * @param {Date} now
 */
export const inNoSendWindow = (windows, now) => {
  const t = now.getTime();
  for (const w of windows || []) {
    if (t >= new Date(w.starts_at).getTime() && t < new Date(w.ends_at).getTime()) return true;
  }
  return false;
};

/**
 * Load current + future windows into memory (drops long-past rows).
 * @param {import('pg').Pool} pool
 * @returns {Promise<{starts_at:Date, ends_at:Date, kind:string}[]>}
 */
export async function loadWindows(pool) {
  const { rows } = await pool.query(
    `SELECT starts_at, ends_at, kind FROM drip.no_send_windows
      WHERE ends_at >= now() - interval '2 days'
      ORDER BY starts_at`
  );
  return rows;
}

/**
 * Ensure the calendar covers at least the next 60 days; if not, fetch the
 * current + next civil year from Hebcal and upsert. Self-healing, idempotent.
 * A failed fetch throws (caller keeps existing windows); never deletes.
 *
 * @param {import('pg').Pool} pool
 * @param {(year:number)=>Promise<object>} fetchFn - injectable (fetchHebcal in prod)
 * @param {Date} now
 * @returns {Promise<{fetched:number}>}
 */
export async function refreshCalendar(pool, fetchFn, now = new Date()) {
  const horizon = new Date(now.getTime() + 60 * 24 * 3600 * 1000);
  const { rows } = await pool.query('SELECT max(ends_at) AS m FROM drip.no_send_windows');
  const maxEnd = rows[0] && rows[0].m ? new Date(rows[0].m) : null;
  if (maxEnd && maxEnd >= horizon) return { fetched: 0 };

  const year = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric' }).format(now)
  );

  let windows = [];
  for (const y of [year, year + 1]) {
    windows = windows.concat(parseHebcal(await fetchFn(y)));
  }
  if (!windows.length) return { fetched: 0 };

  for (const w of windows) {
    await pool.query(
      `INSERT INTO drip.no_send_windows (starts_at, ends_at, kind)
       VALUES ($1, $2, $3)
       ON CONFLICT (starts_at) DO UPDATE
         SET ends_at = EXCLUDED.ends_at, kind = EXCLUDED.kind`,
      [w.starts_at, w.ends_at, w.kind]
    );
  }
  return { fetched: windows.length };
}
