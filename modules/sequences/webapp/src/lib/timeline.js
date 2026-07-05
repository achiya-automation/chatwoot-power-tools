/*
 * timeline — חישוב לוח הזמנים של רצף drip. פונקציות טהורות (בלי React/DOM)
 * כדי שיהיו ניתנות לבדיקה ב-node --test (engine/test/timeline.test.js).
 *
 * כל שלב מוגדר ע"י המתנה *מהשלב הקודם* (delayDays/delayHours). כדי שהמשתמש
 * "יראה בדיוק מה ייקרה", אנחנו צוברים את ההמתנות לקיזוז מרגע ההרשמה — תוך
 * התחשבות ב-sendHour (שעה-ביום עושה snap לאותה שעה, בדיוק כמו המנוע), כך
 * שהתצוגה משקפת "ביום ה-N בשעה HH:00" ולא צבירת שעות-המתנה מטעה.
 *
 * i18n: ה-humanizer דו-לשוני (he/en) עם דקדוק נכון (יחיד/רבים). קורא את השפה
 * הנוכחית מ-i18n.js בזמן קריאה; ב-node (בדיקות engine, ללא URL) ברירת המחדל 'he'
 * → הפלט העברי זהה לחלוטין להיסטורי (הבדיקות אינן נשברות).
 */
import { getLocale } from '../i18n.js';

function split(totalHours) {
  return {
    days: Math.floor(totalHours / 24),
    hours: totalHours % 24,
    totalHours,
  };
}

// שעה-ביום של שלב (0..23) אם הוגדרה, אחרת null. 0 הוא ערך תקף (חצות).
function stepSendHour(s) {
  return s?.sendHour === 0 || s?.sendHour ? Number(s.sendHour) : null;
}

/*
 * computeSchedule(steps) → לכל שלב, הקיזוז המצטבר מרגע ההרשמה.
 * [{ days, hours, sendHour, sendDate, repeatUnit, totalHours }] באותו סדר כמו steps.
 * sendHour עושה snap לאותה שעה באותו יום קלנדרי (כמו atJerusalemHour במנוע).
 */
export function computeSchedule(steps = []) {
  let day = 0; // ימים מרגע ההרשמה
  let hour = 0; // שעה ביום (0..23)
  return (steps || []).map((s) => {
    const dd = Math.max(0, Math.floor(Number(s?.delayDays) || 0));
    const dh = Math.max(0, Math.floor(Number(s?.delayHours) || 0));
    hour += dh;
    day += dd + Math.floor(hour / 24);
    hour %= 24;
    const sh = stepSendHour(s);
    if (sh != null) hour = sh; // snap לשעה המבוקשת, באותו יום
    return {
      days: day,
      hours: hour,
      sendHour: sh,
      sendDate: s?.sendDate || '',
      repeatUnit: s?.repeatInterval ? s?.repeatUnit || '' : '',
      totalHours: day * 24 + hour,
    };
  });
}

/*
 * sequenceDuration(steps) → הקיזוז של השלב האחרון = משך הרצף כולו
 * (מרגע ההרשמה ועד שליחת ההודעה האחרונה), כולל ה-snap לשעה.
 */
export function sequenceDuration(steps = []) {
  const sched = computeSchedule(steps);
  return sched.length ? split(sched[sched.length - 1].totalHours) : split(0);
}

// "יום ו-2 שעות" / "3 ימים" (he) · "1 day and 2 hours" / "3 days" (en) · "" (אפס)
function humanize(days, hours) {
  const parts = [];
  if (getLocale() === 'en') {
    if (days) parts.push(days === 1 ? '1 day' : `${days} days`);
    if (hours) parts.push(hours === 1 ? '1 hour' : `${hours} hours`);
    return parts.join(' and ');
  }
  if (days) parts.push(days === 1 ? 'יום' : `${days} ימים`);
  if (hours) parts.push(hours === 1 ? 'שעה' : `${hours} שעות`);
  return parts.join(' ו-');
}

const hhmm = (h) => `${String(h).padStart(2, '0')}:00`;
const REPEAT_SUFFIX = {
  he: { day: 'ואז כל יום', week: 'ואז כל שבוע', month: 'ואז כל חודש' },
  en: { day: 'then every day', week: 'then every week', month: 'then every month' },
};

/*
 * קיזוז שלב לתצוגה. מתחשב בשעה-ביום, בתאריך מוחלט ובחזרה:
 *   he: "מיד" · "כעבור 4 ימים בשעה 17:00" · "בתאריך 25.06 בשעה 09:00" · "… · ואז כל חודש"
 *   en: "immediately" · "after 4 days at 17:00" · "on 25.06 at 09:00" · "… · then every month"
 */
export function formatOffset({ days, hours, sendHour, sendDate, repeatUnit } = {}) {
  const L = getLocale() === 'en' ? 'en' : 'he';
  let base;
  if (L === 'en') {
    if (sendDate) {
      const [, m, d] = String(sendDate).split('-');
      base = d && m ? `on ${d}.${m}` : 'on a fixed date';
      if (sendHour != null) base += ` at ${hhmm(sendHour)}`;
    } else if (sendHour != null) {
      base = days ? `after ${humanize(days, 0)} at ${hhmm(sendHour)}` : `today at ${hhmm(sendHour)}`;
    } else if (!days && !hours) {
      base = 'immediately';
    } else {
      base = `after ${humanize(days, hours)}`;
    }
  } else {
    if (sendDate) {
      const [, m, d] = String(sendDate).split('-');
      base = d && m ? `בתאריך ${d}.${m}` : 'בתאריך קבוע';
      if (sendHour != null) base += ` בשעה ${hhmm(sendHour)}`;
    } else if (sendHour != null) {
      base = days ? `כעבור ${humanize(days, 0)} בשעה ${hhmm(sendHour)}` : `היום בשעה ${hhmm(sendHour)}`;
    } else if (!days && !hours) {
      base = 'מיד';
    } else {
      base = `כעבור ${humanize(days, hours)}`;
    }
  }
  const suffix = repeatUnit && REPEAT_SUFFIX[L][repeatUnit] ? ` · ${REPEAT_SUFFIX[L][repeatUnit]}` : '';
  return base + suffix;
}

// משך כולל לתצוגה: "מיידי"/"Immediate" כשאפס, אחרת humanize
export function formatDuration({ days, hours }) {
  if (!days && !hours) return getLocale() === 'en' ? 'Immediate' : 'מיידי';
  return humanize(days, hours);
}

/*
 * estimateFinishDate(steps, from) → אם הרצף יתחיל בזמן `from`, מתי תישלח ההודעה
 * האחרונה. מחזיר Date. (ה-UI נותן from=now כדי להציג תאריך משוער.)
 */
export function estimateFinishDate(steps = [], from = new Date()) {
  const { totalHours } = sequenceDuration(steps);
  return new Date(from.getTime() + totalHours * 3600 * 1000);
}

const DOW = {
  he: ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

/*
 * formatWhen("2026-07-02 19:00") → "ה׳ 2.7 · 19:00" (he) / "Thu 2.7 · 19:00" (en) —
 * יום בשבוע + תאריך + שעה. מציג את מועד השליחה המחושב של שלב שטרם נשלח במקום קיזוז
 * יחסי. מקבל "YYYY-MM-DD HH:MM" בשעון ישראל (כפי שה-engine מחזיר), ומחזיר את הקלט
 * כמות-שהוא אם אינו תאריך-שעה תקין (למשל "בקרוב").
 */
export function formatWhen(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/);
  if (!m) return s || '';
  const [, y, mo, d, hm] = m;
  // יום השבוע מהתאריך עצמו (ב-UTC כדי שאזור-הזמן של הדפדפן לא יזיז את היום)
  const dow = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay();
  const L = getLocale() === 'en' ? 'en' : 'he';
  return `${DOW[L][dow]} ${Number(d)}.${Number(mo)} · ${hm}`;
}
