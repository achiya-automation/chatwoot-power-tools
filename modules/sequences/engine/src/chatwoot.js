/**
 * Chatwoot REST API client.
 * sendTemplate body shape is authoritative from n8n/send-advance.code.js:
 *   { content, template_params: { name, language, category, processed_params } }
 * (no top-level message_type/content_type — the brief had those but n8n omits them)
 */
import { readFile } from 'node:fs/promises';

const GRAPH = 'https://graph.facebook.com/v21.0';

export function makeClient({ baseUrl, token, accountId, reads, query }) {
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

    /**
     * ⭐ Send the step as a FREE-FORM message (no template) — only valid inside an open
     * 24h customer-service window.
     *
     * This is the single highest-value path in the engine. Meta's per-user marketing cap
     * (131049) and the portfolio's 24h tier apply to TEMPLATES sent outside a service
     * window. A free-form message sent inside the window is neither — it is exempt from
     * both. Measured on banana-book 2026-07-12: templates to leads who had replied landed
     * ~29%; the same content sent free-form inside their window is not rate-limited at all.
     *
     * The caller MUST confirm the window is open (compliance.inSession) — outside it
     * WhatsApp rejects a non-template message with 131047.
     *
     * Sends the SAME body + media as the template, so the lead sees identical content.
     * Returns { id, content }, matching sendTemplate.
     */
    sendFreeform: async (cid, t) => {
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
      } catch { /* templates unavailable → send the text we have */ }

      const MEDIA_FORMATS = ['IMAGE', 'VIDEO', 'DOCUMENT'];
      const textOnly = async () => {
        const m = await req(`/conversations/${cid}/messages`, {
          method: 'POST',
          body: JSON.stringify({ content }),
        });
        return { id: m.id, content };
      };

      if (!t.mediaUrl || !MEDIA_FORMATS.includes(headerFormat)) return textOnly();

      // Chatwoot's message API takes attachments as multipart file parts, not URLs — so we
      // read the file we already serve at PUBLIC_BASE_URL straight off disk (media.js wrote it).
      const file = String(t.mediaUrl).split('/').pop().split('?')[0];
      let buf;
      try {
        buf = await readFile(`${process.env.MEDIA_DIR || '/app/media'}/${file}`);
      } catch {
        // Media gone from disk: still deliver the text. Dropping the whole step would stall
        // the lead inside the one window where we can reach them for free.
        console.warn(`[drip] freeform: media missing for ${t.name} (${file}) — sending text only`);
        return textOnly();
      }

      const fd = new FormData();
      fd.append('content', content);
      fd.append('attachments[]', new Blob([buf]), file);
      // No Content-Type header on purpose — fetch must set the multipart boundary itself.
      const r = await fetch(`${base}/conversations/${cid}/messages`, {
        method: 'POST',
        headers: { api_access_token: token },
        body: fd,
      });
      if (!r.ok) throw new Error(`Chatwoot POST freeform /conversations/${cid}/messages → ${r.status}`);
      const m = await r.json();
      return { id: m.id, content };
    },

    /**
     * Send the step through Meta's Marketing Messages (MM Lite) API instead of Chatwoot's
     * Cloud-API path — `POST /{PHONE_NUMBER_ID}/marketing_messages`.
     *
     * Why it might beat Cloud API: MM Lite routes marketing through Meta's ads-delivery
     * optimizer. Meta: it "can recognize high-engagement message templates … and it can
     * overcome per-user message limits that might not allow delivery on Cloud API."
     * ⚠️ Unproven for THIS audience — that is what the A/B measures. On the burned cohort
     * it delivered 0/19, same as Cloud API (2026-07-12).
     *
     * Chatwoot has no MM Lite path, so we send via Graph and then write the message row
     * ourselves with source_id = the wamid — otherwise Meta's status webhook has nothing to
     * match and we never learn whether it was delivered. The row is what makes the A/B
     * measurable at all.
     *
     * Returns { id, content } — same shape as sendTemplate, so reconcile's bookkeeping
     * (sent_messages, retry, advance) is untouched.
     */
    sendMmLite: async (cid, t) => {
      const creds = reads?.getWhatsappCreds ? await reads.getWhatsappCreds(accountId) : null;
      if (!creds?.token || !creds?.phoneId) throw new Error('MM Lite: no WhatsApp creds');

      // Resolve the conversation once: Graph needs the recipient's phone; the message row
      // needs the internal (not display) conversation id + inbox.
      const conv = (await query(
        `SELECT c.id AS conv_db_id, c.inbox_id, replace(ct.phone_number, '+', '') AS phone
           FROM public.conversations c
           JOIN public.contacts ct ON ct.id = c.contact_id
          WHERE c.display_id = $1 AND c.account_id = $2`,
        [cid, accountId]
      ))[0];
      if (!conv?.phone) throw new Error(`MM Lite: no phone for conversation ${cid}`);

      // Same body + header the template path would render, so the lead sees identical content.
      let content = '';
      let headerFormat = null;
      try {
        const tpls = await loadRawTemplates();
        const tpl = tpls.find((x) => x.name === t.name && x.language === t.language)
          || tpls.find((x) => x.name === t.name);
        const bodyComp = (tpl?.components || []).find((c) => String(c.type || '').toUpperCase() === 'BODY');
        content = renderBody(bodyComp?.text, t.params);
        const headerComp = (tpl?.components || []).find((c) => String(c.type || '').toUpperCase() === 'HEADER');
        headerFormat = headerComp ? String(headerComp.format || '').toUpperCase() : null;
      } catch { /* templates unavailable → body params still go out, just no rendered preview */ }

      const params = Array.isArray(t.params) ? t.params : Object.values(t.params || {});
      const components = [];
      const MEDIA_FORMATS = ['IMAGE', 'VIDEO', 'DOCUMENT'];
      if (t.mediaUrl && MEDIA_FORMATS.includes(headerFormat)) {
        const kind = headerFormat.toLowerCase();
        components.push({ type: 'header', parameters: [{ type: kind, [kind]: { link: t.mediaUrl } }] });
      }
      if (params.length) {
        components.push({
          type: 'body',
          parameters: params.map((v) => ({ type: 'text', text: String(v ?? '') })),
        });
      }

      const r = await fetch(`${GRAPH}/${creds.phoneId}/marketing_messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: conv.phone,
          type: 'template',
          template: { name: t.name, language: { code: t.language }, components },
        }),
      });
      const j = await r.json();
      const wamid = j?.messages?.[0]?.id;
      if (!wamid) {
        throw new Error(`MM Lite ${r.status}: ${JSON.stringify(j?.error || j).slice(0, 200)}`);
      }

      // The sender must match the drip's other messages or the thread renders inconsistently.
      const sender = (await query(
        `SELECT sender_type, sender_id FROM public.messages
          WHERE account_id = $1 AND message_type = 1 AND sender_type = 'AgentBot'
          ORDER BY id DESC LIMIT 1`,
        [accountId]
      ))[0] || { sender_type: 'AgentBot', sender_id: null };

      const m = (await query(
        `INSERT INTO public.messages
           (account_id, inbox_id, conversation_id, message_type, content_type, status,
            sender_type, sender_id, private, content, source_id, additional_attributes,
            created_at, updated_at)
         VALUES ($1, $2, $3, 1, 0, 0, $4, $5, false, $6, $7,
                 jsonb_build_object('template_params', jsonb_build_object(
                   'name', $8::text, 'category', $9::text, 'language', $10::text, 'via', 'MM_LITE')),
                 now(), now())
         RETURNING id`,
        [accountId, conv.inbox_id, conv.conv_db_id, sender.sender_type, sender.sender_id,
         content, wamid, t.name, t.category, t.language]
      ))[0];

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

    /** Returns true if a human agent (outgoing, sender 'User' — not our AgentBot) messaged
     *  after sinceISO. Signals a human took over, so the sequence should stand down. */
    outgoingByHumanSince: async (cid, sinceISO) => {
      if (reads?.outgoingByHumanSince) return reads.outgoingByHumanSince(cid, sinceISO, accountId);
      const r = await req(`/conversations/${cid}/messages`);
      const since = new Date(sinceISO);
      return (r.payload || []).some(
        (m) => m.message_type === 1 && m.sender_type === 'User' && new Date(m.created_at * 1000) > since
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
