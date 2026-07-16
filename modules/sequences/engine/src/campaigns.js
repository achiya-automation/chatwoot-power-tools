import { DEFAULT_CAP } from './meta.js';

/**
 * The account's 24h cap, as last refreshed from Meta by the reconcile loop.
 * -1 in the column means the unlimited tier. Falls back to the conservative DEFAULT_CAP
 * when the account has no health row yet (first boot, before the first Graph read).
 */
async function readCapFromHealth(query, accountId) {
  const rows = await query('SELECT cap FROM drip.account_health WHERE account_id = $1', [accountId]);
  const cap = rows[0]?.cap;
  if (cap == null) return DEFAULT_CAP;
  return Number(cap) < 0 ? Infinity : Number(cap);
}

/**
 * campaigns.js — read-only campaign analytics from Chatwoot's own tables.
 *
 * Campaign→message link is ONLY messages.content_attributes.campaign_id (written by the
 * whatsapp_campaign_conversations initializer). We compare the parsed numeric value — never
 * LIKE/substring and never jsonb type-sensitive containment — so campaign 16 cannot swallow
 * 160/216 and legacy string campaign ids still match. conversations.campaign_id is NULL for WA.
 *
 * ⚠️ content_attributes in production is a DOUBLE-ENCODED JSON *string*
 * (e.g. "{\"campaign_id\":19,\"external_error\":\"131049: ...\"}"), not a jsonb object —
 * Chatwoot serializes the initializer's Ruby hash to a JSON string. `caObj(col)` normalizes
 * BOTH the double-encoded string AND a plain object to a real jsonb object via
 * `(col::jsonb #>> '{}')::jsonb`, so ?/->>/@> behave the same on either shape.
 * external_error is itself a plain string ("131049: ..."), not an object — read it with ->>.
 *
 * Status enum: sent:0, delivered:1, read:2, failed:3. "delivered" = status IN (1,2).
 */

// Normalize a content_attributes column to a jsonb OBJECT (handles the double-encoded-string
// production shape and a plain-object test/other shape identically).
const caObj = (col) => `(${col}::jsonb #>> '{}')::jsonb`;

// Campaign ids have existed as both JSON numbers and JSON strings. Comparing ->> as a guarded
// integer makes both shapes equivalent without accepting substrings or crashing on bad data.
const campaignIdEquals = (col, param = '$2') => `
  (${caObj(col)} ->> 'campaign_id') ~ '^[0-9]+$'
  AND (${caObj(col)} ->> 'campaign_id')::int = ${param}::int`;

/** Canonical E.164-ish display for campaign reports (Israeli local numbers get +972). */
export function normalizeCampaignPhone(value) {
  let digits = String(value ?? '').split('@', 1)[0].replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `972${digits.slice(1)}`;
  return digits ? `+${digits}` : '';
}

const phoneKey = (value) => normalizeCampaignPhone(value).replace(/^\+/, '');
const asPositiveInt = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// A campaign may create a second, channel-bound Contact record for an imported contact. The
// immutable audience snapshot (new campaigns) or current label membership (legacy fallback)
// is the canonical source for the human name and phone shown in the report.
async function loadAudienceContacts(query, accountId, campaignId) {
  return query(
    `WITH snap AS (
       SELECT contact_id, contact_name, phone, 'snapshot'::text AS audience_source
         FROM drip.campaign_audience_snapshots
        WHERE account_id = $1 AND campaign_id = $2
     ), aud AS (
       SELECT (a ->> 'id')::int AS label_id
         FROM public.campaigns c, jsonb_array_elements(c.audience) a
        WHERE c.id = $2 AND c.account_id = $1 AND a ->> 'type' = 'Label'
     ), current_aud AS (
       SELECT DISTINCT ct.id::bigint AS contact_id, ct.name AS contact_name,
              ct.phone_number AS phone, 'current_label'::text AS audience_source
         FROM aud
         JOIN public.labels l ON l.id = aud.label_id AND l.account_id = $1
         JOIN public.tags t ON lower(t.name) = lower(l.title)
         JOIN public.taggings tg ON tg.tag_id = t.id
              AND tg.taggable_type = 'Contact' AND tg.context = 'labels'
         JOIN public.contacts ct ON ct.id = tg.taggable_id AND ct.account_id = $1
     )
     SELECT contact_id, contact_name, phone, audience_source FROM snap
     UNION ALL
     SELECT contact_id, contact_name, phone, audience_source FROM current_aud
      WHERE NOT EXISTS (SELECT 1 FROM snap)
     ORDER BY contact_id`,
    [accountId, campaignId]
  );
}

function audienceResolver(audienceContacts) {
  const byId = new Map();
  const byPhone = new Map();
  for (const contact of audienceContacts) {
    const id = asPositiveInt(contact.contact_id);
    const phone = normalizeCampaignPhone(contact.phone);
    const item = { ...contact, contact_id: id, phone };
    if (id) byId.set(id, item);
    const key = phoneKey(phone);
    if (key) {
      const list = byPhone.get(key) || [];
      list.push(item);
      byPhone.set(key, list);
    }
  }

  // Legacy messages have no campaign_contact_id. Consume same-phone candidates once so two
  // audience contacts sharing a number do not both get marked attempted from one message.
  const usedIds = new Set();
  const resolve = ({ snapshotContactId, phone }) => {
    if (snapshotContactId && byId.has(snapshotContactId)) {
      const exact = byId.get(snapshotContactId);
      usedIds.add(exact.contact_id);
      return exact;
    }
    const candidates = byPhone.get(phoneKey(phone)) || [];
    const available = candidates.find((c) => !c.contact_id || !usedIds.has(c.contact_id));
    const chosen = available || candidates[0] || null;
    if (chosen?.contact_id) usedIds.add(chosen.contact_id);
    return chosen;
  };

  return { byId, byPhone, usedIds, resolve };
}

const STATUS_RANK = new Map([[2, 4], [1, 3], [0, 2], [3, 1]]);

function collapseRecipientAttempts(rawRecipients, audienceContacts) {
  const resolver = audienceResolver(audienceContacts);
  const grouped = new Map();
  const assignments = new Map();

  for (const raw of rawRecipients) {
    const snapshotContactId = asPositiveInt(raw.campaign_contact_id);
    const rawPhone = raw.campaign_phone || raw.contact_phone || raw.source_id || '';
    const assignmentKey = snapshotContactId ? `snapshot:${snapshotContactId}`
      : raw.contact_id ? `raw-contact:${raw.contact_id}`
        : raw.conversation_id ? `conversation:${raw.conversation_id}` : `phone:${phoneKey(rawPhone)}`;
    let canonical = assignments.get(assignmentKey);
    if (canonical === undefined) {
      canonical = resolver.resolve({ snapshotContactId, phone: rawPhone });
      assignments.set(assignmentKey, canonical);
    }
    const canonicalId = canonical?.contact_id || snapshotContactId;
    const phone = normalizeCampaignPhone(canonical?.phone || rawPhone);
    const key = canonicalId ? `contact:${canonicalId}`
      : phone ? `phone:${phoneKey(phone)}`
        : raw.contact_id ? `conversation-contact:${raw.contact_id}` : `message:${raw.message_id}`;
    const status = Number(raw.status);
    const item = {
      message_id: raw.message_id,
      contact_id: canonicalId || asPositiveInt(raw.contact_id),
      contact_name: raw.campaign_contact_name || canonical?.contact_name || raw.contact_name || '',
      phone,
      status,
      error_title: raw.error_title || '',
      sent_at: raw.sent_at || '',
      conversation_id: raw.conversation_id,
      conversation_display_id: raw.conversation_display_id,
      attempt_count: 1,
    };
    const previous = grouped.get(key);
    if (!previous) {
      grouped.set(key, item);
      continue;
    }
    previous.attempt_count += 1;
    const prevRank = STATUS_RANK.get(previous.status) || 0;
    const nextRank = STATUS_RANK.get(item.status) || 0;
    if (nextRank > prevRank || (nextRank === prevRank && item.sent_at > previous.sent_at)) {
      grouped.set(key, { ...item, attempt_count: previous.attempt_count });
    }
  }

  return { recipients: [...grouped.values()], attemptedAudienceIds: resolver.usedIds };
}

// Chatwoot stores naive timestamps in UTC (Rails convention). For display we convert to the
// operator's timezone: interpret the naive value as UTC, then shift. A single-step
// `col AT TIME ZONE tz` would do the OPPOSITE (treat the naive value as local) and shift the
// wrong way — hence the explicit two-step form.
const TZ = 'Asia/Jerusalem';
const localTs = (col) => `((${col}) AT TIME ZONE 'UTC' AT TIME ZONE '${TZ}')`;

// Per-campaign status counts, aggregated in ONE pass over messages carrying a campaign_id.
const AGG_CTE = `
  WITH raw_msg AS (
    SELECT (${caObj('m.content_attributes')} ->> 'campaign_id')::int AS campaign_id,
           coalesce(
             CASE WHEN nullif(${caObj('m.content_attributes')} ->> 'campaign_contact_id', '') IS NOT NULL
                  THEN 'contact:' || (${caObj('m.content_attributes')} ->> 'campaign_contact_id') END,
             CASE WHEN nullif(regexp_replace(coalesce(
               ${caObj('m.content_attributes')} ->> 'campaign_phone',
               ci.source_id,
               ct.phone_number,
               ''), '[^0-9]', '', 'g'), '') IS NOT NULL
                  THEN 'phone:' || regexp_replace(coalesce(
                    ${caObj('m.content_attributes')} ->> 'campaign_phone',
                    ci.source_id,
                    ct.phone_number,
                    ''), '[^0-9]', '', 'g') END,
             CASE WHEN cv.contact_id IS NOT NULL THEN 'contact:' || cv.contact_id::text END,
             'message:' || m.id::text
           ) AS recipient_key,
           m.status
      FROM public.messages m
      LEFT JOIN public.conversations cv ON cv.id = m.conversation_id
      LEFT JOIN public.contact_inboxes ci ON ci.id = cv.contact_inbox_id
      LEFT JOIN public.contacts ct ON ct.id = cv.contact_id
     WHERE m.account_id = $1
       AND (${caObj('m.content_attributes')} ->> 'campaign_id') ~ '^[0-9]+$'
  ), msg AS (
    SELECT campaign_id, recipient_key,
           CASE WHEN bool_or(status = 2) THEN 2
                WHEN bool_or(status = 1) THEN 1
                WHEN bool_or(status = 0) THEN 0
                WHEN bool_or(status = 3) THEN 3
                ELSE -1 END AS status
      FROM raw_msg
     GROUP BY campaign_id, recipient_key
  ), agg AS (
    SELECT campaign_id,
           count(*)::int                                  AS attempted,
           count(*) FILTER (WHERE status IN (0,1,2))::int AS sent,
           count(*) FILTER (WHERE status IN (1,2))::int   AS delivered,
           count(*) FILTER (WHERE status = 2)::int        AS read,
           count(*) FILTER (WHERE status = 3)::int        AS failed
      FROM msg GROUP BY campaign_id
  )`;

export async function listCampaigns(query, accountId) {
  const rows = await query(
    `${AGG_CTE}
     SELECT c.id, c.display_id, c.title, c.campaign_type, c.campaign_status,
            c.template_params ->> 'name'     AS template_name,
            c.template_params ->> 'language' AS language,
            c.template_params ->> 'category' AS category,
            c.audience,
            to_char(${localTs('c.scheduled_at')}, 'YYYY-MM-DD HH24:MI') AS scheduled_at,
            to_char(${localTs('c.created_at')},  'YYYY-MM-DD HH24:MI') AS created_at,
            coalesce(a.attempted, 0) AS attempted,
            coalesce(a.sent, 0)      AS sent,
            coalesce(a.delivered, 0) AS delivered,
            coalesce(a.read, 0)      AS read,
            coalesce(a.failed, 0)    AS failed
       FROM public.campaigns c
       JOIN public.inboxes i ON i.id = c.inbox_id AND i.channel_type = 'Channel::Whatsapp'
       LEFT JOIN agg a ON a.campaign_id = c.id
      WHERE c.account_id = $1
      ORDER BY c.created_at DESC NULLS LAST, c.id DESC`,
    [accountId]
  );
  return rows;
}

// One campaign's full detail. One row per logical recipient, even if a send was retried.
export async function getCampaignDetail(query, accountId, campaignId) {
  const id = parseInt(campaignId, 10);
  if (Number.isNaN(id)) return null; // missing/non-numeric campaign_id → clean null, not a DB error
  const campaign = (await query(
    `SELECT c.id, c.title, c.message, c.campaign_type, c.campaign_status, c.audience,
            c.template_params ->> 'name'     AS template_name,
            c.template_params ->> 'language' AS language,
            c.template_params ->> 'category' AS category,
            to_char(${localTs('c.created_at')}, 'YYYY-MM-DD HH24:MI') AS created_at
       FROM public.campaigns c
      WHERE c.account_id = $1 AND c.id = $2 LIMIT 1`,
    [accountId, id]
  ))[0] || null;
  if (!campaign) return null;

  const audienceContacts = await loadAudienceContacts(query, accountId, id);
  const audienceSource = audienceContacts[0]?.audience_source || 'none';

  // Raw attempts. The conversation contact can be a channel-created duplicate with no useful
  // name/phone, so canonical contact data is resolved against the captured audience below.
  const rawRecipients = await query(
    `SELECT m.id AS message_id,
            cv.contact_id,
            ct.name AS contact_name,
            ct.phone_number AS contact_phone,
            ci.source_id,
            ${caObj('m.content_attributes')} ->> 'campaign_contact_id' AS campaign_contact_id,
            ${caObj('m.content_attributes')} ->> 'campaign_contact_name' AS campaign_contact_name,
            ${caObj('m.content_attributes')} ->> 'campaign_phone' AS campaign_phone,
            m.status,
            ${caObj('m.content_attributes')} ->> 'external_error' AS error_title,
            to_char(${localTs('m.created_at')}, 'YYYY-MM-DD HH24:MI') AS sent_at,
            m.conversation_id,
            cv.display_id AS conversation_display_id
       FROM public.messages m
       LEFT JOIN public.conversations cv ON cv.id = m.conversation_id
       LEFT JOIN public.contacts ct ON ct.id = cv.contact_id
       LEFT JOIN public.contact_inboxes ci ON ci.id = cv.contact_inbox_id
      WHERE m.account_id = $1
        AND ${campaignIdEquals('m.content_attributes')}
      ORDER BY m.created_at, m.id`,
    [accountId, id]
  );
  const { recipients, attemptedAudienceIds } = collapseRecipientAttempts(rawRecipients, audienceContacts);

  const funnel = recipients.reduce(
    (f, r) => {
      f.attempted += 1;
      if (r.status === 0 || r.status === 1 || r.status === 2) f.sent += 1;
      if (r.status === 1 || r.status === 2) f.delivered += 1;
      if (r.status === 2) f.read += 1;
      if (r.status === 3) f.failed += 1;
      if (r.status === 0) f.pending += 1;
      return f;
    },
    { audience: 0, attempted: 0, sent: 0, delivered: 0, read: 0, failed: 0, pending: 0 }
  );

  // Engagement: distinct conversations with an INCOMING message after the campaign send.
  const replied = Number((await query(
    `SELECT count(DISTINCT m_in.conversation_id)::int AS c
       FROM public.messages m_out
       JOIN public.messages m_in
         ON m_in.conversation_id = m_out.conversation_id
        AND m_in.message_type = 0
        AND m_in.created_at > m_out.created_at
      WHERE m_out.account_id = $1
        AND ${campaignIdEquals('m_out.content_attributes')}`,
    [accountId, id]
  ))[0]?.c || 0);

  // The replies themselves (first incoming message per conversation, capped): who replied,
  // what they opened with, and the conversation display_id for a click-through into Chatwoot.
  // Best-effort — the count above stays exact even when this list is capped or fails.
  let replies = [];
  try {
    // הפנימי: התגובה הראשונה לכל שיחה (DISTINCT ON מחייב מיון לפי conversation_id);
    // החיצוני: טריות קודם — לידים חדשים למעלה, וב-overflow נשמרים ה-200 העדכניים.
    replies = await query(
      `SELECT conversation_display_id, contact_id, contact_name, contact_phone, source_id,
              campaign_contact_id, campaign_phone, content, replied_at FROM (
         SELECT DISTINCT ON (m_in.conversation_id)
                cv.display_id AS conversation_display_id,
                cv.contact_id,
                ct.name AS contact_name,
                ct.phone_number AS contact_phone,
                ci.source_id,
                ${caObj('m_out.content_attributes')} ->> 'campaign_contact_id' AS campaign_contact_id,
                ${caObj('m_out.content_attributes')} ->> 'campaign_phone' AS campaign_phone,
                left(m_in.content, 240) AS content,
                to_char(${localTs('m_in.created_at')}, 'YYYY-MM-DD HH24:MI') AS replied_at,
                m_in.created_at AS first_reply_at
           FROM public.messages m_out
           JOIN public.messages m_in
             ON m_in.conversation_id = m_out.conversation_id
            AND m_in.message_type = 0
            AND m_in.created_at > m_out.created_at
           JOIN public.conversations cv ON cv.id = m_in.conversation_id
           LEFT JOIN public.contacts ct ON ct.id = cv.contact_id
           LEFT JOIN public.contact_inboxes ci ON ci.id = cv.contact_inbox_id
          WHERE m_out.account_id = $1
            AND ${campaignIdEquals('m_out.content_attributes')}
          ORDER BY m_in.conversation_id, m_in.created_at
       ) r
       ORDER BY r.first_reply_at DESC
       LIMIT 200`,
      [accountId, id]
    );
  } catch { replies = []; }
  const replyResolver = audienceResolver(audienceContacts);
  replies = replies.map((reply) => {
    const snapshotContactId = asPositiveInt(reply.campaign_contact_id);
    const rawPhone = reply.campaign_phone || reply.contact_phone || reply.source_id || '';
    const canonical = replyResolver.resolve({ snapshotContactId, phone: rawPhone });
    return {
      conversation_display_id: reply.conversation_display_id,
      contact_name: canonical?.contact_name || reply.contact_name || '',
      phone: normalizeCampaignPhone(canonical?.phone || rawPhone),
      content: reply.content,
      replied_at: reply.replied_at,
    };
  });
  const engagement = { replied, reply_rate: funnel.delivered ? Math.round((replied / funnel.delivered) * 100) : 0, replies };

  // Exact for snapshotted campaigns; legacy fallback is explicitly marked current_label.
  const attemptedPhones = new Set(recipients.map((r) => phoneKey(r.phone)).filter(Boolean));
  const not_sent = audienceContacts
    .filter((contact) => {
      const contactId = asPositiveInt(contact.contact_id);
      if (contactId) return !attemptedAudienceIds.has(contactId);
      const key = phoneKey(contact.phone);
      return !key || !attemptedPhones.has(key);
    })
    .map((contact) => ({
      contact_id: asPositiveInt(contact.contact_id),
      contact_name: contact.contact_name || '',
      phone: normalizeCampaignPhone(contact.phone),
      reason: 'no_attempt_record',
    }));
  funnel.audience = audienceContacts.length || funnel.attempted;

  return { campaign, funnel, engagement, recipients, not_sent, audience_source: audienceSource };
}

// Preflight: Meta's 24h send budget for the account — the tier cap, minus distinct
// conversations messaged in the rolling 24h (drip sends + campaign sends; failed sends never
// opened a conversation so they don't count).
//
// The cap is read from drip.account_health, which the reconcile loop refreshes from the Graph
// API every ~30 minutes. A dashboard read must not trigger its own Graph call: it would be a
// second source of truth, and it would hit Meta once per page view.
//
// Advisory display only — the drip reconciler keeps enforcing its own budget. Best-effort:
// returns null on any query failure so the UI simply hides the line.
// _reads is kept in the signature (unused) so the store.js call site and the existing tests
// stay untouched — the cap now comes from drip.account_health, not from a Graph read.
export async function campaignsTierInfo(query, _reads, accountId, deps = {}) {
  const { getCap = readCapFromHealth } = deps;
  try {
    const cap = await getCap(query, accountId);
    const used = Number((await query(
      `SELECT count(DISTINCT cid)::int AS c FROM (
         SELECT sm.conversation_id AS cid
           FROM drip.sent_messages sm
           LEFT JOIN public.messages m ON m.id = sm.message_id
          WHERE sm.account_id = $1
            AND sm.sent_at > now() - interval '24 hours'
            AND (m.status IS NULL OR m.status <> 3)
         UNION
         SELECT m.conversation_id
           FROM public.messages m
          WHERE m.account_id = $1
            AND m.created_at > now() - interval '24 hours'
            AND ${caObj('m.content_attributes')} ? 'campaign_id'
            AND m.status <> 3
       ) u`,
      [accountId]
    ))[0]?.c || 0);
    const unlimited = !Number.isFinite(cap);
    return {
      cap: unlimited ? null : cap,
      unlimited,
      used_24h: used,
      remaining: unlimited ? null : Math.max(0, cap - used),
    };
  } catch { return null; }
}

// Daily campaign-message trend (last `days`), Asia/Jerusalem, oldest → newest.
// Zero-filled: every day in the range gets a row (generate_series), so quiet days show as
// gaps in the chart instead of silently disappearing from the axis.
export async function campaignsTrend(query, accountId, days = 14) {
  days = Math.min(90, Math.max(1, parseInt(days, 10) || 14)); // client-supplied — clamp
  return query(
    `WITH days AS (
       SELECT d::date AS day
         FROM generate_series(
                (now() AT TIME ZONE '${TZ}')::date - ($2::int - 1) * interval '1 day',
                (now() AT TIME ZONE '${TZ}')::date,
                interval '1 day') d
     ), agg AS (
       SELECT ${localTs('m.created_at')}::date AS day,
              count(*)::int AS attempted,
              count(*) FILTER (WHERE m.status IN (0,1,2))::int AS sent,
              count(*) FILTER (WHERE m.status IN (1,2))::int AS delivered,
              count(*) FILTER (WHERE m.status = 3)::int       AS failed
         FROM public.messages m
        WHERE m.account_id = $1
          AND ${caObj('m.content_attributes')} ? 'campaign_id'
          -- naive-UTC range, one day wider than needed (index-friendly; no per-row TZ math in
          -- the WHERE) — the JOIN against \`days\` drops the spillover bucket.
          AND m.created_at >= (now() AT TIME ZONE '${TZ}')::date - $2::int * interval '1 day'
        GROUP BY 1
     )
     SELECT to_char(days.day, 'DD/MM') AS day,
            coalesce(a.attempted, 0) AS attempted,
            coalesce(a.sent, 0)      AS sent,
            coalesce(a.delivered, 0) AS delivered,
            coalesce(a.failed, 0)    AS failed
       FROM days
       LEFT JOIN agg a ON a.day = days.day
      ORDER BY days.day`,
    [accountId, days]
  );
}
