-- 049_campaign_resend_schedule.sql — שליחה מחדש לנכשלים בשעה שנקבעה מראש.
--
-- הסיבה הכי שכיחה לכישלון המוני היא המכסה היומית של מטא. שליחה מחדש *מיידית* באותו יום
-- נכשלת שוב מאותה סיבה בדיוק, ומי שכן צריך לנסות שוב צריך לחזור למחשב מחר בבוקר.
-- שורה כאן = "בשעה הזו, תריץ שליחה מחדש לכל מי שנכשל". רשימת הנכשלים מחושבת בזמן
-- ההרצה ולא בזמן התזמון — כך תגובות ומסירות שהגיעו בינתיים כבר לא נספרות ככישלון.
CREATE TABLE IF NOT EXISTS drip.campaign_resend_schedule (
  id          bigserial   PRIMARY KEY,
  account_id  bigint      NOT NULL,
  campaign_id bigint      NOT NULL,
  run_at      timestamptz NOT NULL,
  template    jsonb,                                -- NULL = תבנית הקמפיין המקורית
  locale      text        NOT NULL DEFAULT 'he',
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,                          -- מתי הטיק התניע — וגם ההגנה מפני הרצה כפולה
  error       text
);

-- תור אחד פעיל לכל קמפיין: תזמון חדש מחליף את הקודם במקום להצטבר לשתי שליחות.
CREATE UNIQUE INDEX IF NOT EXISTS campaign_resend_schedule_pending_idx
  ON drip.campaign_resend_schedule (account_id, campaign_id) WHERE started_at IS NULL;

CREATE INDEX IF NOT EXISTS campaign_resend_schedule_due_idx
  ON drip.campaign_resend_schedule (run_at) WHERE started_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON drip.campaign_resend_schedule TO drip_engine;
    GRANT USAGE, SELECT ON SEQUENCE drip.campaign_resend_schedule_id_seq TO drip_engine;
  END IF;
END $$;
