-- 008_delivery_status.sql — מעקב מסירה אמיתי ("מי נתקע ברצף").
--
-- עד כה ה-reconciler שלח דרך Chatwoot, רשם sent_messages, וקידם ל-'completed' —
-- אבל כשל מסירה של Meta (אסינכרוני, מגיע ל-public.messages.status=3) לא נבדק אף פעם,
-- אז הדשבורד הציג "נשלח/הושלם" בזמן שהלקוח לא קיבל כלום.
--
-- כאן: שומרים את message_id (ה-id ש-Chatwoot מחזיר), ופאזה חדשה ב-reconciler
-- קוראת את public.messages.status בטיק מאוחר ומסמנת delivery_status ('delivered'/'failed').
-- כשל → ה-enrollment מקבל status='failed' (נתקע) + שומרים את קוד/כותרת השגיאה לתצוגה.

-- ── עמודות מעקב מסירה על sent_messages ──
ALTER TABLE drip.sent_messages ADD COLUMN IF NOT EXISTS message_id      int;
ALTER TABLE drip.sent_messages ADD COLUMN IF NOT EXISTS delivery_status text DEFAULT 'pending'; -- pending | delivered | failed
ALTER TABLE drip.sent_messages ADD COLUMN IF NOT EXISTS error_code      text;   -- '131026' וכו'
ALTER TABLE drip.sent_messages ADD COLUMN IF NOT EXISTS error_title     text;   -- '131026: Message undeliverable'

-- אינדקס לשליפת הממתינים-לבדיקה (delivery_status='pending' עם message_id)
CREATE INDEX IF NOT EXISTS idx_sent_pending
  ON drip.sent_messages(account_id, delivery_status)
  WHERE message_id IS NOT NULL;

-- ── sent_history: + delivery_status + error_title (כל הודעה בסיידבר מראה אם נמסרה/נכשלה) ──
CREATE OR REPLACE FUNCTION drip.sent_history(p_account_id int, p_conversation_id int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h.sent_at), '[]'::jsonb)
  FROM (
    SELECT step_order, template_name, content,
           COALESCE(delivery_status, 'pending') AS delivery_status,
           error_code, error_title,
           to_char(sent_at, 'YYYY-MM-DD HH24:MI') AS sent_at
    FROM drip.sent_messages
    WHERE account_id = p_account_id AND conversation_id = p_conversation_id
    ORDER BY sent_at
  ) h;
$$;

-- ── list_enrollments: + last_error + failed_step (איזו שגיאה ובאיזה שלב נתקע) ──
-- מצרף לרוחב את הודעת-הכשל האחרונה של אותה שיחה (delivery_status='failed').
CREATE OR REPLACE FUNCTION drip.list_enrollments(p_account_id int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.enrolled_at DESC), '[]'::jsonb)
  FROM (
    SELECT en.conversation_id,
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
    LEFT JOIN public.contacts     ct ON ct.id = c.contact_id
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

-- ── enrollment_status: + last_error + failed_step (פאנל השיחה מראה למה נתקע) ──
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
  LEFT JOIN public.contacts     ct ON ct.id = c.contact_id
  LEFT JOIN LATERAL (
    SELECT sm.error_code, sm.error_title, sm.step_order
      FROM drip.sent_messages sm
     WHERE sm.account_id = e.account_id
       AND sm.conversation_id = e.conversation_id
       AND sm.delivery_status = 'failed'
     ORDER BY sm.sent_at DESC
     LIMIT 1
  ) fail ON true
  WHERE e.account_id = p_account_id AND e.conversation_id = p_conversation_id
  LIMIT 1;
$$;
