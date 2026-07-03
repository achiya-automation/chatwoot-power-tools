-- 015_step_send_condition.sql — flexible per-step send condition.
--
-- Generalises the per-step gate (the boolean require_no_reply from 014) into two fields:
--   send_condition    : 'always' (default) | 'no_reply' | 'replied'
--                       whether to send the step, based on the customer's reply since
--                       our previous message.
--   on_condition_fail : 'skip' (default) | 'stop'
--                       when the condition is NOT met — 'skip' advances past the step and
--                       KEEPS the sequence going (no send); 'stop' halts the enrollment.
--
-- The "after some time" is still the step's own delay (delay_days/hours/send_hour).
-- This supersedes require_no_reply (true ≡ send_condition='no_reply'); old column dropped.

ALTER TABLE drip.sequence_steps ADD COLUMN IF NOT EXISTS send_condition    text NOT NULL DEFAULT 'always';
ALTER TABLE drip.sequence_steps ADD COLUMN IF NOT EXISTS on_condition_fail text NOT NULL DEFAULT 'skip';

-- Carry over any step that used the old boolean. require_no_reply always exists here
-- (014 runs before 015 in every environment). on_condition_fail stays 'skip' — the new
-- default (skip & continue), which matches the intended follow-up behaviour.
UPDATE drip.sequence_steps SET send_condition = 'no_reply' WHERE require_no_reply IS TRUE;

-- ── _sequence_json: return the new fields (so the UI loads them); drop require_no_reply ──
CREATE OR REPLACE FUNCTION drip._sequence_json(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(seq) || jsonb_build_object('steps', COALESCE(st.steps, '[]'::jsonb))
  FROM (
    SELECT id, account_id, key, display_name, enabled, stop_on_reply, skip_shabbat,
           to_char(quiet_start, 'HH24:MI') AS quiet_start,
           to_char(quiet_end,   'HH24:MI') AS quiet_end
    FROM drip.sequences WHERE id = p_id
  ) seq
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.step_order) AS steps
    FROM (
      SELECT id, step_order, template_name, language, category,
             delay_days, delay_hours, params, media_url, send_hour,
             send_condition, on_condition_fail
      FROM drip.sequence_steps WHERE sequence_id = p_id
    ) s
  ) st ON true;
$$;

-- ── save_sequence: persist the new fields on each step (replaces require_no_reply) ──
CREATE OR REPLACE FUNCTION drip.save_sequence(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_id  uuid;
  v_acc int     := (p->>'account_id')::int;
  v_key text    := p->>'key';
  v_qs  time    := nullif(p->>'quiet_start', '')::time;
  v_qe  time    := nullif(p->>'quiet_end',   '')::time;
  v_sk  boolean := COALESCE((p->>'skip_shabbat')::boolean, false);
BEGIN
  IF v_acc IS NULL THEN RAISE EXCEPTION 'account_id required'; END IF;
  IF COALESCE(v_key, '') = '' THEN RAISE EXCEPTION 'key required'; END IF;

  IF nullif(p->>'id', '') IS NOT NULL THEN
    UPDATE drip.sequences
       SET key          = v_key,
           display_name = p->>'display_name',
           enabled      = COALESCE((p->>'enabled')::boolean, false),
           stop_on_reply = COALESCE((p->>'stop_on_reply')::boolean, false),
           skip_shabbat = v_sk,
           quiet_start  = v_qs,
           quiet_end    = v_qe,
           updated_at   = now()
     WHERE id = (p->>'id')::uuid AND account_id = v_acc
     RETURNING id INTO v_id;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO drip.sequences
      (account_id, key, display_name, enabled, stop_on_reply, skip_shabbat, quiet_start, quiet_end)
    VALUES
      (v_acc, v_key, p->>'display_name',
       COALESCE((p->>'enabled')::boolean, false),
       COALESCE((p->>'stop_on_reply')::boolean, false),
       v_sk, v_qs, v_qe)
    ON CONFLICT (account_id, key) DO UPDATE
      SET display_name  = excluded.display_name,
          enabled       = excluded.enabled,
          stop_on_reply = excluded.stop_on_reply,
          skip_shabbat  = excluded.skip_shabbat,
          quiet_start   = excluded.quiet_start,
          quiet_end     = excluded.quiet_end,
          updated_at    = now()
    RETURNING id INTO v_id;
  END IF;

  DELETE FROM drip.sequence_steps WHERE sequence_id = v_id;
  INSERT INTO drip.sequence_steps
    (sequence_id, step_order, template_name, language, category, delay_days, delay_hours, params, media_url, send_hour, send_condition, on_condition_fail)
  SELECT v_id,
         COALESCE(nullif(s->>'step_order', '')::int, ord::int),
         s->>'template_name',
         COALESCE(nullif(s->>'language', ''), 'he'),
         COALESCE(nullif(s->>'category', ''), 'MARKETING'),
         COALESCE(nullif(s->>'delay_days', '')::int, 0),
         COALESCE(nullif(s->>'delay_hours', '')::int, 0),
         COALESCE(s->'params', '[]'::jsonb),
         nullif(s->>'media_url', ''),
         nullif(s->>'send_hour', '')::int,
         COALESCE(nullif(s->>'send_condition', ''), 'always'),
         COALESCE(nullif(s->>'on_condition_fail', ''), 'skip')
  FROM jsonb_array_elements(COALESCE(p->'steps', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord)
  WHERE COALESCE(s->>'template_name', '') <> '';

  RETURN drip._sequence_json(v_id);
END;
$$;

-- The RPCs no longer reference require_no_reply — safe to drop the superseded column.
ALTER TABLE drip.sequence_steps DROP COLUMN IF EXISTS require_no_reply;
