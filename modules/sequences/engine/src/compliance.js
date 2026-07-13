/**
 * compliance.js — שכבת הציות לכללי מטא.
 *
 * מטא דורשת משלוש שיחה שהעסק יוזם להיות Expected (הלקוח נתן הסכמה), Timely ו-Relevant,
 * ואוכפת את זה דרך מכסה אישית מסתגלת לשיווק, השהיית תבניות, pacing וחסימות מדיניות.
 * המודול הזה מתרגם את הכללים האלה לשער אחד שכל שליחה עוברת דרכו.
 *
 * הלוגיקה כאן טהורה ובדיקה (isOptOut / classifyError / canSend); הפונקציות שנוגעות
 * ב-DB מרוכזות בחלק השני ומקבלות pool מבחוץ.
 *
 * מקורות (מטא, רשמי):
 *   business/help/687938765816627                      — Expected / Timely / Relevant
 *   .../templates/marketing-templates/per-user-limits/ — 131049, "wait at least 24 hours"
 *   .../templates/template-pausing/                    — 3h → 6h → disabled
 *   .../templates/template-pacing/                     — 132015 על הודעות שהוחזקו ונזרקו
 *   .../templates/portfolio-pacing/                    — 135000
 */

// ═══════════════════════════════════════════════════════════════════════════
// חלק א' — לוגיקה טהורה
// ═══════════════════════════════════════════════════════════════════════════

/**
 * מילות הסרה חד-משמעיות — מזוהות בכל מקום בהודעה (מילה שלמה או צירוף).
 * לא כוללות מילים דו-משמעיות ("די", "cancel") — אלה ב-WEAK למטה.
 */
const STRONG_WORDS = [
  'הסר', 'הסירו', 'הסירי', 'להסיר', 'תסיר', 'תסירו', 'הסרה', 'להסרה', 'הסירוני',
  'unsubscribe', 'optout',
];
const STRONG_PHRASES = [
  'opt out', 'remove me', 'take me off', 'stop messaging', 'no more messages',
  'do not contact', "don't contact", 'dont contact',
  'לא מעוניין', 'לא מעוניינת', 'לא מענין',
  'אל תשלחו', 'אל תשלח', 'לא לשלוח', 'תפסיקו לשלוח', 'הפסיקו לשלוח',
  'תורידו אותי', 'תוריד אותי', 'הורידו אותי', 'תוציאו אותי', 'להוריד אותי',
];

/**
 * מילים דו-משמעיות — נחשבות הסרה רק כשהן כמעט כל ההודעה (עד 2 מילים).
 * "די" בהודעה בת מילה אחת = הסרה; "די טוב, תודה" = לא.
 */
const WEAK_WORDS = ['stop', 'די', 'ביטול', 'לבטל', 'תפסיק', 'תפסיקו', 'הפסק', 'הפסיקו', 'עזבו', 'תעזבו'];
const WEAK_MAX_TOKENS = 2;

/** ניקוד, סימני פיסוק ורווחים כפולים החוצה; אותיות קטנות. */
const normalize = (s) =>
  String(s || '')
    .replace(/[֑-ׇ]/g, '')            // ניקוד/טעמים
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')          // פיסוק → רווח
    .replace(/\s+/g, ' ')
    .trim();

/**
 * האם ההודעה היא בקשת הסרה?
 *
 * ההתאמה היא ברמת מילה שלמה, לא substring — "הסרטון" לא יזוהה כ"הסר".
 * מוטה לכיוון זיהוי: החמצה של בקשת הסרה גורמת לחסימה ולנזק לדירוג האיכות של
 * המספר כולו, בעוד זיהוי-שווא עולה ליד אחד — והוא הפיך בקליק אחד מהדשבורד.
 *
 * @param {string} text
 * @param {string[]} [extra] - מילות הסרה נוספות שהלקוח הגדיר
 * @returns {string|null} הביטוי שהותאם, או null
 */
export function isOptOut(text, extra = []) {
  const norm = normalize(text);
  if (!norm) return null;
  const tokens = norm.split(' ');

  for (const p of STRONG_PHRASES) {
    if (norm.includes(normalize(p))) return p;
  }
  for (const w of [...STRONG_WORDS, ...(extra || []).map(normalize).filter(Boolean)]) {
    if (tokens.includes(normalize(w))) return w;
  }
  if (tokens.length <= WEAK_MAX_TOKENS) {
    for (const w of WEAK_WORDS) {
      if (tokens.includes(w)) return w;
    }
  }
  return null;
}

/** MARKETING היא הקטגוריה היחידה שכפופה למכסה האישית ולדרישת ההסכמה. */
export const isMarketing = (category) =>
  String(category || 'MARKETING').toUpperCase() === 'MARKETING';

// אזורי חיוג קנדיים — חולקים את קידומת +1 עם ארה"ב. כל +1 שאינו קנדי מטופל כאמריקאי.
const CANADA_AREA_CODES = new Set([
  '204','226','236','249','250','263','289','306','343','354','365','367','368','382','387',
  '403','416','418','428','431','437','438','450','468','474','506','514','519','548','579',
  '581','584','587','604','613','639','647','672','683','705','709','742','753','778','780',
  '782','807','819','825','867','873','879','902','905',
]);

/**
 * מטא לא מוסרת תבניות שיווקיות למספרים אמריקאיים (+1 עם אזור חיוג של ארה"ב) — כלל,
 * לא מכסה. כל שליחה כזו נכשלת ודאית, עולה כסף ומייצרת רעש שגיאות.
 * מקור: .../marketing-templates/per-user-limits/ § "United States phone numbers"
 */
export function isUsNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d.startsWith('1') || d.length !== 11) return false;   // +1 ואחריו 10 ספרות
  return !CANADA_AREA_CODES.has(d.slice(1, 4));
}

/**
 * סיווג קוד שגיאה של מטא לפעולה שהמנוע צריך לנקוט.
 *
 *   cap             — מכסה אישית לשיווק. לחכות ≥24h (הוראה מפורשת של מטא), לא לרדוף.
 *   template_paused — התבנית מושהית (3h/6h). לדחות את הרצף, לא לשרוף את הליד.
 *   pacing          — מטא החזיקה וזרקה בגלל pacing. לדחות ולנסות שוב.
 *   transient       — תקלה זמנית של מטא. לנסות שוב עם backoff.
 *   optout          — המשתמש סירב לשיווק. לחסום אותו לצמיתות.
 *   invalid         — לא מספר וואטסאפ תקין. לחסום (אין למי לשלוח).
 *   policy          — חסימה/הגבלה ברמת החשבון. עצירת חירום + התראה.
 *   permanent       — כשל אמיתי. לסמן את הליד ולהמשיך.
 *
 * @param {string|number|null} code
 * @returns {'cap'|'template_paused'|'pacing'|'transient'|'optout'|'invalid'|'policy'|'permanent'}
 */
export function classifyError(code) {
  const c = String(code || '');
  switch (c) {
    case '131049':                // per-user marketing limit ("healthy ecosystem engagement")
    case '130472':                // user is part of a Meta experiment
    case '131056':                // pair rate limit (יותר מדי הודעות בין המספר הזה לנמען הזה)
      return 'cap';
    case '132015':                // template paused (pacing / low quality)
      return 'template_paused';
    case '135000':                // business portfolio pacing — ההודעה הוחזקה ונזרקה
      return 'pacing';
    case '131050':                // user is not accepting marketing messages
      return 'optout';
    case '131026':                // message undeliverable — לא משתמש וואטסאפ
    case '131021':                // recipient == sender
      return 'invalid';
    case '368':                   // temporarily blocked for policy violations
    case '131031':                // account has been locked
      return 'policy';
    case '130429':                // rate limit hit
    case '133004':                // server temporarily unavailable
    case '131000':                // generic something-went-wrong
    case '80007':                 // rate limit
      return 'transient';
    default:
      // 133xxx (מלבד 133004) — בעיות רישום/דה-רגיסטרציה של המספר. שום הודעה לא
      // תעבור עד שהן נפתרות, אז אין טעם להמשיך לנסות: עצירה + התראה.
      if (/^133\d{3}$/.test(c)) return 'policy';
      return 'permanent';
  }
}

const SESSION_MS = 24 * 3600 * 1000;

/**
 * האם יש חלון שירות פתוח — כלומר, הנמען הגיב ב-24 השעות האחרונות.
 *
 * זה הנכס היקר ביותר שיש למנוע. מטא: הודעה שיווקית שנשלחת בתוך חלון שירות פתוח
 * *לא נספרת* לא במכסה האישית של הנמען ולא במגבלת ה-24h של הפורטפוליו. מי שהגיב הוא
 * בדיוק מי שאפשר להמשיך לדבר איתו בחינם — מבחינת מכסות.
 */
export const inSession = (contact, now = new Date()) => {
  const t = contact?.last_inbound_at;
  if (!t) return false;
  return now.getTime() - new Date(t).getTime() < SESSION_MS;
};

/** ברירות המחדל של הגדרות הציות — חשבון בלי שורה ב-drip.compliance מקבל אותן. */
export const DEFAULT_SETTINGS = Object.freeze({
  require_consent:       true,
  max_marketing_per_day: 1,
  max_unengaged:         3,
  max_cap_failures:      2,
  consent_max_age_days:  30,
  block_us_marketing:    true,
  halt_on_red:           true,
  opt_out_keywords:      [],
  // תקציב הכישלונות של תבנית. מטא לא מפרסמת סף — ומדידה על החשבון הזה (n=4,998, בבקרה
  // על היסטוריית החסימות של הנמענת, שאחרת מתחזה לאפקט של התבנית) מראה הידרדרות רציפה
  // ולא צוק: ~86% מסירה בתבנית טרייה, ~67% אחרי 10-14 כישלונות, וקריסה ל-~20% מעבר ל-50.
  // 15 הוא בלם זהירות, לא סף מדוד: הוא עוצר תבנית שמידרדרת בעודה רחוקה מהקריסה, ומתריע
  // שצריך תאומה — במקום לגלות את זה מהדוח של הלקוח.
  max_template_failures: 15,
});

/**
 * השער. מחליט אם מותר לשלוח את הצעד הזה, לאיש הקשר הזה, עכשיו.
 *
 * הסדר מכוון: קודם מה שחוסם הכל (עצירת חשבון, תבנית מושהית), אחר כך מה שחוסם את
 * איש הקשר, ורק אז המכסות. `blocked` פירושו "לא היום" (הליד נשאר ברצף וממתין);
 * `drop` פירושו "לעולם לא" (הליד נחסם ויוצא).
 *
 * @param {object} a
 * @param {string} a.category      - MARKETING | UTILITY | AUTHENTICATION
 * @param {object} a.contact       - שורת drip.contact_state (או {} אם אין)
 * @param {string} a.phone         - מספר הנמען
 * @param {object} a.settings      - drip.compliance (או DEFAULT_SETTINGS)
 * @param {object} a.health        - drip.account_health (או {})
 * @param {object|null} a.template - drip.template_health לתבנית הזו (null = לא ידוע)
 * @param {number} a.sentToday     - תבניות שיווק שנשלחו לאיש הקשר ב-24h האחרונות
 * @param {boolean} a.inSession    - האם יש חלון שירות פתוח (הנמען הגיב ב-24h האחרונות)
 * @returns {{ok: boolean, reason?: string, action?: 'defer'|'drop', detail?: string}}
 */
export function canSend({ category, contact = {}, phone, settings = DEFAULT_SETTINGS,
                          health = {}, template = null, sentToday = 0, inSession = false }) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };

  // ── חוסם הכל ────────────────────────────────────────────────────────────
  if (health.halted) {
    return { ok: false, reason: 'account_halted', action: 'defer', detail: health.halt_reason || '' };
  }

  // תבנית שאינה APPROVED — מטא תדחה את הבקשה בכל מקרה. ההשהיה נמשכת 3 או 6 שעות,
  // אז זו דחייה ולא כישלון: הליד נשאר בדיוק במקומו. תבנית שאין עליה מידע נשלחת
  // (fail-open) — הכשלה על סמך חוסר-ידע הייתה משתקת לקוח בכל תקלת Graph.
  if (template && template.status && template.status !== 'APPROVED') {
    return { ok: false, reason: `template_${String(template.status).toLowerCase()}`, action: 'defer' };
  }

  // ── חוסם את איש הקשר ────────────────────────────────────────────────────
  const marketing = isMarketing(category);
  if (contact.suppressed_at) {
    const scope = contact.suppressed_scope || 'marketing';
    if (scope === 'all' || marketing) {
      // ⚠️ רוויה (`saturated`) אינה בקשה של הנמענת — היא תקרה של מטא, והיא שונה מהותית
      // מ-opt-out. מטא: התקרה "מסתגלת אוטומטית עם הזמן", ו*מתבטלת* בתוך חלון שירות פתוח.
      // לכן היא נדחית ולא מסירה: הלידה נשארת ברצף, ואם תגיב אי-פעם — תקבל הכל (נמדד:
      // 25/25 = 100% מסירה בחלון פתוח, מול 7.9% לנמענת שמטא כבר חסמה).
      // מי שביקש להסיר (keyword / 131050) או שאינו נמען תקף — נשאר חסום תמיד.
      const capBased = contact.suppressed_reason === 'saturated';
      if (!capBased) {
        return { ok: false, reason: 'suppressed', action: 'drop', detail: contact.suppressed_reason || '' };
      }
      if (!inSession) {
        return { ok: false, reason: 'saturated', action: 'defer', detail: contact.suppressed_reason || '' };
      }
    }
  }

  // UTILITY / AUTHENTICATION לא כפופות למכסה האישית של מטא ולא לדרישת ההסכמה
  // לשיווק — הן עוברות משכאן.
  if (!marketing) return { ok: true };

  // הודעה שיווקית בתוך חלון שירות פתוח (הנמען הגיב ב-24 השעות האחרונות) פטורה
  // מהמכסה האישית *ומ*מגבלת ה-24h של הפורטפוליו. מטא, per-user-limits:
  // "Marketing messages sent within this window do not count towards the limit."
  if (inSession) return { ok: true, reason: 'in_session' };

  // ── מכסות שיווק ─────────────────────────────────────────────────────────
  // ההסכמה נבדקת בשתי רמות, ודי באחת מהן:
  //   • הצהרת בעל המידע (drip.blanket_consent) — הלקוח חתם שכל הרשימות שלו הסכימו.
  //     זו הרמה הנכונה: ההסכמה שייכת למפרסם, לא לנו. שורה אחת מכסה את כל הלידים שלו.
  //   • consent_at פר-איש-קשר — opt-in ישיר שנרשם אצלנו (טופס, תווית, RPC).
  // אין אף אחת מהן → defer. לקוח שלא הצהיר לא ישלח שיווק בטעות (תיקון 40: עד ₪1,000
  // להודעה; ולמטא זו סיבה #1 להשבתת מספרים).
  if (s.require_consent && !contact.consent_at && !s.blanket_consent) {
    return { ok: false, reason: 'no_consent', action: 'defer' };
  }
  if (s.block_us_marketing && isUsNumber(phone)) {
    return { ok: false, reason: 'us_number', action: 'drop' };
  }
  if (Number(sentToday) >= Number(s.max_marketing_per_day)) {
    return { ok: false, reason: 'daily_cap', action: 'defer' };
  }

  // ── תקציב הכישלונות של התבנית ───────────────────────────────────────────
  // עוצר תבנית שמידרדרת לפני שהיא מתה, ומסמן אותה להחלפה.
  //
  // ⚠️ אבל רק לנמענות שכבר *הראו סיכון* (מטא חסמה אותן פעם אחת לפחות). זו לא החמרה
  // אלא הדיוק שמונע ירייה ברגל: קהל נקי מוסר ב-84%, כלומר גם שליחה מושלמת ל-120 לידים
  // בריאים מייצרת ~19 כישלונות טבעיים. תקציב שסופר אותם היה חוסם את התבנית בדיוק בשביל
  // הלידים הטובים — ומקפיא את הרצף. הכישלונות ששורפים תבנית מגיעים מהזנב הרווי (7.9%
  // מסירה), ורק הוא נעצר כאן.
  //
  // מתחת ל-inSession בכוונה: שליחה בחלון פתוח עוקפת את התקרה, נמסרת (100%), ו*משפרת*
  // את מוניטין התבנית. חסר מידע על התבנית ⇒ שולחים (fail-open).
  if (template && Number(template.failures || 0) >= Number(s.max_template_failures)
      && Number(contact.cap_failures || 0) > 0) {
    return { ok: false, reason: 'template_burned', action: 'defer' };
  }

  // הגנות עומק — הכתיבה עצמה נעשית ב-reconcileDeliveries, אבל אם מחזור אחד פספס,
  // השער לא ישלח בכל זאת. רוויה = דחייה, לא הסרה (ראה ההערה למעלה).
  if (Number(contact.cap_failures || 0) >= Number(s.max_cap_failures)) {
    return { ok: false, reason: 'saturated', action: 'defer' };
  }
  if (Number(contact.unengaged_streak || 0) >= Number(s.max_unengaged)) {
    return { ok: false, reason: 'unengaged', action: 'drop' };
  }

  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// חלק ב' — גישה ל-DB
// ═══════════════════════════════════════════════════════════════════════════

/** הגדרות הציות של החשבון, עם ברירות המחדל הבטוחות למי שאין לו שורה. */
export async function loadSettings(pool, accountId) {
  const { rows } = await pool.query(
    `SELECT * FROM drip.compliance WHERE account_id = $1`, [accountId]
  );

  // הצהרת בעל המידע: המפרסם (הלקוח) חתם שכל הנמענים ברשימותיו הסכימו לקבל דבר
  // פרסומת. ההסכמה שייכת לו, לא לנו — ולכן היא נבדקת ברמת החשבון, לא פר-ליד.
  //
  // שתי רמות, הספציפית גוברת:
  //   • account_id = <החשבון>  — הצהרה נפרדת ללקוח מסוים.
  //   • account_id = 0         — ההצהרה הגלובלית: תנאי ההתקשרות הסטנדרטיים, שבהם
  //                              כל לקוח מצהיר בחתימה על ההסכם. שורה אחת מכסה את כל
  //                              החשבונות — הקיימים והעתידיים.
  //
  // ⚠️ אינה גוברת על suppressed_at: מי שביקש להסיר לא מקבל, גם עם הצהרה. זה נבדק
  // קודם ב-canSend ואינו ניתן לעקיפה.
  // fail-closed: כל תקלה כאן משמעה "אין הצהרה" ⇒ השיווק נחסם. זה הכיוון הבטוח —
  // אבל הוא גם שקט, ולכן ⚠️ חייבים לצעוק: תקלת הרשאה (`GRANT SELECT` חסר ל-drip_engine)
  // נראית בדיוק כמו "אין הצהרה", ותשתק לקוח שלם בלי סימן. 42P01 = הטבלה לא קיימת
  // (טסטים/התקנה נקייה) — זה תרחיש לגיטימי ושקט. כל שאר השגיאות נרשמות.
  const { rows: bc } = await pool.query(
    `SELECT source, detail, declared_at, declared_by
       FROM drip.blanket_consent
      WHERE account_id IN ($1, 0)
      ORDER BY (account_id = $1) DESC
      LIMIT 1`, [accountId]
  ).catch((e) => {
    if (e.code !== '42P01') {
      console.error(`[drip] blanket_consent unreadable for acct ${accountId} (${e.code}: ${e.message}) — שיווק ייחסם`);
    }
    return { rows: [] };
  });

  const blanket = bc[0] ? { blanket_consent: true, blanket_consent_source: bc[0].source } : {};

  if (!rows[0]) return { ...DEFAULT_SETTINGS, ...blanket };
  return {
    ...DEFAULT_SETTINGS,
    ...rows[0],
    ...blanket,
    opt_out_keywords: rows[0].opt_out_keywords || [],
  };
}

/** בריאות החשבון (tier / איכות / עצירה). {} כשאין עדיין שורה. */
export async function loadHealth(pool, accountId) {
  const { rows } = await pool.query(
    `SELECT * FROM drip.account_health WHERE account_id = $1`, [accountId]
  );
  return rows[0] || {};
}

/** מפת contact_id → שורת contact_state, לאנשי הקשר שעומדים להישלח בטיק הזה. */
export async function loadContactStates(pool, accountId, contactIds) {
  const ids = (contactIds || []).filter(Number.isFinite);
  if (!ids.length) return new Map();
  const { rows } = await pool.query(
    `SELECT * FROM drip.contact_state WHERE account_id = $1 AND contact_id = ANY($2::int[])`,
    [accountId, ids]
  );
  return new Map(rows.map((r) => [r.contact_id, r]));
}

/**
 * מפת "<name>|<lang>" → שורת template_health, **בתוספת `failures`** — מספר המסירות
 * שנכשלו בתבנית הזו מאז ומעולם. זה המונה שעליו עובד `max_template_failures`.
 *
 * למה לספור מ-sent_messages ולא לשמור עמודה: התאומה (`_v3`) היא שם חדש, ולכן המונה שלה
 * מתאפס מעצמו — בדיוק כמו אצל מטא. עמודה נפרדת הייתה דורשת איפוס ידני בכל החלפה.
 * ⚠️ `quality_score` של מטא מחזיר UNKNOWN לתמיד בנפחים האלה — הוא אינו אזהרה מוקדמת.
 */
export async function loadTemplateHealth(pool, accountId) {
  const { rows } = await pool.query(
    `SELECT th.*, COALESCE(f.failures, 0)::int AS failures
       FROM drip.template_health th
       LEFT JOIN (
              SELECT template_name, count(*) AS failures
                FROM drip.sent_messages
               WHERE account_id = $1 AND delivery_status = 'failed'
               GROUP BY template_name
            ) f ON f.template_name = th.template_name
      WHERE th.account_id = $1`, [accountId]
  );
  const m = new Map();
  for (const r of rows) {
    m.set(`${r.template_name}|${r.language}`, r);
    if (!m.has(r.template_name)) m.set(r.template_name, r);   // fallback לפי שם בלבד
  }
  return m;
}

/** התראה לדשבורד. אידמפוטנטית — התראה פתוחה זהה לא תיווצר פעמיים. */
export async function raiseAlert(pool, accountId, level, code, message) {
  try {
    await pool.query(
      `INSERT INTO drip.alerts (account_id, level, code, message)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [accountId, level, code, String(message).slice(0, 500)]
    );
  } catch (e) {
    console.error(`[drip] raiseAlert failed acct ${accountId}:`, e.message);
  }
}

/**
 * עצירת חירום לחשבון. מטא סימנה בעיה ברמת המספר (RED / 368 / 133xxx) — כל שליחה
 * נוספת רק מקרבת להשעיה. עוצר, מתריע, ומחכה שאדם ישחרר ידנית (drip.resume_account).
 */
export async function haltAccount(pool, accountId, reason) {
  await pool.query(
    `INSERT INTO drip.account_health (account_id, halted, halt_reason, halted_at)
     VALUES ($1, true, $2, now())
     ON CONFLICT (account_id) DO UPDATE
       SET halted = true, halt_reason = $2, halted_at = now()`,
    [accountId, reason]
  );
  await raiseAlert(pool, accountId, 'critical', 'halted', `השליחה נעצרה אוטומטית: ${reason}`);
  console.error(`[drip] ACCOUNT ${accountId} HALTED — ${reason}`);
}

/**
 * חסימת איש קשר. עוצר את הרצף הפעיל ומנקה את התכונה `sequence` ב-Chatwoot, כדי
 * שגם שיוך המוני עתידי לא יחזיר אותו פנימה — בלי זה החסימה הייתה מתאדה בשיוך הבא.
 *
 * @param {'keyword'|'meta_131050'|'meta_368'|'saturated'|'unengaged'|'invalid'|'manual'} reason
 * @param {'marketing'|'all'} [scope]
 */
export async function suppressContact(pool, accountId, contactId, reason, detail = '', scope = 'marketing') {
  await pool.query(
    `INSERT INTO drip.contact_state (account_id, contact_id, suppressed_at, suppressed_reason, suppressed_detail, suppressed_scope)
     VALUES ($1, $2, now(), $3, $4, $5)
     ON CONFLICT (account_id, contact_id) DO UPDATE
       SET suppressed_at = now(), suppressed_reason = $3, suppressed_detail = $4,
           suppressed_scope = $5, updated_at = now()`,
    [accountId, contactId, reason, String(detail).slice(0, 500), scope]
  );
  await pool.query(
    `UPDATE drip.enrollments SET status = 'stopped'
      WHERE account_id = $1 AND contact_id = $2 AND status = 'active'`,
    [accountId, contactId]
  );
  await pool.query(
    `UPDATE public.contacts SET custom_attributes = custom_attributes - 'sequence'
      WHERE account_id = $1 AND id = $2`,
    [accountId, contactId]
  );
}

/**
 * Phase 0 — סריקת הודעות נכנסות.
 *
 * מזהה בקשות הסרה ומעדכן מעורבות, בלי webhook: המנוע כבר קורא מ-Postgres של
 * Chatwoot וכבר רץ כל 60 שניות, אז סריקה מצטברת לפי סמן על messages.id נותנת את
 * אותה תוצאה באיחור של דקה לכל היותר — ובלי הגדרה נפרדת אצל כל לקוח. בשביל מוצר
 * שנמכר להרבה לקוחות זה ההבדל בין "עובד" ל"צריך התקנה".
 *
 * תגובה של נמען היא גם האות היקר ביותר שמטא נותנת: היא מאפסת את המכסה האישית שלו
 * ופותחת חלון 24h שבו שיווק לא נספר בכלל. לכן כל תגובה מאפסת את שני המונים.
 *
 * @returns {Promise<{scanned: number, optOuts: number}>}
 */
export async function scanInbound(pool, accountId, now = new Date(), settings = null) {
  const s = settings || (await loadSettings(pool, accountId));

  // סמן ההתקדמות. בריצה ראשונה מתחילים מ-90 יום אחורה: זה קולט בקשות הסרה
  // היסטוריות שמעולם לא כובדו (ובדיוק אלה שמייצרות דיווחי ספאם), בלי לסרוק שנים.
  const { rows: hrows } = await pool.query(
    `SELECT last_scanned_message_id FROM drip.account_health WHERE account_id = $1`, [accountId]
  );
  let watermark = Number(hrows[0]?.last_scanned_message_id || 0);
  if (!watermark) {
    const { rows } = await pool.query(
      `SELECT COALESCE(min(m.id), 0)::bigint AS id
         FROM public.messages m
        WHERE m.account_id = $1 AND m.created_at > $2::timestamptz - interval '90 days'`,
      [accountId, now]
    );
    watermark = Math.max(0, Number(rows[0]?.id || 0) - 1);
  }

  const { rows } = await pool.query(
    `SELECT m.id, m.content, m.created_at, c.contact_id
       FROM public.messages m
       JOIN public.conversations c ON c.id = m.conversation_id
      WHERE m.account_id   = $1
        AND m.id           > $2
        AND m.message_type = 0            -- נכנסת
        AND c.contact_id IS NOT NULL
      ORDER BY m.id
      LIMIT 2000`,
    [accountId, watermark]
  );

  // מכווצים את האצווה לפי איש קשר לפני שכותבים. אצווה של 2000 הודעות מגיעה בדרך כלל
  // מכמה עשרות אנשים, ומי שביקש הסרה בדרך כלל כתב את זה יותר מפעם אחת — בלי הכיווץ זו
  // אותה חסימה שנכתבת עשרות פעמים ואותה שורת לוג שמוצפת. ההסרה גוברת על כל תגובה אחרת.
  const byContact = new Map();
  for (const r of rows) {
    watermark = Math.max(watermark, Number(r.id));
    const prev = byContact.get(r.contact_id);
    const hit  = isOptOut(r.content, s.opt_out_keywords);
    if (!prev) {
      byContact.set(r.contact_id, { lastInbound: r.created_at, hit });
      continue;
    }
    if (new Date(r.created_at) > new Date(prev.lastInbound)) prev.lastInbound = r.created_at;
    if (hit && !prev.hit) prev.hit = hit;
  }

  let optOuts = 0;
  for (const [contactId, { lastInbound, hit }] of byContact) {
    // כל תגובה = מעורבות. מאפסת את מוני הכשל ופותחת חלון שירות של 24h.
    //
    // הזמן הוא של ההודעה עצמה, לא now(): בריצה הראשונה סורקים 90 יום אחורה, ותגובה
    // מלפני חודשיים אסור שתיראה כחלון שירות פתוח. Chatwoot שומר created_at כ-UTC נאיבי.
    // GREATEST מגן מפני סדר לא-מונוטוני בין id ל-created_at.
    // ⛔ cap_failures לא מתאפס כאן. הוא היה מתאפס, וזה שיקר:
    // תגובה *ישנה* לא מרפה את התקרה של מטא. נמדד 13/07 — 13 לידים שהמונה שלהם אופס
    // ע"י תגובה מלפני שבועות נשלחו כ"נקיים" וחזרו **13/13 עם 131049**. במקביל, לידים
    // עם מונה אמיתי 0 נמסרו 3/3. המונה חייב לספור את כל ההיסטוריה, אחרת הוא מסווה
    // בדיוק את מי שאסור לשלוח אליו.
    // מה שכן מרפה את התקרה זה **חלון שירות פתוח** — וזה נבדק ב-inSession, לא כאן.
    await pool.query(
      `INSERT INTO drip.contact_state (account_id, contact_id, last_inbound_at, unengaged_streak, cap_failures)
       VALUES ($1, $2, ($3::timestamp AT TIME ZONE 'UTC'), 0, 0)
       ON CONFLICT (account_id, contact_id) DO UPDATE
         SET last_inbound_at  = GREATEST(drip.contact_state.last_inbound_at,
                                         ($3::timestamp AT TIME ZONE 'UTC')),
             unengaged_streak = 0,
             updated_at       = now()`,
      [accountId, contactId, lastInbound]
    );

    // ⭐ תגובה מבטלת רוויה. `saturated` היא תקרה של מטא, לא בקשה של הנמענת — ומטא מסירה
    // אותה בדיוק כאן: "Marketing messages sent within this window do not count towards the
    // limit". החסימה יורדת; opt-out מפורש (keyword / 131050) לעולם לא נוגעים בו.
    await pool.query(
      `UPDATE drip.contact_state
          SET suppressed_at = NULL, suppressed_reason = NULL, suppressed_detail = NULL,
              updated_at = now()
        WHERE account_id = $1 AND contact_id = $2 AND suppressed_reason = 'saturated'`,
      [accountId, contactId]
    );

    // ⭐ ומוסרים לה את ההודעה שמטא חסמה — עכשיו, בתוך החלון שהיא פתחה.
    // התנאי מדויק בכוונה: רק אם השלב הנוכחי שלה *נשלח ונכשל ומעולם לא נמסר*. כלומר זו
    // אינה האצה של הרצף (הקצב שהוגדר נשמר) אלא מסירה סוף-סוף של הודעה שכבר הגיע זמנה
    // ונחסמה. +2 שעות ולא מיד: קודם כל שיניב יספיק לענות לה כמו בן אדם.
    await pool.query(
      `UPDATE drip.enrollments e
          SET status = 'active', next_send_at = now() + interval '2 hours'
        WHERE e.account_id = $1 AND e.contact_id = $2
          AND e.status IN ('active', 'failed')
          AND e.next_send_at > now() + interval '2 hours'
          AND EXISTS (SELECT 1 FROM drip.sent_messages sm
                       WHERE sm.enrollment_id = e.id AND sm.step_order = e.current_step
                         AND sm.delivery_status = 'failed')
          AND NOT EXISTS (SELECT 1 FROM drip.sent_messages sm
                           WHERE sm.enrollment_id = e.id AND sm.step_order = e.current_step
                             AND sm.delivery_status = 'delivered')`,
      [accountId, contactId]
    );

    if (hit) {
      // בקשת הסרה מפורשת חוסמת הכל, לא רק שיווק. זו הקריאה המכבדת של "הסר",
      // והיא מה שמגן על דירוג האיכות של המספר.
      await suppressContact(pool, accountId, contactId, 'keyword', hit, 'all');
      optOuts += 1;
      console.log(`[drip] opt-out acct ${accountId} contact ${contactId} ("${hit}")`);
    }
  }

  await pool.query(
    `INSERT INTO drip.account_health (account_id, last_scanned_message_id)
     VALUES ($1, $2)
     ON CONFLICT (account_id) DO UPDATE SET last_scanned_message_id = $2`,
    [accountId, watermark]
  );

  return { scanned: rows.length, optOuts };
}

/**
 * מעדכן את מוני המעורבות מהודעות שיווק שכבר יש עליהן תשובה סופית.
 *
 * מטא מחשבת את המכסה האישית לפי "recent marketing message read rate" של הנמען.
 * אדם שקיבל כמה הודעות שיווקיות ולא פתח אף אחת מיצה את המכסה שלו — כל שליחה נוספת
 * אליו תיכשל ב-131049, תעלה כסף, *ותוריד את שיעור הקריאה של הרשימה כולה*, מה שמצמצם
 * את המכסה של כל השאר. לכן אחרי max_unengaged שליחות ללא קריאה הוא נחסם.
 *
 * נספר רק מה שכבר הוכרע: הודעה שנשלחה לפני יותר מ-24 שעות ועדיין לא נקראה.
 *
 * @returns {Promise<{read: number, unread: number, suppressed: number}>}
 */
export async function reconcileEngagement(pool, accountId, now = new Date(), settings = null) {
  const s = settings || (await loadSettings(pool, accountId));

  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT sm.id, sm.contact_id, m.status
         FROM drip.sent_messages sm
         JOIN public.messages m ON m.id = sm.message_id
        WHERE sm.account_id         = $1
          AND sm.contact_id IS NOT NULL
          AND sm.engagement_counted = false
          AND sm.message_id IS NOT NULL
          AND upper(COALESCE(sm.category, 'MARKETING')) = 'MARKETING'
          AND sm.in_session         = false
          AND (m.status = 2 OR sm.sent_at < $2::timestamptz - interval '24 hours')
          AND m.status <> 3`,                       // כשלים מטופלים ב-reconcileDeliveries
      [accountId, now]
    ));
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return { read: 0, unread: 0, suppressed: 0 };
    throw err;
  }

  let read = 0, unread = 0, suppressed = 0;
  for (const r of rows) {
    const wasRead = Number(r.status) === 2;
    if (wasRead) {
      await pool.query(
        `INSERT INTO drip.contact_state (account_id, contact_id, unengaged_streak)
         VALUES ($1, $2, 0)
         ON CONFLICT (account_id, contact_id) DO UPDATE
           SET unengaged_streak = 0, updated_at = now()`,
        [accountId, r.contact_id]
      );
      read += 1;
    } else {
      const { rows: cs } = await pool.query(
        `INSERT INTO drip.contact_state (account_id, contact_id, unengaged_streak)
         VALUES ($1, $2, 1)
         ON CONFLICT (account_id, contact_id) DO UPDATE
           SET unengaged_streak = drip.contact_state.unengaged_streak + 1, updated_at = now()
         RETURNING unengaged_streak, suppressed_at`,
        [accountId, r.contact_id]
      );
      unread += 1;
      const st = cs[0];
      if (st && !st.suppressed_at && Number(st.unengaged_streak) >= Number(s.max_unengaged)) {
        await suppressContact(
          pool, accountId, r.contact_id, 'unengaged',
          `${st.unengaged_streak} הודעות שיווק ברצף ללא קריאה`, 'marketing'
        );
        suppressed += 1;
      }
    }
    await pool.query(`UPDATE drip.sent_messages SET engagement_counted = true WHERE id = $1`, [r.id]);
  }

  return { read, unread, suppressed };
}

/**
 * כמה תבניות שיווק (מחוץ לחלון שירות) נשלחו לכל אחד מאנשי הקשר האלה ב-24h האחרונות.
 * @returns {Promise<Map<number, number>>}
 */
export async function marketingSentToday(pool, accountId, contactIds, now = new Date()) {
  const ids = (contactIds || []).filter(Number.isFinite);
  if (!ids.length) return new Map();
  const { rows } = await pool.query(
    `SELECT contact_id, count(*)::int AS n
       FROM drip.sent_messages
      WHERE account_id = $1
        AND contact_id = ANY($2::int[])
        AND sent_at    > $3::timestamptz - interval '24 hours'
        AND in_session = false
        AND upper(COALESCE(category, 'MARKETING')) = 'MARKETING'
        AND delivery_status <> 'failed'
      GROUP BY contact_id`,
    [accountId, ids, now]
  );
  return new Map(rows.map((r) => [r.contact_id, Number(r.n)]));
}
