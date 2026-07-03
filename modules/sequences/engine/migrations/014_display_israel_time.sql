-- 014 — show times in Israel local time, not UTC.
--
-- The engine's DB connection runs with session TimeZone = Etc/UTC, so to_char(ts, '...') on the
-- timestamptz columns rendered times in UTC. The conversation panel and dashboard therefore
-- showed sent_at / next_send_at three hours early (e.g. a message sent 17:07 Israel displayed as
-- 14:07). All clients are in Israel, so format every displayed time in Asia/Jerusalem explicitly
-- (AT TIME ZONE), independent of the session TimeZone. Display only — scheduling compares absolute
-- timestamptz values and is unaffected.
CREATE OR REPLACE FUNCTION drip.fmt_il(ts timestamptz) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT to_char(ts AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD HH24:MI');
$$;

-- ── list_enrollments (dashboard) — times in Israel local time ──
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
           drip.fmt_il(en.next_send_at) AS next_send_at,
           drip.fmt_il(en.last_sent_at) AS last_sent_at,
           drip.fmt_il(en.enrolled_at)  AS enrolled_at
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

-- ── sent_history (conversation panel) — sent_at in Israel local time ──
CREATE OR REPLACE FUNCTION drip.sent_history(p_account_id int, p_conversation_id int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h.sent_at), '[]'::jsonb)
  FROM (
    SELECT step_order, template_name, content,
           COALESCE(delivery_status, 'pending') AS delivery_status,
           error_code, error_title,
           drip.fmt_il(sent_at) AS sent_at
    FROM drip.sent_messages
    WHERE account_id = p_account_id AND conversation_id = p_conversation_id
    ORDER BY sent_at
  ) h;
$$;

-- ── enrollment_status (conversation panel) — times in Israel local time, keeps the 013 fallback ──
CREATE OR REPLACE FUNCTION drip.enrollment_status(p_account_id int, p_conversation_id int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
       'sequence_name', s.display_name,
       'sequence_key',  s.key,
       'current_step',  e.current_step,
       'total_steps',   (SELECT count(*) FROM drip.sequence_steps st WHERE st.sequence_id = e.sequence_id),
       'status',        e.status,
       'next_send_at',  drip.fmt_il(e.next_send_at),
       'last_sent_at',  drip.fmt_il(e.last_sent_at),
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
     LIMIT 1
    ),
    (SELECT jsonb_build_object(
       'sequence_name', s.display_name,
       'sequence_key',  s.key,
       'current_step',  0,
       'total_steps',   (SELECT count(*) FROM drip.sequence_steps st WHERE st.sequence_id = s.id),
       'status',        'pending',
       'next_send_at',  NULL,
       'last_sent_at',  NULL,
       'phone',         ct.phone_number,
       'contact_name',  ct.name,
       'last_error_code', NULL,
       'last_error',      NULL,
       'failed_step',     NULL
     )
     FROM public.contacts ct
     JOIN drip.sequences s ON s.account_id = p_account_id
                          AND s.key = ct.custom_attributes->>'sequence'
     WHERE ct.id = (SELECT contact_id FROM public.conversations
                    WHERE account_id = p_account_id AND display_id = p_conversation_id LIMIT 1)
     LIMIT 1
    )
  );
$$;
