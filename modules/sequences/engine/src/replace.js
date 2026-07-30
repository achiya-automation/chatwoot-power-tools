// ── החלפת-תבנית אוטומטית בריאה ────────────────────────────────────────────────
//
// היסטוריה מחייבת: rotate.js הוסר ב-14/07 כי רוטציה עיוורת (טיימר / מונה שליחות,
// ~15 תבניות בחודש) היא בדיוק דפוס חוות-הספאם שמטא מענישה. המנגנון הזה שונה
// בשלושה מובנים שהופכים אותו לבריא:
//   1. הטריגר הוא שחיקה *נמדדת* — כשלי מסירה על תבנית נקייה בחלון נע של 7 ימים —
//      לא לוח זמנים ולא מונה שליחות.
//   2. בלמי קצב קשיחים: החלפה אחת למשפחה ב-14 יום, שלוש לחשבון ב-30 יום. סדר
//      גודל מתחת לכל דפוס farming.
//   3. תוכן זהה בלבד, אימוץ רק אחרי אישור מטא, ודחייה (כפילות/כל כשל) עוצרת את
//      המשפחה עם התראה לאדם — לעולם לא משנים תוכן אוטומטית ולא מנסים שוב בלולאה.
//
// הרקע המדוד (חשבון 7): תבנית עם 0 כשלים מוסרת 67% ללידים חדשים; 1-5 ⇒ 40%;
// 6+ ⇒ 8%. ב-30/07 תבנית הפתיחה צברה 28 כשלים/7ימים (ותיקים קרים ששוחררו דרכה
// + לחץ השיטפון) וחסמה 100% מהחדשים — ספירלה שמזינה את עצמה, כי כל חדש שנחסם
// מוסיף כשל. עותק זהה טרי הוא התיקון שהוכח: 13/07 — עותק טרי מסר 4/4 מיד.

import { createTemplateCopy } from './meta.js';
import { templateFamily } from './reconcile.js';
import * as compliance from './compliance.js';

export const REPLACE_FAILS_7D = 12;      // ponytail: סף שחיקה — הקריסה נמדדה כבר ב-6+, ‏12 משאיר שוליים מרעש קהל-נקי
export const FAMILY_COOLDOWN_DAYS = 14;  // החלפה אחת למשפחת תבנית בשבועיים
export const ACCOUNT_MAX_PER_30D = 3;    // ושלוש לחשבון בחודש — הרבה מתחת לרדאר farming

/** bb_new_00_intro → bb_new_00_intro_v2 → bb_new_00_intro_v3 … (שומר על אותה משפחה) */
export function nextVersionName(name) {
  const m = String(name).match(/^(.*)_v(\d+)$/);
  return m ? `${m[1]}_v${Number(m[2]) + 1}` : `${name}_v2`;
}

/** תאומת burn פנויה: family_burn1 תפוסה ⇒ family_burn2, וכן הלאה. */
export function nextBurnName(family, existingNames) {
  let max = 0;
  for (const n of existingNames || []) {
    const m = String(n).match(/_burn(\d+)$/);
    if (m && String(n).startsWith(`${family}_burn`)) max = Math.max(max, Number(m[1]));
  }
  return `${family}_burn${max + 1}`;
}

/**
 * שלב א' — זיהוי ויצירה. תבנית נקייה בשימוש פעיל שחצתה את סף השחיקה מקבלת עותק
 * זהה + תאומת burn טרייה במטא, ושורת pending_approval בספר ההחלפות. לא נוגע
 * בשלבים — האימוץ (שלב ב') קורה רק אחרי אישור מטא.
 */
export async function maybeCreateReplacements(pool, reads, accountId, now = new Date(), deps = {}) {
  const createCopy = deps.createCopyFn || createTemplateCopy;
  const q = (t, p) => pool.query(t, p).then((r) => r.rows);

  const s = (await q(
    `SELECT auto_template_replace_enabled FROM drip.compliance WHERE account_id = $1`,
    [accountId]
  ))[0];
  if (!s?.auto_template_replace_enabled) return [];

  // תבניות נקיות (לא burn) שמופיעות בשלב של רצף מאופשר וצברו כשלים מעל הסף בחלון הנע
  const worn = await q(
    `SELECT st.template_name AS name, count(DISTINCT sm.id)::int AS fails
       FROM drip.sequence_steps st
       JOIN drip.sequences sq ON sq.id = st.sequence_id
                             AND sq.account_id = $1 AND sq.enabled
       JOIN drip.sent_messages sm ON sm.account_id = $1
                                 AND sm.template_name = st.template_name
                                 AND sm.delivery_status = 'failed'
                                 AND sm.sent_at >= $2::timestamptz - interval '7 days'
      WHERE st.template_name NOT LIKE '%burn%'
      GROUP BY 1
     HAVING count(DISTINCT sm.id) >= $3`,
    [accountId, now, deps.failsThreshold ?? REPLACE_FAILS_7D]
  );
  if (!worn.length) return [];

  const made = [];
  for (const w of worn) {
    const family = templateFamily(w.name);

    // בלם משפחה: כל שורה בתוך חלון הצינון חוסמת — כולל rejected (נדרש אדם,
    // לא ניסיון אוטומטי חוזר) ו-adopted (העותק הטרי צריך זמן לצבור היסטוריה).
    const recent = (await q(
      `SELECT 1 FROM drip.template_replacements
        WHERE account_id = $1 AND family = $2
          AND created_at > $3::timestamptz - make_interval(days => $4)
        LIMIT 1`,
      [accountId, family, now, FAMILY_COOLDOWN_DAYS]
    )).length;
    if (recent) continue;

    // בלם חשבון: מעל 3 החלפות בחודש זה כבר לא תיקון-תקלה — עוצרים ומתריעים.
    const monthCount = Number((await q(
      `SELECT count(*)::int AS c FROM drip.template_replacements
        WHERE account_id = $1 AND created_at > $2::timestamptz - interval '30 days'`,
      [accountId, now]
    ))[0].c);
    if (monthCount >= ACCOUNT_MAX_PER_30D) {
      await compliance.raiseAlert(pool, accountId, 'warn', 'template_replace_rate_capped',
        `תבנית "${w.name}" חצתה את סף השחיקה (${w.fails} כשלים/7 ימים) אבל בלם הקצב ` +
        `החשבוני (${ACCOUNT_MAX_PER_30D}/30 יום) מלא — נדרשת החלטה ידנית.`);
      break;
    }

    const creds = await reads.getWhatsappCreds(accountId);
    if (!creds) break;

    const newName = nextVersionName(w.name);
    const burns = (await q(
      `SELECT template_name FROM drip.template_health
        WHERE account_id = $1 AND template_name LIKE $2`,
      [accountId, `${family}_burn%`]
    )).map((r) => r.template_name);
    const newBurn = nextBurnName(family, burns);

    try {
      await createCopy(creds.wabaId, creds.token, w.name, newName);
      await createCopy(creds.wabaId, creds.token, w.name, newBurn);
      await q(
        `INSERT INTO drip.template_replacements
               (account_id, family, old_name, new_name, new_burn, status, reason)
         VALUES ($1, $2, $3, $4, $5, 'pending_approval', $6)`,
        [accountId, family, w.name, newName, newBurn, `auto: ${w.fails} fails/7d`]
      );
      await compliance.raiseAlert(pool, accountId, 'warn', 'template_replace_created',
        `תבנית "${w.name}" נשחקה (${w.fails} כשלים/7 ימים). נוצר עותק זהה "${newName}" ` +
        `+ עותק שריפה — יאומץ אוטומטית ברגע שמטא תאשר.`);
      console.log(`[tpl-replace] acct ${accountId}: created ${newName} + ${newBurn} (worn: ${w.name}, ${w.fails} fails/7d)`);
      made.push({ old: w.name, next: newName, burn: newBurn });
    } catch (e) {
      // ponytail: כשל חלקי (נקייה נוצרה, burn נכשלה) נרשם rejected — העותק היתום
      // במטא לא מזיק, ואדם מטפל. אין retry אוטומטי בתוך חלון הצינון.
      await q(
        `INSERT INTO drip.template_replacements
               (account_id, family, old_name, new_name, new_burn, status, reason)
         VALUES ($1, $2, $3, $4, $5, 'rejected', $6)`,
        [accountId, family, w.name, newName, newBurn, String(e.message).slice(0, 300)]
      );
      await compliance.raiseAlert(pool, accountId, 'error', 'template_replace_failed',
        `יצירת עותק טרי ל"${w.name}" נכשלה: ${e.message} — נדרש טיפול ידני ` +
        `(ייתכן שמטא דחתה ככפילות; שינוי תוכן לעולם לא נעשה אוטומטית).`);
    }
  }
  return made;
}

/**
 * שלב ב' — אימוץ. רק כששתי התבניות (עותק + burn) מאושרות ב-template_health,
 * כל השלבים שהצביעו על התבנית הישנה עוברים לעותק הטרי — אותו תוכן, אותו סדר,
 * אותו תזמון; רק שם התבנית מתחלף.
 */
export async function adoptApprovedReplacements(pool, accountId, now = new Date()) {
  const q = (t, p) => pool.query(t, p).then((r) => r.rows);

  const ready = await q(
    `SELECT tr.id, tr.old_name, tr.new_name, tr.new_burn
       FROM drip.template_replacements tr
      WHERE tr.account_id = $1 AND tr.status = 'pending_approval'
        AND EXISTS (SELECT 1 FROM drip.template_health th
                     WHERE th.account_id = $1 AND th.template_name = tr.new_name
                       AND th.status = 'APPROVED')
        AND (tr.new_burn IS NULL OR EXISTS (SELECT 1 FROM drip.template_health th
                     WHERE th.account_id = $1 AND th.template_name = tr.new_burn
                       AND th.status = 'APPROVED'))`,
    [accountId]
  );

  for (const r of ready) {
    await q(
      `UPDATE drip.sequence_steps st
          SET template_name = $2,
              template_burn = COALESCE($3, st.template_burn)
         FROM drip.sequences sq
        WHERE sq.id = st.sequence_id AND sq.account_id = $1
          AND st.template_name = $4`,
      [accountId, r.new_name, r.new_burn, r.old_name]
    );
    await q(
      `UPDATE drip.template_replacements SET status = 'adopted', adopted_at = $2 WHERE id = $1`,
      [r.id, now]
    );
    await compliance.raiseAlert(pool, accountId, 'info', 'template_replace_adopted',
      `העותק הטרי "${r.new_name}" אושר על ידי מטא ואומץ — השלבים שהצביעו על ` +
      `"${r.old_name}" עברו אליו (תוכן, סדר ותזמון ללא שינוי).`);
    console.log(`[tpl-replace] acct ${accountId}: adopted ${r.new_name} (was ${r.old_name})`);
  }
  return ready;
}
