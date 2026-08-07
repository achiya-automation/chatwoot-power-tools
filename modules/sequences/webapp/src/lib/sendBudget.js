/**
 * sendBudget.js — pure math for "how many messages can still go out today", from the
 * `usage` block of the compliance payload: { used_24h, cap, inbox }.
 *
 * Meta's daily cap is a ceiling on *new conversations* per rolling 24h. Seeing only the
 * ceiling (what the screen showed before) says nothing about how much of it is left, which
 * is the only number a person actually plans by.
 *
 * Returns null whenever the figures cannot be stated honestly — no usage block at all
 * (older engine) or no usable cap — so the caller can keep showing exactly what it showed
 * before instead of inventing a number.
 */

export function sendBudget(usage) {
  if (!usage || typeof usage !== 'object') return null;

  // ⚠️ Number(null) הוא 0 — בלי הבדיקה המפורשת תקרה חסרה הייתה נראית כתקרה אפס
  // ("נגמרה המכסה") במקום כ"אין נתון".
  if (usage.cap == null || usage.cap === '') return null;
  const rawCap = Number(usage.cap);
  if (!Number.isFinite(rawCap)) return null;

  const used = Math.max(0, Math.trunc(Number(usage.used_24h)) || 0);
  const unlimited = rawCap === -1; // מטא: תקרה "ללא הגבלה" מגיעה כ--1, לא כמספר גדול
  const cap = unlimited ? -1 : Math.max(0, Math.trunc(rawCap));

  return {
    used,
    cap,
    unlimited,
    // נותרו לעולם לא שלילי: החשבון עלול לעבור את התקרה (הודעות שנשלחו מחוץ למנוע),
    // ו"‎-40 נותרו" זו אמירה שקרית — האמת היא שנגמר.
    remaining: unlimited ? null : Math.max(0, cap - used),
    // המספר שהנתונים שייכים לו. null = לא נבחר מספר לרצפים → אסור להציג את המספרים
    // כאילו הם מיוחסים לקו כלשהו.
    inbox: usage.inbox || null,
  };
}
