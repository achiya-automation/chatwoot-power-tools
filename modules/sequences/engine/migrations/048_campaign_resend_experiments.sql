-- 048_campaign_resend_experiments.sql — כל שליחה מחדש היא "ניסוי" נפרד בדוח.
--
-- עד כה כל ניסיון חוזר נבלע בשורה אחת לנמען (המצב הסופי), ולכן אי אפשר היה לענות על
-- השאלה היחידה שחשובה אחרי כישלון המוני: האם התבנית החדשה עבדה טוב יותר מהקודמת?
--
-- שתי עמודות פותרות את זה בלי טבלה נוספת: כל שורת ledger יודעת לאיזו ריצה היא שייכת
-- ובאיזו תבנית נשלחה. NULL ב-resend_run_id = השליחה המקורית של הקמפיין (וגם כל שורה
-- שנוצרה לפני המיגרציה הזו), ולכן ההשוואה "מקורי מול ניסוי" יוצאת מאותה טבלה.
ALTER TABLE drip.campaign_send_snapshots
  ADD COLUMN IF NOT EXISTS resend_run_id text,
  ADD COLUMN IF NOT EXISTS template_name text;

-- דוח הניסויים מקבץ לפי (חשבון, קמפיין, ריצה); בלי האינדקס זו סריקה של כל ה-ledger.
CREATE INDEX IF NOT EXISTS campaign_send_snapshots_run_idx
  ON drip.campaign_send_snapshots (account_id, campaign_id, resend_run_id);
