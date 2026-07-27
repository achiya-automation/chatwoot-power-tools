-- התראות דו-לשוניות.
--
-- עד כאן `drip.alerts.message` נשא טקסט עברית קשיח שנכתב במנוע, וה-UI הציג אותו כמו
-- שהוא — כך שנציג שעובד באנגלית קיבל דשבורד אנגלי עם התראות בעברית. זו הפרה של ההבטחה
-- ש"כל הדשבורד מותאם לשפת הנציג", והיא בולטת בדיוק במסך שהכי חשוב להבין בו מה קרה.
--
-- הפתרון: ה-`code` הוא המפתח לתרגום, ו-`params` נושא את מה שמשתנה (שם תבנית, מספר
-- כישלונות, קוד שגיאה של מטא). ה-UI מרכיב את המשפט בשפה של הנציג.
--
-- `message` נשאר, ובכוונה: הוא ה-fallback להתראות שנוצרו לפני המיגרציה הזו, ולכל קוד
-- שה-UI עדיין לא מכיר. התראה בעברית עדיפה על התראה ריקה.

ALTER TABLE drip.alerts ADD COLUMN IF NOT EXISTS params jsonb NOT NULL DEFAULT '{}'::jsonb;

-- אותו סיפור ב-account_health: `halt_reason` הוא משפט עברית שה-UI מדפיס כמו שהוא, והוא
-- הטקסט הכי חשוב במסך — הסיבה שהחשבון מושבת. `halt_code` + `halt_params` מאפשרים לתרגם
-- אותו, ו-`halt_reason` נשאר כ-fallback לאותם שני מקרים (התקנה ותיקה, קוד לא מוכר).
ALTER TABLE drip.account_health ADD COLUMN IF NOT EXISTS halt_code   text;
ALTER TABLE drip.account_health ADD COLUMN IF NOT EXISTS halt_params jsonb NOT NULL DEFAULT '{}'::jsonb;
