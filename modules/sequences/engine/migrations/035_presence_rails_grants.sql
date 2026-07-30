-- ה-initializer של Rails (presence_humanizer.rb) קורא את הגדרות ה-presence כדי
-- להחליט אם להחזיק תשובת בוט ואם לממסר הקלדת נציג. תפקיד chatwoot מעולם לא קיבל
-- גישה לסכימת drip — בלי ה-GRANT הזה הפאטצ' דומם (rescue על StatementInvalid).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chatwoot') THEN
    GRANT USAGE ON SCHEMA drip TO chatwoot;
    GRANT SELECT ON drip.presence_settings TO chatwoot;
  END IF;
END $$;
