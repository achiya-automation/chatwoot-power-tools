-- 017 — expose enrollment_id in sent_history + enrollment_status, so the conversation
-- panel can isolate a SINGLE run's history.
--
-- A contact that switched or re-ran sequences (e.g. bb_new → bb_new → bb_postshoot)
-- accumulates sent_messages from every run on the SAME conversation (history is keyed by
-- conversation, kept across resets by design). The timeline matched history to steps by
-- step_order ALONE, so step N of the current sequence could be painted with step N of an
-- OLD run — a message shown as "sent" that actually belongs to a different sequence, out of
-- chronological order ("message 2 before message 1"). The panel now filters history to the
-- current enrollment_id, so only the running sequence's own sends are shown.
--
-- Display-only change: same rows, same ordering, same Israel-time formatting as 014; only an
-- extra enrollment_id field is added (sent_history) / surfaced (enrollment_status current run).

-- ── sent_history: + enrollment_id (which run each sent message belongs to) ──
CREATE OR REPLACE FUNCTION drip.sent_history(p_account_id int, p_conversation_id int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h.sent_at), '[]'::jsonb)
  FROM (
    SELECT step_order, template_name, content, enrollment_id,
           COALESCE(delivery_status, 'pending') AS delivery_status,
           error_code, error_title,
           drip.fmt_il(sent_at) AS sent_at
    FROM drip.sent_messages
    WHERE account_id = p_account_id AND conversation_id = p_conversation_id
    ORDER BY sent_at
  ) h;
$$;

-- ── enrollment_status: + enrollment_id of the CURRENT run (NULL in the pending fallback) ──
CREATE OR REPLACE FUNCTION drip.enrollment_status(p_account_id int, p_conversation_id int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
       'enrollment_id', e.id,
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
       'enrollment_id', NULL,
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
