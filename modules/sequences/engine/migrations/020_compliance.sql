-- 020_compliance.sql — שכבת ציות לכללי מטא (WhatsApp Business Platform).
--
-- מיישמת את שלוש הדרישות של מטא לכל שיחה שהעסק יוזם — Expected / Timely / Relevant —
-- ואת מנגנוני האכיפה שמאחוריהן: מכסה אישית לשיווק (131049), השהיית תבניות (132015),
-- pacing ברמת פורטפוליו (135000), חסימת מדיניות (368) ו-opt-out מפורש (131050).
--
-- חמש טבלאות:
--   contact_state  — הסכמה (opt-in), חסימה (opt-out), ומדדי מעורבות לכל איש קשר
--   account_health — tier, מכסה, דירוג איכות, דגל עצירת חירום, סמן סריקת נכנסות
--   template_health— סטטוס ואיכות של כל תבנית (מ-Graph, לא מהעותק המיושן של Chatwoot)
--   compliance     — הגדרות ציות לכל חשבון (ברירות מחדל בטוחות)
--   alerts         — התראות לדשבורד

-- ── הסכמה + חסימה + מעורבות, שורה אחת לאיש קשר ─────────────────────────────
CREATE TABLE IF NOT EXISTS drip.contact_state (
  account_id int NOT NULL,
  contact_id int NOT NULL,

  -- opt-in (הכלל "Expected" של מטא). NULL = אין רשומת הסכמה → שיווק חסום.
  consent_source text,          -- lead_ad | ctwa | website_form | purchase | phone | manual | import
  consent_detail text,          -- שם הקמפיין / מזהה הטופס / טקסט חופשי
  consent_at     timestamptz,
  consent_by     text,          -- מי תיעד (אימייל סוכן / 'system')

  -- opt-out. כל ערך שאינו NULL ב-suppressed_at חוסם שליחה.
  suppressed_at     timestamptz,
  suppressed_reason text,       -- keyword | meta_131050 | meta_368 | saturated | unengaged | invalid | manual
  suppressed_detail text,
  suppressed_scope  text NOT NULL DEFAULT 'marketing',  -- marketing | all

  -- מעורבות — הקלט שמטא משתמשת בו כדי לחשב את המכסה האישית המסתגלת.
  last_inbound_at   timestamptz,      -- תגובה אחרונה → פותחת חלון 24h
  unengaged_streak  int NOT NULL DEFAULT 0,  -- שליחות שיווק רצופות שלא נקראו ולא נענו
  cap_failures      int NOT NULL DEFAULT 0,  -- 131049 רצופים

  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_cs_suppressed ON drip.contact_state(account_id) WHERE suppressed_at IS NOT NULL;

-- ── בריאות החשבון ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drip.account_health (
  account_id int PRIMARY KEY,
  tier        text,           -- TIER_250 | TIER_2K | TIER_10K | TIER_100K | TIER_UNLIMITED
  cap         int,            -- המכסה המספרית (-1 = ללא הגבלה)
  quality     text,           -- GREEN | YELLOW | RED | UNKNOWN
  halted      boolean NOT NULL DEFAULT false,
  halt_reason text,
  halted_at   timestamptz,
  -- סמן הסריקה של הודעות נכנסות (זיהוי "הסר" בלי webhook — ראה compliance.scanInbound)
  last_scanned_message_id bigint NOT NULL DEFAULT 0,
  checked_at  timestamptz
);

-- ── בריאות תבניות ───────────────────────────────────────────────────────────
-- Chatwoot שומר עותק של התבניות אבל מסנכרן אותו לאט ובלי quality_score. השהיה
-- של תבנית נמשכת 3 שעות בלבד — עותק בן-יממה חסר ערך. לכן נקרא ישירות מ-Graph.
CREATE TABLE IF NOT EXISTS drip.template_health (
  account_id    int  NOT NULL,
  template_name text NOT NULL,
  language      text NOT NULL DEFAULT '',
  status        text,          -- APPROVED | PAUSED | DISABLED | PENDING | REJECTED
  quality       text,          -- GREEN | YELLOW | RED | UNKNOWN
  category      text,          -- MARKETING | UTILITY | AUTHENTICATION
  checked_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, template_name, language)
);

-- ── הגדרות ציות לכל חשבון ───────────────────────────────────────────────────
-- חשבון בלי שורה מקבל את ברירות המחדל האלה (ראה compliance.loadSettings).
CREATE TABLE IF NOT EXISTS drip.compliance (
  account_id int PRIMARY KEY,
  require_consent        boolean NOT NULL DEFAULT true,  -- שיווק בלי רשומת הסכמה → חסום
  max_marketing_per_day  int     NOT NULL DEFAULT 1,     -- תבניות שיווק לאיש קשר ב-24h
  max_unengaged          int     NOT NULL DEFAULT 3,     -- שליחות שיווק ללא קריאה → חסימה
  max_cap_failures       int     NOT NULL DEFAULT 2,     -- 131049 רצופים → חסימה
  consent_max_age_days   int     NOT NULL DEFAULT 30,    -- מעבר לזה — אזהרה בדשבורד (לא חוסם)
  block_us_marketing     boolean NOT NULL DEFAULT true,  -- מטא לא מוסרת שיווק למספרי US
  halt_on_red            boolean NOT NULL DEFAULT true,  -- דירוג RED → עצירת חשבון
  opt_out_keywords       text[]                          -- מילות הסרה נוספות ללקוח הזה
);

-- ── התראות ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drip.alerts (
  id         bigserial PRIMARY KEY,
  account_id int  NOT NULL,
  level      text NOT NULL,   -- info | warn | critical
  code       text NOT NULL,   -- quality_red | template_paused | policy_block | halted | ...
  message    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  acked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON drip.alerts(account_id, created_at DESC) WHERE acked_at IS NULL;

-- מונע הצפת התראות כפולות: התראה פתוחה אחת לכל (חשבון, קוד, טקסט).
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_open
  ON drip.alerts(account_id, code, message) WHERE acked_at IS NULL;

-- ── היסטוריית שליחה: קטגוריה, חלון, איש קשר, ספירת מעורבות ─────────────────
-- category + in_session נחוצות לתקצוב: המכסה של מטא (גם ה-24h של הפורטפוליו וגם
-- האישית) נספרת רק על הודעות שיווקיות שנשלחו *מחוץ* לחלון שירות פתוח.
-- contact_id — כדי לספור תדירות ומעורבות לאיש קשר בלי לעבור דרך השיחה.
-- engagement_counted — אידמפוטנטיות: כל שליחה נספרת פעם אחת בלבד במוני המעורבות.
ALTER TABLE drip.sent_messages ADD COLUMN IF NOT EXISTS category           text;
ALTER TABLE drip.sent_messages ADD COLUMN IF NOT EXISTS in_session         boolean NOT NULL DEFAULT false;
ALTER TABLE drip.sent_messages ADD COLUMN IF NOT EXISTS contact_id         int;
ALTER TABLE drip.sent_messages ADD COLUMN IF NOT EXISTS engagement_counted boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sm_contact_recent ON drip.sent_messages(account_id, contact_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_sm_uncounted ON drip.sent_messages(account_id) WHERE engagement_counted = false;

-- מילוי לאחור: לשורות קיימות אין contact_id/category. נגזור אותן מהשיוך ומהצעד, כדי
-- שהמונים והתקרות יראו גם את מה שכבר נשלח (בלי זה, יום ראשון אחרי הפריסה נראה כאילו
-- אף אחד לא קיבל כלום). שליחות ישנות מסומנות כ"נספרו" — לא נטיל עונש רטרואקטיבי.
UPDATE drip.sent_messages sm
   SET contact_id = e.contact_id
  FROM drip.enrollments e
 WHERE sm.enrollment_id = e.id AND sm.contact_id IS NULL;

UPDATE drip.sent_messages sm
   SET category = st.category
  FROM drip.sequence_steps st
 WHERE st.sequence_id = sm.sequence_id AND st.step_order = sm.step_order
   AND sm.category IS NULL;

UPDATE drip.sent_messages SET engagement_counted = true WHERE engagement_counted = false;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPCs
-- ═══════════════════════════════════════════════════════════════════════════

-- תיעוד הסכמה לאיש קשר בודד או לרשימה (הצהרה רטרואקטיבית על מקור ההסכמה).
CREATE OR REPLACE FUNCTION drip.record_consent(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_acct   int    := (p->>'account_id')::int;
  v_source text   := nullif(p->>'source', '');
  v_detail text   := p->>'detail';
  v_by     text   := COALESCE(p->>'by', 'system');
  v_at     timestamptz := COALESCE((p->>'granted_at')::timestamptz, now());
  v_ids    int[]  := COALESCE(
    (SELECT array_agg((x)::int) FROM jsonb_array_elements_text(COALESCE(p->'contact_ids', '[]'::jsonb)) x),
    '{}'::int[]);
  v_n int;
BEGIN
  IF v_acct IS NULL THEN RAISE EXCEPTION 'account_id required'; END IF;
  IF v_source IS NULL THEN RAISE EXCEPTION 'source required'; END IF;

  INSERT INTO drip.contact_state (account_id, contact_id, consent_source, consent_detail, consent_at, consent_by)
  SELECT v_acct, cid, v_source, v_detail, v_at, v_by FROM unnest(v_ids) cid
  ON CONFLICT (account_id, contact_id) DO UPDATE
    SET consent_source = EXCLUDED.consent_source,
        consent_detail = EXCLUDED.consent_detail,
        consent_at     = EXCLUDED.consent_at,
        consent_by     = EXCLUDED.consent_by,
        updated_at     = now();

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'count', v_n);
END $$;

-- תיעוד הסכמה לכל אנשי הקשר הנושאים תווית מסוימת ב-Chatwoot (הצהרה על רשימה קיימת).
CREATE OR REPLACE FUNCTION drip.consent_by_label(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_acct   int  := (p->>'account_id')::int;
  v_label  text := nullif(p->>'label', '');
  v_source text := nullif(p->>'source', '');
  v_detail text := p->>'detail';
  v_by     text := COALESCE(p->>'by', 'system');
  v_n int;
BEGIN
  IF v_acct IS NULL OR v_label IS NULL OR v_source IS NULL THEN
    RAISE EXCEPTION 'account_id, label and source are required';
  END IF;

  INSERT INTO drip.contact_state (account_id, contact_id, consent_source, consent_detail, consent_at, consent_by)
  SELECT v_acct, t.taggable_id, v_source, v_detail, now(), v_by
    FROM public.taggings t
    JOIN public.tags g ON g.id = t.tag_id
   WHERE t.taggable_type = 'Contact' AND t.context = 'labels' AND g.name = v_label
     AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = t.taggable_id AND c.account_id = v_acct)
  ON CONFLICT (account_id, contact_id) DO UPDATE
    SET consent_source = EXCLUDED.consent_source,
        consent_detail = EXCLUDED.consent_detail,
        consent_at     = COALESCE(drip.contact_state.consent_at, EXCLUDED.consent_at),
        consent_by     = EXCLUDED.consent_by,
        updated_at     = now();

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'count', v_n);
END $$;

-- חסימה/שחרור ידני של איש קשר.
CREATE OR REPLACE FUNCTION drip.set_suppression(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_acct int  := (p->>'account_id')::int;
  v_cid  int  := (p->>'contact_id')::int;
  v_on   boolean := COALESCE((p->>'suppressed')::boolean, true);
  v_reason text := COALESCE(nullif(p->>'reason',''), 'manual');
  v_scope  text := COALESCE(nullif(p->>'scope',''), 'marketing');
BEGIN
  IF v_acct IS NULL OR v_cid IS NULL THEN RAISE EXCEPTION 'account_id and contact_id required'; END IF;

  IF v_on THEN
    INSERT INTO drip.contact_state (account_id, contact_id, suppressed_at, suppressed_reason, suppressed_scope)
    VALUES (v_acct, v_cid, now(), v_reason, v_scope)
    ON CONFLICT (account_id, contact_id) DO UPDATE
      SET suppressed_at = now(), suppressed_reason = v_reason, suppressed_scope = v_scope, updated_at = now();
    -- חסימה עוצרת מיד כל רצף פעיל ומנקה את התכונה, כדי שלא ישויך שוב.
    UPDATE drip.enrollments SET status = 'stopped'
     WHERE account_id = v_acct AND contact_id = v_cid AND status = 'active';
    UPDATE public.contacts
       SET custom_attributes = custom_attributes - 'sequence'
     WHERE account_id = v_acct AND id = v_cid;
  ELSE
    UPDATE drip.contact_state
       SET suppressed_at = NULL, suppressed_reason = NULL, suppressed_detail = NULL,
           cap_failures = 0, unengaged_streak = 0, updated_at = now()
     WHERE account_id = v_acct AND contact_id = v_cid;
  END IF;

  RETURN jsonb_build_object('ok', true);
END $$;

-- שמירת הגדרות ציות.
CREATE OR REPLACE FUNCTION drip.save_compliance(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_acct int := (p->>'account_id')::int;
BEGIN
  IF v_acct IS NULL THEN RAISE EXCEPTION 'account_id required'; END IF;
  INSERT INTO drip.compliance (
    account_id, require_consent, max_marketing_per_day, max_unengaged,
    max_cap_failures, consent_max_age_days, block_us_marketing, halt_on_red, opt_out_keywords)
  VALUES (
    v_acct,
    COALESCE((p->>'require_consent')::boolean, true),
    COALESCE((p->>'max_marketing_per_day')::int, 1),
    COALESCE((p->>'max_unengaged')::int, 3),
    COALESCE((p->>'max_cap_failures')::int, 2),
    COALESCE((p->>'consent_max_age_days')::int, 30),
    COALESCE((p->>'block_us_marketing')::boolean, true),
    COALESCE((p->>'halt_on_red')::boolean, true),
    COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(COALESCE(p->'opt_out_keywords','[]'::jsonb)) x), '{}'::text[]))
  ON CONFLICT (account_id) DO UPDATE SET
    require_consent       = EXCLUDED.require_consent,
    max_marketing_per_day = EXCLUDED.max_marketing_per_day,
    max_unengaged         = EXCLUDED.max_unengaged,
    max_cap_failures      = EXCLUDED.max_cap_failures,
    consent_max_age_days  = EXCLUDED.consent_max_age_days,
    block_us_marketing    = EXCLUDED.block_us_marketing,
    halt_on_red           = EXCLUDED.halt_on_red,
    opt_out_keywords      = EXCLUDED.opt_out_keywords;
  RETURN jsonb_build_object('ok', true);
END $$;

-- שחרור עצירת חירום (אחרי שהלקוח טיפל בסיבה).
CREATE OR REPLACE FUNCTION drip.resume_account(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_acct int := (p->>'account_id')::int;
BEGIN
  IF v_acct IS NULL THEN RAISE EXCEPTION 'account_id required'; END IF;
  UPDATE drip.account_health
     SET halted = false, halt_reason = NULL, halted_at = NULL
   WHERE account_id = v_acct;
  UPDATE drip.alerts SET acked_at = now()
   WHERE account_id = v_acct AND acked_at IS NULL AND code IN ('halted', 'policy_block', 'quality_red');
  RETURN jsonb_build_object('ok', true);
END $$;

-- תמונת מצב הציות לדשבורד.
CREATE OR REPLACE FUNCTION drip.compliance_overview(p_account_id int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'health',   COALESCE((SELECT to_jsonb(h) FROM drip.account_health h WHERE h.account_id = p_account_id), '{}'::jsonb),
    'settings', COALESCE((SELECT to_jsonb(c) FROM drip.compliance     c WHERE c.account_id = p_account_id), '{}'::jsonb),
    'templates',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.template_name)
                            FROM drip.template_health t WHERE t.account_id = p_account_id), '[]'::jsonb),
    'alerts',   COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC)
                            FROM drip.alerts a WHERE a.account_id = p_account_id AND a.acked_at IS NULL), '[]'::jsonb),
    'contacts', (
      SELECT jsonb_build_object(
        'known',        count(*),
        'with_consent', count(*) FILTER (WHERE cs.consent_at IS NOT NULL),
        'suppressed',   count(*) FILTER (WHERE cs.suppressed_at IS NOT NULL),
        'stale',        count(*) FILTER (
                          WHERE cs.consent_at IS NOT NULL
                            AND cs.consent_at < now() - make_interval(days =>
                                  COALESCE((SELECT consent_max_age_days FROM drip.compliance WHERE account_id = p_account_id), 30))))
      FROM drip.contact_state cs WHERE cs.account_id = p_account_id),
    -- אנשי קשר המשויכים לרצף שאין להם רשומת הסכמה — ה"חוב" שהלקוח צריך לסגור.
    'missing_consent', (
      SELECT count(*) FROM public.contacts c
       WHERE c.account_id = p_account_id
         AND c.custom_attributes ? 'sequence'
         AND NOT EXISTS (SELECT 1 FROM drip.contact_state cs
                          WHERE cs.account_id = p_account_id AND cs.contact_id = c.id
                            AND cs.consent_at IS NOT NULL)),
    'suppressed_by_reason', COALESCE((
      SELECT jsonb_object_agg(suppressed_reason, n) FROM (
        SELECT suppressed_reason, count(*) AS n FROM drip.contact_state
         WHERE account_id = p_account_id AND suppressed_at IS NOT NULL
         GROUP BY suppressed_reason) x), '{}'::jsonb)
  );
$$;

-- אישור התראה.
CREATE OR REPLACE FUNCTION drip.ack_alert(p jsonb) RETURNS jsonb
LANGUAGE sql AS $$
  UPDATE drip.alerts SET acked_at = now()
   WHERE account_id = (p->>'account_id')::int
     AND id = (p->>'id')::bigint
     AND acked_at IS NULL;
  SELECT jsonb_build_object('ok', true);
$$;

-- ── ברירות מחדל בטוחות ──────────────────────────────────────────────────────
-- 018 קיבע COALESCE(..., false) על skip_shabbat: רצף שנשמר בלי הדגל איבד בשקט את
-- הגנת השבת, למרות ש-DEFAULT true בטבלה. אותו דבר בשעות שקט (nullable, בלי ברירת
-- מחדל) — רצף בלי שעות שקט ישלח שיווק ב-03:00, שזו הדרך הקצרה לחסימה.
--
-- זה פאטץ' *מדויק* על הגוף מ-018: שתי שורות ה-DECLARE ובלוק ברירת המחדל לשעות שקט.
-- כל השאר זהה מילה במילה (עדכון לפי id, WITH ORDINALITY ל-step_order, החזרת
-- _sequence_json) — שינוי לוגיקה נוספת כאן היה שובר את העורך.
CREATE OR REPLACE FUNCTION drip.save_sequence(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_id     uuid;
  v_acc    int     := (p->>'account_id')::int;
  v_key    text    := p->>'key';
  v_qs     time    := nullif(p->>'quiet_start', '')::time;
  v_qe     time    := nullif(p->>'quiet_end',   '')::time;
  v_sk     boolean := COALESCE((p->>'skip_shabbat')::boolean, true);   -- ← היה false
  v_enroll boolean := COALESCE((p->>'enroll_enabled')::boolean, (p->>'enabled')::boolean, false);
  v_send   boolean := COALESCE((p->>'send_enabled')::boolean,   (p->>'enabled')::boolean, false);
BEGIN
  IF v_acc IS NULL THEN RAISE EXCEPTION 'account_id required'; END IF;
  IF COALESCE(v_key, '') = '' THEN RAISE EXCEPTION 'key required'; END IF;

  -- שעות שקט: רק כשהקריאה לא הזכירה אותן בכלל. עורך ששולח מחרוזת ריקה במפורש
  -- ("אין שעות שקט") ממשיך לקבל NULL — הבחירה שלו מכובדת.
  IF v_qs IS NULL AND v_qe IS NULL AND NOT (p ? 'quiet_start') THEN
    v_qs := '21:00'::time;
    v_qe := '08:00'::time;
  END IF;

  IF nullif(p->>'id', '') IS NOT NULL THEN
    UPDATE drip.sequences
       SET key            = v_key,
           display_name   = p->>'display_name',
           enroll_enabled = v_enroll,
           send_enabled   = v_send,
           enabled        = (v_enroll OR v_send),
           stop_on_reply  = COALESCE((p->>'stop_on_reply')::boolean, false),
           skip_shabbat   = v_sk,
           quiet_start    = v_qs,
           quiet_end      = v_qe,
           updated_at     = now()
     WHERE id = (p->>'id')::uuid AND account_id = v_acc
     RETURNING id INTO v_id;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO drip.sequences
      (account_id, key, display_name, enabled, enroll_enabled, send_enabled, stop_on_reply, skip_shabbat, quiet_start, quiet_end)
    VALUES
      (v_acc, v_key, p->>'display_name',
       (v_enroll OR v_send), v_enroll, v_send,
       COALESCE((p->>'stop_on_reply')::boolean, false),
       v_sk, v_qs, v_qe)
    ON CONFLICT (account_id, key) DO UPDATE
      SET display_name   = excluded.display_name,
          enabled        = excluded.enabled,
          enroll_enabled = excluded.enroll_enabled,
          send_enabled   = excluded.send_enabled,
          stop_on_reply  = excluded.stop_on_reply,
          skip_shabbat   = excluded.skip_shabbat,
          quiet_start    = excluded.quiet_start,
          quiet_end      = excluded.quiet_end,
          updated_at     = now()
    RETURNING id INTO v_id;
  END IF;

  DELETE FROM drip.sequence_steps WHERE sequence_id = v_id;
  INSERT INTO drip.sequence_steps
    (sequence_id, step_order, template_name, language, category, delay_days, delay_hours,
     params, media_url, send_hour, send_condition, on_condition_fail,
     send_date, repeat_interval, repeat_unit, allowed_dow)
  SELECT v_id,
         COALESCE(nullif(s->>'step_order', '')::int, ord::int),
         s->>'template_name',
         COALESCE(nullif(s->>'language', ''), 'he'),
         COALESCE(nullif(s->>'category', ''), 'MARKETING'),
         COALESCE(nullif(s->>'delay_days', '')::int, 0),
         COALESCE(nullif(s->>'delay_hours', '')::int, 0),
         COALESCE(s->'params', '[]'::jsonb),
         nullif(s->>'media_url', ''),
         nullif(s->>'send_hour', '')::int,
         COALESCE(nullif(s->>'send_condition', ''), 'always'),
         COALESCE(nullif(s->>'on_condition_fail', ''), 'skip'),
         nullif(s->>'send_date', '')::date,
         nullif(s->>'repeat_interval', '')::int,
         nullif(s->>'repeat_unit', ''),
         CASE WHEN jsonb_typeof(s->'allowed_dow') = 'array'
                   AND jsonb_array_length(s->'allowed_dow') > 0
              THEN ARRAY(SELECT jsonb_array_elements_text(s->'allowed_dow')::int)
              ELSE NULL END
  FROM jsonb_array_elements(COALESCE(p->'steps', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord)
  WHERE COALESCE(s->>'template_name', '') <> '';

  RETURN drip._sequence_json(v_id);
END;
$function$;

-- הרשאות: אותו תפקיד least-privilege שהמנוע כבר משתמש בו.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON drip.contact_state, drip.account_health,
      drip.template_health, drip.compliance, drip.alerts TO drip_engine;
    GRANT USAGE, SELECT ON SEQUENCE drip.alerts_id_seq TO drip_engine;
    -- consent_by_label קורא תוויות של Chatwoot
    GRANT SELECT ON public.taggings, public.tags TO drip_engine;
  END IF;
END $$;
