-- External journey intake receipts.
--
-- Make may retry a Facebook Lead Ads execution, and an HTTP timeout can happen after the
-- WhatsApp template was already accepted. A permanent unique receipt gives this entry point
-- at-most-once semantics across retries, process restarts and completed journey runs.

CREATE TABLE IF NOT EXISTS drip.journey_intakes (
  account_id   integer     NOT NULL,
  journey_id   uuid        NOT NULL REFERENCES drip.journeys(id) ON DELETE CASCADE,
  source       text        NOT NULL,
  external_id  text        NOT NULL,
  status       text        NOT NULL DEFAULT 'processing', -- processing | started | failed
  attempt_id   uuid,
  lease_until  timestamptz,
  contact_id   bigint,
  display_id   bigint,
  run_id       uuid        REFERENCES drip.journey_runs(id) ON DELETE SET NULL,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, journey_id, source, external_id),
  CONSTRAINT journey_intakes_status_valid CHECK (status IN ('processing', 'started', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_journey_intakes_lease
  ON drip.journey_intakes(status, lease_until)
  WHERE status = 'processing';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
    GRANT SELECT, INSERT, UPDATE ON drip.journey_intakes TO drip_engine;
  END IF;
END $$;
