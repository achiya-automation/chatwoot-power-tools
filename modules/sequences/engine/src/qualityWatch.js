/**
 * qualityWatch.js — שומר על דירוג האיכות של כל מספרי הוואטסאפ, גם אלה שהמנוע לא שולח מהם.
 *
 * למה זה קיים
 *   refreshHealth (meta.js) בודק בריאות רק לחשבונות שרשומים ב-drip.account_tokens ורק
 *   אחרי שנבחר להם מספר לרצפים. ב-07.08.2026 התגלה מספר של לקוח בדירוג RED אצל מטא —
 *   האות המקדים לפני השעיה — שלא היה רשום במנוע, ולכן אף אחד לא ידע. מספר שמושעה הוא
 *   ערוץ שלם שנסגר ללקוח, וזה בדיוק סוג הדבר שאסור לגלות בדיעבד.
 *
 * מה הוא עושה
 *   סורק את כל ערוצי הוואטסאפ שמוגדרים ב-Chatwoot, שואל את מטא מה הדירוג, ומתריע
 *   כשהמצב *משתנה* לרעה. לא מתריע שוב על אותו מצב — התראה שחוזרת כל שעה נהיית רעש
 *   שמפסיקים להסתכל עליו, וזה בדיוק מה שהורג התראות.
 *
 * ⛔ לעולם לא זורק החוצה. זו שכבת תצפית; היא לא מפילה טיק ולא עוצרת שליחה.
 */

// מה נחשב הרעה שמצדיקה התראה. UNKNOWN לא נחשב — מטא מחזירה אותו על מספר חדש או שקט.
const SEVERITY = { GREEN: 0, UNKNOWN: 0, YELLOW: 1, RED: 2 };

const WORDS = {
  RED: '🔴 דירוג האיכות ירד ל-RED — מטא עלולה להשעות את המספר. זה השלב שלפני חסימה.',
  YELLOW: '🟡 דירוג האיכות ירד ל-YELLOW. כדאי לבדוק את איכות הרשימה ואת שיעור התגובות.',
  GREEN: '🟢 דירוג האיכות חזר ל-GREEN.',
};

const fmtPhone = (p) => String(p || '').replace(/^\+?972/, '0');

/**
 * סורק את כל המספרים ומחזיר את ההתראות שנשלחו.
 *
 * @param {import('pg').Pool} pool
 * @param {object} deps - { fetchNumberHealthFn, webhookUrl, fetchImpl }
 * @returns {Promise<{checked:number, alerts:number}>}
 */
export async function watchNumberQuality(pool, deps = {}) {
  const {
    fetchNumberHealthFn,
    webhookUrl = '',
    fetchImpl = fetch,
  } = deps;
  if (!fetchNumberHealthFn) return { checked: 0, alerts: 0 };

  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT i.id            AS inbox_id,
              i.account_id    AS account_id,
              i.name          AS inbox_name,
              cw.phone_number AS phone,
              cw.provider_config->>'api_key'         AS token,
              cw.provider_config->>'phone_number_id' AS phone_id
         FROM public.inboxes i
         JOIN public.channel_whatsapp cw ON cw.id = i.channel_id
        WHERE cw.provider_config->>'phone_number_id' IS NOT NULL`
    ));
  } catch (e) {
    console.error('[quality-watch] cannot read channels:', e.message);
    return { checked: 0, alerts: 0 };
  }

  let checked = 0;
  let alerts = 0;

  for (const r of rows) {
    let quality = null;
    let tier = null;
    let lastError = null;
    try {
      ({ quality, tier } = await fetchNumberHealthFn(r.phone_id, r.token));
    } catch (e) {
      // טוקן שפג, מספר שהוסר מה-WABA, או תקלת רשת. נרשם — אבל לא מתריעים עליו:
      // מספר מנותק הוא בעיית הגדרה, לא סכנת השעיה, והתראה עליו הייתה רעש קבוע.
      lastError = e.message.slice(0, 300);
    }
    checked += 1;

    const prev = (await pool.query(
      'SELECT quality, alerted_quality FROM drip.number_quality WHERE phone_id = $1', [r.phone_id]
    )).rows[0];

    await pool.query(
      `INSERT INTO drip.number_quality (phone_id, inbox_id, account_id, phone, quality, tier, last_error, checked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (phone_id) DO UPDATE
         SET inbox_id = $2, account_id = $3, phone = $4, quality = $5,
             tier = $6, last_error = $7, checked_at = now()`,
      [r.phone_id, r.inbox_id, r.account_id, r.phone, quality, tier, lastError]
    );

    if (!quality || !webhookUrl) continue;

    const now = SEVERITY[quality] ?? 0;
    const reported = SEVERITY[prev?.alerted_quality] ?? 0;
    // מתריעים על הרעה, ופעם אחת גם על חזרה לירוק — כדי שמי שקיבל אזהרה יידע שהיא נסגרה.
    const worsened = now > reported;
    const recovered = now === 0 && reported > 0;
    if (!worsened && !recovered) continue;

    const text = [
      WORDS[quality] || `דירוג האיכות: ${quality}`,
      `מספר: ${fmtPhone(r.phone)} · תיבה: ${r.inbox_name} (חשבון ${r.account_id})`,
      tier ? `מכסה: ${tier}` : null,
    ].filter(Boolean).join('\n');

    try {
      const res = await fetchImpl(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`webhook ${res.status}`);
      // ⛔ מסמנים רק אחרי 2xx — webhook שנפל יתריע שוב בסבב הבא, ולא ייעלם בשקט.
      await pool.query(
        'UPDATE drip.number_quality SET alerted_quality = $2, alerted_at = now() WHERE phone_id = $1',
        [r.phone_id, quality]
      );
      alerts += 1;
    } catch (e) {
      console.error(`[quality-watch] alert failed for ${r.phone}:`, e.message);
    }
  }

  return { checked, alerts };
}
