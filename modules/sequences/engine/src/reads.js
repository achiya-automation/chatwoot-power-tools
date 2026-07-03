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
export function makeDbReads(query) {
  return {
    // All WhatsApp templates for the account (the AgentBot can't GET /inboxes).
    // Same shape as Chatwoot's API message_templates (name/language/components/status).
    loadTemplates: async (accountId) => {
      const rows = await query(
        `SELECT cw.message_templates
           FROM public.inboxes i
           JOIN public.channel_whatsapp cw ON cw.id = i.channel_id
          WHERE i.account_id = $1 AND i.channel_type = 'Channel::Whatsapp'`,
        [accountId]
      );
      return rows.flatMap((r) => r.message_templates || []);
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
    getContact: async (conversationId, accountId) => {
      const rows = await query(
        `SELECT ct.name, ct.phone_number AS phone, ct.email
           FROM public.conversations c
           JOIN public.contacts ct ON ct.id = c.contact_id
          WHERE c.account_id = $1 AND c.display_id = $2
          LIMIT 1`,
        [accountId, conversationId]
      );
      return rows[0] || {};
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
  };
}
