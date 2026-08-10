/**
 * reads.js — DB-backed reads of Chatwoot data the AgentBot token cannot fetch via API.
 *
 * The engine sends through a per-account Chatwoot AgentBot — a "non-human" automation
 * identity that stays out of the agents list. An AgentBot token can WRITE (open a
 * conversation, send a message, set conversation attributes) but it cannot READ inboxes,
 * contacts, or messages over the API. The engine already connects to Chatwoot's Postgres
 * (a least-privilege read role) for delivery tracking, so it reads those directly here —
 * which is also faster (no HTTP round-trips). makeDbReads(query) returns the three readers
 * the Chatwoot client injects in production; without them the client falls back to the API.
 */
/**
 * מתי הודעה יוצאת נשלחה בידי אדם — הגדרה אחת לכל המנוע.
 *
 * שני מקורות, לא אחד. נציג שכותב בתוך Chatwoot מקבל sender_type='User'. אבל כשהמספר
 * עובד ב-coexistence (אפליקציית WhatsApp Business בנייד + Cloud API על אותו מספר),
 * הודעה שנשלחה מהטלפון חוזרת כ-echo מ-Meta ונרשמת **בלי sender בכלל** — מסומנת רק
 * ב-content_attributes.external_echo. בדיקה שסופרת רק 'User' מחמיצה אותה לגמרי, והמנוע
 * ממשיך לדבר לתוך שיחה שאדם כבר מנהל.
 *
 * content_attributes הוא עמודת json שמכילה מחרוזת JSON (double-encoded, 57.5K שורות —
 * כולן string), ולכן ->>'external_echo' לא עובד עליה. LIKE על ::text הוא הקריאה
 * היחידה שעובדת בלי לפענח פעמיים, והשדה הזה לעולם לא מכיל טקסט חופשי של משתמש.
 */
export const HUMAN_OUTGOING_SQL = `(m.message_type = 1
  AND (m.sender_type = 'User' OR m.content_attributes::text LIKE '%external_echo%'))`;

/** אותה הגדרה על אובייקט הודעה מה-API של Chatwoot (נתיב ה-fallback, בלי DB). */
export const isHumanOutgoing = (m) => m?.message_type === 1
  && (m.sender_type === 'User' || Boolean(parseAttrs(m.content_attributes)?.external_echo));

// content_attributes מגיע מה-API כמחרוזת JSON או כאובייקט, תלוי בגרסה — מקבלים את שניהם.
function parseAttrs(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { const p = JSON.parse(v); return typeof p === 'string' ? JSON.parse(p) : p; } catch { return null; }
}

export function makeDbReads(query) {
  /**
   * איזו תיבת וואטסאפ המנוע עובד מולה.
   *
   * לחשבון Chatwoot אחד יכולים להיות כמה מספרי וואטסאפ. עד היום כל אחד משלושת המקומות
   * שצריכים אחד — בריאות, תבניות, ופתיחת שיחה — בחר לבד ובשיטה אחרת, כך שהמנוע יכול היה
   * לקרוא את ה-tier ממספר אחד, את התבניות מכולם, ולשלוח ממספר שלישי. עכשיו יש מקור אמת
   * אחד: drip.account_tokens.inbox_id.
   *
   * ⛔ יותר ממספר אחד ובלי בחירה ⇒ `ambiguous`. המנוע **לא מנחש**: שליחה מהמספר הלא נכון
   * היא טעות שהלקוח רואה, ואי אפשר לבטל אותה.
   *
   * @returns {Promise<{inboxId:number|null, ambiguous:boolean, count:number}>}
   */
  const resolveInbox = async (accountId) => {
    const rows = await query(
      `SELECT i.id, (i.id = t.inbox_id) AS chosen
         FROM public.inboxes i
         JOIN public.channel_whatsapp cw ON cw.id = i.channel_id
         LEFT JOIN drip.account_tokens t ON t.account_id = i.account_id
        WHERE i.account_id = $1 AND i.channel_type = 'Channel::Whatsapp'
        ORDER BY i.id`,
      [accountId]
    );
    const chosen = rows.find((r) => r.chosen);
    if (chosen)        return { inboxId: chosen.id, ambiguous: false, count: rows.length };
    if (rows.length === 1) return { inboxId: rows[0].id, ambiguous: false, count: 1 };
    return { inboxId: null, ambiguous: rows.length > 1, count: rows.length };
  };

  return {
    resolveInbox,

    // All WhatsApp templates for the account (the AgentBot can't GET /inboxes).
    // Same shape as Chatwoot's API message_templates (name/language/components/status).
    // ⚠️ Scoped to the CHOSEN inbox: templates belong to a WABA, and flattening two numbers'
    // template lists together lets a name from one number resolve against the other.
    // inboxIdOverride: a specific number instead of the chosen one (the campaign report asks
    // for the templates of the number THAT campaign sent from). Always re-scoped to the
    // account here — the id arrives from the browser.
    loadTemplates: async (accountId, inboxIdOverride = null) => {
      const inboxId = inboxIdOverride || (await resolveInbox(accountId)).inboxId;
      if (!inboxId) return [];
      const rows = await query(
        `SELECT cw.message_templates
           FROM public.inboxes i
           JOIN public.channel_whatsapp cw ON cw.id = i.channel_id
          WHERE i.id = $1 AND i.account_id = $2`,
        [inboxId, accountId]
      );
      // production default for this column is '{}'::jsonb (an object, not an array) on a
      // never-synced channel — flatMap((r) => r.message_templates || []) would inject that
      // spurious {} into the result instead of contributing zero templates.
      return rows.flatMap((r) => (Array.isArray(r.message_templates) ? r.message_templates : []));
    },

    // Current custom_attributes of a conversation — so patchAttrs can MERGE (the POST
    // replaces the whole hash) without a GET the AgentBot token can't do.
    getConversationAttrs: async (conversationId, accountId) => {
      const rows = await query(
        `SELECT custom_attributes
           FROM public.conversations
          WHERE account_id = $1 AND display_id = $2
          LIMIT 1`,
        [accountId, conversationId]
      );
      return rows[0]?.custom_attributes || {};
    },

    // Contact name/phone/email behind a conversation (for {{1}} param substitution).
    // custom_attributes included so journeys' renderText/condition can resolve {{שדה מותאם}}.
    getContact: async (conversationId, accountId) => {
      const rows = await query(
        `SELECT ct.name, ct.phone_number AS phone, ct.email, ct.custom_attributes
           FROM public.conversations c
           JOIN public.contacts ct ON ct.id = c.contact_id
          WHERE c.account_id = $1 AND c.display_id = $2
          LIMIT 1`,
        [accountId, conversationId]
      );
      return rows[0] || {};
    },

    // journeys: current custom_attributes of a CONTACT (merge before PUT).
    getContactAttrs: async (contactId, accountId) => {
      const rows = await query(
        `SELECT custom_attributes
           FROM public.contacts
          WHERE account_id = $1 AND id = $2
          LIMIT 1`,
        [accountId, contactId]
      );
      return rows[0]?.custom_attributes || {};
    },

    // journeys: current labels of a conversation (POST /labels replaces — we must merge).
    getConversationLabels: async (conversationId, accountId) => {
      const rows = await query(
        `SELECT t.name
           FROM public.conversations c
           JOIN public.taggings tg ON tg.taggable_type = 'Conversation'
                                  AND tg.taggable_id = c.id AND tg.context = 'labels'
           JOIN public.tags t ON t.id = tg.tag_id
          WHERE c.account_id = $1 AND c.display_id = $2`,
        [accountId, conversationId]
      );
      return rows.map((r) => r.name);
    },

    // journeys: channel class of an inbox — decides real buttons vs numbered fallback.
    getInboxChannelType: async (inboxId) => {
      const rows = await query(
        `SELECT channel_type FROM public.inboxes WHERE id = $1 LIMIT 1`,
        [inboxId]
      );
      return rows[0]?.channel_type || '';
    },

    // True if the customer replied (an INCOMING message) after sinceISO (stop_on_reply).
    // Chatwoot stores messages.created_at as naive UTC; compare last_sent_at in that frame.
    incomingSince: async (conversationId, sinceISO, accountId) => {
      const rows = await query(
        `SELECT 1
           FROM public.messages m
           JOIN public.conversations c ON c.id = m.conversation_id
          WHERE c.account_id = $1 AND c.display_id = $2
            AND m.message_type = 0
            AND m.created_at > ($3::timestamptz AT TIME ZONE 'UTC')
          LIMIT 1`,
        [accountId, conversationId, sinceISO]
      );
      return rows.length > 0;
    },

    // True if a HUMAN sent an outgoing message after sinceISO — a Chatwoot agent OR the
    // business phone itself (see HUMAN_OUTGOING_SQL). Our engine sends as 'AgentBot', so
    // either one means a person took over: stand the sequence down instead of talking over them.
    outgoingByHumanSince: async (conversationId, sinceISO, accountId) => {
      const rows = await query(
        `SELECT 1
           FROM public.messages m
           JOIN public.conversations c ON c.id = m.conversation_id
          WHERE c.account_id = $1 AND c.display_id = $2
            AND ${HUMAN_OUTGOING_SQL}
            AND m.created_at > ($3::timestamptz AT TIME ZONE 'UTC')
          LIMIT 1`,
        [accountId, conversationId, sinceISO]
      );
      return rows.length > 0;
    },

    // Meta creds for an account's WhatsApp channel — the same channel token Chatwoot already
    // stores and sends through. phoneId → the number's messaging limit + quality rating;
    // wabaId → the WhatsApp Business Account, whose /message_templates edge is the only place
    // a template's live status (PAUSED!) and quality_score can be read. Chatwoot's own copy of
    // the templates is synced too slowly to catch a 3-hour pause and carries no quality score.
    // Returns null if the account has no WhatsApp channel.
    getWhatsappCreds: async (accountId) => {
      const { inboxId } = await resolveInbox(accountId);
      if (!inboxId) return null;              // אין תיבה, או שיש כמה ואף אחת לא נבחרה
      const rows = await query(
        `SELECT cw.provider_config->>'api_key'            AS token,
                cw.provider_config->>'phone_number_id'    AS "phoneId",
                cw.provider_config->>'business_account_id' AS "wabaId"
           FROM public.inboxes i
           JOIN public.channel_whatsapp cw ON cw.id = i.channel_id
          WHERE i.id = $1`,
        [inboxId]
      );
      return rows[0]?.token && rows[0]?.phoneId ? rows[0] : null;
    },

    // Every usable Cloud-API channel of the account (Template Studio operates per-WABA;
    // several numbers may share one). WAHA/API channels have no templates and no api_key.
    getWhatsappCredsAll: async (accountId) => {
      const rows = await query(
        `SELECT i.id   AS "inboxId",
                i.name AS name,
                cw.phone_number AS phone,
                cw.provider_config->>'api_key'             AS token,
                cw.provider_config->>'phone_number_id'     AS "phoneId",
                cw.provider_config->>'business_account_id' AS "wabaId"
           FROM public.inboxes i
           JOIN public.channel_whatsapp cw ON cw.id = i.channel_id
          WHERE i.account_id = $1
            AND i.channel_type = 'Channel::Whatsapp'
            AND cw.provider = 'whatsapp_cloud'
            AND COALESCE(cw.provider_config->>'api_key','') <> ''
            AND COALESCE(cw.provider_config->>'business_account_id','') <> ''
          ORDER BY i.id`,
        [accountId]
      );
      return rows;
    },
  };
}
