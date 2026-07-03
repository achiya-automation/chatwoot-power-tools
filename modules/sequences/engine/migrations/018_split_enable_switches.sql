-- 018_split_enable_switches.sql
-- Split the single `enabled` switch into two INDEPENDENT kill switches, so a sequence can
-- pause new entries and active sends separately (two toggles in the dashboard):
--   enroll_enabled — gate for Phase 1 (ENROLL): when false, NO new contact is added to the
--                    sequence; leads already mid-sequence are unaffected ("stop new entries").
--   send_enabled   — gate for Phase 2 (SEND): when false, leads already enrolled stop
--                    receiving (PAUSE) but keep their place (current_step), so re-enabling
--                    resumes from exactly where they were ("stop messages to active runs").
-- `enabled` is KEPT as a synced derived flag (= enroll_enabled OR send_enabled, "active in
-- some way") so existing UI badges/counters that read it keep working unchanged.

ALTER TABLE drip.sequences
  ADD COLUMN IF NOT EXISTS enroll_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS send_enabled   boolean NOT NULL DEFAULT true;

-- CRITICAL: preserve the CURRENT state. The new columns default to true, but a sequence that
-- is currently disabled (enabled=false — e.g. a paused client) must map to BOTH switches off,
-- or re-running the engine would resume sending. enabled=true → both on. Runs once (tracked
-- in drip.schema_migrations), so this verbatim copy of `enabled` is correct.
UPDATE drip.sequences SET enroll_enabled = enabled, send_enabled = enabled;

-- ── save_sequence: persist the two switches; keep `enabled` synced as their OR ──────────────
-- Back-compat: an older client that still sends only `enabled` maps it to BOTH switches.
CREATE OR REPLACE FUNCTION drip.save_sequence(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_id     uuid;
  v_acc    int     := (p->>'account_id')::int;
  v_key    text    := p->>'key';
  v_qs     time    := nullif(p->>'quiet_start', '')::time;
  v_qe     time    := nullif(p->>'quiet_end',   '')::time;
  v_sk     boolean := COALESCE((p->>'skip_shabbat')::boolean, false);
  -- new switch falls back to the legacy `enabled` field, then to false (new sequence = off)
  v_enroll boolean := COALESCE((p->>'enroll_enabled')::boolean, (p->>'enabled')::boolean, false);
  v_send   boolean := COALESCE((p->>'send_enabled')::boolean,   (p->>'enabled')::boolean, false);
BEGIN
  IF v_acc IS NULL THEN RAISE EXCEPTION 'account_id required'; END IF;
  IF COALESCE(v_key, '') = '' THEN RAISE EXCEPTION 'key required'; END IF;

  IF nullif(p->>'id', '') IS NOT NULL THEN
    UPDATE drip.sequences
       SET key            = v_key,
           display_name   = p->>'display_name',
           enroll_enabled = v_enroll,
           send_enabled   = v_send,
           enabled        = (v_enroll OR v_send),
           stop_on_reply  = COALESCE((p->>'stop_on_reply')::boolean, false),
           skip_shabbat   = v_sk,
           quiet_start    = v_qs,
           quiet_end      = v_qe,
           updated_at     = now()
     WHERE id = (p->>'id')::uuid AND account_id = v_acc
     RETURNING id INTO v_id;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO drip.sequences
      (account_id, key, display_name, enabled, enroll_enabled, send_enabled, stop_on_reply, skip_shabbat, quiet_start, quiet_end)
    VALUES
      (v_acc, v_key, p->>'display_name',
       (v_enroll OR v_send), v_enroll, v_send,
       COALESCE((p->>'stop_on_reply')::boolean, false),
       v_sk, v_qs, v_qe)
    ON CONFLICT (account_id, key) DO UPDATE
      SET display_name   = excluded.display_name,
          enabled        = excluded.enabled,
          enroll_enabled = excluded.enroll_enabled,
          send_enabled   = excluded.send_enabled,
          stop_on_reply  = excluded.stop_on_reply,
          skip_shabbat   = excluded.skip_shabbat,
          quiet_start    = excluded.quiet_start,
          quiet_end      = excluded.quiet_end,
          updated_at     = now()
    RETURNING id INTO v_id;
  END IF;

  DELETE FROM drip.sequence_steps WHERE sequence_id = v_id;
  INSERT INTO drip.sequence_steps
    (sequence_id, step_order, template_name, language, category, delay_days, delay_hours,
     params, media_url, send_hour, send_condition, on_condition_fail,
     send_date, repeat_interval, repeat_unit, allowed_dow)
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
         COALESCE(nullif(s->>'on_condition_fail', ''), 'skip'),
         nullif(s->>'send_date', '')::date,
         nullif(s->>'repeat_interval', '')::int,
         nullif(s->>'repeat_unit', ''),
         CASE WHEN jsonb_typeof(s->'allowed_dow') = 'array'
                   AND jsonb_array_length(s->'allowed_dow') > 0
              THEN ARRAY(SELECT jsonb_array_elements_text(s->'allowed_dow')::int)
              ELSE NULL END
  FROM jsonb_array_elements(COALESCE(p->'steps', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord)
  WHERE COALESCE(s->>'template_name', '') <> '';

  RETURN drip._sequence_json(v_id);
END;
$function$;

-- ── _sequence_json: surface the two switches back to the editor ─────────────────────────────
CREATE OR REPLACE FUNCTION drip._sequence_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  SELECT to_jsonb(seq) || jsonb_build_object('steps', COALESCE(st.steps, '[]'::jsonb))
  FROM (
    SELECT id, account_id, key, display_name, enabled, enroll_enabled, send_enabled,
           stop_on_reply, skip_shabbat,
           to_char(quiet_start, 'HH24:MI') AS quiet_start,
           to_char(quiet_end,   'HH24:MI') AS quiet_end
    FROM drip.sequences WHERE id = p_id
  ) seq
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.step_order) AS steps
    FROM (
      SELECT id, step_order, template_name, language, category,
             delay_days, delay_hours, params, media_url, send_hour,
             send_condition, on_condition_fail,
             to_char(send_date, 'YYYY-MM-DD') AS send_date,
             repeat_interval, repeat_unit, allowed_dow
      FROM drip.sequence_steps WHERE sequence_id = p_id
    ) s
  ) st ON true;
$function$;
-- list_sequences is unchanged: it already calls _sequence_json (above), so the two new
-- switches ride along automatically.
