-- Presence — "נקרא" (✓✓ כחול) ו"מקליד…" לתיבות WhatsApp Cloud API.
--
-- Chatwoot 4.16.1 לא מממש אף אחד מהשניים (upstream issue #13984, milestone v4.19.0),
-- ולכן כל לקוח רואה ✓✓ אפור לנצח ואף פעם לא "מקליד". שתי הפעולות זמינות ב-Cloud API
-- דרך אותו טוקן שכבר יושב ב-channel_whatsapp.provider_config.
--
-- ⛔ למה לא webhook של Chatwoot: `SafeFetch` חוסם כל URL שאין לו IP ציבורי
-- ("Hostname 'x' has no public ip addresses"), כלומר קריאה לשירות פנימי לא תעבור.
-- ההיתר היחיד הוא SAFE_FETCH_ALLOW_PRIVATE_NETWORK — מתג **גלובלי** שמפרק את הגנת
-- ה-SSRF לכל ה-webhooks של כל הלקוחות. לכן המנוע מושך במקום להיות נדחף, בדיוק כמו
-- לולאת ה-reconcile. ההשהיה שהמשיכה מוסיפה היא ממילא רצויה כאן.
--
-- שליטה: שורה אחת פר (account_id, inbox_id). inbox_id = 0 היא ברירת המחדל של החשבון,
-- ותיבה בלי שורה משלה יורשת אותה. כך לקוח שלא רוצה "מקליד" מכבה פעם אחת.

CREATE TABLE IF NOT EXISTS drip.presence_settings (
  account_id       integer     NOT NULL,
  inbox_id         integer     NOT NULL, -- 0 = ברירת המחדל של החשבון
  read_receipts    boolean     NOT NULL DEFAULT true,
  -- off   = לא להציג "מקליד" בכלל
  -- agent = רק כשנציג אנושי מקליד בפועל ב-Chatwoot (ברירת מחדל)
  -- auto  = מיד אחרי הקריאה, לתיבה שבוט עונה בה
  typing_mode      text        NOT NULL DEFAULT 'agent',
  -- השהיות בשניות. בלעדיהן ✓✓ נדלק ברגע ההודעה ומסגיר בוט מיידית.
  read_delay_min   numeric(4,1) NOT NULL DEFAULT 2,
  read_delay_max   numeric(4,1) NOT NULL DEFAULT 5,
  typing_delay_min numeric(4,1) NOT NULL DEFAULT 2,
  typing_delay_max numeric(4,1) NOT NULL DEFAULT 4,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, inbox_id),
  CONSTRAINT presence_typing_mode_valid CHECK (typing_mode IN ('off', 'agent', 'auto')),
  CONSTRAINT presence_read_delay_ordered   CHECK (read_delay_max   >= read_delay_min),
  CONSTRAINT presence_typing_delay_ordered CHECK (typing_delay_max >= typing_delay_min),
  CONSTRAINT presence_delays_sane CHECK (
    read_delay_min >= 0 AND typing_delay_min >= 0
    -- "מקליד" של Meta פג אחרי 25 שניות; השהיה ארוכה מזה תמיד תפספס
    AND read_delay_max <= 60 AND typing_delay_max <= 20
  )
);

-- סמן ההתקדמות של הלולאה. שורה יחידה — id הוא boolean עם CHECK, כך ששתי עותקים
-- של המנוע לא יכולים להתחיל שני סמנים מקבילים ולעבד כל הודעה פעמיים.
CREATE TABLE IF NOT EXISTS drip.presence_cursor (
  id              boolean PRIMARY KEY DEFAULT true,
  last_message_id bigint  NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT presence_cursor_singleton CHECK (id)
);

INSERT INTO drip.presence_cursor (id, last_message_id)
-- מתחילים מההודעה האחרונה שקיימת עכשיו: התקנה חדשה לא אמורה לסמן כנקראות אלפי
-- הודעות היסטוריות בבת אחת — כל אחת מהן ✓✓ כחול אצל לקוח אמיתי, ובלתי הפיך.
SELECT true, COALESCE(MAX(id), 0) FROM public.messages
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON drip.presence_settings TO drip_engine;
    GRANT SELECT, UPDATE ON drip.presence_cursor TO drip_engine;
  END IF;
END $$;
