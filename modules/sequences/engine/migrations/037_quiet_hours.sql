-- שעות שקט לשיווק: שלבים עם delay יחסי ובלי send_hour יצאו גם ב-01:00-03:00.
-- השער (canSend) דוחה שיווק בתוך החלון; חלון שירות פתוח ופתיחה טרייה פטורים.
ALTER TABLE drip.compliance
  ADD COLUMN IF NOT EXISTS quiet_start_hour integer,
  ADD COLUMN IF NOT EXISTS quiet_end_hour   integer,
  ADD COLUMN IF NOT EXISTS quiet_tz         text;

UPDATE drip.compliance
   SET quiet_start_hour = COALESCE(quiet_start_hour, 21),
       quiet_end_hour   = COALESCE(quiet_end_hour, 8),
       quiet_tz         = COALESCE(quiet_tz, 'Asia/Jerusalem')
 WHERE quiet_start_hour IS NULL OR quiet_end_hour IS NULL OR quiet_tz IS NULL;

ALTER TABLE drip.compliance
  ALTER COLUMN quiet_start_hour SET DEFAULT 21,
  ALTER COLUMN quiet_start_hour SET NOT NULL,
  ALTER COLUMN quiet_end_hour SET DEFAULT 8,
  ALTER COLUMN quiet_end_hour SET NOT NULL,
  ALTER COLUMN quiet_tz SET DEFAULT 'Asia/Jerusalem',
  ALTER COLUMN quiet_tz SET NOT NULL;
