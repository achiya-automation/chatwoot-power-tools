-- drip.save_compliance שמרה 8 שדות בלבד — אלה שהיו קיימים כשהיא נכתבה (מיגרציה 020).
--
-- מאז נוספו לטבלה שבע עמודות הגדרה, ואף אחת מהן לא נשמרה: המסך שלח, הפונקציה
-- התעלמה, והערך חזר לקדמותו ברענון. הגילוי (07.08.2026) הגיע ממקטע "שעות שליחה"
-- החדש, אבל הבאג רחב ממנו:
--   max_template_failures         (022)
--   quiet_start_hour/end_hour/tz  (037)
--   saturation_release_days       (038)
--   window_pull_enabled           (039)
--   auto_template_replace_enabled (040)
--
-- ⚠️ הכלל שמונע נזק: **עדכון רק למפתחות שהגיעו בפועל**. הקורא שולח את הטופס שהוא
-- מציג, ואינו יודע על שדות שמסכים אחרים מנהלים. `p ? 'key'` בודק נוכחות מפתח (ולא
-- ערך), כך ששדה שלא נשלח שומר על ערכו הקיים במקום להתאפס לברירת מחדל — בדיוק הכשל
-- שהיה קורה אילו היינו מוסיפים COALESCE על ערך חסר.

CREATE OR REPLACE FUNCTION drip.save_compliance(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_acct int := (p->>'account_id')::int;
BEGIN
  IF v_acct IS NULL THEN RAISE EXCEPTION 'account_id required'; END IF;

  -- שורה ראשונה לחשבון: ברירות המחדל של הטבלה תופסות לכל מה שלא נשלח.
  INSERT INTO drip.compliance (account_id) VALUES (v_acct)
  ON CONFLICT (account_id) DO NOTHING;

  UPDATE drip.compliance SET
    require_consent       = CASE WHEN p ? 'require_consent'       THEN (p->>'require_consent')::boolean       ELSE require_consent END,
    max_marketing_per_day = CASE WHEN p ? 'max_marketing_per_day' THEN (p->>'max_marketing_per_day')::int     ELSE max_marketing_per_day END,
    max_unengaged         = CASE WHEN p ? 'max_unengaged'         THEN (p->>'max_unengaged')::int             ELSE max_unengaged END,
    max_cap_failures      = CASE WHEN p ? 'max_cap_failures'      THEN (p->>'max_cap_failures')::int          ELSE max_cap_failures END,
    consent_max_age_days  = CASE WHEN p ? 'consent_max_age_days'  THEN (p->>'consent_max_age_days')::int      ELSE consent_max_age_days END,
    block_us_marketing    = CASE WHEN p ? 'block_us_marketing'    THEN (p->>'block_us_marketing')::boolean    ELSE block_us_marketing END,
    halt_on_red           = CASE WHEN p ? 'halt_on_red'           THEN (p->>'halt_on_red')::boolean           ELSE halt_on_red END,
    opt_out_keywords      = CASE WHEN p ? 'opt_out_keywords'
                                 THEN COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(p->'opt_out_keywords') x), '{}'::text[])
                                 ELSE opt_out_keywords END,
    -- ⬇️ השדות שלא נשמרו עד היום
    max_template_failures = CASE WHEN p ? 'max_template_failures' THEN (p->>'max_template_failures')::int     ELSE max_template_failures END,
    quiet_start_hour      = CASE WHEN p ? 'quiet_start_hour'      THEN (p->>'quiet_start_hour')::int          ELSE quiet_start_hour END,
    quiet_end_hour        = CASE WHEN p ? 'quiet_end_hour'        THEN (p->>'quiet_end_hour')::int            ELSE quiet_end_hour END,
    quiet_tz              = CASE WHEN p ? 'quiet_tz'              THEN NULLIF(p->>'quiet_tz', '')             ELSE quiet_tz END,
    saturation_release_days = CASE WHEN p ? 'saturation_release_days' THEN (p->>'saturation_release_days')::int ELSE saturation_release_days END,
    window_pull_enabled   = CASE WHEN p ? 'window_pull_enabled'   THEN (p->>'window_pull_enabled')::boolean   ELSE window_pull_enabled END,
    auto_template_replace_enabled = CASE WHEN p ? 'auto_template_replace_enabled'
                                         THEN (p->>'auto_template_replace_enabled')::boolean
                                         ELSE auto_template_replace_enabled END
  WHERE account_id = v_acct;

  RETURN jsonb_build_object('ok', true);
END $$;

-- 🔒 least-privilege, כמו שאר ה-RPCs (ראה 033).
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION drip.save_compliance(jsonb) FROM PUBLIC';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION drip.save_compliance(jsonb) TO drip_engine';
  END IF;
END $$;
