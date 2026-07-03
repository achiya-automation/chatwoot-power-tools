-- 011_contact_level_enrollment.sql — שיוך ברמת איש קשר + יצירת שיחה עצלה (lazy).
--
-- עד כה: ה-reconciler נדרש לשיחה קיימת (conversation_id NOT NULL) ושיוך הרצף
-- נשמר על השיחה. זה אילץ פתיחת שיחה לכל ליד מראש. הדרישה החדשה:
--   ליד = איש קשר עם custom_attributes.sequence (בלי שיחה).
--   שיחה נפתחת רק כשנשלחת ההודעה הראשונה (lazy), אם אין שיחה.
-- לכן ה-enrollment עובר להיות keyed לפי contact_id, ו-conversation_id הופך nullable
-- (מתמלא ברגע יצירת השיחה בשליחה הראשונה).

-- שיחה אופציונלית עד השליחה הראשונה
ALTER TABLE drip.enrollments ALTER COLUMN conversation_id DROP NOT NULL;

-- ייחודיות חדשה: enrollment אחד לכל (account, contact). שורות ישנות עם contact_id=NULL
-- מותרות (Postgres מתייחס ל-NULL כשונה) — הן ממשיכות להיפתר לפי conversation_id ב-RPCs.
CREATE UNIQUE INDEX IF NOT EXISTS uq_enr_account_contact
  ON drip.enrollments(account_id, contact_id);

-- ── list_enrollments: פותר איש קשר לפי en.contact_id, ובחזרה לאחור דרך השיחה ──
-- COALESCE(en.contact_id, c.contact_id): enrollment חדש (contact_id מלא, ייתכן בלי שיחה)
-- מציג שם/טלפון; enrollment ישן (conversation_id בלבד) ממשיך להיפתר דרך השיחה.
CREATE OR REPLACE FUNCTION drip.list_enrollments(p_account_id int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.enrolled_at DESC), '[]'::jsonb)
  FROM (
    SELECT en.conversation_id,
           en.contact_id,
           COALESCE(ct.phone_number, en.phone) AS phone,
           ct.name                              AS contact_name,
           s.display_name AS sequence_name,
           s.key          AS sequence_key,
           en.current_step,
           (SELECT count(*) FROM drip.sequence_steps st WHERE st.sequence_id = en.sequence_id) AS total_steps,
           en.status,
           fail.error_code  AS last_error_code,
           fail.error_title AS last_error,
           fail.step_order  AS failed_step,
           to_char(en.next_send_at, 'YYYY-MM-DD HH24:MI') AS next_send_at,
           to_char(en.last_sent_at, 'YYYY-MM-DD HH24:MI') AS last_sent_at,
           to_char(en.enrolled_at,  'YYYY-MM-DD HH24:MI') AS enrolled_at
    FROM drip.enrollments en
    JOIN drip.sequences s ON s.id = en.sequence_id
    LEFT JOIN public.conversations c ON c.account_id = en.account_id AND c.display_id = en.conversation_id
    LEFT JOIN public.contacts     ct ON ct.id = COALESCE(en.contact_id, c.contact_id)
    LEFT JOIN LATERAL (
      SELECT sm.error_code, sm.error_title, sm.step_order
        FROM drip.sent_messages sm
       WHERE sm.account_id = en.account_id
         AND sm.conversation_id = en.conversation_id
         AND sm.delivery_status = 'failed'
       ORDER BY sm.sent_at DESC
       LIMIT 1
    ) fail ON true
    WHERE en.account_id = p_account_id
  ) e;
$$;

-- ── enrollment_status: הפאנל מעביר conversation_id; מאתר את ה-enrollment של אותו
-- איש קשר (גם לפני שנוצרה שיחה) — match לפי conversation_id ישיר או לפי איש הקשר של השיחה.
CREATE OR REPLACE FUNCTION drip.enrollment_status(p_account_id int, p_conversation_id int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'sequence_name', s.display_name,
    'sequence_key',  s.key,
    'current_step',  e.current_step,
    'total_steps',   (SELECT count(*) FROM drip.sequence_steps st WHERE st.sequence_id = e.sequence_id),
    'status',        e.status,
    'next_send_at',  to_char(e.next_send_at, 'YYYY-MM-DD HH24:MI'),
    'last_sent_at',  to_char(e.last_sent_at, 'YYYY-MM-DD HH24:MI'),
    'phone',         COALESCE(ct.phone_number, e.phone),
    'contact_name',  ct.name,
    'last_error_code', fail.error_code,
    'last_error',      fail.error_title,
    'failed_step',     fail.step_order
  )
  FROM drip.enrollments e
  JOIN drip.sequences s ON s.id = e.sequence_id
  LEFT JOIN public.conversations c ON c.account_id = e.account_id AND c.display_id = e.conversation_id
  LEFT JOIN public.contacts     ct ON ct.id = COALESCE(e.contact_id, c.contact_id)
  LEFT JOIN LATERAL (
    SELECT sm.error_code, sm.error_title, sm.step_order
      FROM drip.sent_messages sm
     WHERE sm.account_id = e.account_id
       AND sm.conversation_id = e.conversation_id
       AND sm.delivery_status = 'failed'
     ORDER BY sm.sent_at DESC
     LIMIT 1
  ) fail ON true
  WHERE e.account_id = p_account_id
    AND (
      e.conversation_id = p_conversation_id
      OR e.contact_id = (SELECT contact_id FROM public.conversations
                          WHERE account_id = p_account_id AND display_id = p_conversation_id LIMIT 1)
    )
  ORDER BY e.id DESC
  LIMIT 1;
$$;
