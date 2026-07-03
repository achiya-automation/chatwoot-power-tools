/**
 * Chatwoot REST API client.
 * sendTemplate body shape is authoritative from n8n/send-advance.code.js:
 *   { content, template_params: { name, language, category, processed_params } }
 * (no top-level message_type/content_type — the brief had those but n8n omits them)
 */

export function makeClient({ baseUrl, token, accountId, reads }) {
  const base = `${baseUrl}/api/v1/accounts/${accountId}`;
  const h = { 'Content-Type': 'application/json', api_access_token: token };

  const req = async (path, opts = {}) => {
    const r = await fetch(`${base}${path}`, { headers: h, ...opts });
    if (!r.ok) throw new Error(`Chatwoot ${opts.method || 'GET'} ${path} → ${r.status}`);
    return r.json();
  };

  // Raw WhatsApp templates, cached for this client's lifetime. When DB reads are injected
  // (production: AgentBot token can't GET /inboxes) we read them from Chatwoot's Postgres;
  // otherwise we fall back to the API (tests / non-bot tokens).
  let _rawTemplates = null;
  const loadRawTemplates = async () => {
    if (_rawTemplates) return _rawTemplates;
    if (reads?.loadTemplates) {
      _rawTemplates = await reads.loadTemplates(accountId);
    } else {
      const inboxes = await req(`/inboxes`);
      _rawTemplates = (inboxes.payload || []).flatMap((i) => i.message_templates || []);
    }
    return _rawTemplates;
  };
  // Substitute {{1}},{{2}}… in a template body with the resolved params (for display).
  const renderBody = (body, params) =>
    String(body || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => {
      const v = (params || [])[Number(n) - 1];
      return v != null && String(v) !== '' ? String(v) : `{{${n}}}`;
    });

  return {
    /** Merge custom_attributes on a conversation.
     *  Endpoint is POST /conversations/:id/custom_attributes — and it REPLACES the
     *  whole hash, so we read the current attributes and merge, otherwise reflecting
     *  seq_* would wipe the agent's `sequence` input (and earlier seq_* values). */
    patchAttrs: async (cid, attrs) => {
      // Read the current attrs (to merge — the POST replaces the whole hash). In production
      // this is a DB read: the AgentBot token can POST custom_attributes but can't GET the
      // conversation, so we must NOT GET it here.
      const current = reads?.getConversationAttrs
        ? await reads.getConversationAttrs(cid, accountId)
        : (await req(`/conversations/${cid}`)).custom_attributes || {};
      const merged = { ...current, ...attrs };
      return req(`/conversations/${cid}/custom_attributes`, {
        method: 'POST',
        body: JSON.stringify({ custom_attributes: merged }),
      });
    },

    /** Set or clear the `sequence` INPUT attribute that drives enroll/switch/stop.
     *  A truthy key assigns the sequence; a falsy key REMOVES the attribute entirely
     *  (clean opt-out → reconciler stops the enrollment). Other attributes preserved. */
    setSequence: async (cid, key) => {
      const conv = await req(`/conversations/${cid}`);
      const attrs = { ...(conv.custom_attributes || {}) };
      if (key) attrs.sequence = key;
      else delete attrs.sequence;
      return req(`/conversations/${cid}/custom_attributes`, {
        method: 'POST',
        body: JSON.stringify({ custom_attributes: attrs }),
      });
    },

    /** Set or clear the `sequence` attribute on a CONTACT (the enroll trigger).
     *  The contact is the lead; no conversation is required. Reads + merges current
     *  attributes so we never wipe other contact attributes. PUT /contacts/:id. */
    setContactSequence: async (contactId, key) => {
      const r = await req(`/contacts/${contactId}`);
      const cur = (r.payload || r).custom_attributes || {};
      const attrs = { ...cur };
      if (key) attrs.sequence = key;
      else delete attrs.sequence;
      return req(`/contacts/${contactId}`, {
        method: 'PUT',
        body: JSON.stringify({ custom_attributes: attrs }),
      });
    },

    /** Open a conversation for a contact (lazy — only at the first send).
     *  source_id is the contact's WhatsApp contact_inbox id. Returns { id } where id is
     *  the per-account display_id used by the messages API and stored on the enrollment. */
    createConversation: async ({ sourceId, inboxId, contactId }) => {
      const m = await req(`/conversations`, {
        method: 'POST',
        body: JSON.stringify({
          source_id: String(sourceId),
          inbox_id:  inboxId,
          contact_id: contactId,
        }),
      });
      return { id: m.display_id ?? m.id };
    },

    /**
     * Send a WhatsApp template message.
     * Body matches the working n8n Send node (n8n/send-advance.code.js):
     *   template_params includes category (not message_type/content_type at top level).
     * Returns { id, content } — the Chatwoot message id plus the rendered body, so
     * the reconciler can record exactly what was delivered (send history).
     */
    sendTemplate: async (cid, t) => {
      // Render the body so the agent SEES the message in the conversation thread
      // (content is display-only; WhatsApp renders the real message from template_params).
      // Also read the HEADER format from the template so we know whether a media param
      // is needed (IMAGE/VIDEO/DOCUMENT) and which kind.
      let content = '';
      let headerFormat = null;
      try {
        const tpls = await loadRawTemplates();
        const tpl = tpls.find((x) => x.name === t.name && x.language === t.language)
          || tpls.find((x) => x.name === t.name);
        const bodyComp = (tpl?.components || []).find(
          (c) => String(c.type || '').toUpperCase() === 'BODY'
        );
        content = renderBody(bodyComp?.text, t.params);
        const headerComp = (tpl?.components || []).find(
          (c) => String(c.type || '').toUpperCase() === 'HEADER'
        );
        headerFormat = headerComp ? String(headerComp.format || '').toUpperCase() : null;
      } catch { /* templates unavailable → empty content + no header detection */ }

      // Body params as the flat hash Chatwoot expects: {"1":v1,"2":v2} (array 422s).
      const bodyParams = Array.isArray(t.params)
        ? Object.fromEntries((t.params || []).map((v, i) => [String(i + 1), v]))
        : t.params || {};

      // Template with a MEDIA header + a media_url for this step → send the ENHANCED
      // shape so Chatwoot attaches the header. Without processed_params.header, Chatwoot's
      // TemplateProcessor skips the header entirely (media never sent).
      // ⚠️ The template's example.header_handle (scontent.whatsapp.net) is NOT usable as
      // media_url — it 403s → 131053. The URL must be a public one of ours.
      const MEDIA_FORMATS = ['IMAGE', 'VIDEO', 'DOCUMENT'];
      let processedParams = bodyParams;
      if (t.mediaUrl && MEDIA_FORMATS.includes(headerFormat)) {
        processedParams = {
          body: bodyParams,
          header: { media_url: t.mediaUrl, media_type: headerFormat.toLowerCase() },
        };
      }

      const m = await req(`/conversations/${cid}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content,
          template_params: {
            name: t.name,
            language: t.language,
            category: t.category,
            processed_params: processedParams,
          },
        }),
      });
      return { id: m.id, content };
    },

    /** Fetch conversation contact details (DB read in production; API fallback). */
    getContact: async (cid) => {
      if (reads?.getContact) return reads.getContact(cid, accountId);
      const conv = await req(`/conversations/${cid}`);
      const m = conv.meta?.sender || {};
      return { name: m.name, phone: m.phone_number, email: m.email };
    },

    /** Returns true if any incoming (customer) message arrived after sinceISO
     *  (DB read in production; API fallback). */
    incomingSince: async (cid, sinceISO) => {
      if (reads?.incomingSince) return reads.incomingSince(cid, sinceISO, accountId);
      const r = await req(`/conversations/${cid}/messages`);
      const since = new Date(sinceISO);
      return (r.payload || []).some(
        (m) => m.message_type === 0 && new Date(m.created_at * 1000) > since
      );
    },

    /** List APPROVED WhatsApp templates across all inboxes (case-insensitive, deduped by name+language) */
    listTemplates: async () => {
      const raw = await loadRawTemplates();
      const seen = new Set();
      return raw.filter((t) => {
        if (String(t.status || '').toUpperCase() !== 'APPROVED') return false;
        const k = `${t.name}|${t.language}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    },

    /**
     * Idempotent: ensure the 4 drip custom-attribute definitions exist.
     * attribute_model=0 means conversation_attribute in Chatwoot's enum.
     */
    ensureAttributes: async () => {
      // Best-effort: the per-account AgentBot token can't manage attribute definitions
      // (those are created once at onboarding by an admin). This must NEVER throw, or the
      // tick would skip reconcileAccount. The engine writes seq_* regardless — definitions
      // only control whether Chatwoot's sidebar renders them with a friendly label.
      try {
        const defs = await req(`/custom_attribute_definitions?attribute_model=0`);
        const have = new Set((defs || []).map((d) => d.attribute_key));
        const want = [
          ['sequence', 'list'],
          ['seq_step', 'number'],
          ['seq_state', 'list'],
          ['seq_next', 'number'],
        ];
        for (const [key, type] of want) {
          if (!have.has(key)) {
            await req(`/custom_attribute_definitions`, {
              method: 'POST',
              body: JSON.stringify({
                attribute_display_name: key,
                attribute_key: key,
                attribute_display_type: type,
                attribute_model: 'conversation_attribute',
              }),
            });
          }
        }
      } catch (e) {
        console.warn('[drip] ensureAttributes skipped (non-fatal):', e.message);
      }
    },
  };
}
