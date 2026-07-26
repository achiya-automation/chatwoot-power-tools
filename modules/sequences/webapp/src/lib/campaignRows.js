/*
 * campaignRows — השכבה הטהורה שבין תשובת campaign_detail לבין טבלת הנמענים.
 *
 * מאחדת את שתי הרשימות שהדוח מחזיר (recipients = מי שנוסה, not_sent = קהל היעד שלא נוסה)
 * לשורות בעלות אותו מבנה ומסננת לפי בחירת המשתמש. בלי React/DOM — נבדקת ב-node --test
 * (test/campaignRows.test.js). רינדור ה-CSV עצמו יושב בשרת (engine/src/campaignCsv.js,
 * לוגיקת שורות/סינון זהה) — ההורדה היא ניווט אל נקודת קצה, לא blob בדפדפן.
 *
 * ⚠️ סטטוס בשורה הוא המצב *הסופי* של אותו נמען, ולכן הקטגוריות זרות זו לזו (סכומן = הקהל).
 * זה שונה מהמשפך למעלה, שבו "נמסרו" מכיל גם את מי שכבר קרא. משום כך התוויות כאן מפורשות:
 * "נמסרו · טרם נקראו", ולא "נמסרו" סתם — אחרת המספר בצ'יפ סותר לכאורה את המשפך.
 */

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

