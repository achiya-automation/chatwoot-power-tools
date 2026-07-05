/*
 * deliveryError — ממפה קוד שגיאת מסירה של WhatsApp/Meta להסבר קצר (he/en).
 * פונקציה טהורה (בלי React/DOM) כדי שתהיה ניתנת לבדיקה ב-node --test.
 *
 * הקודים נשמרים על drip.sent_messages.error_code ע"י ה-reconciler (פאזה 4),
 * שמחלץ אותם מ-public.messages.content_attributes (external_error).
 *
 * i18n: קורא את השפה מ-i18n.js בזמן קריאה; ב-node (בדיקות engine) ברירת המחדל 'he'
 * → הפלט העברי זהה להיסטורי (delivery_error.test.js אינו נשבר).
 */
import { getLocale } from '../i18n.js';

// code → הסבר ידידותי (ניטרלי-מגדר), לכל שפה
const LABELS = {
  he: {
    '131026': 'ההודעה לא נמסרה — ייתכן שהמספר אינו בוואטסאפ, חסם את העסק, או אינו מקבל הודעות עסקיות',
    '131049': 'Meta חסמה את ההודעה כדי לשמור על מעורבות תקינה — נשלחו יותר מדי הודעות שיווקיות לנמען',
    '131047': 'מחוץ לחלון 24 השעות — נדרשת תבנית מאושרת',
    '131051': 'סוג ההודעה אינו נתמך עבור הנמען',
    '131053': 'שגיאת העלאת מדיה — ודאו שקישור המדיה ציבורי ותקין',
    '132000': 'מספר הפרמטרים אינו תואם לתבנית המאושרת',
    '132001': 'התבנית אינה קיימת או אינה מאושרת בשפה שנבחרה',
    '132005': 'התבנית נדחתה או הושעתה ב-Meta',
    '132012': 'פורמט הפרמטרים אינו תואם לתבנית המאושרת',
    '131008': 'פרמטר חובה חסר בבקשה',
    '131000': 'שגיאה כללית של Meta — אפשר לנסות שוב',
    '470': 'חלון ההודעות (24 שעות) נסגר',
    '100': 'בקשת API שגויה — בדקו את הפרמטרים',
  },
  en: {
    '131026': 'The message was not delivered — the number may not be on WhatsApp, may have blocked the business, or does not accept business messages',
    '131049': 'Meta blocked the message to maintain healthy engagement — too many marketing messages were sent to this recipient',
    '131047': 'Outside the 24-hour window — an approved template is required',
    '131051': 'This message type is not supported for the recipient',
    '131053': 'Media upload error — make sure the media link is public and valid',
    '132000': 'The number of parameters does not match the approved template',
    '132001': 'The template does not exist or is not approved in the selected language',
    '132005': 'The template was rejected or suspended by Meta',
    '132012': 'The parameter format does not match the approved template',
    '131008': 'A required parameter is missing from the request',
    '131000': 'General Meta error — you can try again',
    '470': 'The messaging window (24 hours) has closed',
    '100': 'Invalid API request — check the parameters',
  },
};

const NOT_DELIVERED = { he: 'המסירה נכשלה', en: 'Delivery failed' };
const STUCK = { he: 'נתקע', en: 'Stuck' };

/**
 * הסבר מלא לכשל מסירה, לפי השפה הנוכחית.
 * @param {string|null} code          - קוד Meta (למשל '131026')
 * @param {string|null} fallbackTitle - הטקסט הגולמי מ-Meta, אם אין מיפוי
 * @returns {string}
 */
export function deliveryErrorLabel(code, fallbackTitle) {
  const L = getLocale() === 'en' ? 'en' : 'he';
  if (code && LABELS[L][code]) return LABELS[L][code];
  if (fallbackTitle) return String(fallbackTitle);
  return NOT_DELIVERED[L];
}

/**
 * תווית קומפקטית ל-chip: "נתקע · 131026" / "Stuck · 131026" (או רק "נתקע"/"Stuck").
 * @param {string|null} code
 * @returns {string}
 */
export function deliveryErrorChip(code) {
  const stuck = STUCK[getLocale() === 'en' ? 'en' : 'he'];
  return code ? `${stuck} · ${code}` : stuck;
}

// code → המלצת פעולה ("מה לעשות") — כדי שהלקוח לא יישאר תקוע מול קוד שגיאה.
const ACTIONS = {
  he: {
    '131026': 'ודאו שמספר הטלפון נכון ושהנמען משתמש בוואטסאפ. אם תקין — הסירו מהרצף.',
    '131049': 'Meta מגבילה הודעות שיווקיות לאותו נמען. המתינו, או השתמשו בתבנית מסוג UTILITY (אינה נספרת במגבלה).',
    '131047': 'הרצף שולח תבנית מאושרת ממילא; אם נמשך — בדקו את אישור התבנית ב-Meta.',
    '131051': 'בחרו תבנית מסוג אחר עבור הנמען הזה.',
    '131053': 'החליפו את קישור המדיה בקישור HTTPS ציבורי ותקין (לא קישור של וואטסאפ).',
    '132000': 'מספר המשתנים אינו תואם לתבנית — תקנו בעורך הרצף.',
    '132001': 'בחרו תבנית קיימת ומאושרת בשפה הנכונה בעורך הרצף.',
    '132005': 'התבנית נדחתה או הושעתה ב-Meta — בחרו תבנית אחרת.',
    '132012': 'פורמט המשתנים אינו תואם — תקנו את המשתנים בעורך הרצף.',
    '131008': 'חסר משתנה חובה — מלאו את כל המשתנים בעורך הרצף.',
  },
  en: {
    '131026': 'Make sure the phone number is correct and the recipient uses WhatsApp. If it is correct — remove them from the sequence.',
    '131049': 'Meta limits marketing messages to the same recipient. Wait, or use a UTILITY template (it does not count toward the limit).',
    '131047': 'The sequence already sends an approved template; if it persists — check the template approval in Meta.',
    '131051': 'Choose a different template type for this recipient.',
    '131053': 'Replace the media link with a public, valid HTTPS link (not a WhatsApp link).',
    '132000': 'The number of variables does not match the template — fix it in the sequence editor.',
    '132001': 'Choose an existing, approved template in the correct language in the sequence editor.',
    '132005': 'The template was rejected or suspended by Meta — choose a different template.',
    '132012': 'The variable format does not match — fix the variables in the sequence editor.',
    '131008': 'A required variable is missing — fill in all variables in the sequence editor.',
  },
};

const GENERIC_ACTION = {
  he: 'בדקו את פרטי איש הקשר, או הסירו מהרצף ונסו שוב.',
  en: 'Check the contact details, or remove them from the sequence and try again.',
};

/**
 * המלצת פעולה קצרה ללקוח לפי קוד השגיאה (מה לעשות הלאה), לפי השפה הנוכחית.
 * @param {string|null} code
 * @returns {string}
 */
export function deliveryErrorAction(code) {
  const L = getLocale() === 'en' ? 'en' : 'he';
  return (code && ACTIONS[L][code]) || GENERIC_ACTION[L];
}
