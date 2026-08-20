-- ניטור דירוג האיכות של *כל* מספרי הוואטסאפ במערכת — לא רק אלה שהמנוע שולח מהם.
--
-- למה זה נחוץ: refreshHealth רץ רק על חשבונות שרשומים ב-drip.account_tokens, ורק אחרי
-- שנבחר להם מספר. בפועל (07.08.2026) נמצא מספר בדירוג RED אצל מטא — האות המקדים לפני
-- השעיה — שלא היה רשום במנוע, ולכן אף אחד לא ידע עליו. מספר מושעה הוא אובדן ערוץ שלם
-- ללקוח, ולא משהו שמגלים ממנו בדיעבד.
--
-- הטבלה זוכרת מה כבר דיווחנו, כדי שהתראה תישלח על *שינוי* מצב ולא בכל סבב.

CREATE TABLE IF NOT EXISTS drip.number_quality (
  phone_id        text        PRIMARY KEY,          -- מזהה המספר אצל מטא
  inbox_id        int,
  account_id      int,
  phone           text,
  quality         text,                             -- GREEN | YELLOW | RED | UNKNOWN
  tier            text,
  last_error      text,                             -- טוקן שפג/מספר שהוסר — גם זה שווה ידיעה
  checked_at      timestamptz NOT NULL DEFAULT now(),
  -- מה שכבר נשלחה עליו התראה. NULL = טרם דיווחנו.
  alerted_quality text,
  alerted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_number_quality_account ON drip.number_quality(account_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON drip.number_quality TO drip_engine';
  END IF;
END $$;
