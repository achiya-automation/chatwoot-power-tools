-- 053: הרשאת הקריאה המזערית הדרושה לשער "רק שיחת בוט" של presence.
--
-- קובץ בשם *role_grants* מדולג בכוונה על ידי migrate.js: המנוע רץ כ-drip_engine
-- ואינו בעלים של טבלאות Chatwoot. יש להריץ את הקובץ כבעלים/superuser בפריסה,
-- ואילו התקנות חדשות מקבלות את אותה הרשאה אוטומטית דרך lib/db.sh.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine')
     AND to_regclass('public.agent_bot_inboxes') IS NOT NULL THEN
    GRANT SELECT ON public.agent_bot_inboxes TO drip_engine;
  END IF;
END $$;
