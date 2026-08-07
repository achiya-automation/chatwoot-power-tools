/*
 * settings — הלוגיקה הטהורה של לשונית "הגדרות" (components/SettingsView.jsx):
 * מה נשלח לשרת בשמירת המדיניות, ואיך מפרשים בקשת ניווט שמגיעה מבחוץ.
 * חסר-React בכוונה, כדי שיהיה ניתן לבדיקה ב-node (test/settingsForm.test.js).
 */

// ברירות מחדל — ה-API מחזיר settings:{} כשאין שורה לחשבון.
export const DEFAULT_SETTINGS = {
  require_consent: true,
  max_marketing_per_day: 1,
  max_unengaged: 3,
  max_cap_failures: 2,
  consent_max_age_days: 30,
  block_us_marketing: true,
  halt_on_red: true,
  opt_out_keywords: [],
  // שעות השקט של החשבון. התחלה == סיום ⇒ כבוי (זהה ל-accountQuietWindow במנוע).
  quiet_start_hour: 0,
  quiet_end_hour: 0,
};

// שדות המדיניות המספריים — טופס אחיד (תווית + "למה זה קיים" + input)
export const NUMBER_FIELDS = ['max_marketing_per_day', 'max_unengaged', 'max_cap_failures', 'consent_max_age_days'];
// שדות המדיניות הבוליאניים — מתגים
export const BOOL_FIELDS = ['require_consent', 'block_us_marketing', 'halt_on_red'];
// שעות שלמות (0-23) — כך drip.compliance שומר את חלון השקט
export const HOUR_FIELDS = ['quiet_start_hour', 'quiet_end_hour'];

const toHour = (v) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : 0;
};

/**
 * המטען של save_compliance. ⚠️ ה-RPC הוא upsert לשורה אחת ושומר את *כל* השדות
 * ביחד — לכן כל שמירה בלשונית שולחת את התמונה המלאה (form כפי שנטען מהשרת),
 * בדיוק כמו הטופס המקורי בתצוגת הציות. מקטע שנשלח חלקית ימחק שדות של מקטע אחר.
 */
export function compliancePayload(form, keywordsText) {
  return {
    ...form,
    ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, Number(form[k]) || 0])),
    ...Object.fromEntries(HOUR_FIELDS.map((k) => [k, toHour(form[k])])),
    opt_out_keywords: String(keywordsText ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/** חלון השקט כ-{start,end} שעות, או null כשהוא כבוי. תואם accountQuietWindow במנוע. */
export function quietWindow(form) {
  const start = toHour(form?.quiet_start_hour);
  const end = toHour(form?.quiet_end_hour);
  return start === end ? null : { start, end };
}

// מקטעי הלשונית, לפי הסדר שהוצג ואושר
export const SETTINGS_SECTIONS = ['inbox', 'hours', 'compliance', 'presence'];

// הטאבים של האפליקציה (הסיידבר של Chatwoot שולח את השם הזה ב-postMessage / ?tab=)
export const VIEWS = ['overview', 'sequences', 'contacts', 'campaigns', 'compliance', 'templates', 'journeys', 'settings'];

/**
 * בקשת ניווט → { view, section }. 'presence' הייתה לשונית בפני עצמה: הפריט
 * בסיידבר, deep-link ?tab=presence וה-localStorage של משתמשים קיימים עדיין
 * שולחים אותה — היא נוחתת בלשונית ההגדרות, על מקטע הנוכחות. null = לא מוכר.
 */
export function normalizeTab(raw) {
  if (raw === 'presence') return { view: 'settings', section: 'presence' };
  return VIEWS.includes(raw) ? { view: raw, section: null } : null;
}
