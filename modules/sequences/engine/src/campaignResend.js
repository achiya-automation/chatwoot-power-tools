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
 * A resend may use a DIFFERENT template than the campaign's (with its own variable values) —
 * that is the whole point of retrying a batch Meta rejected. Every run therefore carries a
 * run id and the template it used on its ledger rows, and campaignExperiments() reports each
 * run separately: same recipients, different template, measurable difference.
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

// ── בלם לחץ (12.8.26) ────────────────────────────────────────────────────────
// POST /messages רק *יוצר* את ההודעה; את השליחה בפועל למטא עושה Sidekiq ברקע. הקצב
// שלנו (3.3 הודעות/שנייה, וכפול מספר הקמפיינים שרצים במקביל) גבוה מהקצב שבו Sidekiq
// מספיק לשלוח — התור 'high' תפח ל-1,310 עבודות עם פיגור של 4 דקות, וכל הודעה של לקוח
// אמיתי נתקעה מאחוריהן. למשתמש זה נראה כאילו "הכל בהמתנה".
//
// המדד: הודעה שנוצרה אצלנו ועדיין אין לה source_id (wamid) = Sidekiq עוד לא שלח אותה.
// כשמצטברות יותר מדי כאלה — עוצרים ונותנים לתור לנשום. בלי גישה ל-Redis של Chatwoot,
// וזה המדד הנכון בלאו הכי: מה שמעניין הוא ההודעות שלנו, לא עומק התור הכללי.
const BACKPRESSURE_CHECK_EVERY = 40;   // כל כמה שליחות בודקים
const BACKPRESSURE_HIGH = 250;         // מעל זה — עוצרים
const BACKPRESSURE_OK = 80;            // יורדים לזה — ממשיכים
const BACKPRESSURE_WAIT_MS = 2000;     // בין בדיקות בזמן ההמתנה
const BACKPRESSURE_MAX_WAIT_MS = 120000; // גג המתנה, כדי שריצה לא תיתקע לנצח

const M = {
  he: {
    notFound: 'הקמפיין לא נמצא',
    noTemplate: 'לקמפיין אין תבנית שמורה — אין מה לשלוח מחדש',
    noFailed: 'אין נמענים שנכשלו בקמפיין הזה',
    running: 'שליחה מחדש כבר רצה לקמפיין הזה',
    runningOther: 'שליחה מחדש כבר רצה בקמפיין אחר של החשבון — ההודעות יוצאות דרך אותו תור ואותה מכסה, אז מריצים אחת בכל פעם',
    noContact: 'אין מזהה איש קשר — אי אפשר לפתוח שיחה',
    suppressed: 'הנמען ביקש הסרה (opt-out)',
    liquidBlank: 'משתנה בתבנית נשאר ריק עבור הנמען',
    tplNotApproved: 'התבנית שנבחרה אינה מאושרת במספר שנבחר לשליחה',
    tplParams: 'התבנית דורשת {n} ערכי משתנים, וכולם חייבים להיות מלאים',
    tplNeedsMedia: 'התבנית פותחת בתמונה/וידאו/מסמך — צריך קישור מדיה',
    badInbox: 'המספר שנבחר לשליחה אינו מספר וואטסאפ של החשבון',
  },
  en: {
    notFound: 'Campaign not found',
    noTemplate: 'The campaign has no saved template — nothing to resend',
    noFailed: 'This campaign has no failed recipients',
    running: 'A resend is already running for this campaign',
    runningOther: 'A resend is already running for another campaign in this account — they share one queue and one daily quota, so they run one at a time',
    noContact: 'No contact id — cannot open a conversation',
    suppressed: 'The recipient opted out',
    liquidBlank: 'A template variable rendered empty for this recipient',
    tplNotApproved: 'The selected template is not approved on the number chosen for sending',
    tplParams: 'The template needs {n} variable values, and none may be empty',
    tplNeedsMedia: 'The template opens with an image/video/document — a media link is required',
    badInbox: 'The chosen number is not a WhatsApp inbox of this account',
  },
};
const t = (locale, key, vars) => {
  const s = (M[locale === 'en' ? 'en' : 'he'] || M.he)[key] || key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : s;
};

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
    template_name: job.templateName,    // which template THIS run is sending
    run_id: job.runId,
    inbox_id: job.inboxId,              // and from which number
    waiting: !!job.waiting,             // עוצר כרגע כדי לא להציף את התור של Chatwoot
    started_at: job.startedAt,
  };
}

const MEDIA_HEADERS = new Set(['IMAGE', 'VIDEO', 'DOCUMENT']);

/** מספר הוואטסאפ שהריצה תשלח ממנו — של הקמפיין, או אחר שנבחר ואומת מול החשבון. */
async function resolveSendInbox(query, accountId, campaign, chosenInboxId, locale) {
  const wanted = Number.parseInt(chosenInboxId, 10);
  if (!Number.isInteger(wanted) || wanted === Number(campaign.inbox_id)) return campaign.inbox_id;
  const ok = (await query(
    `SELECT id FROM public.inboxes
      WHERE id = $1 AND account_id = $2 AND channel_type = 'Channel::Whatsapp'`,
    [wanted, accountId]
  ))[0];
  if (!ok) throw new Error(t(locale, 'badInbox'));
  return wanted;
}

/** Only {{N}} body params — never header/namespace/whatever else shares the hash. */
function numericKeysOnly(obj) {
  return Object.fromEntries(
    Object.entries(obj || {}).filter(([k]) => /^\d+$/.test(k))
  );
}

/** Body params in Chatwoot's flat hash shape ({"1":v1,…}) whatever the caller sent. */
function normalizeParams(params) {
  if (Array.isArray(params)) {
    return Object.fromEntries(params.map((v, i) => [String(i + 1), v]));
  }
  return params && typeof params === 'object' ? { ...params } : {};
}

/**
 * The template this run will send: the campaign's own (default), or an explicitly chosen one.
 *
 * A chosen template arrives from the browser, so it is validated here and not trusted: it must
 * be APPROVED on the CAMPAIGN'S number (templates belong to a WABA — the account's "chosen"
 * inbox may be a different number entirely), every {{N}} it declares must have a non-empty
 * value, and a media header must come with a link. Failing here costs one error message;
 * failing at Meta costs the whole batch.
 */
async function resolveTemplate(query, campaign, chosen, locale, sendInboxId) {
  if (!chosen?.name) {
    const tpl = campaign.template_params || {};
    if (!tpl.name) throw new Error(t(locale, 'noTemplate'));
    // processed_params is either the flat body hash ({"1":"..."}) or the enhanced
    // { body, header:{ media_url } } shape — sendTemplate rebuilds the enhanced shape itself
    // from mediaUrl, so split it here rather than teaching it a third input format.
    //
    // ⚠️ A media template with NO variables stores just { header: {...} } — no `body` key at
    // all. Taking the whole object as the body then shipped {"header": {...}} as a body
    // PARAMETER, and Meta rejected every single message with 132012 ("Parameter format does
    // not match format in the created template") — 1,888 of them on 12.8.26. Body params are
    // numbered ({{1}}, {{2}}…) by definition, so keep only the numeric keys.
    const raw = tpl.processed_params || {};
    return {
      name: tpl.name,
      language: tpl.language || tpl.lang_code,
      category: tpl.category,
      bodyParams: raw.body && typeof raw.body === 'object' ? raw.body : numericKeysOnly(raw),
      mediaUrl: raw.header?.media_url || null,
    };
  }

  const rows = await query(
    `SELECT cw.message_templates
       FROM public.inboxes i
       JOIN public.channel_whatsapp cw ON cw.id = i.channel_id
      WHERE i.id = $1`,
    [sendInboxId]
  );
  const list = Array.isArray(rows[0]?.message_templates) ? rows[0].message_templates : [];
  const match = list.find((x) => x.name === chosen.name
    && String(x.status || '').toUpperCase() === 'APPROVED'
    && (!chosen.language || x.language === chosen.language));
  if (!match) throw new Error(t(locale, 'tplNotApproved'));

  const comp = (type) => (match.components || []).find((c) => String(c.type || '').toUpperCase() === type);
  const body = String(comp('BODY')?.text || '');
  // The highest {{N}} in the body, not the count of occurrences — a template that repeats
  // {{1}} needs ONE value, and counting occurrences would reject a perfectly valid send.
  const need = [...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)]
    .reduce((max, m) => Math.max(max, Number(m[1])), 0);
  const bodyParams = numericKeysOnly(normalizeParams(chosen.params));
  const filled = Array.from({ length: need }, (_, i) => String(bodyParams[String(i + 1)] ?? '').trim());
  if (filled.some((v) => v === '')) throw new Error(t(locale, 'tplParams', { n: need }));

  const headerFormat = String(comp('HEADER')?.format || '').toUpperCase();
  let mediaUrl = null;
  if (MEDIA_HEADERS.has(headerFormat)) {
    mediaUrl = String(chosen.mediaUrl || '').trim();
    if (!/^https:\/\/\S+/i.test(mediaUrl)) throw new Error(t(locale, 'tplNeedsMedia'));
  }

  return {
    name: match.name,
    language: match.language,
    category: match.category || 'MARKETING',
    bodyParams,
    mediaUrl,
  };
}

/**
 * startResend(deps, accountId, campaignId, locale, options) → { total, run_id, template_name }
 * deps: { query, makeClientFor, delayMs?, now? } — client injected so tests never send.
 * options.template: { name, language, params, mediaUrl } — omit to reuse the campaign's own.
 * options.inboxId: send from a DIFFERENT number than the campaign's — the way out when the
 *   original number's quality rating dropped and Meta is throttling everything it sends.
 */
export async function startResend(deps, accountId, campaignId, locale = 'he', options = {}) {
  const { query } = deps;
  const id = Number.parseInt(campaignId, 10);
  if (!Number.isInteger(id)) throw new Error(t(locale, 'notFound'));
  // ⚠️ נעילה ברמת החשבון, לא ברמת הקמפיין (12.8.26). ארבע שליחות מחדש שהותנעו בתוך
  // דקה וחצי הזרימו ~1,000 הודעות לאותו תור Sidekiq, שתפח לפיגור של ארבע דקות — וכל
  // הודעה של לקוח אמיתי חיכתה מאחוריהן. הן גם מתחרות על אותה מכסה יומית של אותו מספר,
  // אז אין שום יתרון בהרצה במקביל: ריצה אחת בכל רגע, השאר ממתינות לתורן.
  const key = jobKey(accountId, id);
  const busy = [...jobs.values()].find((j) => j.accountId === accountId && j.status === 'running');
  if (busy) throw new Error(t(locale, busy.campaignId === id ? 'running' : 'runningOther'));

  const detail = await getCampaignDetail(query, accountId, id);
  if (!detail) throw new Error(t(locale, 'notFound'));

  // המספר לשלוח ממנו: של הקמפיין כברירת מחדל. בחירה אחרת מאומתת מול החשבון — מזהה
  // תיבה מגיע מהדפדפן, ותיבה של חשבון אחר הייתה שולחת בשם מישהו אחר.
  const sendInboxId = await resolveSendInbox(query, accountId, detail.campaign, options?.inboxId, locale);
  const template = await resolveTemplate(query, detail.campaign, options?.template, locale, sendInboxId);

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
    // One run = one experiment. The id is the run's start clock, which also sorts the
    // experiments table without a second column.
    runId: `r${Date.now()}`,
    templateName: template.name,
    inboxId: sendInboxId,
    accountId,
    campaignId: id,
    waiting: false,          // עוצרים כרגע כדי לתת לתור של Chatwoot להתנקז
    startedAt: new Date().toISOString(),
  };
  jobs.set(key, job);

  // Fire-and-forget: the HTTP request returns immediately; the UI polls resendStatus.
  runJob(deps, { accountId, campaign: detail.campaign, template, sendInboxId, recipients: failedRecipients, suppressed, contactById, job, locale })
    .catch((e) => { job.failed.push({ phone: '', name: '', error: e.message }); })
    .finally(() => {
      job.status = 'done';
      const timer = setTimeout(() => { if (jobs.get(key) === job) jobs.delete(key); }, JOB_TTL_MS);
      if (timer.unref) timer.unref();
    });

  return { total: job.total, run_id: job.runId, template_name: job.templateName, inbox_id: sendInboxId };
}

async function runJob(deps, ctx) {
  const { query, makeClientFor, delayMs = SEND_GAP_MS } = deps;
  const { accountId, campaign, template, sendInboxId, recipients, suppressed, contactById, job, locale } = ctx;
  // הלקוח קורא את התבניות מהמספר ששולח. בלי זה הוא נופל ל"המספר הנבחר לחשבון",
  // ובחשבון בלי מספר נבחר הוא לא מוצא את התבנית כלל — ראו ההערה ב-makeClient.
  const client = await makeClientFor(accountId, sendInboxId);
  const { bodyParams, mediaUrl } = template;
  const sentIds = [];   // מזהי ההודעות שיצרנו — המדד ללחץ על התור של Chatwoot

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

      const displayId = await resolveConversation(query, client, accountId, sendInboxId, r, locale);
      const sent = await client.sendTemplate(displayId, {
        name: template.name,
        language: template.language,
        category: template.category,
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
            conversation_id, message_id, status, attempted_at, status_updated_at,
            resend_run_id, template_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, now(), now(), $9, $10)
         ON CONFLICT (account_id, campaign_id, source_id) DO NOTHING`,
        [accountId, campaign.id, r.contact_id || null, r.contact_name || '', r.phone || '',
          `retry:${campaign.id}:${r.contact_id || r.phone || attempt}:${Date.now()}`,
          msgRow?.conversation_id || null, sent?.id || null,
          job.runId, template.name]
      );
      if (sent?.id) sentIds.push(sent.id);
      job.sent += 1;
    } catch (e) {
      job.failed.push({ ...label, error: e.message });
    } finally {
      job.done += 1;
    }
    if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
    if (delayMs && attempt % BACKPRESSURE_CHECK_EVERY === 0) {
      await awaitQueueDrain(query, accountId, sentIds, job);
    }
  }
  job.waiting = false;
}

/**
 * עוצר את הריצה כשיותר מדי הודעות שלנו עדיין ממתינות ל-Sidekiq של Chatwoot.
 * ⛔ לעולם לא זורק: בלם שנשבר לא אמור להפיל שליחה שכבר יצאה לדרך — במקרה הגרוע
 * ממשיכים בקצב המקורי, בדיוק כמו קודם.
 */
async function awaitQueueDrain(query, accountId, sentIds, job) {
  const recent = sentIds.slice(-1500);   // מספיק כדי למדוד לחץ, בלי שאילתה שתופחת
  if (!recent.length) return;
  const pending = async () => Number((await query(
    `SELECT count(*)::int AS n FROM public.messages
      WHERE account_id = $1 AND id = ANY($2::bigint[]) AND source_id IS NULL AND status = 0`,
    [accountId, recent]
  ))[0]?.n || 0);
  try {
    if (await pending() < BACKPRESSURE_HIGH) return;
    const until = Date.now() + BACKPRESSURE_MAX_WAIT_MS;
    job.waiting = true;
    while (Date.now() < until) {
      await new Promise((res) => setTimeout(res, BACKPRESSURE_WAIT_MS));
      if (await pending() <= BACKPRESSURE_OK) break;
    }
  } catch { /* המדידה נכשלה — ממשיכים בקצב הרגיל */ }
  job.waiting = false;
}

/**
 * The conversation to send into: the contact's newest conversation ON THE SENDING INBOX,
 * else a fresh one. A Meta-rejected first send usually left NOTHING behind, so the create
 * path is the common case — source_id is the phone in digits, the same convention the whole
 * stack uses.
 *
 * ⚠️ The recipient's existing conversation is only reused when it belongs to the sending
 * inbox. Sending from a DIFFERENT number (the escape hatch when the original number's
 * quality dropped) into the old number's conversation would go out from the old number
 * anyway — the inbox owns the channel, not the message.
 */
async function resolveConversation(query, client, accountId, sendInboxId, recipient, locale) {
  const contactId = recipient.contact_id;
  if (!contactId) {
    if (recipient.conversation_display_id) return recipient.conversation_display_id;
    throw new Error(t(locale, 'noContact'));
  }

  const existing = (await query(
    `SELECT cv.display_id FROM public.conversations cv
      WHERE cv.account_id = $1 AND cv.contact_id = $2 AND cv.inbox_id = $3
      ORDER BY cv.id DESC LIMIT 1`,
    [accountId, contactId, sendInboxId]
  ))[0];
  if (existing?.display_id) return existing.display_id;

  const ci = (await query(
    `SELECT source_id FROM public.contact_inboxes WHERE contact_id = $1 AND inbox_id = $2 LIMIT 1`,
    [contactId, sendInboxId]
  ))[0];
  const sourceId = ci?.source_id || normalizeCampaignPhone(recipient.phone).replace(/^\+/, '');
  const opened = await client.createConversation({
    sourceId, inboxId: sendInboxId, contactId,
  });
  return opened.id;
}

// ── תזמון: "תריץ שליחה מחדש בשעה X" ──────────────────────────────────────────
// הנכשלים נקבעים בזמן ההרצה (startResend מחשב אותם מחדש), לא בזמן התזמון.

/** קביעה/החלפה של התזמון היחיד לקמפיין. run_at ISO. מחזיר { run_at }. */
export async function scheduleResend(query, accountId, campaignId, runAt, { template = null, locale = 'he', inboxId = null } = {}) {
  const id = Number.parseInt(campaignId, 10);
  const when = new Date(runAt);
  if (!Number.isInteger(id) || Number.isNaN(when.getTime())) throw new Error(t(locale, 'notFound'));
  await query(
    `DELETE FROM drip.campaign_resend_schedule
      WHERE account_id = $1 AND campaign_id = $2 AND started_at IS NULL`,
    [accountId, id]
  );
  await query(
    `INSERT INTO drip.campaign_resend_schedule (account_id, campaign_id, run_at, template, locale, inbox_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [accountId, id, when.toISOString(), template ? JSON.stringify(template) : null, locale,
      Number.isInteger(Number.parseInt(inboxId, 10)) ? Number.parseInt(inboxId, 10) : null]
  );
  return { run_at: when.toISOString() };
}

/** התזמון הממתין של הקמפיין (או null). */
export async function pendingResend(query, accountId, campaignId) {
  const id = Number.parseInt(campaignId, 10);
  if (!Number.isInteger(id)) return null;
  const row = (await query(
    `SELECT s.id, s.run_at, s.template ->> 'name' AS template_name, s.inbox_id,
            i.name AS inbox_name
       FROM drip.campaign_resend_schedule s
       LEFT JOIN public.inboxes i ON i.id = s.inbox_id
      WHERE s.account_id = $1 AND s.campaign_id = $2 AND s.started_at IS NULL
      ORDER BY s.run_at LIMIT 1`,
    [accountId, id]
  ))[0];
  return row || null;
}

/**
 * מספרי הוואטסאפ של החשבון עם דירוג האיכות של כל אחד — כדי שהבחירה "ממי לשלוח" תהיה
 * מיודעת. הדירוג מגיע מתצפית המספרים (drip.number_quality), שסורקת כל מספר בחשבון.
 */
export async function accountWhatsappInboxes(query, accountId) {
  return query(
    `SELECT i.id, i.name, cw.phone_number AS phone, nq.quality, nq.tier
       FROM public.inboxes i
       JOIN public.channel_whatsapp cw ON cw.id = i.channel_id
       LEFT JOIN drip.number_quality nq ON nq.inbox_id = i.id
      WHERE i.account_id = $1 AND i.channel_type = 'Channel::Whatsapp'
      ORDER BY i.id`,
    [accountId]
  );
}

export async function cancelScheduledResend(query, accountId, campaignId) {
  const id = Number.parseInt(campaignId, 10);
  if (!Number.isInteger(id)) return { cancelled: 0 };
  const rows = await query(
    `DELETE FROM drip.campaign_resend_schedule
      WHERE account_id = $1 AND campaign_id = $2 AND started_at IS NULL
      RETURNING id`,
    [accountId, id]
  );
  return { cancelled: rows.length };
}

/**
 * runDueResends — נקרא מהטיק. מסמן כל שורה שהגיע זמנה כ"התחילה" *לפני* ההתנעה, כדי
 * ששני טיקים חופפים לא ישלחו פעמיים; כישלון נרשם בשורה ולא מפיל את הטיק.
 */
export async function runDueResends(deps) {
  const { query } = deps;
  const due = await query(
    `UPDATE drip.campaign_resend_schedule
        SET started_at = now()
      WHERE id IN (
        SELECT id FROM drip.campaign_resend_schedule
         WHERE started_at IS NULL AND run_at <= now()
         ORDER BY run_at LIMIT 20 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, account_id, campaign_id, template, locale, inbox_id`
  );
  let started = 0;
  for (const row of due) {
    try {
      await startResend(deps, Number(row.account_id), Number(row.campaign_id), row.locale || 'he',
        { template: row.template || null, inboxId: row.inbox_id });
      started += 1;
    } catch (e) {
      await query('UPDATE drip.campaign_resend_schedule SET error = $2 WHERE id = $1',
        [row.id, String(e.message).slice(0, 500)]).catch(() => {});
    }
  }
  return { due: due.length, started };
}

// Test hook — a fresh suite must not inherit a finished job from a previous test.
export function _resetResendJobs() { jobs.clear(); }
