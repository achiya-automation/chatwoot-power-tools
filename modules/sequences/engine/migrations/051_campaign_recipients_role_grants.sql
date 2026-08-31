-- 051: קריאת טבלת הנמענים המקורית של Chatwoot 4.17 (native-first, 20.8.26).
-- כל שאילתות הסקירה/הדוח במנוע קוראות את public.campaign_recipients כשקיימת —
-- בלי ה-GRANT הזה הפאנל נופל על permission denied ברגע שקמפיין ראשון רץ בצינור החדש.
--
-- המנוע רץ כ-drip_engine ואינו בעלים של טבלאות public, לכן migrate.js מדווח על הקובץ
-- כ-pending. install.sh ו-sync-servers.sh מחילים אותו כבעלים ורושמים אותו ב-ledger;
-- אם טבלת 4.17 חסרה, המיגרציה נכשלת ולא נרשמת כהצלחה.
DO $$
BEGIN
  IF to_regclass('public.campaign_recipients') IS NULL THEN
    RAISE EXCEPTION 'Chatwoot schema is missing public.campaign_recipients (requires Chatwoot >= 4.17.1 with migrations complete)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
    EXECUTE 'GRANT SELECT ON public.campaign_recipients TO drip_engine';
  END IF;
END $$;
