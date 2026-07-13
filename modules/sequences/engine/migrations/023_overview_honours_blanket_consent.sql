-- הדשבורד הציג "שיווק אליהם חסום" על לידים שקיבלו הודעה באותו יום.
--
-- `compliance_overview` ספרה אנשי קשר בלי `consent_at` — ולא הסתכלה בכלל על
-- `drip.blanket_consent`, הצהרת בעל המידע שהלקוח חותם עליה. השער האמיתי (`canSend`)
-- כן מסתכל:
--
--     require_consent && !contact.consent_at && !settings.blanket_consent  →  חסום
--
-- ⇒ כשיש הצהרה, **אף אחד אינו חסום**. הדשבורד פשוט לא ידע את זה, והתריע על חוב שלא קיים
-- (נמדד 13/07: 0 דחיות `no_consent` בלוג, ו-5 מתוך 19 ה"חסומים" קיבלו הודעה באותו בוקר).
--
-- ⛔ הכלל `require_consent` נשאר דלוק. הוא לא חוסם אף אחד שיש עליו הצהרה — אבל הוא כן
-- יחסום לקוח עתידי שטרם חתם. זו ההגנה, וההצהרה החתומה היא הראיה. תיקון 40: עד ₪1,000
-- להודעה, ואצל מטא זו הסיבה מספר 1 להשבתת מספרים.
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

    -- הצהרת בעל המידע החלה על החשבון. הספציפית גוברת על הגלובלית (account_id = 0),
    -- שהיא תנאי ההתקשרות הסטנדרטיים — שורה אחת שמכסה כל לקוח, קיים ועתידי.
    'blanket_consent', COALESCE((
      SELECT to_jsonb(b) FROM drip.blanket_consent b
       WHERE b.account_id IN (p_account_id, 0)
       ORDER BY (b.account_id = p_account_id) DESC
       LIMIT 1), 'null'::jsonb),

    -- ⭐ מי שבאמת חסום — בדיוק לפי הכלל של canSend. עם הצהרה: אפס.
    'missing_consent', CASE
      WHEN EXISTS (SELECT 1 FROM drip.blanket_consent b WHERE b.account_id IN (p_account_id, 0)) THEN 0
      ELSE (
        SELECT count(*) FROM public.contacts c
         WHERE c.account_id = p_account_id
           AND c.custom_attributes ? 'sequence'
           AND NOT EXISTS (SELECT 1 FROM drip.contact_state cs
                            WHERE cs.account_id = p_account_id AND cs.contact_id = c.id
                              AND cs.consent_at IS NOT NULL))
      END,

    -- הספירה הגולמית — לתצוגה בלבד. אינה "חסומים": היא רק "אין רשומה אישית", ומי שיש
    -- עליו הצהרה מקבל בכל מקרה.
    'without_consent_record', (
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
