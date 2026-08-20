-- 051: קריאת טבלת הנמענים המקורית של Chatwoot 4.17 (native-first, 20.8.26).
-- כל שאילתות הסקירה/הדוח במנוע קוראות את public.campaign_recipients כשקיימת —
-- בלי ה-GRANT הזה הפאנל נופל על permission denied ברגע שקמפיין ראשון רץ בצינור החדש.
--
-- קובץ בשם *role_grants* מדולג בכוונה ע"י מיגרציות המנוע (migrate.js — המנוע רץ
-- כ-drip_engine ואינו בעלים של טבלאות public). מורץ ידנית ע"י בעלים/superuser:
--   docker exec -i chatwoot-postgres-1 psql -U chatwoot -d chatwoot \
--     < modules/sequences/engine/migrations/051_campaign_recipients_role_grants.sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
    GRANT SELECT ON public.campaign_recipients TO drip_engine;
  END IF;
END $$;
