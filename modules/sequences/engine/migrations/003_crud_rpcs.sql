-- 003_crud_rpcs.sql — CRUD RPCs for the Web App (drip-engine sidecar)
-- Adds updated_at/enrolled_at columns + save/delete/list functions (port of db/005,006,007,008)
-- Supersedes the n8n inline-SQL approach: uses parameterized jsonb argument.

ALTER TABLE drip.sequences    ADD COLUMN IF NOT EXISTS updated_at  timestamptz;
ALTER TABLE drip.enrollments  ADD COLUMN IF NOT EXISTS enrolled_at timestamptz DEFAULT now();

-- ── helper: JSON representation of a single sequence + its steps ──
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
             delay_days, delay_hours, params
      FROM drip.sequence_steps WHERE sequence_id = p_id
    ) s
  ) st ON true;
$$;

-- ── list: all sequences for an account (with steps), sorted by display_name ──
CREATE OR REPLACE FUNCTION drip.list_sequences(p_account_id int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(drip._sequence_json(id) ORDER BY display_name), '[]'::jsonb)
  FROM drip.sequences WHERE account_id = p_account_id;
$$;

-- ── save: upsert sequence + atomically replace all steps. Returns saved sequence ──
-- p: { account_id, id?(uuid for edit/null for create), key, display_name, enabled,
--      stop_on_reply, skip_shabbat, quiet_start("HH:MM"|""), quiet_end, steps:[{...}] }
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

  -- Edit existing sequence by id (allows key rename)
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

  -- Create / upsert by (account_id, key)
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

  -- Atomically replace steps
  DELETE FROM drip.sequence_steps WHERE sequence_id = v_id;
  INSERT INTO drip.sequence_steps
    (sequence_id, step_order, template_name, language, category, delay_days, delay_hours, params)
  SELECT v_id,
         COALESCE(nullif(s->>'step_order', '')::int, ord::int),
         s->>'template_name',
         COALESCE(nullif(s->>'language', ''), 'he'),
         COALESCE(nullif(s->>'category', ''), 'MARKETING'),
         COALESCE(nullif(s->>'delay_days', '')::int, 0),
         COALESCE(nullif(s->>'delay_hours', '')::int, 0),
         COALESCE(s->'params', '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(p->'steps', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord)
  WHERE COALESCE(s->>'template_name', '') <> '';

  RETURN drip._sequence_json(v_id);
END;
$$;

-- ── delete: stop active enrollments, then remove sequence (cascade to steps) ──
-- Stopping enrollments first prevents orphaned active rows after the sequence
-- is deleted (sequence_id becomes NULL via ON DELETE SET NULL).
-- p: { account_id, key }
CREATE OR REPLACE FUNCTION drip.delete_sequence(p jsonb) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_acc int  := (p->>'account_id')::int;
  v_key text := p->>'key';
  v_id  uuid;
BEGIN
  SELECT id INTO v_id FROM drip.sequences WHERE account_id = v_acc AND key = v_key;
  IF v_id IS NULL THEN RETURN; END IF;

  -- Stop any active enrollments before deleting the sequence so they never
  -- become orphans (sequence_id would be SET NULL, reconciler would crash).
  UPDATE drip.enrollments
     SET status = 'stopped'
   WHERE sequence_id = v_id AND status = 'active';

  DELETE FROM drip.sequences WHERE id = v_id;
END;
$$;

-- ── list_enrollments: all enrollments for an account (global dashboard view) ──
CREATE OR REPLACE FUNCTION drip.list_enrollments(p_account_id int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.enrolled_at DESC), '[]'::jsonb)
  FROM (
    SELECT en.conversation_id,
           en.phone,
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
    WHERE en.account_id = p_account_id
  ) e;
$$;

-- ── enrollment_status: single-conversation status (sidebar view) ──
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
    'phone',         e.phone
  )
  FROM drip.enrollments e
  JOIN drip.sequences s ON s.id = e.sequence_id
  WHERE e.account_id = p_account_id AND e.conversation_id = p_conversation_id
  LIMIT 1;
$$;
