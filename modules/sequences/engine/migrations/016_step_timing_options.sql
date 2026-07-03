-- 016_step_timing_options.sql
-- Richer per-step timing for the "smart timing picker":
--   send_date       — absolute calendar date (broadcast-style): send this step ON this date
--                     (at send_hour, Jerusalem) instead of a relative delay. NULL = relative.
--   repeat_interval — recurring cadence count (e.g. 1). NULL = one-shot (current behaviour).
--   repeat_unit     — 'day' | 'week' | 'month'. With repeat_interval, the step re-arms itself
--                     every interval after each send (the enrollment never "completes" past it).
--   allowed_dow     — preferred days-of-week (JS getDay: 0=Sun .. 6=Sat). When set and partial,
--                     the computed time is shifted FORWARD to the nearest allowed day. NULL/full = any day.
-- send_hour (migration 010) already snaps to an exact Jerusalem hour and stays unchanged.

ALTER TABLE drip.sequence_steps
  ADD COLUMN IF NOT EXISTS send_date       date,
  ADD COLUMN IF NOT EXISTS repeat_interval int,
  ADD COLUMN IF NOT EXISTS repeat_unit     text,
  ADD COLUMN IF NOT EXISTS allowed_dow     int[];

-- ── save_sequence: persist the 4 new step fields ────────────────────────────────
CREATE OR REPLACE FUNCTION drip.save_sequence(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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

-- ── _sequence_json: surface the 4 new step fields back to the editor ────────────
CREATE OR REPLACE FUNCTION drip._sequence_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
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
             send_condition, on_condition_fail,
             to_char(send_date, 'YYYY-MM-DD') AS send_date,
             repeat_interval, repeat_unit, allowed_dow
      FROM drip.sequence_steps WHERE sequence_id = p_id
    ) s
  ) st ON true;
$function$;
