/*
 * campaignCsv — דוח הנמענים של קמפיין כקובץ CSV, בצד השרת.
 *
 * למה בשרת ולא בדפדפן: ההורדה בדפדפן (blob + עוגן download) נכשלת בשקט ב-Safari כשהדוח
 * רץ בתוך ה-iframe של ה-overlay ב-Chatwoot. ניווט רגיל אל נקודת קצה שמחזירה
 * Content-Disposition: attachment יורד בכל דפדפן ומכל הקשר — iframe, standalone, מובייל.
 *
 * המודול טהור (בלי express/DOM) ונבדק ב-node --test. השאילתה עצמה נשארת ב-campaigns.js;
 * כאן רק שיטוח, סינון ורינדור. הבריחה זהה ל-webapp/src/lib/csv.js — ציטוט מלא, הכפלת
 * גרשיים, ומגן הזרקת-נוסחאות (CWE-1236) על ערכים שמקורם בפרופיל וואטסאפ.
 */

// messages.status: 0=נשלח 1=נמסר 2=נקרא 3=נכשל; 4=דילוג מה-ledger (לא נעשה ניסיון שליחה
// בכלל — הסיבה ב-error_title); כל ערך אחר = ממתין (ראו campaigns.js).
export function statusKeyOf(status) {
  return status === 2 ? 'read'
    : status === 1 ? 'delivered'
      : status === 3 ? 'failed'
        : status === 0 ? 'sent'
          : status === 4 ? 'notsent' : 'pending';
}

export const STATUS_KEYS = ['read', 'delivered', 'sent', 'pending', 'failed', 'notsent'];

const T = {
  he: {
    head: ['שם', 'טלפון', 'סטטוס', 'סיבה', 'ניסיונות', 'זמן', 'הגיב', 'תוכן התגובה', 'זמן התגובה', 'קישור לשיחה'],
    status: { read: 'נקרא', delivered: 'נמסר', sent: 'נשלח — ממתין למסירה', pending: 'ממתין', failed: 'נכשל', notsent: 'לא נוסה לשליחה' },
    yes: 'כן', no: 'לא', noAttempt: 'לא נוצר ניסיון שליחה', report: 'דוח', filtered: 'מסונן',
  },
  en: {
    head: ['Name', 'Phone', 'Status', 'Reason', 'Attempts', 'Time', 'Replied', 'Reply text', 'Reply time', 'Conversation link'],
    status: { read: 'Read', delivered: 'Delivered', sent: 'Sent — awaiting delivery', pending: 'Pending', failed: 'Failed', notsent: 'Not attempted' },
    yes: 'Yes', no: 'No', noAttempt: 'No send attempt was created', report: 'report', filtered: 'filtered',
  },
};

// קודי שגיאת מסירה של Meta → הסבר קצר. אותם קודים כמו webapp/src/lib/deliveryError.js —
// עותק מקומי כי ה-Docker context של ה-engine לא כולל את webapp/src.
const ERROR_LABELS = {
  he: {
    131026: 'ההודעה לא נמסרה — ייתכן שהמספר אינו בוואטסאפ, חסם את העסק, או אינו מקבל הודעות עסקיות',
    131049: 'Meta חסמה את ההודעה כדי לשמור על מעורבות תקינה — נשלחו יותר מדי הודעות שיווקיות לנמען',
    131047: 'מחוץ לחלון 24 השעות — נדרשת תבנית מאושרת',
    131048: 'Meta הגבילה זמנית את השליחה מהמספר העסקי — יותר מדי הודעות סומנו כספאם או נחסמו',
    131050: 'הנמען ביקש להפסיק לקבל הודעות שיווקיות',
    131051: 'סוג ההודעה אינו נתמך עבור הנמען',
    131053: 'שגיאת העלאת מדיה — ודאו שקישור המדיה ציבורי ותקין',
    130472: 'המספר של הנמען משתתף בניסוי של Meta — הודעות שיווקיות אליו אינן נמסרות כרגע',
    132000: 'מספר הפרמטרים אינו תואם לתבנית המאושרת',
    132001: 'התבנית אינה קיימת או אינה מאושרת בשפה שנבחרה',
    132005: 'התבנית נדחתה או הושעתה ב-Meta',
    132012: 'פורמט הפרמטרים אינו תואם לתבנית המאושרת',
    132015: 'התבנית מושהית ב-Meta',
    131008: 'פרמטר חובה חסר בבקשה',
    131000: 'שגיאה כללית של Meta — אפשר לנסות שוב',
    135000: 'Meta החזיקה את ההודעה ולא מסרה אותה (pacing)',
    131056: 'יותר מדי הודעות בין שני המספרים האלה',
    470: 'חלון ההודעות (24 שעות) נסגר',
    100: 'בקשת API שגויה — בדקו את הפרמטרים',
    // סיבות מקומיות שנרשמות ב-ledger ע"י הפאטצ' של Chatwoot — לא קודים של Meta.
    // אלה המקרים שבהם השליחה נעצרה אצלנו ולא הגיעה בכלל ל-Meta.
    no_phone: 'לא נשלח — לאיש הקשר אין מספר טלפון',
    no_template_params: 'לא נשלח — לקמפיין לא הוגדרה תבנית',
    liquid_blank: 'לא נשלח — שדה בהתאמה האישית של התבנית ריק אצל איש הקשר',
    template_not_found: 'לא נשלח — התבנית לא נמצאה או אינה מאושרת בשפה שנבחרה',
    send_failed: 'הבקשה ל-Meta נכשלה — הפרטים בלוג השרת',
    no_attempt_record: 'לא נוצר ניסיון שליחה',
  },
  en: {
    131026: 'Not delivered — the number may not be on WhatsApp, may have blocked the business, or does not accept business messages',
    131049: 'Meta blocked the message to maintain healthy engagement — too many marketing messages were sent to this recipient',
    131047: 'Outside the 24-hour window — an approved template is required',
    131048: 'Meta temporarily limited sending from the business number — too many messages were flagged as spam or blocked',
    131050: 'The recipient asked to stop receiving marketing messages',
    131051: 'This message type is not supported for the recipient',
    131053: 'Media upload error — make sure the media link is public and valid',
    130472: "The recipient's number is part of a Meta experiment — marketing messages are currently not delivered",
    132000: 'The number of parameters does not match the approved template',
    132001: 'The template does not exist or is not approved in the selected language',
    132005: 'The template was rejected or suspended by Meta',
    132012: 'The parameter format does not match the approved template',
    132015: 'The template is paused by Meta',
    131008: 'A required parameter is missing from the request',
    131000: 'General Meta error — you can try again',
    135000: 'Meta held the message and did not deliver it (pacing)',
    131056: 'Too many messages between these two numbers',
    470: 'The messaging window (24 hours) has closed',
    100: 'Invalid API request — check the parameters',
    // Local ledger reasons written by the Chatwoot patch — not Meta codes. These are
    // the cases where the send stopped on our side and never reached Meta at all.
    no_phone: 'Not sent — the contact has no phone number',
    no_template_params: 'Not sent — the campaign has no template configured',
    liquid_blank: 'Not sent — a template personalization field is empty for this contact',
    template_not_found: 'Not sent — the template was not found or is not approved in the selected language',
    send_failed: 'The request to Meta failed — see the server log for details',
    no_attempt_record: 'No send attempt was created',
  },
};

/**
 * "131049: raw meta text" → הסבר מתורגם. גם מפתח מילולי מה-ledger ("no_phone") ממופה
 * דרך אותה טבלה; קוד/מפתח לא מוכר → הטקסט הגולמי.
 */
export function errorLabel(raw, locale = 'he') {
  if (!raw) return '';
  const text = String(raw);
  const digits = /^(\d+)/.exec(text);
  const key = digits ? Number(digits[1]) : text;
  return ERROR_LABELS[locale === 'en' ? 'en' : 'he'][key] || text;
}

// בריחת שדה: ציטוט + הכפלת גרשיים + גרש מוביל נגד תא שמתפרש כנוסחה ב-Excel/Sheets.
function csvField(value) {
  const s = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** recipients + not_sent (מ-getCampaignDetail) → שורות אחידות עם statusKey. */
export function buildRows({ recipients = [], not_sent = [] } = {}) {
  const attempted = (recipients || []).map((r) => ({
    contact_name: r.contact_name || '',
    phone: r.phone || '',
    statusKey: statusKeyOf(r.status),
    // status 4 נושא סיבת דילוג ולא שגיאת מסירה, אבל שתיהן חיות באותו שדה ומתורגמות יחד.
    error_title: (r.status === 3 || r.status === 4) ? (r.error_title || '') : '',
    // דילוג אינו ניסיון שליחה — 0, לא 1.
    attempts: r.status === 4 ? 0 : (r.attempt_count || 1),
    sent_at: r.status === 4 ? '' : (r.sent_at || ''),
    replied: !!r.replied,
    reply_content: r.reply_content || '',
    replied_at: r.replied_at || '',
    conversation_display_id: Number.isInteger(r.conversation_display_id) ? r.conversation_display_id : null,
  }));
  const missed = (not_sent || []).map((c) => ({
    contact_name: c.contact_name || '', phone: c.phone || '', statusKey: 'notsent',
    error_title: c.reason || '', attempts: 0, sent_at: '', replied: false, reply_content: '', replied_at: '',
    conversation_display_id: null,
  }));
  return attempted.concat(missed);
}

/**
 * סינון דו-צירי: statuses = Set של מפתחות (ריק = הכל), reply = 'all' | 'yes' | 'no'.
 * זהה לסינון בטבלת הדוח — כך "לפי הסינון הנוכחי" בדפדפן ובקובץ חופפים אחד לאחד.
 */
export function filterRows(rows, { statuses, reply = 'all' } = {}) {
  const wanted = statuses && statuses.size ? statuses : null;
  return rows.filter((row) => {
    if (wanted && !wanted.has(row.statusKey)) return false;
    if (reply === 'yes' && !row.replied) return false;
    if (reply === 'no' && row.replied) return false;
    return true;
  });
}

/** ?statuses=read,failed&reply=yes → אובייקט הסינון; ערכים לא מוכרים נזרקים בשקט. */
export function parseFilter(q = {}) {
  const statuses = new Set(String(q.statuses || '').split(',').map((s) => s.trim()).filter((s) => STATUS_KEYS.includes(s)));
  const reply = q.reply === 'yes' || q.reply === 'no' ? q.reply : 'all';
  return { statuses, reply };
}

/** גוף ה-CSV המלא (עם BOM). origin — לקישורי השיחות; ריק = בלי עמודת קישור מאוכלסת. */
export function toCsv(rows, { locale = 'he', origin = '', accountId } = {}) {
  const L = T[locale === 'en' ? 'en' : 'he'];
  const lines = [L.head.map(csvField).join(',')];
  for (const row of rows) {
    lines.push([
      row.contact_name,
      row.phone,
      L.status[row.statusKey],
      row.error_title ? errorLabel(row.error_title, locale) : (row.statusKey === 'notsent' ? L.noAttempt : ''),
      row.attempts,
      row.sent_at,
      row.replied ? L.yes : L.no,
      row.reply_content,
      row.replied_at,
      row.conversation_display_id && origin ? `${origin}/app/accounts/${accountId}/conversations/${row.conversation_display_id}` : '',
    ].map(csvField).join(','));
  }
  return '﻿' + lines.join('\r\n');
}

/** שם קובץ: דוח-<כותרת>-<תאריך>[-מסונן].csv */
export function csvFileName(campaign, { locale = 'he', filtered = false } = {}) {
  const L = T[locale === 'en' ? 'en' : 'he'];
  const safeTitle = String(campaign.title || `campaign-${campaign.id}`)
    .replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 70);
  const date = String(campaign.created_at || '').slice(0, 10) || campaign.id;
  return `${L.report}-${safeTitle}-${date}${filtered ? `-${L.filtered}` : ''}.csv`;
}
