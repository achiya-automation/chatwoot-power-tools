-- 019_template_media.sql — מאגר מרכזי: מדיה קבועה לכל תבנית (per account).
-- מקור-אמת יחיד שכל מקום ששולח תבנית קורא ממנו (צ'אט, קמפיינים, רצפים) → מילוי אוטומטי
-- של שדה ה-media_url כשבוחרים תבנית עם media header, במקום לבחור/להעלות בכל שליחה.
-- media_url הוא URL ציבורי (של ה-drip engine, /media/<file>) — Meta מושכת אותו בשליחה.
-- ⚠️ ה-example.header_handle של Meta אינו שמיש לשליחה חוזרת (403 → 131053, ראה 006),
-- ולכן המאגר שומר URL ציבורי ולא handle.
CREATE TABLE IF NOT EXISTS drip.template_media (
  account_id    int         NOT NULL,
  template_name text        NOT NULL,
  media_url     text        NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, template_name)
);

-- Seed: מדיה שכבר הוגדרה בשלבי רצפים כבר "נזכרת" — מייבאים אותה למאגר המרכזי כך
-- שהמילוי האוטומטי יעבוד מיד בצ'אט ובקמפיינים, בלי להעלות שוב. media_url קבוע per-template,
-- אז conflict כפול-URL לא אמור לקרות; DISTINCT + DO NOTHING שומר את הראשון ליתר ביטחון.
INSERT INTO drip.template_media (account_id, template_name, media_url)
SELECT DISTINCT s.account_id, st.template_name, st.media_url
  FROM drip.sequence_steps st
  JOIN drip.sequences s ON s.id = st.sequence_id
 WHERE nullif(st.media_url, '') IS NOT NULL
ON CONFLICT (account_id, template_name) DO NOTHING;
