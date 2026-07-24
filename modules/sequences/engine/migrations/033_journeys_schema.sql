-- 033_journeys_schema.sql — בונה פלואו (journeys): גרף שיחה ויזואלי בסגנון ManyChat.
--
-- journeys      — הגדרת פלואו: טריגר (תיבות/מילות מפתח/ידני) + גרף צמתים (jsonb).
-- journey_runs  — ריצה חיה של פלואו על שיחה אחת: הצומת הנוכחי, תשובות שנאספו,
--                 תזמון הפעולה הבאה (השהיות/פולואפים) ו-watermark לדדופ הודעות.
--
-- הגרף נשמר כ-jsonb אחד (nodes+edges) ולא כטבלאות מנורמלות — העורך תמיד טוען ושומר
-- את הגרף בשלמותו, והמנוע קורא אותו לזיכרון פעם אחת לריצה. ולידציה בצד המנוע.

CREATE TABLE IF NOT EXISTS drip.journeys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  int  NOT NULL,
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'draft',              -- draft | active | paused
  trigger     jsonb NOT NULL DEFAULT '{}'::jsonb,          -- {inbox_ids:[],keywords:[],on_new_conversation:bool,manual:bool}
  graph       jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journeys_account ON drip.journeys(account_id, status);

CREATE TABLE IF NOT EXISTS drip.journey_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id               uuid NOT NULL REFERENCES drip.journeys(id) ON DELETE CASCADE,
  account_id               int    NOT NULL,
  display_id               bigint NOT NULL,                -- מזהה השיחה ב-API/webhook (display_id)
  contact_id               bigint,
  status                   text NOT NULL DEFAULT 'active', -- active|waiting_answer|waiting_delay|done|stopped|human_handled|failed
  current_node             text,
  answers                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  retry_count              int NOT NULL DEFAULT 0,         -- תזכורות שנשלחו לצומת הממתין הנוכחי
  waiting_since            timestamptz,
  next_action_at           timestamptz,
  last_inbound_message_id  bigint NOT NULL DEFAULT 0,      -- דדופ: הודעה נכנסת מעובדת פעם אחת
  last_error               text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journey_runs_due  ON drip.journey_runs(status, next_action_at);
CREATE INDEX IF NOT EXISTS idx_journey_runs_conv ON drip.journey_runs(account_id, display_id);
-- ריצה חיה אחת לכל שיחה — מונע שני פלואו שמדברים בערבוביה באותה שיחה.
CREATE UNIQUE INDEX IF NOT EXISTS uq_journey_runs_live ON drip.journey_runs(account_id, display_id)
  WHERE status IN ('active', 'waiting_answer', 'waiting_delay');

-- ── CRUD בדפוס ה-RPC של הרצפים (save_sequence) ──

-- account-scoped: callers always pass their validated account_id, so a leaked/guessed
-- journey UUID alone can't read another tenant's flow.
CREATE OR REPLACE FUNCTION drip._journey_json(p_id uuid, p_account int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(j) FROM (
    SELECT id, account_id, name, status, trigger, graph, created_at, updated_at
    FROM drip.journeys WHERE id = p_id AND account_id = p_account
  ) j;
$$;

CREATE OR REPLACE FUNCTION drip.save_journey(p jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_id  uuid;
  v_acc int := (p->>'account_id')::int;
BEGIN
  IF v_acc IS NULL THEN RAISE EXCEPTION 'account_id required'; END IF;
  IF COALESCE(p->>'name', '') = '' THEN RAISE EXCEPTION 'name required'; END IF;

  IF nullif(p->>'id', '') IS NOT NULL THEN
    UPDATE drip.journeys
       SET name       = p->>'name',
           trigger    = COALESCE(p->'trigger', trigger),
           graph      = COALESCE(p->'graph', graph),
           status     = COALESCE(nullif(p->>'status', ''), status),
           updated_at = now()
     WHERE id = (p->>'id')::uuid AND account_id = v_acc
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'journey not found'; END IF;
  ELSE
    INSERT INTO drip.journeys (account_id, name, trigger, graph, status)
    VALUES (v_acc, p->>'name',
            COALESCE(p->'trigger', '{}'::jsonb),
            COALESCE(p->'graph', '{"nodes":[],"edges":[]}'::jsonb),
            COALESCE(nullif(p->>'status', ''), 'draft'))
    RETURNING id INTO v_id;
  END IF;

  RETURN drip._journey_json(v_id, v_acc);
END;
$$;

CREATE OR REPLACE FUNCTION drip.list_journeys(p_account int) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(j ORDER BY j.updated_at DESC), '[]'::jsonb)
  FROM (
    SELECT jo.id, jo.account_id, jo.name, jo.status, jo.trigger, jo.updated_at,
           jsonb_array_length(COALESCE(jo.graph->'nodes', '[]'::jsonb)) AS node_count,
           (SELECT count(*) FROM drip.journey_runs r
             WHERE r.journey_id = jo.id
               AND r.status IN ('active','waiting_answer','waiting_delay')) AS live_runs,
           (SELECT count(*) FROM drip.journey_runs r
             WHERE r.journey_id = jo.id AND r.status = 'done') AS done_runs
    FROM drip.journeys jo WHERE jo.account_id = p_account
  ) j;
$$;

CREATE OR REPLACE FUNCTION drip.delete_journey(p_account int, p_id uuid) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM drip.journeys WHERE id = p_id AND account_id = p_account;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION drip.set_journey_status(p_account int, p_id uuid, p_status text) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF p_status NOT IN ('draft', 'active', 'paused') THEN
    RAISE EXCEPTION 'invalid status %', p_status;
  END IF;
  UPDATE drip.journeys SET status = p_status, updated_at = now()
   WHERE id = p_id AND account_id = p_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'journey not found'; END IF;
  -- השהיה עוצרת גם ריצות חיות — בלי לגעת בהיסטוריה.
  IF p_status = 'paused' THEN
    UPDATE drip.journey_runs SET status = 'stopped', updated_at = now()
     WHERE journey_id = p_id AND status IN ('active','waiting_answer','waiting_delay');
  END IF;
  RETURN drip._journey_json(p_id, p_account);
END;
$$;

-- 🔒 least-privilege: these RPCs are for the engine role only. Without an explicit REVOKE,
-- Postgres grants EXECUTE to PUBLIC on creation, so any role with USAGE on schema drip
-- (e.g. the chatwoot app role) could call them directly for any account_id.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'drip._journey_json(uuid, int)', 'drip.save_journey(jsonb)', 'drip.list_journeys(int)',
    'drip.delete_journey(int, uuid)', 'drip.set_journey_status(int, uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO drip_engine', fn);
    END IF;
  END LOOP;
END $$;
