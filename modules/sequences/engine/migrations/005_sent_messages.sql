-- 005_sent_messages.sql — message send history (transparency: "see exactly what was sent")
-- Owned by drip_engine (owner of schema drip) → no extra grants needed.
--
-- One row per template message the reconciler actually delivered. Keyed by
-- conversation (NOT a hard FK to enrollments): an explicit re-assign deletes the
-- old enrollment to reset the run, but the history of what a contact already
-- received must survive that — so we never cascade it away. enrollment_id is a
-- soft reference for debugging only.

CREATE TABLE IF NOT EXISTS drip.sent_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      int  NOT NULL,
  conversation_id int  NOT NULL,
  enrollment_id   uuid,              -- soft ref (no FK: reset deletes enrollment, history stays)
  sequence_id     uuid,
  step_order      int,
  template_name   text,
  content         text,              -- rendered body the agent saw (display copy)
  sent_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sent_conv
  ON drip.sent_messages(account_id, conversation_id, sent_at DESC);

-- ── sent_history: ordered message log for a single conversation (sidebar timeline) ──
-- Returns [] (never null) so the UI can render an empty state without a null guard.
CREATE OR REPLACE FUNCTION drip.sent_history(p_account_id int, p_conversation_id int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(h) ORDER BY h.sent_at), '[]'::jsonb)
  FROM (
    SELECT step_order, template_name, content,
           to_char(sent_at, 'YYYY-MM-DD HH24:MI') AS sent_at
    FROM drip.sent_messages
    WHERE account_id = p_account_id AND conversation_id = p_conversation_id
    ORDER BY sent_at
  ) h;
$$;
