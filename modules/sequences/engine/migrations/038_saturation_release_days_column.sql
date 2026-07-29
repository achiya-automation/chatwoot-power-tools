-- כפתור הכיוונון של שחרור-המנוחה (ראה compliance.js, saturation_release_days)
-- עובר להיות פר-חשבון, כמו שאר ספי הציות. ⚠️ חובה NOT NULL DEFAULT: עמודה
-- שנשארת NULL הייתה נמזגת מעל ברירת המחדל שבקוד (spread של שורת ה-compliance)
-- ומכבה את השחרור בשקט לכל חשבון שיש לו שורה — Number(null)=0 = כבוי.
ALTER TABLE drip.compliance
  ADD COLUMN IF NOT EXISTS saturation_release_days integer NOT NULL DEFAULT 21;
