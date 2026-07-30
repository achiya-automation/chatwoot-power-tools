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

  // ⭐ הסירוב הישראלי הנפוץ ביותר — ולא היה כאן. נמדד בבננה בוק (14/07/2026):
  // 27 אנשים ביקשו להפסיק, המנוע זיהה 8. את 19 הנותרים הוא המשיך להפגיז — 34 הודעות
  // שיווק *אחרי* שסירבו. נופר סירבה שלוש פעמים ("כבר לא רלוונטי" · "בת המצווה כבר
  // התקיימה" · "לא רלוונטי") וקיבלה בתגובה הודעת "תודה שבחרתם בנו". לינור כתבה "לא
  // יודעת למה פניתם אלי", ואז "בבקשה די, כבר כתבתי לכם" — וקיבלה עוד שתיים.
  // "לא רלוונטי" הוא לא ניסוח מנומס של "אולי אחר כך". הוא "תפסיקו".
  'לא רלוונטי', 'לא רלוונטית', 'לא רלוונטיות',
  'בבקשה די', 'כבר כתבתי לכם', 'למה פניתם אלי', 'למה פניתם אליי',

  // האירוע כבר עבר / כבר סגרו במקום אחר — אין מה למכור להם, וכל הודעה נוספת מעצבנת.
  'כבר סגרתי', 'כבר סגרנו', 'כבר בחרנו', 'כבר תאמנו',
  'כבר התקיימה', 'כבר התקיים', 'כבר היה', 'כבר היתה', 'כבר עבר',
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
    // ⚠️ 131048 = "Spam rate limit hit" — מטא חונקת את המספר כי יותר מדי הודעות נחסמו
    // או סומנו כספאם. זו לא תקלה של הליד; זו אזהרה על **המספר**. להמשיך לשלוח לתוכה
    // זה בדיוק מה שהופך חנק זמני להשעיה. עוצרים ומתריעים, כמו כל אות מדיניות.
    case '131048':
      return 'policy';

    case '130429':                // rate limit hit
    case '133004':                // server temporarily unavailable
    case '131000':                // generic something-went-wrong
    case '80007':                 // rate limit
    case '131052':                // media download error — שלנו, לא של הנמענת
    case '131053':                // unable to download the media — URL/הרשאות
      return 'transient';
    default:
      // 133xxx (מלבד 133004) — בעיות רישום/דה-רגיסטרציה של המספר. שום הודעה לא
      // תעבור עד שהן נפתרות, אז אין טעם להמשיך לנסות: עצירה + התראה.
      if (/^133\d{3}$/.test(c)) return 'policy';

      // ⛔ קוד שאיננו מכירים לא הורג ליד.
      // ברירת המחדל הייתה `permanent` ⇒ `failEnrollment`, כלומר **כל** קוד שלא נמצא
      // ברשימה מחק את הליד לצמיתות — כולל קודים זמניים לגמרי (131048 שרף כך לידים,
      // וגם `368` שלא נפרסר בכלל וחזר null). קוד לא-מוכר הוא **חוסר ידע שלנו**, לא
      // ראיה שהנמענת אבודה. מסמנים כזמני: הליד נשאר, מתקרר, ומתריעים כדי שאדם יסתכל.
      // מחיקה שמורה לקודים שאנחנו יודעים בוודאות שהם סופיים (invalid / optout).
      return 'transient';
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

// One source of truth for recipient backoff. The previous implementation kept this
// ladder in reconcile.js while canSend used a separate, shorter "release" threshold.
// A manual/backlog reschedule could therefore pull a contact forward past the backoff.
export const CAP_COOLDOWN_DAYS = Object.freeze([7, 10, 14, 21, 30, 45]);
export const capCooldownDays = (failures) =>
  CAP_COOLDOWN_DAYS[
    Math.min(Math.max(Number(failures) || 1, 1), CAP_COOLDOWN_DAYS.length) - 1
  ];

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
  // תקציב הכישלונות של תבנית — והמספר הזה עולה כסף לשני הכיוונים.
  //
  // העקומה הנמדדת (n=4,998, בבקרה על היסטוריית החסימות של הנמענת — שאחרת מתחזה
  // לאפקט של התבנית):
  //     0-9 כישלונות  → 83-86% מסירה
  //     10-49         → 67-73%
  //     50+           → 18%      ← הקריסה
  //
  // ⚠️ סף נמוך מדי מסוכן לא פחות מגבוה מדי: שיעור הכשל על *לידים נקיים* הוא ~32%,
  // כלומר סף 10 היה מפעיל רוטציה כל 32 שליחות — ~15 תבניות חדשות בחודש. יצירה המונית
  // של תבניות כמעט-זהות היא בדיוק הדפוס שמטא מסמנת כחוות-ספאם. הרוטציה הייתה מייצרת
  // את הבעיה שהיא נועדה לפתור.
  //
  // 40 = אחרי שהשחיקה אמיתית, לפני הקריסה, ובקצב רוטציה של פעם בחודש בערך.
  max_template_failures: 40,

  // מדרגה קשיחה: גם קהל נקי נעצר רגע לפני נקודת הקריסה שנמדדה ב-50+ כשלים.
  // המדרגה הרגילה ממשיכה לעצור רק קהל מסוכן; זו רשת ביטחון לכל התבנית.
  max_template_failures_hard: 48,

  // ── בלם המסירה (delivery floor) ────────────────────────────────────────────
  // halt_on_red מסתמך על דירוג האיכות של מטא — שבנפחים האלה מחזיר UNKNOWN לנצח
  // ואינו נורה אף פעם. הבלם האמיתי מודד את המסירה *בפועל*: אם ההודעות על תבניות
  // נקיות מפסיקות להגיע (WABA שרוף, מדיה שבורה, פעולת מדיניות של מטא) — כל שליחה
  // נכשלת בלי שאף תבנית בודדת חוצה את הסף שלה, והחשבון נשאר "בריא" בעיני מטא בזמן
  // שהוא הולם. checkDeliveryFloor עוצר את זה. הסף הוא רצפת קריסה, לא "יום חלש":
  // הבייסליין הבריא בפועל הוא 60-84%, בעוד קריסה אמיתית נראית כ-0-20%.
  min_delivery_rate:     45,
  min_delivery_sample:   30,

  // ── חלון הפתיחה לליד חדש (fresh opener) ─────────────────────────────────────
  // גם כשהחשבון עצור על RED, מותר לשלוח את *הפתיחה בלבד* לליד שנרשם ממש לאחרונה.
  // ליד טרי הוא engagement איכותי (נמדד בבננה בוק: הפתיחה מוסרת ב-91%, לעומת 24%
  // בתבניות מאוחרות שנשלחו לקהל קר) — הוא לא מה ששורף את המספר, ואף מסייע להתאוששות.
  // ליד שלא מקבל פתיחה בזמן = ליד אבוד. ⚠️ רק ליד שנרשם בתוך החלון הזה — לא קהל ישן
  // וקר (שהוא בדיוק מה ששרף את המספר). 0 = לכבות את ההחרגה לגמרי.
  fresh_opener_hours:    48,

  // ── שחרור-מנוחה לנמענת רוויה (saturation rest release) ──────────────────────
  // מטא: התקרה הפר-נמענת "מסתגלת אוטומטית עם הזמן" — כלומר היא משתחררת אחרי מנוחה.
  // נמדד אצלנו (45 יום, n=2,398 שליחות שבאו אחרי 131049): ניסיון במרווח של פחות
  // מ-4 ימים מהחסימה האחרונה נמסר ב-8-15%; 4-7 ימים — 41%; 7 ימים ומעלה — 61%.
  // לכן נמענת שסומנה saturated אינה חנויה לנצח: אחרי המנוחה הזו מותר ניסיון בודד.
  // כישלון נוסף מאפס את שעון המנוחה ומטפס בסולם הצינון (ראה reconcile), כך שנמענת
  // שמטא ממשיכה לשמור עליה מקבלת ניסיון אחד ומרווח — לא הפגזה. לסף מתווסף פיזור
  // דטרמיניסטי של 0-9 ימים לפי contact_id, כדי שקוהורט שלם שנחסם באותו שבוע לא
  // ישתחרר באותו בוקר וישרוף את עותקי ה-burn בבת אחת. 0 = כבוי (חניה לצמיתות).
  saturation_release_days: 21,

  // שעות שקט לשיווק. start == end משאיר את ההגנה כבויה כברירת מחדל; חשבונות
  // קיימים מקבלים את הערכים שלהם ממיגרציה/שורת compliance.
  quiet_start_hour: 0,
  quiet_end_hour:   0,
  quiet_tz:         'Asia/Jerusalem',

  // ── החלפת-תבנית אוטומטית בריאה (ראה src/replace.js) ─────────────────────────
  // תבנית נקייה שחצתה סף שחיקה נמדד מקבלת עותק זהה + תאומת burn, והשלבים עוברים
  // אליו רק אחרי אישור מטא. בלמי קצב: 1/משפחה/14 יום, 3/חשבון/30 יום. כבוי
  // כברירת מחדל — יצירת תבניות בחשבון של לקוח רק בהסכמתו המפורשת.
  auto_template_replace_enabled: false,

  // ── שחרור-בחלון לתקועים (window-retry) ──────────────────────────────────────
  // הודעה נכנסת פותחת חלון שירות של 24h שבו המסירה ~100% ופטורה מהתקרה של מטא.
  // כשהדגל דולק, reconcile מקדים אל תוך החלון *רק* ניסיון-חוזר תקוע — ליד עם
  // cap_failures>0 שההודעה שלו כבר נשלחה בזמן שהרצף קבע ונחסמה (הודעה מאחרת,
  // לא מוקדמת). ⛔ לתזמון של הרצף עצמו לא נוגעים: ליד שנמסר לו (cap=0) שולח את
  // השלב הבא בדיוק בזמנו. כבוי כברירת מחדל — הדלקה רק בהסכמת בעל החשבון.
  window_pull_enabled: false,
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
                          health = {}, template = null, sentToday = 0, inSession = false,
                          isFreshOpener = false, now = new Date() }) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };

  // ── חוסם הכל — פרט לחלון שירות פתוח ───────────────────────────────────────
  // עצירת חשבון (RED / מסירה נמוכה) עוצרת שיווק. אבל נמענת שהגיבה ב-24h האחרונות
  // נמצאת בחלון שירות פתוח — ושליחה אליה היא *service*, לא marketing: מטא לא סופרת
  // אותה כשיווק, ומענה לשיחות פתוחות דווקא *משפר* את דירוג האיכות שהוריד ל-RED.
  // בלי החרגה זו נמענת שהגיבה לפתיחה ("מתי הבת מצווה?") לא קיבלה את המשך הרצף כשמטא
  // הורידה את המספר ל-RED — בדיוק ההמשך שהיא ביקשה. עקבי עם saturated/daily_cap/
  // template_burned שכולם כבר מוחרגים ב-inSession. (368/מספר חסום: inSession פשוט
  // ייכשל בשקט — לא מזיק.)
  // isFreshOpener: הפתיחה לליד שנרשם ממש עכשיו עוברת גם בעצירה — ליד טרי הוא engagement
  // איכותי שמסייע להתאוששות, וליד שלא מקבל פתיחה בזמן אבוד. מחושב ב-reconcile (רק step 1
  // + נרשם בתוך fresh_opener_hours), כדי שקהל ישן וקר לא יעקוף. הצעדים הבאים ברצף לא.
  if (health.halted && !inSession && !isFreshOpener) {
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

  // כמה זמן הנמענת נחה מאז ה-131049 האחרון שלה? השחרור דורש *ראיה* למנוחה —
  // חותמת שקיימת וישנה מספיק. אין חותמת ⇒ אין ראיה ⇒ ההתנהגות הישנה (חנייה),
  // fail-closed. הפיזור לפי contact_id דטרמיניסטי: אותה נמענת משתחררת תמיד
  // באותו יום, אבל קוהורט שנחסם יחד נמרח על פני ~10 ימים.
  const capFailures = Number(contact.cap_failures || 0);
  const lastCapMs = contact.last_cap_failure_at
    ? new Date(contact.last_cap_failure_at).getTime()
    : NaN;
  const restDays = Number.isFinite(lastCapMs)
    ? Math.max(0, (now.getTime() - lastCapMs) / 86400000)
    : -1;
  const stagedCooldown = capFailures > 0 ? capCooldownDays(capFailures) : 0;
  const cooldownReady = capFailures === 0
    || (restDays >= stagedCooldown);

  // Saturated contacts (cap >= max) need both the staged backoff and the explicit
  // release policy. A low release_days value must never shorten the 30/45-day rung.
  const releaseDays = Number(s.saturation_release_days || 0);
  const saturatedReleaseAfter = Math.max(
    stagedCooldown,
    releaseDays + (Number(contact.contact_id) || 0) % 10
  );
  const restedEnough = capFailures > 0
    && releaseDays > 0
    && restDays >= saturatedReleaseAfter;

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
      // אחרי המנוחה המדודה התקרה של מטא כבר הסתגלה — ניסיון בודד משתחרר. הניתוב
      // למאגר השריפה עדיין חל (cap_failures>0), כך שגם אם הניסיון ייכשל, הכישלון
      // ייספג בעותק ה-burn ולא בתבנית הנקייה — וישעון המנוחה יתאפס ויטפס בסולם.
      if (!inSession && !restedEnough) {
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

  // שלבי המשך שיווקיים בלבד. ליד טרי עם cap=0 אינו מושפע, וחלון שירות כבר
  // הוחרג מעל. ההגנה הזו עומדת גם מול UPDATE ידני/backlog שמקדים next_send_at.
  if (capFailures > 0 && capFailures < Number(s.max_cap_failures) && !cooldownReady) {
    const retryAt = Number.isFinite(lastCapMs)
      ? new Date(lastCapMs + stagedCooldown * 86400000)
      : null;
    return { ok: false, reason: 'cap_cooldown', action: 'defer', retryAt };
  }

  // ── שעות שקט ────────────────────────────────────────────────────────────
  // חלון שירות ופתיחה טרייה פטורים; יתר השיווק נדחה לבוקר.
  const qs = Number(s.quiet_start_hour), qe = Number(s.quiet_end_hour);
  if (Number.isFinite(qs) && Number.isFinite(qe) && qs !== qe && !isFreshOpener) {
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric', hour12: false, timeZone: s.quiet_tz || 'Asia/Jerusalem',
    }).format(now));
    const quiet = qs > qe ? (hour >= qs || hour < qe) : (hour >= qs && hour < qe);
    if (quiet) return { ok: false, reason: 'quiet_hours', action: 'defer' };
  }

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
  if (template && Number(template.failures || 0) >= Number(s.max_template_failures_hard || 48)) {
    return { ok: false, reason: 'template_burned', action: 'defer' };
  }
  if (template && Number(template.failures || 0) >= Number(s.max_template_failures)
      && Number(contact.cap_failures || 0) > 0) {
    return { ok: false, reason: 'template_burned', action: 'defer' };
  }

  // הגנות עומק — הכתיבה עצמה נעשית ב-reconcileDeliveries, אבל אם מחזור אחד פספס,
  // השער לא ישלח בכל זאת. רוויה = דחייה, לא הסרה (ראה ההערה למעלה) — וגם כאן
  // שחרור-המנוחה חל, מאותו נימוק בדיוק כמו בענף ה-suppressed למעלה.
  if (Number(contact.cap_failures || 0) >= Number(s.max_cap_failures) && !restedEnough) {
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
 * שנכשלו בתבנית הזו בחלון נע של `BURN_WINDOW_DAYS` ימים. זה המונה שעליו עובד
 * `max_template_failures`.
 *
 * חלון נע ולא all-time: מוניטין תבנית אצל מטא הוא "איכות אחרונה", לא היסטורית — תבנית
 * שנחה מתאוששת (נמדד: 2-5 ימי מנוחה → 79% מסירה). ספירת אבד-עולם חסמה תבנית לנצח,
 * והאיפוס היחיד היה שם חדש = רוטציית תבניות סדרתית = דפוס הספאם שמטא מסמנת. החלון
 * משחרר את הבלם מעצמו אחרי מנוחה: אפס תבניות חדשות, אפס התערבות ידנית.
 * ⚠️ `quality_score` של מטא מחזיר UNKNOWN לתמיד בנפחים האלה — הוא אינו אזהרה מוקדמת.
 */
export const BURN_WINDOW_DAYS = 7; // מעל זמן ההתאוששות הנמדד; מיושר עם הצינון המדורג של הליד (3-12 ימים)

export async function loadTemplateHealth(pool, accountId) {
  const { rows } = await pool.query(
    `SELECT th.*, COALESCE(f.failures, 0)::int AS failures
       FROM drip.template_health th
       LEFT JOIN (
              SELECT template_name, count(*) AS failures
                FROM drip.sent_messages
               WHERE account_id = $1 AND delivery_status = 'failed'
                 AND sent_at >= now() - make_interval(days => $2)
               GROUP BY template_name
            ) f ON f.template_name = th.template_name
      WHERE th.account_id = $1`, [accountId, BURN_WINDOW_DAYS]
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
 * שחרור חשבון אוטומטי — ההיפך מ-haltAccount. נקרא רק כשמטא שדרגה את דירוג האיכות בחזרה
 * ל-GREEN (התאוששות מאומתת).
 * ⚠️ רק GREEN — לעולם לא UNKNOWN: בנפחים נמוכים UNKNOWN הוא ברירת המחדל ואינו עדות
 * להתאוששות. שחרור על UNKNOWN הוא שחרור-שווא — נמדד 20/07/2026: קריאת UNKNOWN רגעית בין
 * שתי קריאות RED הובילה לשחרור מוקדם ולשליחת שיווק למספר שעדיין היה RED במטא Business Manager.
 * הקריאה ב-meta.js מסננת גם שרק halt שנבע מדירוג RED משוחרר כך (לא מסירה נמוכה / policy).
 */
export async function resumeAccount(pool, accountId, reason) {
  await pool.query(
    `UPDATE drip.account_health SET halted = false, halt_reason = NULL, halted_at = NULL WHERE account_id = $1`,
    [accountId]
  );
  await pool.query(
    `UPDATE drip.alerts SET acked_at = now()
      WHERE account_id = $1 AND acked_at IS NULL AND code IN ('halted', 'quality_red')`,
    [accountId]
  );
  await raiseAlert(pool, accountId, 'info', 'resumed', reason);
  console.log(`[drip] ACCOUNT ${accountId} RESUMED — ${reason}`);
}

/**
 * בלם המסירה — מפסק-פחת לפי המסירה *בפועל*, לא לפי דירוג מטא. זה מה ש-halt_on_red
 * לא רואה: בנפחים האלה מטא מחזירה quality=UNKNOWN לנצח, אז מספר שמפסיק להגיע בשקט
 * (WABA שרוף, מדיה שבורה, פעולת מדיניות) נכשל בכל שליחה — בלי שאף תבנית בודדת חוצה
 * את max_template_failures — והחשבון נשאר "בריא" בעיני מטא בזמן שהוא הולם. הבלם הזה
 * סוגר את הפער. נקרא פר-חשבון בכל tick; משתמש ב-haltAccount הקיים (canSend כבר עוצר
 * על health.halted). מחליף את הסקריפט החיצוני drip-brake.sh — עכשיו מובנה ורב-דיירי.
 *
 * @returns {Promise<{rate:number,n:number,halted:boolean}|null>} null = מדגם קטן מדי
 */
export async function checkDeliveryFloor(pool, accountId, settings = null) {
  // מכבד כיוונון פר-חשבון: loadSettings ממזג DEFAULT_SETTINGS עם שורת ה-compliance
  // (אם קיימת). חשבון חדש בלי שורה נופל ל-DEFAULT — כך הבלם מובנה אוטומטית לכולם.
  const s = { ...DEFAULT_SETTINGS, ...(settings || await loadSettings(pool, accountId)) };

  // מקור האמת הוא sent_messages.delivery_status. בנוסף למאגר השריפה מוחרג רק
  // 131049 ראשון-בחיים: הוא רעש שמגיע ממקור הלידים, לא אות שהמספר עצמו קרס.
  // הצלחות ראשונות וכשלים אחרים נשארים במדגם — אחרת תקלה אמיתית בקהל חדש נעלמת.
  const { rows } = await pool.query(
    `WITH s AS (
       SELECT sm.sent_at, COALESCE(sm.delivery_status, 'pending') AS ds, sm.error_code,
              (sm.template_name LIKE '%burn%') AS is_burn,
              row_number() OVER (PARTITION BY sm.contact_id ORDER BY sm.sent_at, sm.id) = 1
                AS first_ever
         FROM drip.sent_messages sm
        WHERE sm.account_id = $1
     )
     SELECT count(*) FILTER (WHERE ds IN ('delivered','read')) AS ok,
            count(*) FILTER (WHERE ds = 'failed')              AS bad
       FROM s
      WHERE sent_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'Asia/Jerusalem'
        AND NOT is_burn
        AND NOT (first_ever AND ds = 'failed' AND error_code = '131049')`,
    [accountId]
  );
  const ok = Number(rows[0]?.ok || 0), bad = Number(rows[0]?.bad || 0);
  const n = ok + bad;

  // עצירה שיצר הבלם הזה משתחררת אוטומטית כשהתנאי חולף. עצירת RED/Policy
  // נשארת ידנית/תלויה במטא.
  const isFloorHalt = (r) => /שיעור ההגעה/.test(String(r || ''));
  const maybeResume = async (why) => {
    const h = await loadHealth(pool, accountId);
    if (h.halted && isFloorHalt(h.halt_reason)) await resumeAccount(pool, accountId, why);
  };

  // מדגם קטן אינו הוכחת התאוששות. בפרט בחצות המדגם מתאפס; שחרור אז היה מאפשר
  // למספר שבור לשרוף עוד batch בכל יום בלי מסירה חיובית אחת.
  if (n < (s.min_delivery_sample || 30)) return null;

  const rate = Math.round((100 * ok) / n);
  if (rate >= (s.min_delivery_rate || 45)) {
    await maybeResume(`שיעור ההגעה התאושש ל-${rate}% (${ok} מתוך ${n}) — השליחה חודשה אוטומטית.`);
    return { rate, n, halted: false };
  }

  // המסירה צנחה. עוצר — אם לא כבר עצור, כדי לא להציף את הדשבורד באותה התראה כל tick.
  const h = await loadHealth(pool, accountId);
  if (!h.halted) {
    await haltAccount(
      pool, accountId,
      `שיעור ההגעה צנח ל-${rate}% (${ok} מתוך ${n} היום, נמענות מוכרות על תבניות נקיות). ` +
      `השליחה נעצרה אוטומטית — בדקו את המספר, המדיה והתבניות. תשתחרר לבד כשהשיעור יתאושש.`
    );
  }
  return { rate, n, halted: true };
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
  // ⚠️ Stopping the sequence belongs to a real opt-out (keyword / 131050) or an unreachable
  // number — NOT to `saturated`. Saturation is Meta's per-user cap: temporary, self-adapting,
  // and lifted entirely inside an open service window. canSend already encodes exactly that —
  // it DEFERS a saturated contact instead of dropping her, so that "she stays in the sequence
  // and gets everything she missed if she ever replies". Stopping the enrollment here would
  // silently break that promise: the send query only ever looks at status='active', so a
  // stopped lead never reaches canSend at all, and the open door it holds for her is one she
  // can never walk through. Deleting her `sequence` tag compounds it — the reconciler reads an
  // empty tag as an opt-out and would refuse to re-enroll her.
  // Measured (banana-book, 2026-07-14): a lead with 4 cap failures — suppressed, written off
  // as burned — was delivered AND read the moment she was sent from a clean number.
  if (reason !== 'saturated') {
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
  // ⚠️ שגיאות 132xxx (אי-התאמת פרמטרים / תבנית לא מוכרת בזמן שליחה) הן תקלת
  // תשתית שלנו — שום דבר לא הגיע לנמענת, אז הן לא "לחץ שיווקי" ולא נספרות
  // במכסה היומית שלה. נלמד 30/07: עותק טרי שנשלח לפני שה-cache של Chatwoot
  // הסתנכרן נפל על 132000, והכשל חסם את הנמענת ליממה על לא-כלום.
  // כשלי תקרה אמיתיים (131049) כן נספרים — זה כל הלקח של 29/07.
  const { rows } = await pool.query(
    `SELECT contact_id, count(*)::int AS n
       FROM drip.sent_messages
      WHERE account_id = $1
        AND contact_id = ANY($2::int[])
        AND sent_at    > $3::timestamptz - interval '24 hours'
        AND in_session = false
        AND upper(COALESCE(category, 'MARKETING')) = 'MARKETING'
        AND (error_code IS NULL OR error_code NOT LIKE '132%')
      GROUP BY contact_id`,
    [accountId, ids, now]
  );
  return new Map(rows.map((r) => [r.contact_id, Number(r.n)]));
}

/**
 * בדיקת תקציב חיה ואטומית רגע לפני שליחה בלתי-הפיכה.
 *
 * ההקשר הנטען בתחילת tick הוא snapshot. בלעדיה מנה אחת יכולה:
 *   1. לשלוח שוב לאותו איש קשר אחרי 131049, כי הכשל טרם נראה ב-snapshot;
 *   2. להעביר תבנית מ-36 ל-50 כשלים, כי כל ההודעות ראו את אותו מונה 36.
 *
 * advisory locks מסדרים גם כמה מופעי engine במקביל. מיד לאחר הבדיקה, reconcile
 * כותב reservation מחויב ל-sent_messages לפני קריאת הרשת; pending נספר ככשל
 * אפשרי עד ש-Meta מכריעה אותו.
 */
export async function checkLiveSendBudget(db, {
  accountId,
  contactId,
  templateName,
  category,
  inSession: openWindow = false,
  capFailures = 0,
  settings = DEFAULT_SETTINGS,
  now = new Date(),
}) {
  if (!isMarketing(category) || openWindow) return { ok: true };

  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };

  if (Number.isFinite(Number(contactId))) {
    await db.query(
      `SELECT pg_advisory_xact_lock($1::int, hashtext($2))`,
      [Number(accountId), `contact:${Number(contactId)}`]
    );
    const attempts = Number((await db.query(
      `SELECT count(*)::int AS n
         FROM drip.sent_messages
        WHERE account_id = $1 AND contact_id = $2
          AND sent_at > $3::timestamptz - interval '24 hours'
          AND in_session = false
          AND upper(COALESCE(category, 'MARKETING')) = 'MARKETING'
          AND (error_code IS NULL OR error_code NOT LIKE '132%')`,
      [accountId, contactId, now]
    )).rows[0]?.n || 0);
    if (attempts >= Number(s.max_marketing_per_day)) {
      return { ok: false, reason: 'daily_cap', action: 'defer' };
    }
  }

  if (!templateName) return { ok: true };

  await db.query(
    `SELECT pg_advisory_xact_lock($1::int, hashtext($2))`,
    [Number(accountId), `template:${templateName}`]
  );
  const live = (await db.query(
    `SELECT
       count(*) FILTER (
         WHERE delivery_status = 'failed'
           AND sent_at >= $3::timestamptz - make_interval(days => $4)
       )::int AS failures,
       count(*) FILTER (
         WHERE delivery_status = 'pending'
           AND sent_at >= $3::timestamptz - interval '48 hours'
       )::int AS pending
       FROM drip.sent_messages
      WHERE account_id = $1 AND template_name = $2`,
    [accountId, templateName, now, BURN_WINDOW_DAYS]
  )).rows[0] || {};

  const failures = Number(live.failures || 0);
  const pending = Number(live.pending || 0);
  const risky = Number(capFailures || 0) > 0;
  const limit = risky
    ? Number(s.max_template_failures)
    : Number(s.max_template_failures_hard || 48);

  if (failures + pending >= limit) {
    return {
      ok: false,
      reason: 'template_burned',
      action: 'defer',
      detail: `${failures} failed + ${pending} pending / ${limit}`,
    };
  }
  return { ok: true };
}
