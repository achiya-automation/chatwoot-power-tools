-- Fills in the reason for recipients that have an audience snapshot but NO send row.
--
-- Campaigns that ran while the patch captured the audience and logged successful sends,
-- but still returned silently on a skip, leave those recipients in the audience with no
-- ledger row at all — the report shows them as "not attempted" with no explanation.
--
-- A missing send row is conclusive: snapshot_campaign_send runs BEFORE any Chatwoot
-- conversation work, so every accepted Meta send has a row. No row therefore means the
-- send was never accepted:
--   * no phone on the contact  → status 4 (skipped, no attempt was made)
--   * a phone but still no row → status 3 (the send request itself failed)
--
-- Safe to re-run: only inserts rows that are absent, and never touches existing ones.
--
-- Pass both ids on the command line — deliberately NOT \set here, because a \set in the
-- file silently overrides -v and every campaign you "loop over" runs against the hardcoded
-- one instead:
--   psql -v account_id=10 -v campaign_id=31 -f backfill-missing-ledger-reasons.sql

BEGIN;

INSERT INTO drip.campaign_send_snapshots
  (account_id, campaign_id, contact_id, contact_name, phone, source_id,
   status, error_title, attempted_at, status_updated_at)
SELECT a.account_id, a.campaign_id, a.contact_id, a.contact_name, a.phone,
       'skip:' || a.campaign_id || ':' || a.contact_id,
       CASE WHEN coalesce(a.phone, '') = '' THEN 4 ELSE 3 END,
       CASE WHEN coalesce(a.phone, '') = '' THEN 'no_phone' ELSE 'send_failed' END,
       a.captured_at, a.captured_at
  FROM drip.campaign_audience_snapshots a
 WHERE a.account_id = :account_id
   AND a.campaign_id = :campaign_id
   AND NOT EXISTS (
     SELECT 1 FROM drip.campaign_send_snapshots s
      WHERE s.account_id = a.account_id
        AND s.campaign_id = a.campaign_id
        AND s.contact_id = a.contact_id
   )
ON CONFLICT (account_id, campaign_id, source_id) DO NOTHING;

SELECT (SELECT count(*) FROM drip.campaign_audience_snapshots
         WHERE account_id = :account_id AND campaign_id = :campaign_id) AS audience,
       count(*) FILTER (WHERE status IN (0,1,2)) AS sent,
       count(*) FILTER (WHERE status = 3)        AS failed,
       count(*) FILTER (WHERE status = 4)        AS skipped,
       count(*)                                  AS ledger_rows
  FROM drip.campaign_send_snapshots
 WHERE account_id = :account_id AND campaign_id = :campaign_id;

COMMIT;
