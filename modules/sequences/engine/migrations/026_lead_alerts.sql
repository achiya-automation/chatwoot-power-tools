-- התראת וואטסאפ על כל ליד חדש שנסגר (נמסר / נחסם).
ALTER TABLE drip.sent_messages ADD COLUMN IF NOT EXISTS alerted_at timestamptz;

-- ⚠️ הכרחי. בלי הזה, ההרצה הראשונה רואה את כל ההיסטוריה (אלפי שורות) כ"טרם הותרעה"
-- ומפוצצת את הטלפון. כל מה שקיים ברגע ההתקנה = כבר נצפה.
UPDATE drip.sent_messages SET alerted_at = now() WHERE alerted_at IS NULL;

-- אינדקס חלקי: התור מתרוקן, אז הוא נשאר זעיר גם כשהטבלה גדולה.
CREATE INDEX IF NOT EXISTS sent_messages_unalerted_idx
    ON drip.sent_messages (account_id, sent_at) WHERE alerted_at IS NULL;
