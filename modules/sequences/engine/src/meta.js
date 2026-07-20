/**
 * meta.js — קריאת מצב החשבון והתבניות ישירות מ-Graph API של מטא.
 *
 * המנוע שולח דרך Chatwoot, ולכן לא רואה את התשובה הסינכרונית של מטא. שלוש עובדות
 * קריטיות מגיעות רק מכאן:
 *   1. המכסה היומית (tier) — כמה נמענים ייחודיים מותר לפתוח אליהם שיחה ב-24h.
 *   2. דירוג האיכות של המספר (GREEN/YELLOW/RED) — האות המקדים לפני השעיה.
 *   3. סטטוס ואיכות של כל תבנית — תבנית מושהית נדחית ע"י מטא בכל מקרה.
 *
 * ⚠️ שינוי מטא, 21.5.2026: השדה `messaging_limit_tier` הוצא משימוש ומטא כבר לא
 * מחזירה אותו כלל — קריאה שלו מחזירה undefined, מה שהתרגם ל-DEFAULT_CAP=250 לנצח.
 * השדה שהחליף אותו: `whatsapp_business_manager_messaging_limit`. המגבלה עברה לרמת
 * *פורטפוליו עסקי* ומשותפת לכל מספרי הטלפון שבו, וגם המדרגות השתנו: אין יותר
 * TIER_1K, ומדרגת הכניסה אחרי scaling היא TIER_2K.
 * מקור: developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

// מדרגות המכסה של מטא → מקסימום שיחות שהעסק יוזם ב-24h מתגלגלות.
// TIER_50 ו-TIER_1K כבר לא מוקצות לחשבונות חדשים, אבל נשארות במפה כי חשבון ותיק
// עשוי עדיין להחזיר אותן.
const TIER_LIMITS = {
  TIER_50:        50,
  TIER_250:       250,
  TIER_1K:        1000,
  TIER_2K:        2000,      // ← מדרגת הכניסה החדשה. היעדרה כאן תרגם TIER_2K אמיתי
  TIER_10K:       10000,     //   ל-DEFAULT_CAP=250 — שמינית מהמותר.
  TIER_100K:      100000,
  TIER_UNLIMITED: Infinity,
  UNLIMITED:      Infinity,
};

// נפילה שמרנית כשאי אפשר לקרוא את המדרגה: המדרגה הנמוכה ביותר, כך שתקלה מאטה
// (בטוח) במקום להסיר את התקרה (חסימות).
export const DEFAULT_CAP = 250;

/** מדרגה → מספר. Infinity = ללא הגבלה. DEFAULT_CAP כשלא מזוהה. */
export function tierToCap(tier) {
  if (tier == null) return DEFAULT_CAP;
  const cap = TIER_LIMITS[String(tier).toUpperCase()];
  return cap == null ? DEFAULT_CAP : cap;
}

/**
 * קריאה גולמית של בריאות המספר: מדרגה + דירוג איכות.
 *
 * מבקשים גם את השדה הישן — חשבון שעדיין מקבל אותו יחזיר אותו, ואנחנו מעדיפים את
 * החדש כשקיים. מטא פשוט משמיטה שדות שאינה מכירה, אז בקשת שניהם בטוחה.
 *
 * @returns {Promise<{tier: string|null, quality: string|null}>}
 */
export async function fetchNumberHealth(phoneId, token, fetchImpl = fetch) {
  const fields = 'whatsapp_business_manager_messaging_limit,messaging_limit_tier,quality_rating';
  const r = await fetchImpl(`${GRAPH}/${phoneId}?fields=${fields}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Graph number health ${phoneId} → ${r.status}`);
  const j = await r.json();
  return {
    tier:    j.whatsapp_business_manager_messaging_limit || j.messaging_limit_tier || null,
    quality: j.quality_rating || null,
  };
}

/**
 * סטטוס ואיכות של כל התבניות ב-WABA.
 *
 * Chatwoot שומר עותק של התבניות, אבל מסנכרן אותו לאט ובלי quality_score — והשהיית
 * תבנית נמשכת 3 שעות בלבד. עותק בן-יממה חסר ערך כאן, אז קוראים ישירות ממטא.
 *
 * @returns {Promise<{name:string,language:string,status:string|null,quality:string,category:string|null}[]>}
 */
export async function fetchTemplateHealth(wabaId, token, fetchImpl = fetch) {
  const out = [];
  let url = `${GRAPH}/${wabaId}/message_templates`
    + `?fields=name,language,status,category,quality_score&limit=200`;
  for (let page = 0; page < 10 && url; page += 1) {   // ponytail: תקרה של 2000 תבניות
    const r = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`Graph templates ${wabaId} → ${r.status}`);
    const j = await r.json();
    for (const t of j.data || []) {
      out.push({
        name:     t.name,
        language: t.language || '',
        status:   t.status || null,
        quality:  t.quality_score?.score || 'UNKNOWN',
        category: t.category || null,
      });
    }
    url = j.paging?.next || null;
  }
  return out;
}

/**
 * יצירת עותק זהה של תבנית קיימת ב-WABA, בשם חדש — "עותק שריפה". שולף את ה-components
 * של המקור (GET) ויוצר תבנית חדשה איתם (POST). אותו תוכן בדיוק, שם שונה.
 *
 * ⚠️ זו פעולה יזומה, חד-פעמית (המשתמש לוחץ "צור עותק") — לא רוטציה אוטומטית. יצירה
 * אוטומטית חוזרת של תבניות כמעט-זהות נאסרה ב-14/07 (rotate.js הוסר) כי היא דפוס
 * הספאם שמטא מענישה. עותק בודד ויזום הוא הגדרה חד-פעמית של זוג, לא סדרה.
 *
 * מטא מאשרת עותק (תוכן זהה, שם שונה) תוך דקות עד שעות; refreshHealth יסנכרן את
 * הסטטוס. מחזיר את שם העותק ומזההו. זורק עם הודעה ידידותית בכשל (הרשאה/כפילות/פורמט).
 *
 * @returns {Promise<{name:string, id:string, status:string}>}
 */
export async function createTemplateCopy(wabaId, token, sourceName, burnName, fetchImpl = fetch) {
  if (!wabaId || !token) throw new Error('חסרים פרטי חיבור וואטסאפ (WABA/טוקן) לחשבון');
  // 1. שליפת המקור עם ה-components המלאים (הפורמט המדויק שנדרש ליצירה).
  const gr = await fetchImpl(
    `${GRAPH}/${wabaId}/message_templates`
      + `?name=${encodeURIComponent(sourceName)}&fields=name,language,category,components&limit=10`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const gj = await gr.json().catch(() => ({}));
  if (!gr.ok) throw new Error(gj?.error?.error_user_msg || gj?.error?.message || `קריאת התבנית נכשלה (${gr.status})`);
  const src = (gj.data || []).find((t) => t.name === sourceName);
  if (!src) throw new Error(`התבנית "${sourceName}" לא נמצאה ב-WABA`);

  // 2. יצירת העותק — אותם components, שם חדש. allow_category_change: שמטא תוכל
  //    לסווג מחדש בלי לדחות, כמו בתבנית רגילה.
  const cr = await fetchImpl(`${GRAPH}/${wabaId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: burnName,
      language: src.language,
      category: src.category || 'MARKETING',
      components: src.components,
      allow_category_change: true,
    }),
  });
  const cj = await cr.json().catch(() => ({}));
  if (!cr.ok) throw new Error(cj?.error?.error_user_msg || cj?.error?.message || `יצירת העותק נכשלה (${cr.status})`);
  return { name: burnName, id: cj.id || '', status: cj.status || 'PENDING' };
}

/** cap שמור ב-DB → מספר. ‎-1 מייצג "ללא הגבלה" (Infinity לא נשמר בעמודת int). */
function capFromDb(row) {
  if (!row || row.cap == null) return DEFAULT_CAP;
  return Number(row.cap) < 0 ? Infinity : Number(row.cap);
}

const _cache = new Map(); // accountId -> { at }

/**
 * רענון בריאות החשבון והתבניות אל תוך drip.account_health + drip.template_health.
 *
 * לעולם לא זורק: תקלת Graph או טוקן פגום יכולים רק להשאיר על כנו את המצב הקודם —
 * אף פעם לא להסיר תקרה ואף פעם לא לשחרר עצירה.
 *
 * דירוג RED → עצירת חשבון אוטומטית (כשהוגדר halt_on_red). מטא: מספר שממשיך לשלוח
 * באיכות נמוכה מגיע להשעיה. עצירה של כמה שעות זולה בהרבה מאיבוד המספר.
 *
 * @param {import('pg').Pool} pool
 * @param {object} reads      - makeDbReads(); דורש getWhatsappCreds
 * @param {number} accountId
 * @param {Date}   now
 * @param {object} deps       - { fetchNumberHealthFn, fetchTemplateHealthFn, refreshMs, compliance }
 * @returns {Promise<{cap: number, tier: string|null, quality: string|null}>}
 */
export async function refreshHealth(pool, reads, accountId, now = new Date(), deps = {}) {
  const {
    fetchNumberHealthFn   = fetchNumberHealth,
    fetchTemplateHealthFn = fetchTemplateHealth,
    refreshMs             = 30 * 60 * 1000,   // חצי שעה — השהיית תבנית היא 3h, שש שעות מיושן מדי
    compliance            = null,
  } = deps;

  const current = (await pool.query(
    `SELECT tier, cap, quality FROM drip.account_health WHERE account_id = $1`, [accountId]
  )).rows[0];

  const cached = _cache.get(accountId);
  if (cached && (now.getTime() - cached.at) < refreshMs) {
    return { cap: capFromDb(current), tier: current?.tier || null, quality: current?.quality || null };
  }

  try {
    const creds = reads.getWhatsappCreds ? await reads.getWhatsappCreds(accountId) : null;
    if (!creds?.phoneId || !creds?.token) throw new Error('no WhatsApp channel creds');

    const { tier, quality } = await fetchNumberHealthFn(creds.phoneId, creds.token);
    const cap = tierToCap(tier);

    await pool.query(
      `INSERT INTO drip.account_health (account_id, tier, cap, quality, checked_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (account_id) DO UPDATE
         SET tier = $2, cap = $3, quality = $4, checked_at = now()`,
      [accountId, tier, Number.isFinite(cap) ? cap : -1, quality]
    );

    if (compliance && quality) {
      const settings = await compliance.loadSettings(pool, accountId);
      if (quality === 'RED' && settings.halt_on_red) {
        const h = await compliance.loadHealth(pool, accountId);
        if (!h.halted) {
          await compliance.haltAccount(
            pool, accountId,
            'דירוג האיכות של המספר ירד ל-RED. המשך שליחה עלול להוביל להשעיית המספר.'
          );
        }
      } else if (quality === 'YELLOW') {
        await compliance.raiseAlert(
          pool, accountId, 'warn', 'quality_yellow',
          'דירוג האיכות של המספר ירד ל-YELLOW. בדקו את שיעור הקריאה ואת איכות הרשימה.'
        );
      } else if (quality === 'GREEN') {
        // auto-resume: מטא שדרגה את המספר ל-GREEN — הסכנה שהובילה לעצירה חלפה. משחררים
        // רק halt שנבע מדירוג האיכות (RED/נמוכה), ורק על GREEN מלא (לא UNKNOWN — ראה
        // resumeAccount). כך "עצירה עד התערבות ידנית" הופכת ל"עצירה בזמן סכנה, חידוש כשבטוח".
        const h = await compliance.loadHealth(pool, accountId);
        if (h.halted && /RED|נמוכה/.test(h.halt_reason || '')) {
          await compliance.resumeAccount(
            pool, accountId,
            'דירוג האיכות של המספר חזר ל-GREEN — השליחה חודשה אוטומטית.'
          );
        }
      }
    }

    if (creds.wabaId) {
      try {
        const tpls = await fetchTemplateHealthFn(creds.wabaId, creds.token);
        for (const t of tpls) {
          await pool.query(
            `INSERT INTO drip.template_health (account_id, template_name, language, status, quality, category, checked_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             ON CONFLICT (account_id, template_name, language) DO UPDATE
               SET status = $4, quality = $5, category = $6, checked_at = now()`,
            [accountId, t.name, t.language, t.status, t.quality, t.category]
          );
          if (compliance && t.status === 'PAUSED') {
            await compliance.raiseAlert(
              pool, accountId, 'warn', 'template_paused',
              `התבנית "${t.name}" מושהית ע"י מטא. רצפים שמשתמשים בה ממתינים ויימשכו כשתחזור.`
            );
          }
        }
      } catch (e) {
        console.error(`[drip] template health read failed acct ${accountId}:`, e.message);
      }
    }

    _cache.set(accountId, { at: now.getTime() });
    return { cap, tier, quality };
  } catch (e) {
    console.error(`[drip] health read failed acct ${accountId} (keeping last known):`, e.message);
    return { cap: capFromDb(current), tier: current?.tier || null, quality: current?.quality || null };
  }
}

/** עוזר לבדיקות — איפוס ה-cache. */
export function _resetHealthCache() { _cache.clear(); }
