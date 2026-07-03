import { API_BASE } from '../config.js';

/*
 * שכבת API לרצפים — מדברת עם ה-engine (drip-engine sidecar) ב-same-origin,
 * דרך נקודת קצה יחידה. (היה n8n webhook בעבר; כיום container בתוך ה-stack של Chatwoot.)
 *
 * חוזה: POST `${API_BASE}?account_id=N`  body: { action, payload }
 *   list         → { ok, data:[sequence...] }
 *   save         → { ok, data: sequence }
 *   delete       → { ok, data:null }
 *   templates    → { ok, data:[{name,language,category,params_count,body_preview}] }
 *   sent_history → { ok, data:[{step_order,template_name,content,sent_at}] }
 *
 * ה-API עובד בצורת DB (snake_case). הפונקציות כאן ממפות UI↔DB כך ששאר
 * האפליקציה עובדת בצורה השטוחה הנוחה (name/stopOnReply/quietHoursStart/...).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function call(action, payload, accountId) {
  if (accountId == null) throw new Error('חסר account_id');
  const url = `${API_BASE}?account_id=${encodeURIComponent(accountId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload: payload || {} }),
  });
  if (!res.ok) throw new Error(`API ${action} נכשל (${res.status})`);
  const json = await res.json();
  if (json && json.ok === false) throw new Error(json.error || `API ${action} נכשל`);
  return json ? json.data : null;
}

// ── מיפוי DB → UI ──
function stepToUi(s) {
  return {
    id: s.id || `step_${Math.random().toString(36).slice(2, 9)}`,
    template: s.template_name || '',
    language: s.language || 'he',
    category: s.category || 'MARKETING',
    delayDays: Number(s.delay_days) || 0,
    delayHours: Number(s.delay_hours) || 0,
    // params מאוחסן כמערך (jsonb) — שומרים מערך שטוח של מחרוזות
    params: Array.isArray(s.params) ? s.params : [],
    // קישור מדיה ל-header (IMAGE/VIDEO/DOCUMENT) — ריק אם אין
    mediaUrl: s.media_url || '',
    // תנאי שליחה (per-step): always/no_reply/replied + פעולה כשלא מתקיים: skip/stop
    sendCondition: s.send_condition || 'always',
    onConditionFail: s.on_condition_fail || 'skip',
    // ── תזמון מתקדם (בורר "שורה חכמה + מתקדם") ──
    sendHour: (s.send_hour === 0 || s.send_hour) ? Number(s.send_hour) : null, // שעה מדויקת 0-23 (null=ללא snap)
    sendDate: s.send_date || '',                                              // תאריך מוחלט YYYY-MM-DD (broadcast); ריק=יחסי
    repeatInterval: s.repeat_interval ? Number(s.repeat_interval) : null,     // חזרה: מספר מחזורים (null=חד-פעמי)
    repeatUnit: s.repeat_unit || '',                                          // day | week | month
    allowedDow: Array.isArray(s.allowed_dow) ? s.allowed_dow.map(Number) : [], // ימי שבוע מותרים 0=ראשון..6=שבת ([]=כולם)
  };
}

function toUi(seq) {
  return {
    id: seq.id,
    key: seq.key || '',
    name: seq.display_name || '',
    enabled: !!seq.enabled,
    // שני מתגי כיבוי נפרדים (migration 018): כניסות (צירוף לידים חדשים) ושליחה (לרצפים פעילים).
    enrollEnabled: seq.enroll_enabled !== false,
    sendEnabled: seq.send_enabled !== false,
    stopOnReply: !!seq.stop_on_reply,
    skipShabbat: !!seq.skip_shabbat,
    quietHoursStart: seq.quiet_start || '',
    quietHoursEnd: seq.quiet_end || '',
    steps: (seq.steps || []).map(stepToUi),
  };
}

// ── מיפוי UI → DB ──
function stepToDb(s) {
  return {
    template_name: s.template || '',
    language: s.language || 'he',
    category: s.category || 'MARKETING',
    delay_days: Number(s.delayDays) || 0,
    delay_hours: Number(s.delayHours) || 0,
    // params = מערך מחרוזות (jsonb). שומרים גם ערכים ריקים כדי לשמר את הסדר/אינדקס.
    params: Array.isArray(s.params) ? s.params.map((x) => String(x || '')) : [],
    // קישור מדיה ל-header (ריק → NULL ב-DB)
    media_url: String(s.mediaUrl || '').trim(),
    // תנאי שליחה (per-step): always/no_reply/replied + פעולה כשלא מתקיים: skip/stop
    send_condition: s.sendCondition || 'always',
    on_condition_fail: s.onConditionFail || 'skip',
    // ── תזמון מתקדם — ריק → NULL ב-DB (0 הוא שעה תקפה, לכן בודקים === 0 בנפרד) ──
    send_hour: (s.sendHour === 0 || s.sendHour) ? Number(s.sendHour) : '',
    send_date: String(s.sendDate || '').trim(),
    repeat_interval: s.repeatInterval ? Number(s.repeatInterval) : '',
    repeat_unit: s.repeatInterval ? (s.repeatUnit || 'month') : '',
    allowed_dow: Array.isArray(s.allowedDow) ? s.allowedDow.map(Number) : [],
  };
}

function toDb(seq) {
  return {
    // מזהה זמני מקומי (seq_xxx) → null = יצירה. uuid אמיתי → עדכון.
    id: seq.id && UUID_RE.test(seq.id) ? seq.id : null,
    key: String(seq.key || '').trim(),
    display_name: String(seq.name || '').trim(),
    // `enabled` = נגזרת (פעיל במשהו); המנוע אוכף לפי שני המתגים הנפרדים.
    enabled: !!seq.enrollEnabled || !!seq.sendEnabled,
    enroll_enabled: !!seq.enrollEnabled,
    send_enabled: !!seq.sendEnabled,
    stop_on_reply: !!seq.stopOnReply,
    skip_shabbat: !!seq.skipShabbat,
    quiet_start: seq.quietHoursStart || '',
    quiet_end: seq.quietHoursEnd || '',
    steps: (seq.steps || []).map(stepToDb),
  };
}

// ── פעולות ──
export async function listSequences(accountId) {
  const data = await call('list', {}, accountId);
  return (data || []).map(toUi);
}

export async function saveSequence(seq, accountId) {
  const saved = await call('save', toDb(seq), accountId);
  return toUi(saved);
}

export async function deleteSequence(key, accountId) {
  await call('delete', { key }, accountId);
  return { key };
}

export async function listTemplates(accountId) {
  const data = await call('templates', {}, accountId);
  return data || [];
}

// enrollments — אנשי קשר שמשויכים כרגע לרצפים (תצוגה גלובלית). מוחזר בצורת DB ישירות
// (כולל contact_name + phone אמיתי מ-contacts).
export async function listEnrollments(accountId) {
  const data = await call('enrollments', {}, accountId);
  return data || [];
}

// labels — תוויות השיחות בחשבון + ספירה: [{ label, count }] (לשיוך המוני לפי תווית).
export async function listLabels(accountId) {
  const data = await call('labels', {}, accountId);
  return data || [];
}

// bulk_enroll — משייך רצף לכל השיחות עם תווית מסוימת. מחזיר { count, total }.
export async function bulkEnroll(label, sequenceKey, accountId) {
  return call('bulk_enroll', { label, sequence: sequenceKey }, accountId);
}

// enrollment_status — מצב הליד של *שיחה בודדת* (תצוגת סרגל-צד לקריאה-בלבד).
// מחזיר { sequence_name, sequence_key, current_step, total_steps, status,
//         next_send_at, phone } | null (כשהליד לא משויך לאף רצף).
export async function getEnrollmentStatus(conversationId, accountId) {
  return call('enrollment_status', { conversation_id: conversationId }, accountId);
}

// sent_history — יומן ההודעות שכבר נשלחו ללקוח (שקיפות: "מה נשלח בפועל ומתי").
// מחזיר [{ step_order, template_name, content, sent_at, enrollment_id }] (מסודר לפי זמן, [] כשאין).
export async function getSentHistory(conversationId, accountId) {
  const data = await call('sent_history', { conversation_id: conversationId }, accountId);
  return data || [];
}

// projected_schedule — מועדי השליחה הצפויים של השלב הנוכחי וכל השלבים הבאים, מחושבים בדיוק
// כמו שהמנוע ישלח (כולל דחיית שבת/חג). מחזיר [{ step_order, send_at }] (שעון ישראל), [] כשאין רישום פעיל.
export async function getProjectedSchedule(conversationId, accountId) {
  const data = await call('projected_schedule', { conversation_id: conversationId }, accountId);
  return data || [];
}

// upload_media — מעלה קובץ (drag-drop) ומקבל קישור ציבורי. נשלח כ-raw body; השרת
// מאמת מול מגבלות WhatsApp ושומר ב-volume. מחזיר { url, byteSize, mime }.
export async function uploadMedia(file, format, accountId) {
  if (accountId == null) throw new Error('חסר account_id');
  const url = `${API_BASE}/media?account_id=${encodeURIComponent(accountId)}&format=${encodeURIComponent(format || '')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'x-filename': encodeURIComponent(file.name || 'file'),
    },
    body: file,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error || `העלאה נכשלה (${res.status})`);
  return json.data; // { url, file, byteSize, mime }
}

// storage_usage — אחסון לחשבון: { drip_bytes, drip_count, chatwoot_bytes, total_bytes }.
export async function getStorageUsage(accountId) {
  return call('storage_usage', {}, accountId);
}

// delivery_stats — אנליטיקת שליחה/מסירה לכרטיס "פעילות שליחה":
// { today:{sent,delivered,read,failed,pending,block_cap,block_invalid,block_optout,block_other},
//   byTemplate:[{template,sent,failed}], retryWaiting:int, trend:[{day,sent,delivered,failed}] }
export async function getDeliveryStats(accountId) {
  return call('delivery_stats', {}, accountId);
}

// set_sequence — שיוך/ביטול סדרה לשיחה בודדת (מהפאנל בתוך השיחה).
// sequence ריק/null → opt-out (המנוע עוצר את הליד). מחזיר { ok:true }.
export async function setSequence(conversationId, sequence, accountId) {
  return call(
    'set_sequence',
    { conversation_id: conversationId, sequence: sequence || '' },
    accountId
  );
}

// set_sequence לפי איש קשר — שיוך/החלפה/הסרה של סדרה לליד ישירות מהדשבורד (בלי שיחה).
// המנוע כותב את מאפיין `sequence` ברמת איש הקשר; ה-reconciler משייך/מעביר/עוצר בטיק הבא.
// sequence ריק/null → הסרה. מחזיר { ok:true }.
export async function setSequenceByContact(contactId, sequence, accountId) {
  return call(
    'set_sequence',
    { contact_id: contactId, sequence: sequence || '' },
    accountId
  );
}

// contacts — חיפוש אנשי קשר בחשבון כדי לשייך ליד לסדרה (שם/טלפון/אימייל). חיפוש ריק →
// אנשי הקשר האחרונים. כל שורה: { contact_id, name, phone, email, sequence } (סדרה נוכחית).
export async function searchContacts(queryText, accountId) {
  const data = await call('contacts', { query: queryText || '' }, accountId);
  return data || [];
}
