-- בחירת מספר הוואטסאפ שהמנוע עובד מולו.
--
-- לחשבון Chatwoot אחד יכולים להיות כמה ערוצי וואטסאפ (לאחיה יש שלושה). עד היום המנוע
-- בחר לבד — ובשלוש נקודות שונות, כל אחת בשיטה אחרת:
--   reads.getWhatsappCreds  → ORDER BY i.id LIMIT 1   (המספר עם ה-id הנמוך)
--   reads.loadTemplates     → כל התיבות יחד           (תבניות ממספרים שונים מעורבבות!)
--   reconcile (פתיחת שיחה)  → ORDER BY ci.id LIMIT 1  (המספר שהליד במקרה מקושר אליו)
--
-- כלומר הבריאות נקראה ממספר אחד, התבניות מכולם, וההודעה נשלחה ממספר שלישי. NULL נשאר
-- תקף ומשמעו "יש בדיוק תיבת וואטסאפ אחת — קח אותה", כדי שחשבון עם מספר יחיד לא יידרש
-- להגדיר כלום. כשיש יותר מאחת ולא נבחרה — המנוע נעצר ומתריע, ולא מנחש.
ALTER TABLE drip.account_tokens
  ADD COLUMN IF NOT EXISTS inbox_id integer;

COMMENT ON COLUMN drip.account_tokens.inbox_id IS
  'תיבת הוואטסאפ (public.inboxes.id) שהמנוע שולח דרכה. NULL = תיבה יחידה, בחירה אוטומטית. יותר מאחת ו-NULL = עצירה + התראה.';

-- מספרי הוואטסאפ של החשבון, ומי מהם נבחר. `needs_choice` הוא מה שהפאנל מדגיש באדום.
CREATE OR REPLACE FUNCTION drip.whatsapp_inboxes(p_account_id integer)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  WITH boxes AS (
    SELECT i.id,
           i.name,
           cw.provider_config->>'phone_number_id' AS phone_number_id,
           (i.id = t.inbox_id)                    AS chosen
      FROM public.inboxes i
      JOIN public.channel_whatsapp cw ON cw.id = i.channel_id
      LEFT JOIN drip.account_tokens t ON t.account_id = i.account_id
     WHERE i.account_id = p_account_id AND i.channel_type = 'Channel::Whatsapp'
     ORDER BY i.id)
  SELECT jsonb_build_object(
    'inboxes', COALESCE(jsonb_agg(to_jsonb(boxes)), '[]'::jsonb),
    'count',   count(*),
    -- יותר מתיבה אחת ואף אחת לא נבחרה ⇒ המנוע עוצר. זה הדגל שהפאנל צועק עליו.
    'needs_choice', count(*) > 1 AND count(*) FILTER (WHERE chosen) = 0
  ) FROM boxes;
$$;

-- בחירת התיבה. NULL מנקה את הבחירה (חוזר להתנהגות "תיבה יחידה").
CREATE OR REPLACE FUNCTION drip.set_whatsapp_inbox(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_account_id integer := (p->>'account_id')::integer;
  v_inbox_id   integer := NULLIF(p->>'inbox_id', '')::integer;
BEGIN
  -- לא נותנים לבחור תיבה של חשבון אחר, ולא תיבה שאינה וואטסאפ.
  IF v_inbox_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.inboxes i
        WHERE i.id = v_inbox_id AND i.account_id = v_account_id
          AND i.channel_type = 'Channel::Whatsapp') THEN
    RAISE EXCEPTION 'inbox % is not a WhatsApp inbox of account %', v_inbox_id, v_account_id;
  END IF;

  UPDATE drip.account_tokens SET inbox_id = v_inbox_id WHERE account_id = v_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account % is not connected to the engine yet', v_account_id;
  END IF;

  RETURN drip.whatsapp_inboxes(v_account_id);
END;
$$;
