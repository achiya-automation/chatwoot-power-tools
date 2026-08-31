-- 054: קריאת חברות המשתמש העדכנית לצורך אימות גישת מובייל.
--
-- כרטיס/עוגיית המובייל מוכיחים רק ש-Chatwoot הנפיק אותם בעבר. לפני כל קבלה שלהם
-- המנוע בודק מחדש את public.account_users, כדי שמשתמש שהוסר מחשבון יאבד גישה גם
-- אם הכרטיס החתום שלו טרם פג. המנוע רץ כ-drip_engine ואינו בעלים של טבלת Chatwoot,
-- ולכן המתקין מחיל את הקובץ הזה כבעלים ורושם אותו ב-drip.schema_migrations.
DO $$
BEGIN
  IF to_regclass('public.account_users') IS NULL THEN
    RAISE EXCEPTION 'Chatwoot schema is missing public.account_users (complete Chatwoot migrations before installing)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
    GRANT SELECT ON public.account_users TO drip_engine;
  END IF;
END $$;
