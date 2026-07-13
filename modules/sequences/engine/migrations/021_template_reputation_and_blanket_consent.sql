-- 021 — הצהרת הסכמה כוללת + שומר "השלב הקודם נמסר"
--
-- רקע (בננה בוק, 2026-07-12):
--
-- 1. blanket_consent — ההסכמה לקבל דבר פרסומת שייכת למפרסם (הלקוח), לא לנו. הוא חותם
--    בהסכם שכל הנמענים ברשימותיו הסכימו. דרישת רישום פר-ליד הייתה עבודה כפולה שחסמה
--    לקוחות חדשים בשקט. השורה עצמה היא שובל הביקורת (מי הצהיר, מה, מתי).
--    account_id = 0 → הצהרה גלובלית: תנאי ההתקשרות הסטנדרטיים, מכסים כל חשבון קיים ועתידי.
--    ⚠️ אינה גוברת על suppressed_at — מי שביקש להסיר לא מקבל, גם עם הצהרה.
--
-- 2. require_prev_delivered — שלב שהטקסט שלו מתייחס אחורה ("יצא לך לראות את הסרטון
--    ששלחתי?") חייב לוודא שההודעה הקודמת באמת נמסרה. שלב 1 הוא תבנית שיווק שנחסמת
--    ב-131049 לרוב הלידים הקרים; בלי השומר, 26 אנשים נשאלו על סרטון שמעולם לא קיבלו.

CREATE TABLE IF NOT EXISTS drip.blanket_consent (
  account_id  int PRIMARY KEY,      -- 0 = הצהרה גלובלית (ברירת מחדל לכל החשבונות)
  source      text        NOT NULL,
  detail      text        NOT NULL,
  declared_at timestamptz NOT NULL DEFAULT now(),
  declared_by text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE drip.blanket_consent IS
  'הצהרה חתומה של הלקוח (בעל המידע) שכל הנמענים ברשימותיו הסכימו לקבל דבר פרסומת. account_id=0 = הצהרה גלובלית לכל החשבונות. לא גוברת על suppressed_at.';

ALTER TABLE drip.sequence_steps
  ADD COLUMN IF NOT EXISTS require_prev_delivered boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN drip.sequence_steps.require_prev_delivered IS
  'לא לשלוח את השלב אם ההודעה של השלב הקודם לא נמסרה. לשלבים שהטקסט שלהם מתייחס אחורה.';

-- ⚠️ ההרשאה חייבת להינתן במפורש: הטבלה נוצרת ע"י ה-superuser, וה-role של המנוע
-- (drip_engine) לא יורש SELECT. בלעדיה loadSettings נכשל בשקט (fail-closed) ⇒ כל
-- השיווק נחסם עם no_consent, בלי שום סימן. ה-DEFAULT PRIVILEGES מונע חזרה של הבאג.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
    GRANT SELECT ON drip.blanket_consent TO drip_engine;
    ALTER DEFAULT PRIVILEGES IN SCHEMA drip GRANT SELECT ON TABLES TO drip_engine;
  END IF;
END $$;
