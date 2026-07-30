-- כפתור כיוונון פר-חשבון לשחרור נמענת רוויה. NOT NULL חשוב: NULL היה
-- נמרח מעל ברירת המחדל בקוד ומכבה את ההגנה בשקט.
ALTER TABLE drip.compliance
  ADD COLUMN IF NOT EXISTS saturation_release_days integer;

UPDATE drip.compliance
   SET saturation_release_days = 21
 WHERE saturation_release_days IS NULL;

ALTER TABLE drip.compliance
  ALTER COLUMN saturation_release_days SET DEFAULT 21,
  ALTER COLUMN saturation_release_days SET NOT NULL;
