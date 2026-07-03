-- 012_media.sql — uploaded media library (drag-drop → public URL).
-- Each row is a file uploaded for a media-header template; the engine hosts it at a
-- PUBLIC path (/drip/media/<file>) so Meta can fetch it, and tracks byte_size per
-- account for the storage view. The file itself lives on a persistent volume.
CREATE TABLE IF NOT EXISTS drip.media (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  int         NOT NULL,
  file        text        NOT NULL,            -- filename on disk + in the public URL (<uuid>.<ext>)
  orig_name   text,                            -- original filename (display only)
  mime        text,
  byte_size   bigint      NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_media_account ON drip.media(account_id);
