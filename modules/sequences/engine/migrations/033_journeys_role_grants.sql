-- 033_journeys_role_grants.sql — דורש owner/superuser. migrate.js מדווח עליו כ-pending;
-- install.sh ו-sync-servers.sh מחילים אותו באופן אידמפוטנטי ורושמים אותו ב-ledger.
--
-- למה SECURITY DEFINER: הפלואו צריך אירועי זמן-אמת מ-Chatwoot. הדרך הנקייה היא שורת
-- webhook חשבונית ב-public.webhooks — אבל ל-drip_engine אין (ולא צריך להיות) INSERT על
-- public. הפונקציה הזו היא השער הצר: היא רושמת webhook אחד בדיוק, ל-URL שהמנוע מוסר,
-- אידמפוטנטית לפי (account_id, url), עם מנויים מצומצמים לשני האירועים שהפלואו צורך.
--
-- הסוד לא נשמר פה — הוא חלק מנתיב ה-URL (כמו NOTIFY_WEBHOOK_URL: "הנתיב הוא הסוד").

CREATE OR REPLACE FUNCTION drip.ensure_journey_webhook(p_account_id integer, p_url text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, drip, pg_temp
AS $$
BEGIN
  IF COALESCE(p_url, '') = '' THEN
    RAISE WARNING 'drip.ensure_journey_webhook: empty url for account %', p_account_id;
    RETURN false;
  END IF;
  -- 🔒 p_url is caller-supplied and this function is SECURITY DEFINER, so a compromised engine
  -- could otherwise register a webhook to an ATTACKER URL and exfiltrate a tenant's events via
  -- Chatwoot's own dispatcher. Constrain it to exactly the journeys-hook shape: http(s), and a
  -- path of /drip-api/journey-hook/<hex-token>. This blocks arbitrary collector URLs/paths.
  IF p_url !~ '^https?://[A-Za-z0-9._:-]+/drip-api/journey-hook/[a-f0-9]{16,}$' THEN
    RAISE WARNING 'drip.ensure_journey_webhook: url % is not a valid journey-hook url', p_url;
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id) THEN
    RAISE WARNING 'drip.ensure_journey_webhook: account % does not exist', p_account_id;
    RETURN false;
  END IF;

  -- REPLACE, not add: remove any prior journeys webhook for this account first, so a call with a
  -- different URL can't leave a second, silent copy running alongside the legitimate one.
  DELETE FROM public.webhooks
   WHERE account_id = p_account_id
     AND name = 'בונה פלואו — אירועי זמן-אמת'
     AND url IS DISTINCT FROM p_url;

  INSERT INTO public.webhooks (account_id, url, webhook_type, subscriptions, name, created_at, updated_at)
  VALUES (p_account_id, p_url, 0,
          '["message_created", "conversation_created"]'::jsonb,
          'בונה פלואו — אירועי זמן-אמת', now(), now())
  ON CONFLICT (account_id, url) DO NOTHING;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION drip.ensure_journey_webhook(integer, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION drip.ensure_journey_webhook(integer, text) TO drip_engine';
  END IF;
END $$;

COMMENT ON FUNCTION drip.ensure_journey_webhook(integer, text) IS
  'רושם webhook חשבוני לאירועי הפלואו (message_created/conversation_created). אידמפוטנטי לפי (account_id, url).';
