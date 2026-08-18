/**
 * scheduledMessages.js — שליחה מתוזמנת של הודעה בודדת בתוך שיחה.
 *
 * למה זה קיים: Chatwoot מתזמן קמפיינים, לא הודעות. נציג שמסיים תשובה בשעה 23:40, או
 * שמבטיח "אחזור אליך מחר בבוקר", נשאר בלי מקום להניח את ההודעה — היא יוצאת עכשיו או
 * נשכחת. כאן היא ממתינה בתור ויוצאת בשעה שנקבעה, גם כשהדפדפן סגור.
 *
 * ⚠️ זהות השולח: ההודעה יוצאת דרך ה-`api_access_token` של המנוע, בדיוק כמו כל הודעת רצף
 * — לא בשם הנציג שתזמן. אחסון טוקן הסשן של הנציג כדי לחקות אותו היה הופך כל שורה בטבלה
 * לסוד בר-שימוש-חוזר, וזה מחיר לא סביר עבור שם על בועה. הנציג המתזמן נשמר ב-created_by
 * לתצוגה בלבד.
 *
 * הדפוס (סימון-לפני-התנעה, FOR UPDATE SKIP LOCKED, כישלון נרשם בשורה ולא מפיל את הטיק)
 * זהה ל-campaignResend.runDueResends — ראה migrations/051_scheduled_messages.sql.
 */

const MAX_PER_TICK = 50;
const MAX_CONTENT = 20000;
// חלון החסד: הודעה שזמנה עבר לפני יותר מכאן לא נשלחת. שרת שהיה כבוי לילה שלם לא אמור
// לפלוט בבוקר מטח הודעות "לפי מחר בבוקר" שכבר מזמן לא רלוונטיות — ובוודאי לא ללקוחות.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** parseRunAt — מקבל ISO ומחזיר Date, או null אם אינו זמן עתידי תקין. */
export function parseRunAt(value, { now = Date.now(), maxDays = 60 } = {}) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const t = d.getTime();
  if (t <= now + 30_000) return null;                       // פחות מחצי דקה קדימה = "עכשיו"
  if (t > now + maxDays * 86400_000) return null;           // תקרה, שלא ייווצר תור נצחי
  return d;
}

/** scheduleMessage — מכניס הודעה לתור. מחזיר את השורה שנוצרה. */
export async function scheduleMessage({ query }, accountId, payload = {}) {
  const conversationId = Number(payload.conversation_id);
  const content = String(payload.content || '').trim();
  if (!Number.isFinite(conversationId) || conversationId <= 0) throw new Error('conversation_id required');
  if (!content) throw new Error('content required');
  if (content.length > MAX_CONTENT) throw new Error('content too long');
  const runAt = parseRunAt(payload.run_at);
  if (!runAt) throw new Error('run_at must be a valid time between 30s and 60 days from now');

  const rows = await query(
    `INSERT INTO drip.scheduled_messages
       (account_id, conversation_id, content, run_at, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, conversation_id, content, run_at, created_by_name, created_at`,
    [accountId, conversationId, content, runAt.toISOString(),
     payload.created_by ? Number(payload.created_by) : null,
     payload.created_by_name ? String(payload.created_by_name).slice(0, 120) : null]
  );
  return rows[0];
}

/** listScheduled — מה עוד ממתין בשיחה (או בחשבון כולו כשאין conversation_id). */
export async function listScheduled({ query }, accountId, payload = {}) {
  const conversationId = Number(payload.conversation_id);
  const scoped = Number.isFinite(conversationId) && conversationId > 0;
  return query(
    `SELECT id, conversation_id, content, run_at, created_by_name, created_at
       FROM drip.scheduled_messages
      WHERE account_id = $1 AND started_at IS NULL
        ${scoped ? 'AND conversation_id = $2' : ''}
      ORDER BY run_at
      LIMIT 200`,
    scoped ? [accountId, conversationId] : [accountId]
  );
}

/** cancelScheduled — מבטל הודעה שעוד לא התניעה. started_at בתנאי = אין מרוץ מול הטיק. */
export async function cancelScheduled({ query }, accountId, payload = {}) {
  const id = Number(payload.id);
  if (!Number.isFinite(id)) throw new Error('id required');
  const rows = await query(
    `DELETE FROM drip.scheduled_messages
      WHERE id = $1 AND account_id = $2 AND started_at IS NULL
      RETURNING id`,
    [id, accountId]
  );
  if (!rows.length) throw new Error('not found or already sent');
  return { id: rows[0].id };
}

/**
 * runDueScheduledMessages — נקרא מהטיק. מסמן כל שורה שהגיע זמנה כ"התחילה" *לפני* השליחה,
 * כדי ששני טיקים חופפים לא ישלחו פעמיים; כישלון נרשם בשורה ולא מפיל את הטיק.
 */
export async function runDueScheduledMessages({ query, makeClientFor, now = Date.now, log = console }) {
  const due = await query(
    `UPDATE drip.scheduled_messages
        SET started_at = now()
      WHERE id IN (
        SELECT id FROM drip.scheduled_messages
         WHERE started_at IS NULL AND run_at <= now()
         ORDER BY run_at LIMIT ${MAX_PER_TICK} FOR UPDATE SKIP LOCKED
      )
      RETURNING id, account_id, conversation_id, content, run_at`
  );
  let sent = 0;
  let skipped = 0;
  for (const row of due) {
    try {
      if (now() - new Date(row.run_at).getTime() > STALE_AFTER_MS) {
        skipped += 1;
        await query('UPDATE drip.scheduled_messages SET error = $2 WHERE id = $1',
          [row.id, 'skipped: past the staleness window']).catch(() => {});
        continue;
      }
      const client = await makeClientFor(Number(row.account_id));
      const m = await client.sendText(Number(row.conversation_id), row.content);
      await query('UPDATE drip.scheduled_messages SET sent_at = now(), message_id = $2 WHERE id = $1',
        [row.id, m && m.id ? Number(m.id) : null]).catch(() => {});
      sent += 1;
    } catch (e) {
      await query('UPDATE drip.scheduled_messages SET error = $2 WHERE id = $1',
        [row.id, String(e.message).slice(0, 500)]).catch(() => {});
      log.error?.(`[drip] scheduled message ${row.id} failed: ${e.message}`);
    }
  }
  return { due: due.length, sent, skipped };
}
