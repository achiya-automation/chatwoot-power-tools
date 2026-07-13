-- הצטרפות אוטומטית של חשבון חדש.
--
-- הבעיה שזה פותר: לולאת המנוע רצה רק על חשבונות שרשומים ב-drip.account_tokens, והרישום
-- היה ידני. חשבון חדש עם רצף מוגדר היטב פשוט **לא שולח כלום — ובלי שגיאה**. זו התקלה
-- הכי גרועה שיש: היא שקטה, והיא נראית בדיוק כמו "אין לידים בשלים".
--
-- למה SECURITY DEFINER ולא GRANT ישיר: המנוע צריך רק *יכולת אחת* — להקים לעצמו AgentBot
-- בחשבון שכבר יש בו רצף. GRANT INSERT על public.access_tokens היה נותן לו להנפיק טוקני API
-- לכל דבר. הפונקציה הזו היא השער הצר: היא בודקת שהחשבון קיים, מקימה בוט אחד בדיוק,
-- ואידמפוטנטית לחלוטין.
--
-- הטוקן עצמו לעולם לא חוזר לקורא — הוא נכתב ישירות ל-drip.account_tokens.

CREATE OR REPLACE FUNCTION drip.ensure_account_bot(p_account_id integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, drip, pg_temp
AS $$
DECLARE
  v_bot_id   bigint;
  v_token    text;
  v_base_url text;
BEGIN
  -- כבר רשום? אין מה לעשות.
  IF EXISTS (SELECT 1 FROM drip.account_tokens WHERE account_id = p_account_id) THEN
    RETURN false;
  END IF;

  -- חשבון שלא קיים — לא ממציאים לו בוט.
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id) THEN
    RAISE WARNING 'drip.ensure_account_bot: account % does not exist', p_account_id;
    RETURN false;
  END IF;

  -- בוט קיים לחשבון הזה (למשל מהתקנה קודמת) — משתמשים בו במקום להקים כפול.
  SELECT ab.id INTO v_bot_id
    FROM public.agent_bots ab
   WHERE ab.account_id = p_account_id AND ab.name = '🤖 רצפי הודעות'
   LIMIT 1;

  IF v_bot_id IS NULL THEN
    INSERT INTO public.agent_bots (name, description, account_id, bot_type, bot_config, created_at, updated_at)
    VALUES ('🤖 רצפי הודעות', 'מנוע רצפי ההודעות — נוצר אוטומטית', p_account_id, 0, '{}'::jsonb, now(), now())
    RETURNING id INTO v_bot_id;
  END IF;

  SELECT at.token INTO v_token
    FROM public.access_tokens at
   WHERE at.owner_type = 'AgentBot' AND at.owner_id = v_bot_id
   LIMIT 1;

  IF v_token IS NULL THEN
    -- 24 תווים, כמו שהטוקנים הקיימים של Chatwoot נראים. הוא נבדק בחיפוש מחרוזת פשוט,
    -- אז כל מחרוזת ייחודית עובדת — אבל נשארים בפורמט כדי לא להפתיע כלי-עזר.
    v_token := translate(encode(gen_random_bytes(18), 'base64'), '+/=', 'xyz');
    v_token := substr(v_token, 1, 24);
    INSERT INTO public.access_tokens (owner_type, owner_id, token, created_at, updated_at)
    VALUES ('AgentBot', v_bot_id, v_token, now(), now());
  END IF;

  -- ה-base_url של החשבונות הקיימים. ברירת מחדל: השם הפנימי של Rails ברשת של Docker.
  SELECT base_url INTO v_base_url FROM drip.account_tokens LIMIT 1;

  INSERT INTO drip.account_tokens (account_id, chatwoot_token, base_url)
  VALUES (p_account_id, v_token, COALESCE(v_base_url, 'http://rails:3000'))
  ON CONFLICT (account_id) DO NOTHING;

  RAISE NOTICE 'drip.ensure_account_bot: חשבון % חובר אוטומטית (bot %)', p_account_id, v_bot_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION drip.ensure_account_bot(integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drip_engine') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION drip.ensure_account_bot(integer) TO drip_engine';
  END IF;
END $$;

COMMENT ON FUNCTION drip.ensure_account_bot(integer) IS
  'מחבר חשבון חדש למנוע: מקים AgentBot + טוקן ורושם ב-drip.account_tokens. אידמפוטנטי. הטוקן לא חוזר לקורא.';
