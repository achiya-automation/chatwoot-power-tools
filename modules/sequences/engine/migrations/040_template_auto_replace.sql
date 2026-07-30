-- החלפת-תבנית אוטומטית בריאה: כשתבנית נקייה בשימוש פעיל חוצה סף שחיקה נמדד
-- (כשלי מסירה בחלון נע), נוצר עותק זהה + תאומת burn, והשלבים עוברים אליו רק
-- אחרי אישור מטא. בלמי קצב קשיחים (1/משפחה/14 יום, 3/חשבון/30 יום) מבדילים את
-- זה מדפוס ה-farming שמטא מענישה. ראה src/replace.js.
-- NOT NULL וברירת מחדל כבוי: עמודת NULL נמרחת מעל ברירת המחדל שבקוד (לקח 038).
ALTER TABLE drip.compliance
  ADD COLUMN IF NOT EXISTS auto_template_replace_enabled boolean;

UPDATE drip.compliance
   SET auto_template_replace_enabled = false
 WHERE auto_template_replace_enabled IS NULL;

ALTER TABLE drip.compliance
  ALTER COLUMN auto_template_replace_enabled SET DEFAULT false,
  ALTER COLUMN auto_template_replace_enabled SET NOT NULL;

-- ספר ההחלפות: גם ה-bookkeeping של בלמי הקצב וגם תור האימוץ הממתין לאישור מטא.
-- status: pending_approval → adopted | rejected (rejected = נדרש אדם; אין ניסיון אוטומטי חוזר בתוך חלון הצינון)
CREATE TABLE IF NOT EXISTS drip.template_replacements (
  id         serial PRIMARY KEY,
  account_id int  NOT NULL,
  family     text NOT NULL,
  old_name   text NOT NULL,
  new_name   text NOT NULL,
  new_burn   text,
  status     text NOT NULL DEFAULT 'pending_approval',
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  adopted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tpl_replacements_acct_family
  ON drip.template_replacements (account_id, family, created_at DESC);
