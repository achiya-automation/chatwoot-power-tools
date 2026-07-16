-- Immutable per-attempt ledger for WhatsApp one-off campaigns.
--
-- Chatwoot can create an outgoing-echo message without the custom campaign_id metadata, and
-- message rows are not a durable delivery ledger. The Meta message id is stable, so keep one
-- row per accepted send and update its delivery state as webhooks arrive.

CREATE TABLE IF NOT EXISTS drip.campaign_send_snapshots (
  account_id        bigint      NOT NULL,
  campaign_id       bigint      NOT NULL,
  contact_id        bigint,
  contact_name      text,
  phone             text,
  source_id         text        NOT NULL,
  conversation_id   bigint,
  message_id        bigint,
  status            integer     NOT NULL DEFAULT 0,
  error_title       text,
  attempted_at      timestamptz NOT NULL DEFAULT now(),
  status_updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, campaign_id, source_id)
);

CREATE INDEX IF NOT EXISTS campaign_send_snapshots_campaign_idx
  ON drip.campaign_send_snapshots (account_id, campaign_id, attempted_at);

CREATE INDEX IF NOT EXISTS campaign_send_snapshots_source_idx
  ON drip.campaign_send_snapshots (account_id, source_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
    GRANT SELECT ON drip.campaign_send_snapshots TO drip_engine;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chatwoot') THEN
    GRANT SELECT, INSERT, UPDATE ON drip.campaign_send_snapshots TO chatwoot;
  END IF;
END $$;
