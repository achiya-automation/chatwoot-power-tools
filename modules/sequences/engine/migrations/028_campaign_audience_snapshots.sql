-- Immutable audience snapshot for accurate historical WhatsApp campaign reports.
--
-- Chatwoot stores only the label ids on campaigns. Label membership can change after a send,
-- and imported contacts may be represented by a second channel-bound Contact record. Capturing
-- the original contact id/name/phone before processing gives reports a stable source of truth.

CREATE TABLE IF NOT EXISTS drip.campaign_audience_snapshots (
  account_id   bigint      NOT NULL,
  campaign_id  bigint      NOT NULL,
  contact_id   bigint      NOT NULL,
  contact_name text,
  phone        text,
  captured_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS campaign_audience_snapshots_campaign_idx
  ON drip.campaign_audience_snapshots (account_id, campaign_id);

-- The engine owns/reads the table. Chatwoot's Rails/Sidekiq role writes the snapshot immediately
-- before campaign processing. Keep the migration portable for installations using another role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
    GRANT SELECT ON drip.campaign_audience_snapshots TO drip_engine;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chatwoot') THEN
    GRANT SELECT, INSERT, UPDATE ON drip.campaign_audience_snapshots TO chatwoot;
  END IF;
END $$;
