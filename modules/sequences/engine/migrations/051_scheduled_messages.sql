-- 051_scheduled_messages.sql — שליחה מתוזמנת של הודעה בודדת בתוך שיחה.
--
-- Chatwoot יודע לתזמן קמפיין, אבל לא הודעה אחת בשיחה אחת. זה בדיוק מה שנציג צריך כשהוא
-- מסיים לכתוב תשובה ב-23:40 ולא רוצה להעיר לקוח, או כשהוא מבטיח "אחזור אליך מחר בבוקר"
-- ואין לו איפה להניח את ההבטחה חוץ מתזכורת אישית. בלי זה התשובה יוצאת מיד או נשכחת.
--
-- שורה כאן = "בשעה הזו, שלח את הטקסט הזה לשיחה הזו". התוכן נשמר בזמן התזמון (בניגוד
-- ל-campaign_resend_schedule, שמחשב את קהל היעד בזמן ההרצה) — כי כאן הטקסט הוא ההחלטה
-- עצמה, והנציג מצפה שיישלח בדיוק מה שראה על המסך.
CREATE TABLE IF NOT EXISTS drip.scheduled_messages (
  id              bigserial   PRIMARY KEY,
  account_id      bigint      NOT NULL,
  conversation_id bigint      NOT NULL,           -- display_id (המזהה שה-API של ההודעות עובד מולו)
  content         text        NOT NULL,
  run_at          timestamptz NOT NULL,
  created_by      bigint,                         -- ה-user id של הנציג שתזמן — לתצוגה בלבד
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,                    -- מתי הטיק התניע — וגם ההגנה מפני הרצה כפולה
  sent_at         timestamptz,
  message_id      bigint,                         -- ההודעה שנוצרה ב-Chatwoot, לאימות
  error           text
);

-- הטיק שולף לפי זמן בלבד; אינדקס חלקי כדי שהתור לא יגדל עם ההיסטוריה.
CREATE INDEX IF NOT EXISTS scheduled_messages_due_idx
  ON drip.scheduled_messages (run_at) WHERE started_at IS NULL;

-- הפאנל מציג "מה ממתין בשיחה הזו" — שאילתה שרצה בכל פתיחת שיחה, ולכן צריכה אינדקס משלה.
CREATE INDEX IF NOT EXISTS scheduled_messages_pending_conv_idx
  ON drip.scheduled_messages (account_id, conversation_id) WHERE started_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON drip.scheduled_messages TO drip_engine;
    GRANT USAGE, SELECT ON SEQUENCE drip.scheduled_messages_id_seq TO drip_engine;
  END IF;
END $$;
