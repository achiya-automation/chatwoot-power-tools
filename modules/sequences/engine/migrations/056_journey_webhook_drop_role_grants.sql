-- 056_journey_webhook_drop_role_grants.sql — requires owner/superuser, like 033.
--
-- The counterpart of drip.ensure_journey_webhook. reconcileJourneys refreshed the account's
-- journeys webhook only while the account had an active flow, so an account whose flows were
-- all paused kept its old row forever. After the hook secret was rotated that row pointed at a
-- dead token, and Chatwoot queued a WebhookJob that failed with 404 on every single event.
-- The engine now calls this when an account has no active flow, so no stale row survives.
-- Same narrow gate as 033: only this feature's rows (by name and URL shape), one account.

CREATE OR REPLACE FUNCTION drip.drop_journey_webhook(p_account_id integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, drip, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.webhooks
   WHERE account_id = p_account_id
     AND name = 'בונה פלואו — אירועי זמן-אמת'
     AND url ~ '/drip-api/journey-hook/[a-f0-9]{16,}$';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION drip.drop_journey_webhook(integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION drip.drop_journey_webhook(integer) TO drip_engine';
  END IF;
END $$;

COMMENT ON FUNCTION drip.drop_journey_webhook(integer) IS
  'Removes the account journeys webhook (message_created/conversation_created) when it has no active flow.';
