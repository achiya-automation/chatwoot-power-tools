-- 031: template studio audit log — who did what on which WABA, when.
-- Also drives the pending-status poll (recent-writes window). Meta is the source
-- of truth for template state; this table only records actions taken from the UI.
CREATE TABLE IF NOT EXISTS drip.template_audit (
  id bigserial PRIMARY KEY,
  account_id int NOT NULL,
  actor_uid text,
  actor_name text,
  action text NOT NULL CHECK (action IN ('create','edit','delete')),
  waba_id text NOT NULL,
  template_name text NOT NULL,
  template_language text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS template_audit_waba_recent
  ON drip.template_audit (waba_id, created_at DESC);
