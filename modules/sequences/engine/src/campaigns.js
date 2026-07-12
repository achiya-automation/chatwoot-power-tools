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
 * whatsapp_campaign_conversations initializer). We use jsonb containment (@>) — NOT LIKE —
 * so campaign 16 never swallows 160/216. conversations.campaign_id is NULL for WhatsApp.
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

// Chatwoot stores naive timestamps in UTC (Rails convention). For display we convert to the
// operator's timezone: interpret the naive value as UTC, then shift. A single-step
// `col AT TIME ZONE tz` would do the OPPOSITE (treat the naive value as local) and shift the
// wrong way — hence the explicit two-step form.
const TZ = 'Asia/Jerusalem';
const localTs = (col) => `((${col}) AT TIME ZONE 'UTC' AT TIME ZONE '${TZ}')`;

// Per-campaign status counts, aggregated in ONE pass over messages carrying a campaign_id.
const AGG_CTE = `
  WITH msg AS (
    SELECT (${caObj('content_attributes')} ->> 'campaign_id')::int AS campaign_id, status
      FROM public.messages
     WHERE account_id = $1
       AND ${caObj('content_attributes')} ? 'campaign_id'
  ), agg AS (
    SELECT campaign_id,
           count(*)::int                              AS sent,
           count(*) FILTER (WHERE status IN (1,2))::int AS delivered,
           count(*) FILTER (WHERE status = 2)::int      AS read,
           count(*) FILTER (WHERE status = 3)::int      AS failed
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

// One campaign's full detail. Exact jsonb containment (never a substring match).
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

  // Recipients: one row per campaign message, joined to the contact + failure reason.
  // external_error is a plain string in prod (e.g. "131049: ..."), so read it with ->>.
  const recipients = await query(
    `SELECT ct.name AS contact_name,
            ct.phone_number AS phone,
            m.status,
            ${caObj('m.content_attributes')} ->> 'external_error' AS error_title,
            to_char(${localTs('m.created_at')}, 'YYYY-MM-DD HH24:MI') AS sent_at,
            m.conversation_id,
            cv.display_id AS conversation_display_id
       FROM public.messages m
       LEFT JOIN public.conversations cv ON cv.id = m.conversation_id
       LEFT JOIN public.contacts ct ON ct.id = cv.contact_id
      WHERE m.account_id = $1
        AND ${caObj('m.content_attributes')} @> jsonb_build_object('campaign_id', $2::int)
      ORDER BY m.created_at`,
    [accountId, id]
  );

  const funnel = recipients.reduce(
    (f, r) => {
      f.sent += 1;
      if (r.status === 1 || r.status === 2) f.delivered += 1;
      if (r.status === 2) f.read += 1;
      if (r.status === 3) f.failed += 1;
      return f;
    },
    { audience: 0, sent: 0, delivered: 0, read: 0, failed: 0 }
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
        AND ${caObj('m_out.content_attributes')} @> jsonb_build_object('campaign_id', $2::int)`,
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
      `SELECT conversation_display_id, contact_name, content, replied_at FROM (
         SELECT DISTINCT ON (m_in.conversation_id)
                cv.display_id AS conversation_display_id,
                ct.name AS contact_name,
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
          WHERE m_out.account_id = $1
            AND ${caObj('m_out.content_attributes')} @> jsonb_build_object('campaign_id', $2::int)
          ORDER BY m_in.conversation_id, m_in.created_at
       ) r
       ORDER BY r.first_reply_at DESC
       LIMIT 200`,
      [accountId, id]
    );
  } catch { replies = []; }
  const engagement = { replied, reply_rate: funnel.delivered ? Math.round((replied / funnel.delivered) * 100) : 0, replies };

  // "Not sent": audience labels → contacts (via acts-as-taggable) minus those who got a message.
  // Verified against real taggings schema: taggings/tags carry no account_id (shared across the
  // whole Chatwoot install), so a same-named tag in another account resolves to the SAME tags row —
  // ct.account_id is re-checked below to stop that from leaking another account's contacts in.
  // Best-effort: empty on any shape mismatch.
  let not_sent = [];
  try {
    not_sent = await query(
      `WITH aud AS (
         SELECT (a ->> 'id')::int AS label_id
           FROM public.campaigns c, jsonb_array_elements(c.audience) a
          WHERE c.id = $2 AND c.account_id = $1 AND a ->> 'type' = 'Label'
       ), aud_contacts AS (
         SELECT DISTINCT tg.taggable_id AS contact_id
           FROM aud
           JOIN public.labels l  ON l.id = aud.label_id AND l.account_id = $1
           JOIN public.tags   t  ON lower(t.name) = lower(l.title)
           JOIN public.taggings tg ON tg.tag_id = t.id
                AND tg.taggable_type = 'Contact' AND tg.context = 'labels'
       ), received AS (
         SELECT DISTINCT cv.contact_id
           FROM public.messages m
           JOIN public.conversations cv ON cv.id = m.conversation_id
          WHERE m.account_id = $1
            AND ${caObj('m.content_attributes')} @> jsonb_build_object('campaign_id', $2::int)
       )
       SELECT ct.name AS contact_name, ct.phone_number AS phone
         FROM aud_contacts ac
         JOIN public.contacts ct ON ct.id = ac.contact_id AND ct.account_id = $1
        WHERE ac.contact_id NOT IN (SELECT contact_id FROM received WHERE contact_id IS NOT NULL)
        ORDER BY ct.name NULLS LAST
        LIMIT 500`,
      [accountId, id]
    );
  } catch { not_sent = []; }
  funnel.audience = funnel.sent + not_sent.length;

  return { campaign, funnel, engagement, recipients, not_sent };
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
              count(*)::int AS sent,
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
            coalesce(a.sent, 0)      AS sent,
            coalesce(a.delivered, 0) AS delivered,
            coalesce(a.failed, 0)    AS failed
       FROM days
       LEFT JOIN agg a ON a.day = days.day
      ORDER BY days.day`,
    [accountId, days]
  );
}
