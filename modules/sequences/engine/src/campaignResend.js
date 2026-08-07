import { getCampaignDetail, normalizeCampaignPhone } from './campaigns.js';

/**
 * campaignResend.js — "שליחה מחדש לנכשלים" for one-off WhatsApp campaigns.
 *
 * The original campaign send happens inside Chatwoot (the whatsapp_campaign_conversations
 * initializer). A Meta-rejected recipient ends as status 3 in the drip ledger — usually with
 * NO conversation, because the patch only creates one after a successful send. This module
 * retries exactly those recipients through the engine's own proven template path:
 *
 *   recipient → (existing conversation | create one) → client.sendTemplate()
 *             → Chatwoot's SendOnWhatsappService → Meta → delivery webhooks
 *
 * Each retry is recorded in drip.campaign_send_snapshots under a synthetic
 * `retry:<campaign>:<contact>:<n>` source_id with the new Chatwoot message_id, so the
 * existing report queries pick it up with zero changes: the recipient collapses back to one
 * row whose status follows the NEW message, and attempt_count grows.
 *
 * Batches can be large and each send is a Chatwoot round-trip, so the work runs as an
 * in-memory background job the UI polls (campaign_resend_status). State lives only in this
 * process — a restart loses the progress view but never the truth (the ledger has it).
 */

// One job per (account, campaign); a second start while running is refused.
const jobs = new Map();
const jobKey = (accountId, campaignId) => `${accountId}:${campaignId}`;
// Finished jobs linger so the UI can read the summary, then evaporate.
const JOB_TTL_MS = 15 * 60 * 1000;
// Gentle pacing between sends — the same order of magnitude as the Rails campaign loop;
// hammering /messages concurrently just moves the failure into Chatwoot's queue.
const SEND_GAP_MS = 300;

const M = {
  he: {
    notFound: 'הקמפיין לא נמצא',
    noTemplate: 'לקמפיין אין תבנית שמורה — אין מה לשלוח מחדש',
    noFailed: 'אין נמענים שנכשלו בקמפיין הזה',
    running: 'שליחה מחדש כבר רצה לקמפיין הזה',
    noContact: 'אין מזהה איש קשר — אי אפשר לפתוח שיחה',
    suppressed: 'הנמען ביקש הסרה (opt-out)',
    liquidBlank: 'משתנה בתבנית נשאר ריק עבור הנמען',
  },
  en: {
    notFound: 'Campaign not found',
    noTemplate: 'The campaign has no saved template — nothing to resend',
    noFailed: 'This campaign has no failed recipients',
    running: 'A resend is already running for this campaign',
    noContact: 'No contact id — cannot open a conversation',
    suppressed: 'The recipient opted out',
    liquidBlank: 'A template variable rendered empty for this recipient',
  },
};
const t = (locale, key) => (M[locale === 'en' ? 'en' : 'he'] || M.he)[key];

/**
 * Chatwoot processes campaign params through Liquid with a contact drop. The engine mirrors
 * the same substitution for the retry ({{contact.name}} & friends). Unknown variables render
 * empty — same as Liquid — and a value that ends up entirely blank aborts that recipient
 * (mirrors the Ruby flow's liquid_blank skip) instead of sending a broken message.
 */
export function liquidContactParams(params, contact) {
  const name = String(contact?.name || '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const vars = {
    'contact.name': name,
    'contact.first_name': parts[0] || '',
    'contact.last_name': parts.length > 1 ? parts[parts.length - 1] : '',
    'contact.phone_number': String(contact?.phone_number || ''),
    'contact.email': String(contact?.email || ''),
  };
  let blank = false;
  const sub = (v) => {
    if (typeof v !== 'string') return v;
    const had = /\{\{/.test(v);
    const out = v.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => vars[k] ?? '');
    if (had && out.trim() === '') blank = true;
    return out;
  };
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    }
    return sub(node);
  };
  return { params: walk(params ?? {}), blank };
}

/** Public job shape for the UI — never the internal object itself. */
export function resendStatus(accountId, campaignId) {
  const job = jobs.get(jobKey(accountId, Number(campaignId)));
  if (!job) return null;
  return {
    status: job.status,                 // 'running' | 'done'
    total: job.total,
    done: job.done,
    sent: job.sent,
    failed: job.failed,                 // [{ phone, name, error }]
    started_at: job.startedAt,
  };
}

/**
 * startResend(deps, accountId, campaignId, locale) → { total }
 * deps: { query, makeClientFor, delayMs?, now? } — client injected so tests never send.
 */
export async function startResend(deps, accountId, campaignId, locale = 'he') {
  const { query } = deps;
  const id = Number.parseInt(campaignId, 10);
  if (!Number.isInteger(id)) throw new Error(t(locale, 'notFound'));
  const key = jobKey(accountId, id);
  if (jobs.get(key)?.status === 'running') throw new Error(t(locale, 'running'));

  const detail = await getCampaignDetail(query, accountId, id);
  if (!detail) throw new Error(t(locale, 'notFound'));
  const tpl = detail.campaign.template_params || {};
  if (!tpl.name) throw new Error(t(locale, 'noTemplate'));

  // Final state per recipient is already collapsed by getCampaignDetail — status 3 is
  // "still failed after every attempt so far", exactly the set the report shows in red.
  const failedRecipients = detail.recipients.filter((r) => r.status === 3);
  if (!failedRecipients.length) throw new Error(t(locale, 'noFailed'));

  // Opt-outs recorded since the campaign ran (scope marketing or all) must not be retried.
  const contactIds = failedRecipients.map((r) => r.contact_id).filter(Boolean);
  const suppressed = new Set(contactIds.length ? (await query(
    `SELECT contact_id FROM drip.contact_state
      WHERE account_id = $1 AND suppressed_at IS NOT NULL AND contact_id = ANY($2::bigint[])`,
    [accountId, contactIds]
  )).map((r) => Number(r.contact_id)) : []);

  // Contact fields for the Liquid substitution (ledger rows carry only name+phone).
  const contactRows = contactIds.length ? await query(
    `SELECT id, name, phone_number, email FROM public.contacts
      WHERE account_id = $1 AND id = ANY($2::bigint[])`,
    [accountId, contactIds]
  ) : [];
  const contactById = new Map(contactRows.map((c) => [Number(c.id), c]));

  const job = {
    status: 'running',
    total: failedRecipients.length,
    done: 0,
    sent: 0,
    failed: [],
    startedAt: new Date().toISOString(),
  };
  jobs.set(key, job);

  // Fire-and-forget: the HTTP request returns immediately; the UI polls resendStatus.
  runJob(deps, { accountId, campaign: detail.campaign, recipients: failedRecipients, suppressed, contactById, job, locale })
    .catch((e) => { job.failed.push({ phone: '', name: '', error: e.message }); })
    .finally(() => {
      job.status = 'done';
      const timer = setTimeout(() => { if (jobs.get(key) === job) jobs.delete(key); }, JOB_TTL_MS);
      if (timer.unref) timer.unref();
    });

  return { total: job.total };
}

async function runJob(deps, ctx) {
  const { query, makeClientFor, delayMs = SEND_GAP_MS } = deps;
  const { accountId, campaign, recipients, suppressed, contactById, job, locale } = ctx;
  const client = await makeClientFor(accountId);
  const tpl = campaign.template_params;
  // processed_params is either the flat body hash ({"1":"..."}) or the enhanced
  // { body, header:{ media_url } } shape — sendTemplate rebuilds the enhanced shape itself
  // from mediaUrl, so split it here rather than teaching it a third input format.
  const raw = tpl.processed_params || {};
  const bodyParams = raw.body && typeof raw.body === 'object' ? raw.body : raw;
  const mediaUrl = raw.header?.media_url || null;

  let attempt = 0;
  for (const r of recipients) {
    attempt += 1;
    const label = { phone: r.phone || '', name: r.contact_name || '' };
    try {
      if (r.contact_id && suppressed.has(Number(r.contact_id))) {
        throw new Error(t(locale, 'suppressed'));
      }
      const contact = contactById.get(Number(r.contact_id)) || { name: r.contact_name, phone_number: r.phone };
      const { params, blank } = liquidContactParams(bodyParams, contact);
      if (blank) throw new Error(t(locale, 'liquidBlank'));

      const displayId = await resolveConversation(query, client, accountId, campaign, r, locale);
      const sent = await client.sendTemplate(displayId, {
        name: tpl.name,
        language: tpl.language || tpl.lang_code,
        category: tpl.category,
        params,
        mediaUrl,
      });

      // Ledger row for the retry — a NEW source_id keeps the original failed attempt intact
      // (the report's attempt_count is real history), while the message join lets delivery
      // webhooks drive this row's effective status from now on.
      const msgRow = sent?.id ? (await query(
        `SELECT conversation_id FROM public.messages WHERE account_id = $1 AND id = $2`,
        [accountId, sent.id]
      ))[0] : null;
      await query(
        `INSERT INTO drip.campaign_send_snapshots
           (account_id, campaign_id, contact_id, contact_name, phone, source_id,
            conversation_id, message_id, status, attempted_at, status_updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, now(), now())
         ON CONFLICT (account_id, campaign_id, source_id) DO NOTHING`,
        [accountId, campaign.id, r.contact_id || null, r.contact_name || '', r.phone || '',
          `retry:${campaign.id}:${r.contact_id || r.phone || attempt}:${Date.now()}`,
          msgRow?.conversation_id || null, sent?.id || null]
      );
      job.sent += 1;
    } catch (e) {
      job.failed.push({ ...label, error: e.message });
    } finally {
      job.done += 1;
    }
    if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
  }
}

/**
 * The conversation to send into: the recipient's existing one (legacy failures that DID get a
 * message row), else the contact's newest conversation on the campaign's inbox, else a fresh
 * one. A Meta-rejected first send usually left NOTHING behind, so the create path is the
 * common case — source_id is the phone in digits, the same convention the whole stack uses.
 */
async function resolveConversation(query, client, accountId, campaign, recipient, locale) {
  if (recipient.conversation_display_id) return recipient.conversation_display_id;

  const contactId = recipient.contact_id;
  if (!contactId) throw new Error(t(locale, 'noContact'));

  const existing = (await query(
    `SELECT cv.display_id FROM public.conversations cv
      WHERE cv.account_id = $1 AND cv.contact_id = $2 AND cv.inbox_id = $3
      ORDER BY cv.id DESC LIMIT 1`,
    [accountId, contactId, campaign.inbox_id]
  ))[0];
  if (existing?.display_id) return existing.display_id;

  const ci = (await query(
    `SELECT source_id FROM public.contact_inboxes WHERE contact_id = $1 AND inbox_id = $2 LIMIT 1`,
    [contactId, campaign.inbox_id]
  ))[0];
  const sourceId = ci?.source_id || normalizeCampaignPhone(recipient.phone).replace(/^\+/, '');
  const opened = await client.createConversation({
    sourceId, inboxId: campaign.inbox_id, contactId,
  });
  return opened.id;
}

// Test hook — a fresh suite must not inherit a finished job from a previous test.
export function _resetResendJobs() { jobs.clear(); }
