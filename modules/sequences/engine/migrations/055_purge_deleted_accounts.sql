-- מחיקת חשבון ב-Chatwoot לא נוגעת בסכימת drip: כל טבלה כאן נושאת account_id משלה ואין
-- בינה לבין public.accounts שום מפתח זר (סכימה נפרדת, בעלות נפרדת, ומחיקת החשבון נעשית
-- בקוד של Chatwoot). התוצאה שנמדדה בייצור ב-4.9.2026: 45,564 שורות עם 23,746 מספרי טלפון
-- ו-45,564 שמות של אנשי קשר, ששייכות לשלושה חשבונות שכבר אינם קיימים. זו לא בעיית מקום —
-- זה מידע אישי של לקוחות שהיה אמור להימחק יחד עם החשבון (תיקון 13, וה-DPA מול הלקוח).
--
-- שתי פונקציות ולא רשימת טבלאות קשיחה: רשימה קשיחה היא בדיוק מה שקפא כבר פעמיים בפרויקט
-- הזה (רשימת המודולים ב-watchdog). כאן הן נגזרות מ-information_schema, כך שטבלת drip
-- חדשה עם account_id מכוסה ביום שהיא נוצרת.

-- כמה שורות שייכות לחשבונות שכבר אינם קיימים, לפי טבלה. קריאה בלבד.
CREATE OR REPLACE FUNCTION drip.deleted_account_footprint()
RETURNS TABLE(tbl text, rows_left bigint)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  r record;
  n bigint;
BEGIN
  FOR r IN
    SELECT DISTINCT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'drip'
       AND c.column_name = 'account_id'
       AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM drip.%I s WHERE NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = s.account_id)',
      r.table_name
    ) INTO n;
    IF n > 0 THEN
      tbl := r.table_name;
      rows_left := n;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- מוחקת את אותן שורות בדיוק. מחזירה מה נמחק, לפי טבלה.
-- ⚠️ בלתי הפיכה. להריץ במודע:  SELECT * FROM drip.purge_deleted_accounts();
CREATE OR REPLACE FUNCTION drip.purge_deleted_accounts()
RETURNS TABLE(tbl text, rows_deleted bigint)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  r record;
  n bigint;
BEGIN
  FOR r IN
    SELECT DISTINCT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'drip'
       AND c.column_name = 'account_id'
       AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'DELETE FROM drip.%I s WHERE NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = s.account_id)',
      r.table_name
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      tbl := r.table_name;
      rows_deleted := n;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;
