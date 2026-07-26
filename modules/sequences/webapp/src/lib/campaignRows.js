/*
 * campaignRows — השכבה הטהורה שבין תשובת campaign_detail לבין טבלת הנמענים והייצוא.
 *
 * מאחדת את שתי הרשימות שהדוח מחזיר (recipients = מי שנוסה, not_sent = קהל היעד שלא נוסה)
 * לשורות בעלות אותו מבנה, מסננת לפי בחירת המשתמש, ומרנדרת CSV. בלי React/DOM — נבדקת
 * ב-node --test (test/campaignRows.test.js).
 *
 * ⚠️ סטטוס בשורה הוא המצב *הסופי* של אותו נמען, ולכן הקטגוריות זרות זו לזו (סכומן = הקהל).
 * זה שונה מהמשפך למעלה, שבו "נמסרו" מכיל גם את מי שכבר קרא. משום כך התוויות כאן מפורשות:
 * "נמסרו · טרם נקראו", ולא "נמסרו" סתם — אחרת המספר בצ'יפ סותר לכאורה את המשפך.
 */
import { csvRow } from './csv.js';

// messages.status: 0=נשלח 1=נמסר 2=נקרא 3=נכשל (ראו engine/src/campaigns.js).
// כל ערך אחר (null/NaN — שורה שטרם קיבלה סטטוס) נופל ל-pending, כמו בטבלה.
export function statusKeyOf(status) {
  return status === 2 ? 'read'
    : status === 1 ? 'delivered'
      : status === 3 ? 'failed'
        : status === 0 ? 'sent' : 'pending';
}

/** סדר הצגת הצ'יפים — מהמצב הטוב ביותר לגרוע, ולבסוף מי שלא נוסה כלל. */
export const STATUS_KEYS = ['read', 'delivered', 'sent', 'pending', 'failed', 'notsent'];

/** recipients + not_sent → מערך שורות אחיד. */
export function buildRows({ recipients = [], not_sent = [] } = {}) {
  const attempted = (recipients || []).map((r) => ({
    contact_name: r.contact_name || '',
    phone: r.phone || '',
    statusKey: statusKeyOf(r.status),
    // המחרוזת הגולמית של Meta; התרגום נעשה בשכבת התצוגה (deliveryError.js).
    error_title: r.status === 3 ? (r.error_title || '') : '',
    attempts: r.attempt_count || 1,
    sent_at: r.sent_at || '',
    replied: !!r.replied,
    reply_content: r.reply_content || '',
    replied_at: r.replied_at || '',
    conversation_display_id: Number.isInteger(r.conversation_display_id) ? r.conversation_display_id : null,
  }));
  const missed = (not_sent || []).map((c) => ({
    contact_name: c.contact_name || '',
    phone: c.phone || '',
    statusKey: 'notsent',
    error_title: '',
    attempts: 0,
    sent_at: '',
    replied: false,
    reply_content: '',
    replied_at: '',
    conversation_display_id: null,
  }));
  return attempted.concat(missed);
}

/** ספירה לכל מפתח סטטוס + לשני מצבי התגובה — מוצגת על הצ'יפים עצמם. */
export function countRows(rows) {
  const counts = { replied: 0, noreply: 0 };
  for (const key of STATUS_KEYS) counts[key] = 0;
  for (const row of rows) {
    counts[row.statusKey] = (counts[row.statusKey] || 0) + 1;
    if (row.replied) counts.replied += 1; else counts.noreply += 1;
  }
  return counts;
}

/**
 * סינון: statuses = Set של מפתחות סטטוס (ריק/חסר = הכל), reply = 'all' | 'yes' | 'no'.
 * שני הצירים בלתי-תלויים — "נכשלו שהגיבו" הוא צירוף חוקי (ותשובה מעניינת).
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

/**
 * CSV מלא של השורות שנבחרו.
 * labels: כותרות העמודות + statusLabel(key) + yes/no + errorLabel(raw) — מוזרקים מהרכיב
 * כדי שהמודול יישאר טהור (וכדי שהתרגום יישאר במקום אחד).
 * conversationUrl(displayId) → קישור מלא לשיחה, או '' כשאין.
 */
export function rowsToCsv(rows, labels) {
  const head = [
    labels.name, labels.phone, labels.status, labels.reason, labels.attempts,
    labels.when, labels.replied, labels.replyText, labels.replyWhen, labels.conversation,
  ];
  const body = rows.map((row) => [
    row.contact_name,
    row.phone,
    labels.statusLabel(row.statusKey),
    row.statusKey === 'notsent' ? labels.noAttempt : (row.error_title ? labels.errorLabel(row.error_title) : ''),
    row.attempts,
    row.sent_at,
    row.replied ? labels.yes : labels.no,
    row.reply_content,
    row.replied_at,
    row.conversation_display_id ? labels.conversationUrl(row.conversation_display_id) : '',
  ]);
  // BOM — בלעדיו Excel פותח עברית UTF-8 כג'יבריש.
  return '﻿' + [head, ...body].map(csvRow).join('\r\n');
}
