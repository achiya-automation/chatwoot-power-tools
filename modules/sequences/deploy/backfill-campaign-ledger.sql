-- Backfill of the durable send ledger for a campaign that ran BEFORE the Chatwoot patch
-- started writing it. Set the five \set values below and run with psql -f.
--
-- Such a campaign has no ledger rows, so the report has to infer "was this sent?" from
-- content_attributes.campaign_id on the outgoing message. The panel's retry button wipes
-- that field (messages_controller#retry → update!(content_attributes: {})), so recipients
-- who did receive the template get reported as never attempted, and the ones who genuinely
-- got nothing carry no reason at all.
--
-- First run: campaign 17 (אדמון, 20.07.2026) — audience 285 = 215 delivered/read + 31
-- failed at Meta + 1 failed send request + 39 with no phone. Before the backfill the
-- report showed 45 "not attempted"; five of those had in fact been sent.
--
-- Reconstruction rules:
--   * The campaign message for a contact is the FIRST outgoing agent message carrying a
--     Meta wamid inside the run window. Bot follow-ups only fire after an inbound reply,
--     so they are always later than the campaign message.
--   * Anyone in the audience with no such message and no phone → status 4 / 'no_phone'.
--   * Anyone in the audience with a phone but no message → the send request itself
--     failed → status 3 / 'send_failed'.
--
-- Idempotent: ON CONFLICT DO NOTHING on the audience, DO UPDATE on the sends.

\set campaign_id 17
\set account_id 1
\set tag_id 5
\set run_start '2026-07-20 15:25'
\set run_end   '2026-07-20 16:00'

BEGIN;

WITH audience AS (
  SELECT DISTINCT ct.id AS contact_id, ct.name, ct.phone_number
    FROM public.taggings tg
    JOIN public.contacts ct ON ct.id = tg.taggable_id AND ct.account_id = :account_id
   WHERE tg.tag_id = :tag_id AND tg.taggable_type = 'Contact'
), sent AS (
  SELECT DISTINCT ON (cv.contact_id)
         cv.contact_id, m.id AS message_id, m.conversation_id, m.source_id, m.status,
         (m.content_attributes::jsonb #>> '{}')::jsonb ->> 'external_error' AS error_title,
         m.created_at
    FROM public.messages m
    JOIN public.conversations cv ON cv.id = m.conversation_id
   WHERE m.account_id = :account_id
     AND m.message_type = 1
     AND m.sender_type = 'User'
     AND m.source_id LIKE 'wamid.%'
     AND m.created_at >= :'run_start' AND m.created_at < :'run_end'
   ORDER BY cv.contact_id, m.created_at
)
INSERT INTO drip.campaign_audience_snapshots
  (account_id, campaign_id, contact_id, contact_name, phone, captured_at)
SELECT :account_id, :campaign_id, a.contact_id, coalesce(a.name, ''), coalesce(a.phone_number, ''),
       timestamptz :'run_start'
  FROM audience a
ON CONFLICT (account_id, campaign_id, contact_id) DO NOTHING;

WITH audience AS (
  SELECT DISTINCT ct.id AS contact_id, ct.name, ct.phone_number
    FROM public.taggings tg
    JOIN public.contacts ct ON ct.id = tg.taggable_id AND ct.account_id = :account_id
   WHERE tg.tag_id = :tag_id AND tg.taggable_type = 'Contact'
), sent AS (
  SELECT DISTINCT ON (cv.contact_id)
         cv.contact_id, m.id AS message_id, m.conversation_id, m.source_id, m.status,
         (m.content_attributes::jsonb #>> '{}')::jsonb ->> 'external_error' AS error_title,
         m.created_at
    FROM public.messages m
    JOIN public.conversations cv ON cv.id = m.conversation_id
   WHERE m.account_id = :account_id
     AND m.message_type = 1
     AND m.sender_type = 'User'
     AND m.source_id LIKE 'wamid.%'
     AND m.created_at >= :'run_start' AND m.created_at < :'run_end'
   ORDER BY cv.contact_id, m.created_at
)
INSERT INTO drip.campaign_send_snapshots
  (account_id, campaign_id, contact_id, contact_name, phone, source_id,
   conversation_id, message_id, status, error_title, attempted_at, status_updated_at)
SELECT :account_id, :campaign_id, a.contact_id, coalesce(a.name, ''), coalesce(a.phone_number, ''),
       coalesce(s.source_id, 'skip:' || :campaign_id || ':' || a.contact_id),
       s.conversation_id, s.message_id,
       CASE WHEN s.contact_id IS NOT NULL THEN s.status
            WHEN a.phone_number IS NULL OR a.phone_number = '' THEN 4
            ELSE 3 END,
       CASE WHEN s.contact_id IS NOT NULL THEN s.error_title
            WHEN a.phone_number IS NULL OR a.phone_number = '' THEN 'no_phone'
            ELSE 'send_failed' END,
       coalesce(s.created_at::timestamptz, timestamptz :'run_start'),
       coalesce(s.created_at::timestamptz, timestamptz :'run_start')
  FROM audience a
  LEFT JOIN sent s ON s.contact_id = a.contact_id
ON CONFLICT (account_id, campaign_id, source_id) DO UPDATE
  SET status = EXCLUDED.status,
      error_title = EXCLUDED.error_title,
      conversation_id = coalesce(EXCLUDED.conversation_id, drip.campaign_send_snapshots.conversation_id),
      message_id = coalesce(EXCLUDED.message_id, drip.campaign_send_snapshots.message_id),
      status_updated_at = now();

-- Sanity: audience must equal sent + skipped + failed, with no row left unaccounted for.
SELECT (SELECT count(*) FROM drip.campaign_audience_snapshots
         WHERE account_id = :account_id AND campaign_id = :campaign_id) AS audience,
       count(*) FILTER (WHERE status IN (0,1,2))                        AS sent,
       count(*) FILTER (WHERE status = 3)                               AS failed,
       count(*) FILTER (WHERE status = 4)                               AS skipped,
       count(*)                                                         AS ledger_rows
  FROM drip.campaign_send_snapshots
 WHERE account_id = :account_id AND campaign_id = :campaign_id;

COMMIT;
