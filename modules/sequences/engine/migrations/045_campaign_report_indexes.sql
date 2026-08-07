-- Campaign report performance: stop scanning every message in the account.
--
-- The campaign list / trend / tier / detail queries all look for messages tagged with a
-- campaign_id inside content_attributes — a DOUBLE-ENCODED json string (see the caObj()
-- comment in src/campaigns.js). Without an index each of those queries is a sequential
-- scan of public.messages with a double JSON parse per row, and the dashboard fires
-- several of them per page view. That is exactly what made the panel crawl while a
-- campaign was running: the same table was being flooded with inserts at scan time.
--
-- A partial expression index keeps ONLY campaign-tagged messages (a tiny fraction of the
-- table). account_id first serves the per-account aggregate scans; the extracted numeric
-- campaign_id serves campaign_detail's equality lookup. The WHERE clause is VERBATIM the
-- guard expression the queries use — a partial index is only chosen when the planner can
-- prove the query's predicate implies the index's, and identical text is the reliable way.
--
-- ⚠️ Plain CREATE INDEX (migrations run inside a transaction, so CONCURRENTLY is not an
-- option): the build takes a lock that blocks writes to public.messages for its duration
-- (one scan of the table). Deploy at a quiet moment, not mid-campaign.

CREATE INDEX IF NOT EXISTS drip_messages_campaign_id_idx
  ON public.messages (
    account_id,
    ((((content_attributes::jsonb #>> '{}')::jsonb ->> 'campaign_id')::int))
  )
  WHERE ((content_attributes::jsonb #>> '{}')::jsonb ->> 'campaign_id') ~ '^[0-9]+$';

-- Campaign resend writes retry attempts to the send ledger from the engine process.
-- The engine normally connects as the same role that owns the schema (CWPT_DATABASE_URL),
-- but a hardened deployment runs it as drip_engine — grant the writes it needs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
    GRANT SELECT, INSERT, UPDATE ON drip.campaign_send_snapshots TO drip_engine;
  END IF;
END $$;
