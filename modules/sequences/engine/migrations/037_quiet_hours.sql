-- שעות שקט לשיווק: שלבים עם delay יחסי ובלי send_hour יצאו גם ב-01:00-03:00
-- (נצפה חי 29/07/2026 — 84 שליחות לילה ב-14 יום). השער (canSend) דוחה שיווק
-- בתוך החלון; חלון שירות פתוח פטור. ברירת המחדל בקוד כבויה (ראה compliance.js —
-- שעון אמיתי בברירת מחדל היה שובר כל CI לילי); ההדלקה כאן, פר-חשבון.
ALTER TABLE drip.compliance
  ADD COLUMN IF NOT EXISTS quiet_start_hour integer,
  ADD COLUMN IF NOT EXISTS quiet_end_hour   integer,
  ADD COLUMN IF NOT EXISTS quiet_tz         text;

-- כל החשבונות הקיימים ישראליים — מדליקים להם 21:00→08:00. חשבון חדש שיצטרך
-- התנהגות אחרת מקבל ערכים משלו בשורת ה-compliance שלו.
UPDATE drip.compliance
   SET quiet_start_hour = 21,
       quiet_end_hour   = 8,
       quiet_tz         = COALESCE(quiet_tz, 'Asia/Jerusalem')
 WHERE quiet_start_hour IS NULL;
