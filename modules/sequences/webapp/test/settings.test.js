import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  compliancePayload,
  normalizeTab,
  quietWindow,
} from '../src/lib/settings.js';

// ── מטען השמירה ─────────────────────────────────────────────────────────────
// save_compliance הוא upsert של כל שורת המדיניות: מטען חלקי ידרוס שדות של מקטע אחר.

test('compliancePayload: כל שדות המדיניות נשלחים יחד, גם כשנערך רק אחד', () => {
  const form = { ...DEFAULT_SETTINGS, max_unengaged: 5 };
  const p = compliancePayload(form, '');
  for (const k of Object.keys(DEFAULT_SETTINGS)) assert.ok(k in p, `missing ${k}`);
  assert.equal(p.max_unengaged, 5);
  assert.equal(p.require_consent, true);
});

test('compliancePayload: שדות מספריים נשלחים כמספר גם כשה-input החזיר מחרוזת', () => {
  const p = compliancePayload({ ...DEFAULT_SETTINGS, max_marketing_per_day: '3', consent_max_age_days: '' }, '');
  assert.equal(p.max_marketing_per_day, 3);
  assert.equal(p.consent_max_age_days, 0); // ריק → 0, כמו בטופס המקורי
});

test('compliancePayload: מילות הסרה — פיצול בפסיק, גזירת רווחים, בלי ריקים', () => {
  const p = compliancePayload(DEFAULT_SETTINGS, ' הסר , stop ,, unsubscribe ');
  assert.deepEqual(p.opt_out_keywords, ['הסר', 'stop', 'unsubscribe']);
  assert.deepEqual(compliancePayload(DEFAULT_SETTINGS, '').opt_out_keywords, []);
});

test('compliancePayload: שעות השקט נשלחות כשעה שלמה 0-23 בלבד', () => {
  assert.equal(compliancePayload({ quiet_start_hour: '21', quiet_end_hour: '8' }, '').quiet_start_hour, 21);
  assert.equal(compliancePayload({ quiet_start_hour: '21', quiet_end_hour: '8' }, '').quiet_end_hour, 8);
  assert.equal(compliancePayload({ quiet_start_hour: 99 }, '').quiet_start_hour, 0);
  assert.equal(compliancePayload({ quiet_start_hour: -3 }, '').quiet_start_hour, 0);
  assert.equal(compliancePayload({ quiet_start_hour: 'abc' }, '').quiet_start_hour, 0);
});

test('compliancePayload: שדות שהמסך לא מציג (כמו quiet_tz) נשמרים כמו שנטענו', () => {
  const p = compliancePayload({ ...DEFAULT_SETTINGS, quiet_tz: 'Asia/Jerusalem', window_pull_enabled: true }, '');
  assert.equal(p.quiet_tz, 'Asia/Jerusalem');
  assert.equal(p.window_pull_enabled, true);
});

// ── חלון השקט ───────────────────────────────────────────────────────────────

test('quietWindow: התחלה == סיום ⇒ כבוי (זהה ל-accountQuietWindow במנוע)', () => {
  assert.equal(quietWindow({ quiet_start_hour: 0, quiet_end_hour: 0 }), null);
  assert.equal(quietWindow({ quiet_start_hour: 9, quiet_end_hour: 9 }), null);
  assert.deepEqual(quietWindow({ quiet_start_hour: 21, quiet_end_hour: 8 }), { start: 21, end: 8 });
});

// ── ניווט ───────────────────────────────────────────────────────────────────

test('normalizeTab: הלשונית הישנה presence נוחתת בהגדרות על מקטע הנוכחות', () => {
  assert.deepEqual(normalizeTab('presence'), { view: 'settings', section: 'presence' });
});

test('normalizeTab: טאבים קיימים ממשיכים כרגיל, לא-מוכר מוחזר null', () => {
  assert.deepEqual(normalizeTab('compliance'), { view: 'compliance', section: null });
  assert.deepEqual(normalizeTab('settings'), { view: 'settings', section: null });
  assert.equal(normalizeTab('nope'), null);
  assert.equal(normalizeTab(null), null);
});
