-- שחרור-מנוחה לנמענת רוויה: המנוע צריך לדעת מתי הייתה החסימה (131049) האחרונה
-- של כל נמענת, כדי לשחרר אותה לניסיון בודד אחרי מנוחה. נמדד (45 יום, n=2,398):
-- ניסיון במרווח <4 ימים מהחסימה נמסר ב-8-15%, 4-7 ימים — 41%, 7+ ימים — 61%.
-- ראה canSend (saturation_release_days) ואת סולם CAP_COOLDOWN_DAYS ב-reconcile.
ALTER TABLE drip.contact_state
  ADD COLUMN IF NOT EXISTS last_cap_failure_at timestamptz;

-- אתחול מההיסטוריה — sent_messages היא מקור האמת (המונה נדרס בעבר; ההיסטוריה,
-- שבה כל חסימה היא שורה משלה, לא ניתנת לאיבוד). בלי ה-backfill כל הלידים החונים
-- היו נראים "נחו מספיק" ביום הפריסה ומשתחררים בבת אחת.
UPDATE drip.contact_state cs
   SET last_cap_failure_at = h.last_fail
  FROM (SELECT account_id, contact_id, max(sent_at) AS last_fail
          FROM drip.sent_messages
         WHERE delivery_status = 'failed' AND error_code = '131049'
         GROUP BY 1, 2) h
 WHERE cs.account_id = h.account_id
   AND cs.contact_id = h.contact_id
   AND cs.last_cap_failure_at IS NULL;

-- תיקון סחיפה חד-פעמי: נמענת עם היסטוריית 131049 אבל מונה 0 עוקפת את ניתוב
-- ה-burn ומקבלת את התבנית הנקייה — ושורפת אותה (נתפס חי 29/07/2026: ליד עם 4
-- חסימות בהיסטוריה קיבל את ה-intro הנקייה). מסמנים 1 — לא את הערך המלא — כדי
-- לשמר את סמנטיקת השחרור: 1>0 ⇒ ניתוב burn עובד, 1<max ⇒ הנמענת עדיין מקבלת.
UPDATE drip.contact_state cs
   SET cap_failures = 1
 WHERE cs.cap_failures = 0
   AND cs.suppressed_at IS NULL
   AND EXISTS (SELECT 1 FROM drip.sent_messages m
                WHERE m.account_id = cs.account_id
                  AND m.contact_id = cs.contact_id
                  AND m.delivery_status = 'failed'
                  AND m.error_code = '131049');
