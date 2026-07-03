-- 013 — enrollment_status: reflect a just-assigned sequence during the reconciler gap.
--
-- set_sequence writes the contact's `sequence` attr AND deletes the enrollment (so a re-assign
-- can restart cleanly). The per-minute reconciler then re-enrolls. In the ~1-minute gap there is
-- NO enrollment row, so the old enrollment_status returned NULL and the conversation panel
-- flashed back to "no sequence" — even though the lead was just assigned (and a message is on
-- its way). Fix: fall back to the contact's `sequence` attr as a 'pending' status when no
-- enrollment exists yet. The panel then shows the assigned sequence ("being processed within a
-- minute") and switches to the live status once the reconciler enrolls.
CREATE OR REPLACE FUNCTION drip.enrollment_status(p_account_id int, p_conversation_id int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    -- 1) a real enrollment — matched by conversation_id OR by the conversation's contact
    --    (contact-level model: the enrollment may carry conversation_id NULL until first send).
    (SELECT jsonb_build_object(
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
     LIMIT 1
    ),
    -- 2) fallback — the contact carries a `sequence` attr (just assigned) but no enrollment yet.
    --    Shown as 'pending' so the panel reflects the assignment immediately. NULL when the
    --    contact has no attr (truly unassigned) or the sequence key is unknown.
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
