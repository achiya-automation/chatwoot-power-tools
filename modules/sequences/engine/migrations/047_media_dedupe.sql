-- 047_media_dedupe.sql — מזהה קובץ זהה בהעלאה חוזרת, כדי לא לייצר כתובת "קרה" חדשה.
--
-- Meta re-fetches a template's media URL for EVERY message it sends (Chatwoot passes
-- `{image: {link: url}}`, never an uploaded media handle). A URL that is not yet in the
-- CDN cache therefore takes the full campaign rate straight to origin, and Meta answers
-- 131053 "Media upload error" on whatever it fails to fetch.
--
-- Real incident 09.08.2026, campaign 46: a byte-identical image was re-uploaded, minting a
-- fresh cold URL one minute before the send. 256 of 370 messages died on 131053. The three
-- earlier campaigns reused a warm URL and lost zero messages to media.
--
-- Hashing the content lets the upload endpoint hand back the existing (already warm) URL
-- instead of a cold one. Also stops the volume filling with duplicate copies.
ALTER TABLE drip.media ADD COLUMN IF NOT EXISTS sha256 char(64);

-- Not UNIQUE on purpose: rows predating this migration have sha256 IS NULL, and a partial
-- unique index would still let two concurrent uploads of a new file race. The lookup only
-- needs to be fast, and losing a race costs one duplicate row, not correctness.
CREATE INDEX IF NOT EXISTS idx_media_account_sha ON drip.media(account_id, sha256);
