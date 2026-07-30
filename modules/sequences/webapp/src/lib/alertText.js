/*
 * נוסח ההתראות ועצירות החשבון, בשפת הנציג.
 *
 * המנוע כותב ל-drip.alerts שלושה דברים: `code` (מפתח תרגום), `params` (מה שמשתנה —
 * שם תבנית, מספרים, קוד שגיאה של מטא), ו-`message` — משפט עברית מוכן.
 *
 * עד מיגרציה 034 היה רק `message`, וה-UI הדפיס אותו כמו שהוא: נציג שעובד באנגלית קיבל
 * דשבורד אנגלי עם התראות בעברית. כאן מתרגמים לפי `code`, ונופלים ל-`message` בשני
 * מקרים — התראה שנוצרה לפני המיגרציה, וקוד שאין לו עדיין תרגום. התראה בשפה הלא-נכונה
 * עדיפה על התראה ריקה.
 *
 * `t` מוזרק (ולא מיובא) כדי שהמודול יישאר טהור וניתן לבדיקה בלי React.
 */

/**
 * סיבת עצירה. משמשת גם בכרטיס בריאות המספר וגם בתוך התראת `halted`.
 *
 * @param {(key: string, vars?: object) => string} t
 * @param {string|null} code   - quality_red | delivery_floor | meta_policy
 * @param {object|null} params
 * @param {string|null} raw    - halt_reason הגולמי (fallback)
 */
export function haltText(t, code, params, raw) {
  if (!code) return raw || '';
  const key = `hz_${code}`;
  const s = t(key, params || {});
  return s === key ? (raw || '') : s;
}

/**
 * נוסח שורת ההתראה.
 *
 * שני דברים לא-מובנים-מאליהם:
 *  - `code` של התראה ייחודית-לתבנית נושא את שם התבנית (`template_burned:promo_08`), כדי
 *    ש-ON CONFLICT ימנע כפילות פר-תבנית. מפתח התרגום הוא החלק שלפני הנקודתיים.
 *  - `halted` הוא מעטפת: הטקסט שמעניין את המשתמש הוא *הסיבה* (`params.cause`), לא
 *    המילה "נעצר". בלי זה כל עצירה נראית זהה.
 *
 * @param {(key: string, vars?: object) => string} t
 * @param {{code?: string, params?: object, message?: string}} a
 * @returns {string}
 */
export function alertText(t, a) {
  if (!a) return '';
  const base = String(a.code || '').split(':')[0];
  const p = a.params || {};

  if (base === 'halted') {
    const why = haltText(t, p.cause, p, p.reason);
    return why ? `${t('haltedPrefix')}${why}` : (a.message || '');
  }

  // תבנית עם עותק שריפה מקבלת עצה *הפוכה* מתבנית בלעדיו ("אין צורך ליצור תבנית" מול
  // "צרו עותק") — לכן מפתח נפרד ולא משפט מסועף. ואריאנט שאין לו תרגום נופל ל-message
  // הגולמי, לא למפתח הבסיס: הבסיס היה נותן לנציג את העצה הלא-נכונה.
  const variantKey =
    (base === 'template_burned'    && p.burnCopy)    ? 'al_template_burned_copy' :
    (base === 'template_degrading' && p.hasBurnCopy) ? 'al_template_degrading_copy' : null;
  const key = variantKey || `al_${base}`;
  const s = t(key, p);
  return s === key ? (a.message || '') : s;
}
