-- משיכת חלון (window-pull): הודעה נכנסת פותחת חלון שירות של 24 שעות שבו המסירה
-- ~100% (נמדד 195/196) ופטורה מהתקרה הפר-נמענית של מטא — אבל שלב שה-next_send_at
-- שלו רחוק מפספס את החלון: נמדדו 88 מ-184 חלונות (48%) שנפתחו והתבזבזו ב-30 יום.
-- הדגל מפעיל הקדמה של השלב הבא אל תוך החלון — שלב אחד לכל חלון, אותה תבנית,
-- אותו סדר, אותם תנאים; רק התזמון זז. שערי שבת/שקט/ציות ממשיכים לחול במלואם.
-- NOT NULL וברירת מחדל כבוי: עמודת NULL הייתה נמרחת מעל ברירת המחדל שבקוד
-- ומדליקה/מכבה את הפיצ'ר בשקט (אותו לקח כמו 038).
ALTER TABLE drip.compliance
  ADD COLUMN IF NOT EXISTS window_pull_enabled boolean;

UPDATE drip.compliance
   SET window_pull_enabled = false
 WHERE window_pull_enabled IS NULL;

ALTER TABLE drip.compliance
  ALTER COLUMN window_pull_enabled SET DEFAULT false,
  ALTER COLUMN window_pull_enabled SET NOT NULL;
