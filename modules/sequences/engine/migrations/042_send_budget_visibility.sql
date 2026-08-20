-- כמה מהמכסה היומית של מטא כבר נוצל — נתון אחד, מקור אמת אחד.
--
-- שתי בעיות שהמיגרציה הזו סוגרת:
--
-- 1. הפאנל הציג רק את התקרה ("2,000") ואף פעם לא כמה ממנה נוצל, כלומר אי אפשר היה
--    לענות על השאלה היחידה שמעניינת: כמה עוד אפשר לשלוח היום. המנוע כן חישב את זה
--    בתוך reconcile.js — וזרק את המספר.
--
-- 2. הספירה ההיא ספרה רק שליחות של המנוע. קמפיין שנשלח ידנית מ-Chatwoot על אותו
--    מספר צורך בדיוק את אותה מכסה של מטא, ולא נספר — כך שהמנוע האמין שיש לו יותר
--    מקום ממה שבאמת היה, ויכול היה לדחוף את המספר אל מעבר לתקרה (שגיאה 131049).
--
-- הפונקציה כאן היא המקור היחיד לשני הצרכנים (המנוע והמסך), כדי שהמספר שמוצג יהיה
-- בדיוק המספר שנאכף. פיצול בין השניים היה גרוע מכלום: מסך שמבטיח מקום שאין.

CREATE OR REPLACE FUNCTION drip.used_conversations_24h(p_account_id int, p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE sql STABLE AS $$
  -- מטא סופרת *שיחות שהעסק יזם* ב-24 שעות מתגלגלות, פר מספר. לכן:
  --   • DISTINCT על השיחה, לא על ההודעה — חמישה שלבים לאותו לקוח = שיחה אחת.
  --   • איחוד של שני המקורות לפני הספירה, כדי שליד שקיבל גם קמפיין וגם רצף באותה
  --     שיחה ייספר פעם אחת בלבד.
  --   • שליחה שנכשלה (status=3) לא פתחה שיחה ולכן לא נספרת.
  SELECT count(DISTINCT conversation_id)::int FROM (
    -- שליחות המנוע. in_session=false: הודעה למי שהגיב ב-24 השעות האחרונות היא בתוך
    -- חלון השירות ואינה צורכת מהמכסה כלל (הגדרת מטא).
    SELECT sm.conversation_id
      FROM drip.sent_messages sm
      LEFT JOIN public.messages m ON m.id = sm.message_id
     WHERE sm.account_id = p_account_id
       AND sm.sent_at > p_now - interval '24 hours'
       AND sm.in_session = false
       AND (m.status IS NULL OR m.status <> 3)

    UNION

    -- קמפיינים ידניים מ-Chatwoot על *המספר שנבחר לרצפים*. ההגבלה לתיבה הנבחרת היא
    -- מכוונת: התקרה שייכת למספר, וספירת קמפיין שיצא ממספר אחר הייתה מנפחת את הניצול
    -- של מספר שלא שלח כלום. כשלא נבחר מספר — אין למה לייחס, ולכן לא סופרים.
    SELECT m.conversation_id
      FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
      JOIN drip.account_tokens t ON t.account_id = p_account_id
     WHERE m.account_id = p_account_id
       AND c.inbox_id = t.inbox_id                              -- התיבה של השיחה היא מקור האמת למספר
       AND m.created_at > p_now - interval '24 hours'
       AND m.message_type = 1                                   -- outgoing
       AND m.content_attributes ->> 'campaign_id' IS NOT NULL
       AND m.status <> 3
  ) AS opened;
$$;

-- אותו גוף בדיוק שהיה ב-023, בשם חדש. ההפרדה מכוונת: מי שיוסיף בעתיד מפתח
-- לתמונת הציות עורך כאן, ו-usage נשאר עטיפה דקה שלא צריך לגעת בה.
CREATE OR REPLACE FUNCTION drip.compliance_overview_base(p_account_id int) RETURNS jsonb
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

-- הרחבת תמונת הציות: usage = מה שהמסך צריך כדי לומר "נוצל X מתוך Y", ומאיזה מספר.
CREATE OR REPLACE FUNCTION drip.compliance_overview(p_account_id int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT drip.compliance_overview_base(p_account_id) || jsonb_build_object(
    'usage', jsonb_build_object(
      'used_24h', drip.used_conversations_24h(p_account_id),
      -- ‎-1 = ללא הגבלה (Infinity לא נשמר בעמודת int). NULL כשאין עדיין קריאת בריאות.
      'cap', (SELECT h.cap FROM drip.account_health h WHERE h.account_id = p_account_id),
      -- ⭐ המספר שהנתונים שייכים לו. לחשבון יכולים להיות כמה מספרים, והצגת תקרה בלי
      -- לומר של מי היא — כפי שהיה — היא נתון שאי אפשר לפעול לפיו. NULL = לא נבחר.
      'inbox', (
        SELECT jsonb_build_object('id', i.id, 'name', i.name, 'phone', cw.phone_number)
          FROM drip.account_tokens t
          JOIN public.inboxes i ON i.id = t.inbox_id
          JOIN public.channel_whatsapp cw ON cw.id = i.channel_id
         WHERE t.account_id = p_account_id)
    )
  );
$$;

-- 🔒 least-privilege — ללא REVOKE מפורש Postgres נותן EXECUTE ל-PUBLIC ביצירה, וכל
-- תפקיד עם USAGE על סכמת drip (כולל תפקיד האפליקציה של Chatwoot) היה יכול לקרוא
-- לפונקציות האלה עבור כל account_id.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'drip.used_conversations_24h(int, timestamptz)',
    'drip.compliance_overview_base(int)',
    'drip.compliance_overview(int)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO drip_engine', fn);
    END IF;
  END LOOP;
END $$;
