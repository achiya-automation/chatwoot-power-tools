/**
 * notify.js — a WhatsApp ping the moment Meta answers about a NEW lead.
 *
 * WHY THIS EXISTS
 *   A drip that silently stops delivering looks exactly like a drip with no leads. The
 *   difference only shows up in a report, days later, when the client is already angry.
 *   The one event worth waking a human for is a NEW lead's very first message: it answers
 *   "is the system still reaching people?" — and if it failed, that lead is capped and no
 *   amount of retrying will help.
 *
 * WHY ONLY THE FIRST MESSAGE OF AN ENROLLMENT
 *   Every message of every step would be ~45 pings/day and none of them actionable: a step-6
 *   failure to a lead who already got steps 1-5 is noise. The first message is the lead-level
 *   event ("did this lead get in?"), and it's ~15/day.
 *
 * DELIVERY GUARANTEES
 *   `alerted_at` is stamped only AFTER the webhook returns 2xx, so a failed POST retries next
 *   tick instead of vanishing. The migration backfills every existing row — without that, the
 *   first run would find 4,000 historical messages "unalerted" and blast them all.
 *
 * ⛔ NEVER let this throw into the send path. An alert is a nice-to-have; a send is the product.
 */

/** Meta's error codes, in words a human can act on. */
const REASONS = {
  131049: 'מטא חסמה — מכסה אישית לשיווק',
  130472: 'מטא חסמה — הנמענת בניסוי של מטא',
  131026: 'לא מספר וואטסאפ פעיל',
  131050: 'הנמענת ביקשה לא לקבל שיווק',
  132015: 'התבנית מושהית אצל מטא',
  135000: 'מטא החזיקה את ההודעה וזרקה אותה (pacing)',
  131056: 'יותר מדי הודעות בין המספרים האלה',
};

const fmtPhone = (p) => String(p || '').replace(/^\+?972/, '0');

/**
 * ⛔ בכוונה בלי אחוז.
 *
 * אחוז מסירה של לידים חדשים מחלק את המסירות ב*כל* מי שנכנס — כולל לידים שמטא כבר
 * חסמה עוד לפני שהגיעו אלינו (שרידים מקמפיין קודם). ב-13/07: 5 מסירות מתוך 22 = 23%,
 * מספר שנראה כמו מערכת גוססת. האמת: 5 מתוך 5 הלידים שמטא לא חסמה נמסרו — 100%.
 *
 * שתי עובדות ובלי מנה. מי שקורא רואה גם שהמערכת מוסרת וגם כמה מהתור כבר שרוף,
 * ואף מספר לא משקר לו.
 */
const tallyOf = (t) =>
  `📊 לידים חדשים היום: ${t.delivered} נמסרו · ${t.failed} חסומים אצל מטא`;

/** One lead, one message. Short enough to read on a lock screen. */
function render(r, tally) {
  const who = `${r.name || 'ללא שם'} · ${fmtPhone(r.phone_number)}`;
  const today = tallyOf(tally);

  if (r.delivery_status === 'failed') {
    const why = REASONS[Number(r.error_code)] || r.error_title || `שגיאה ${r.error_code || '?'}`;
    const history = Number(r.cap_failures) > 1
      ? `\nמטא כבר חסמה אותה ${r.cap_failures} פעמים — הרצף ינסה שוב מחר.`
      : '\nהרצף ינסה שוב בעוד 24 שעות.';
    return `🔴 ליד חדש לא קיבל\n\n${who}\n${why}${history}\n\n${today}`;
  }
  return `✅ ליד חדש קיבל את ההודעה\n\n${who}\nתבנית: ${r.template_name}\n\n${today}`;
}

/**
 * Push a WhatsApp alert for every new lead whose first message Meta has now resolved.
 *
 * @param {import('pg').Pool} pool
 * @param {number} accountId
 * @param {{webhookUrl:string, fetchImpl?:Function, maxPerTick?:number}} opts
 * @returns {Promise<number>} how many alerts were sent
 */
export async function notifyNewLeads(pool, accountId, opts) {
  const { webhookUrl, fetchImpl = fetch, maxPerTick = 8 } = opts;
  if (!webhookUrl) return 0;

  const { rows } = await pool.query(
    `SELECT sm.id, sm.template_name, sm.delivery_status, sm.error_code, sm.error_title,
            c.name, c.phone_number, COALESCE(cs.cap_failures, 0) AS cap_failures
       FROM drip.sent_messages sm
       JOIN public.contacts c ON c.id = sm.contact_id
       LEFT JOIN drip.contact_state cs
              ON cs.account_id = sm.account_id AND cs.contact_id = sm.contact_id
      WHERE sm.account_id = $1
        AND sm.alerted_at IS NULL
        AND sm.delivery_status IN ('delivered', 'read', 'failed')
        -- ⭐ "ליד חדש" = מי שמעולם לא שלחנו לו. לא "ההודעה הראשונה של ההרשמה":
        -- החייאה של רצף ישן פותחת הרשמות חדשות למאות לידים ותיקים, והם היו נספרים
        -- כחדשים — 500 התראות, ואחוז הצלחה מדולל בזנב שרוף שכבר חסום.
        -- כשל בשלב 6 אצל מי שכבר קיבל 1-5 הוא רעש, לא התראה.
        AND NOT EXISTS (
              SELECT 1 FROM drip.sent_messages p
               WHERE p.account_id = sm.account_id AND p.contact_id = sm.contact_id
                 AND p.sent_at < sm.sent_at)
      ORDER BY sm.sent_at
      LIMIT 50`,
    [accountId]
  );
  if (!rows.length) return 0;

  // אחוז המסירה של הלידים החדשים היום — מול העיניים בכל התראה, בלי לפתוח כלום.
  // אותו NOT EXISTS בדיוק כמו למעלה: אותו היקף כמו ההתראה עצמה, אחרת המספר משקר.
  const [tally] = (await pool.query(
    `SELECT count(*) FILTER (WHERE delivery_status IN ('delivered','read'))::int AS delivered,
            count(*) FILTER (WHERE delivery_status = 'failed')::int AS failed
       FROM drip.sent_messages sm
      WHERE sm.account_id = $1
        AND sm.delivery_status IN ('delivered','read','failed')
        AND sm.sent_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Jerusalem')
                          AT TIME ZONE 'Asia/Jerusalem'
        AND NOT EXISTS (
              SELECT 1 FROM drip.sent_messages p
               WHERE p.account_id = sm.account_id AND p.contact_id = sm.contact_id
                 AND p.sent_at < sm.sent_at)`,
    [accountId]
  )).rows;

  // ⚠️ אנטי-הצפה. בעומס (החייאה של רצף ישן, backfill) התראה-לכל-ליד היא מאות הודעות
  // וואטסאפ ברצף — WAHA יחנק והטלפון יהפוך ללא-שמיש. מעל הסף: סיכום אחד.
  const texts = rows.length > maxPerTick
    ? [`📥 ${rows.length} לידים חדשים נסגרו כרגע\n\n` +
       `✅ נמסרו: ${rows.filter((r) => r.delivery_status !== 'failed').length}\n` +
       `🔴 נחסמו: ${rows.filter((r) => r.delivery_status === 'failed').length}\n\n` +
       tallyOf(tally)]
    : rows.map((r) => render(r, tally));

  for (const text of texts) {
    const res = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    // ⛔ לא מסמנים alerted_at לפני 2xx: webhook שנפל = התראה שנשלחת שוב בטיק הבא,
    // ולא התראה שנעלמה בשקט. כפילות עדיפה על החמצה כשזה מנגנון ההתראה עצמו.
    if (!res.ok) throw new Error(`webhook ${res.status}`);
  }

  await pool.query(
    `UPDATE drip.sent_messages SET alerted_at = now() WHERE id = ANY($1::uuid[])`,
    [rows.map((r) => r.id)]
  );
  return rows.length;
}

export const _render = render;   // לטסטים
