-- 007_enrollment_contact_info.sql — שם + טלפון לכל enrollment מ-public.contacts.
-- עד כה enrollments.phone היה NULL (ה-reconciler לא שמר), אז הדשבורד הציג "—".
-- במקום backfill — list_enrollments / enrollment_status מצרפים את ה-contact בזמן קריאה
-- (drip_engine יש SELECT על conversations+contacts). מציג שם וטלפון אמיתיים.

-- ── list_enrollments: + contact_name + phone אמיתי ──
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
           to_char(en.next_send_at, 'YYYY-MM-DD HH24:MI') AS next_send_at,
           to_char(en.last_sent_at, 'YYYY-MM-DD HH24:MI') AS last_sent_at,
           to_char(en.enrolled_at,  'YYYY-MM-DD HH24:MI') AS enrolled_at
    FROM drip.enrollments en
    JOIN drip.sequences s ON s.id = en.sequence_id
    LEFT JOIN public.conversations c ON c.account_id = en.account_id AND c.display_id = en.conversation_id
    LEFT JOIN public.contacts     ct ON ct.id = c.contact_id
    WHERE en.account_id = p_account_id
  ) e;
$$;

-- ── enrollment_status: + contact_name + phone אמיתי (פאנל השיחה) ──
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
    'contact_name',  ct.name
  )
  FROM drip.enrollments e
  JOIN drip.sequences s ON s.id = e.sequence_id
  LEFT JOIN public.conversations c ON c.account_id = e.account_id AND c.display_id = e.conversation_id
  LEFT JOIN public.contacts     ct ON ct.id = c.contact_id
  WHERE e.account_id = p_account_id AND e.conversation_id = p_conversation_id
  LIMIT 1;
$$;
