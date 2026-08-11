import { tierToCap } from './meta.js';

/**
 * The account's 24h cap, as last refreshed from Meta by the reconcile loop.
 * -1 in the column means the unlimited tier.
 *
 * ⚠️ Returns null — NOT DEFAULT_CAP — when there is no health row. DEFAULT_CAP (250) is a
 * conservative floor for DECIDING WHETHER TO SEND; as a number on screen it is a lie. An
 * account with a real 2,000 cap but no sequences (so the tick never reads its health) was
 * shown "only 194 messages left today" and talked out of a perfectly legitimate send.
 * The caller falls back to the number-quality observation, and failing that says "unknown".
 */
async function readCapFromHealth(query, accountId) {
  const rows = await query('SELECT cap FROM drip.account_health WHERE account_id = $1', [accountId]);
  const cap = rows[0]?.cap;
  if (cap == null) return null;
  return Number(cap) < 0 ? Infinity : Number(cap);
}

/**
 * campaigns.js — read-only campaign analytics from Chatwoot's own tables.
 *
 * New sends are linked through drip.campaign_send_snapshots, an immutable per-attempt ledger
 * keyed by Meta's message id. Legacy rows fall back to messages.content_attributes.campaign_id.
 * We compare the parsed numeric value — never LIKE/substring and never jsonb type-sensitive
 * containment — so campaign 16 cannot swallow 160/216 and string campaign ids still match.
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

// SQL equivalent of normalizeCampaignPhone for joins against the immutable audience. This is
// used only to recover legacy retry rows that have no campaign_contact_id of their own.
const sqlPhoneKey = (expr) => `(
  CASE
    WHEN regexp_replace(coalesce(${expr}, ''), '[^0-9]', '', 'g') LIKE '00%'
      THEN substr(regexp_replace(coalesce(${expr}, ''), '[^0-9]', '', 'g'), 3)
    WHEN regexp_replace(coalesce(${expr}, ''), '[^0-9]', '', 'g') LIKE '0%'
      THEN '972' || substr(regexp_replace(coalesce(${expr}, ''), '[^0-9]', '', 'g'), 2)
    ELSE regexp_replace(coalesce(${expr}, ''), '[^0-9]', '', 'g')
  END)`;

// Campaign ids have existed as both JSON numbers and JSON strings. Comparing ->> as a guarded
// integer makes both shapes equivalent without accepting substrings or crashing on bad data.
const campaignIdEquals = (col, param = '$2') => `
  ${hasCampaignId(col)}
  AND (${caObj(col)} ->> 'campaign_id')::int = ${param}::int`;

// "This message belongs to a campaign" — the one guard every campaign query must use.
// This exact text is also the partial-index predicate (migration 045); the planner only
// picks the index when the query predicate provably implies it, so keep them identical.
// (It also guards the ::int casts above/below — `? 'campaign_id'` alone let a non-numeric
// value crash the query.)
const hasCampaignId = (col) => `(${caObj(col)} ->> 'campaign_id') ~ '^[0-9]+$'`;

// "ההודעה הזאת עדיין לא מיוצגת ב-ledger" — הבדיקה שמפרידה שורות legacy מכפילויות.
// ¬(A ∨ B) נכתב כאן במפורש כ-¬A ∧ ¬B, וזה לא קוסמטי: כשה-OR יושב בתוך NOT EXISTS אחד,
// Postgres יכול לגבב רק את campaign_id ואת שאר התנאי הוא מריץ כ-Join Filter על כל צירוף
// בתוך הדלי. בחשבון עם 23K הודעות מול 23K שורות ledger זה 22.4 מיליון השוואות — 125 שניות
// לתשובה ריקה, מספיק כדי לרוקן את בריכת החיבורים ולהשבית את הפאנל של כל הלקוחות (10.8.26).
// מפוצל, לכל ענף יש תנאי שוויון שלם לגבב עליו: אותה תשובה בדיוק ב-0.4 שניות.
// `scope` הוא תנאי הקמפיין הנוסף (או '' כשהשאילתה כבר מסננת אחרת) ומודבק לשני הענפים.
const notInLedger = (scope = '') => `NOT EXISTS (
             SELECT 1 FROM drip.campaign_send_snapshots s
              WHERE s.account_id = m.account_id${scope}
                AND s.message_id = m.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM drip.campaign_send_snapshots s
              WHERE s.account_id = m.account_id${scope}
                AND m.source_id IS NOT NULL AND s.source_id = m.source_id
           )`;

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
      message_id: asPositiveInt(raw.message_id),
      contact_id: canonicalId || asPositiveInt(raw.contact_id),
      contact_name: raw.campaign_contact_name || canonical?.contact_name || raw.contact_name || '',
      phone,
      status,
      error_title: raw.error_title || '',
      sent_at: raw.sent_at || '',
      conversation_id: asPositiveInt(raw.conversation_id),
      conversation_display_id: asPositiveInt(raw.conversation_display_id),
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
// For timestamptz columns (the drip ledger) the value already carries a zone, so ONE
// conversion is the whole job. Running localTs on them re-reads the UTC clock reading as
// a local wall time and shifts the result three hours back — a send at 18:30 reads 12:30.
const localTsTz = (col) => `((${col}) AT TIME ZONE '${TZ}')`;

// Per-campaign status counts. The durable send ledger wins; explicitly tagged legacy messages
// are included only when the same Meta/message id is not already represented in the ledger.
const AGG_CTE = `
  WITH snapshot_msg AS (
    SELECT s.campaign_id,
           coalesce(
             CASE WHEN s.contact_id IS NOT NULL THEN 'contact:' || s.contact_id::text END,
             CASE WHEN nullif(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
                  THEN 'phone:' || regexp_replace(s.phone, '[^0-9]', '', 'g') END,
             'source:' || s.source_id
           ) AS recipient_key,
           CASE WHEN s.status = 3 THEN 3
                ELSE greatest(s.status, coalesce(current_message.status, 0)) END AS status
      FROM drip.campaign_send_snapshots s
      LEFT JOIN LATERAL (
        SELECT m.status FROM public.messages m
         WHERE m.account_id = s.account_id
           AND (m.id = s.message_id OR (m.source_id IS NOT NULL AND m.source_id = s.source_id))
         ORDER BY (m.id = s.message_id) DESC, m.id DESC
         LIMIT 1
      ) current_message ON true
     WHERE s.account_id = $1
  ), legacy_msg AS (
    SELECT (${caObj('m.content_attributes')} ->> 'campaign_id')::int AS campaign_id,
           coalesce(
             CASE WHEN nullif(${caObj('m.content_attributes')} ->> 'campaign_contact_id', '') IS NOT NULL
                  THEN 'contact:' || (${caObj('m.content_attributes')} ->> 'campaign_contact_id') END,
             CASE WHEN aud.contact_id IS NOT NULL THEN 'contact:' || aud.contact_id::text END,
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
      LEFT JOIN LATERAL (
        SELECT a.contact_id
          FROM drip.campaign_audience_snapshots a
         WHERE a.account_id = m.account_id
           AND a.campaign_id = CASE
             WHEN (${caObj('m.content_attributes')} ->> 'campaign_id') ~ '^[0-9]+$'
             THEN (${caObj('m.content_attributes')} ->> 'campaign_id')::int
           END
           AND ${sqlPhoneKey('a.phone')} = ${sqlPhoneKey(`coalesce(
             ${caObj('m.content_attributes')} ->> 'campaign_phone',
             ci.source_id,
             ct.phone_number,
             '')`)}
         ORDER BY a.contact_id
         LIMIT 1
      ) aud ON true
     WHERE m.account_id = $1
       AND ${hasCampaignId('m.content_attributes')}
       AND ${notInLedger(`
                AND s.campaign_id = (${caObj('m.content_attributes')} ->> 'campaign_id')::int`)}
  ), raw_msg AS (
    SELECT campaign_id, recipient_key, status FROM snapshot_msg
    UNION ALL
    SELECT campaign_id, recipient_key, status FROM legacy_msg
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
            coalesce(a.failed, 0)    AS failed,
            coalesce(aud.n, 0)       AS audience_size
       FROM public.campaigns c
       JOIN public.inboxes i ON i.id = c.inbox_id AND i.channel_type = 'Channel::Whatsapp'
       LEFT JOIN agg a ON a.campaign_id = c.id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS n FROM drip.campaign_audience_snapshots s
          WHERE s.account_id = c.account_id AND s.campaign_id = c.id
       ) aud ON true
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
            c.inbox_id, c.template_params,
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

  // Raw attempts. The durable ledger recovers sends where Chatwoot's outgoing-echo message lost
  // campaign_id; tagged messages remain a compatibility fallback for campaigns predating it.
  // The conversation contact can be a channel-created duplicate with no useful name/phone, so
  // canonical contact data is resolved against the captured audience below.
  const rawRecipients = await query(
    `WITH snapshot_rows AS (
       SELECT coalesce(m.id, s.message_id) AS message_id,
              cv.contact_id,
              ct.name AS contact_name,
              ct.phone_number AS contact_phone,
              ci.source_id,
              s.contact_id::text AS campaign_contact_id,
              s.contact_name AS campaign_contact_name,
              s.phone AS campaign_phone,
              CASE WHEN s.status = 3 THEN 3
                   ELSE greatest(s.status, coalesce(m.status, 0)) END AS status,
              coalesce(s.error_title, ${caObj('m.content_attributes')} ->> 'external_error') AS error_title,
              to_char(${localTsTz('s.attempted_at')}, 'YYYY-MM-DD HH24:MI') AS sent_at,
              coalesce(m.conversation_id, s.conversation_id) AS conversation_id,
              cv.display_id AS conversation_display_id
         FROM drip.campaign_send_snapshots s
         LEFT JOIN LATERAL (
           SELECT mm.* FROM public.messages mm
            WHERE mm.account_id = s.account_id
              AND (mm.id = s.message_id OR (mm.source_id IS NOT NULL AND mm.source_id = s.source_id))
            ORDER BY (mm.id = s.message_id) DESC, mm.id DESC
            LIMIT 1
         ) m ON true
         LEFT JOIN public.conversations cv ON cv.id = coalesce(m.conversation_id, s.conversation_id)
         LEFT JOIN public.contacts ct ON ct.id = cv.contact_id
         LEFT JOIN public.contact_inboxes ci ON ci.id = cv.contact_inbox_id
        WHERE s.account_id = $1 AND s.campaign_id = $2
     ), legacy_rows AS (
       SELECT m.id AS message_id,
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
          AND ${notInLedger(' AND s.campaign_id = $2')}
     )
     SELECT * FROM snapshot_rows
     UNION ALL
     SELECT * FROM legacy_rows
     ORDER BY sent_at, message_id`,
    [accountId, id]
  );
  const { recipients, attemptedAudienceIds } = collapseRecipientAttempts(rawRecipients, audienceContacts);

  const funnel = recipients.reduce(
    (f, r) => {
      // status 4 = שורת ledger של דילוג: הנמען היה בקהל אבל שום שליחה לא נוסתה
      // (אין טלפון / אין תבנית / משתנה ריק). היא נספרת בקהל ומוצגת בטבלה עם הסיבה,
      // אבל אינה ניסיון — אחרת "נוסו" היה כולל את מי שמעולם לא פנינו אליו.
      if (r.status === 4) { f.skipped += 1; return f; }
      f.attempted += 1;
      if (r.status === 0 || r.status === 1 || r.status === 2) f.sent += 1;
      if (r.status === 1 || r.status === 2) f.delivered += 1;
      if (r.status === 2) f.read += 1;
      if (r.status === 3) f.failed += 1;
      if (r.status === 0) f.pending += 1;
      return f;
    },
    { audience: 0, attempted: 0, sent: 0, delivered: 0, read: 0, failed: 0, pending: 0, skipped: 0 }
  );

  // Engagement uses all attempt conversations, including recovered outgoing-echo rows without
  // campaign_id. Restrict incoming messages to after the campaign was created.
  const conversationIds = [...new Set(rawRecipients.map((r) => asPositiveInt(r.conversation_id)).filter(Boolean))];
  // The ids themselves, not just the count: the per-recipient "replied" flag (report filter +
  // CSV column) must stay exact even when the reply-content list below is capped or fails.
  const repliedRows = conversationIds.length ? await query(
    `SELECT DISTINCT m_in.conversation_id AS conversation_id
       FROM public.messages m_in
      WHERE m_in.account_id = $1
        AND m_in.message_type = 0
        AND m_in.conversation_id = ANY($3::bigint[])
        AND m_in.created_at > (SELECT created_at FROM public.campaigns WHERE account_id = $1 AND id = $2)`,
    [accountId, id, conversationIds]
  ) : [];
  const repliedConversationIds = new Set(repliedRows.map((r) => asPositiveInt(r.conversation_id)).filter(Boolean));
  const replied = repliedConversationIds.size;

  // The replies themselves (first incoming message per conversation, capped): who replied,
  // what they opened with, and the conversation display_id for a click-through into Chatwoot.
  // Best-effort — the count above stays exact even when this list is capped or fails.
  let replies = [];
  try {
    if (!conversationIds.length) throw new Error('no campaign conversations');
    // הפנימי: התגובה הראשונה לכל שיחה (DISTINCT ON מחייב מיון לפי conversation_id);
    // החיצוני: טריות קודם — לידים חדשים למעלה, וב-overflow נשמרים ה-1000 העדכניים.
    // התקרה קיימת כדי שקמפיין ענק לא ינפח את ה-payload; היא חלה על *תוכן* התגובה בלבד —
    // דגל "הגיב" לכל נמען מגיע מ-repliedConversationIds ולכן נשאר מדויק גם מעליה.
    replies = await query(
      `SELECT conversation_id, conversation_display_id, contact_id, contact_name, contact_phone,
              source_id, content, replied_at FROM (
         SELECT DISTINCT ON (m_in.conversation_id)
                m_in.conversation_id,
                cv.display_id AS conversation_display_id,
                cv.contact_id,
                ct.name AS contact_name,
                ct.phone_number AS contact_phone,
                ci.source_id,
                left(m_in.content, 240) AS content,
                to_char(${localTs('m_in.created_at')}, 'YYYY-MM-DD HH24:MI') AS replied_at,
                m_in.created_at AS first_reply_at
           FROM public.messages m_in
           JOIN public.conversations cv ON cv.id = m_in.conversation_id
           LEFT JOIN public.contacts ct ON ct.id = cv.contact_id
           LEFT JOIN public.contact_inboxes ci ON ci.id = cv.contact_inbox_id
          WHERE m_in.account_id = $1
            AND m_in.message_type = 0
            AND m_in.conversation_id = ANY($3::bigint[])
            AND m_in.created_at > (SELECT created_at FROM public.campaigns WHERE account_id = $1 AND id = $2)
          ORDER BY m_in.conversation_id, m_in.created_at
       ) r
       ORDER BY r.first_reply_at DESC
       LIMIT 1000`,
      [accountId, id, conversationIds]
    );
  } catch { replies = []; }
  // תוכן התגובה לכל שיחה, לפני ההמרה לתצוגה (שם) — מזין את עמודות התגובה בטבלה ובייצוא.
  const replyByConversation = new Map(replies.map((r) => [asPositiveInt(r.conversation_id), r]));
  for (const r of recipients) {
    const cid = asPositiveInt(r.conversation_id);
    const reply = cid ? replyByConversation.get(cid) : null;
    r.replied = !!(cid && repliedConversationIds.has(cid));
    r.reply_content = reply?.content || '';
    r.replied_at = reply?.replied_at || '';
  }
  const replyResolver = audienceResolver(audienceContacts);
  const recipientByConversation = new Map(recipients.map((r) => [asPositiveInt(r.conversation_id), r]));
  replies = replies.map((reply) => {
    const recipient = recipientByConversation.get(asPositiveInt(reply.conversation_id));
    const snapshotContactId = asPositiveInt(recipient?.contact_id);
    const rawPhone = recipient?.phone || reply.contact_phone || reply.source_id || '';
    const canonical = replyResolver.resolve({ snapshotContactId, phone: rawPhone });
    return {
      conversation_display_id: reply.conversation_display_id,
      contact_name: recipient?.contact_name || canonical?.contact_name || reply.contact_name || '',
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
  funnel.audience = audienceContacts.length || (funnel.attempted + funnel.skipped);

  return { campaign, funnel, engagement, recipients, not_sent, audience_source: audienceSource };
}

/**
 * One row per "experiment" on a campaign: the original send (resend_run_id IS NULL) and every
 * resend run after it, each with the template it used and how that batch actually performed.
 *
 * Deliberately NOT collapsed per recipient like getCampaignDetail: the question here is
 * "how did THIS template do on the batch it was sent to", so the same person appearing in two
 * experiments is the point, not a duplicate. Row counts therefore sum to more than the
 * audience, and each row is read on its own.
 *
 * A reply is credited to the attempt it followed: after that attempt's send, and before the
 * next attempt in the same conversation (lead()). Without the upper bound every earlier
 * experiment would inherit the replies of the later one and all of them would look identical.
 */
export async function campaignExperiments(query, accountId, campaignId) {
  const id = parseInt(campaignId, 10);
  if (Number.isNaN(id)) return [];
  return query(
    `WITH att AS (
       SELECT s.resend_run_id AS run_id,
              s.template_name,
              s.conversation_id,
              s.attempted_at,
              CASE WHEN s.status = 3 THEN 3
                   ELSE greatest(s.status, coalesce(m.status, 0)) END AS status,
              lead(s.attempted_at) OVER (
                PARTITION BY s.conversation_id ORDER BY s.attempted_at, s.source_id
              ) AS next_at
         FROM drip.campaign_send_snapshots s
         LEFT JOIN LATERAL (
           SELECT mm.status FROM public.messages mm
            WHERE mm.account_id = s.account_id
              AND (mm.id = s.message_id OR (mm.source_id IS NOT NULL AND mm.source_id = s.source_id))
            ORDER BY (mm.id = s.message_id) DESC, mm.id DESC
            LIMIT 1
         ) m ON true
        WHERE s.account_id = $1 AND s.campaign_id = $2
     ), scored AS (
       SELECT att.*, EXISTS (
         SELECT 1 FROM public.messages mi
          WHERE mi.account_id = $1
            AND mi.message_type = 0
            AND mi.conversation_id = att.conversation_id
            AND mi.created_at >  (att.attempted_at AT TIME ZONE 'UTC')
            AND (att.next_at IS NULL OR mi.created_at < (att.next_at AT TIME ZONE 'UTC'))
       ) AS replied
         FROM att
     )
     SELECT run_id,
            max(template_name)                                AS template_name,
            to_char(${localTsTz('min(attempted_at)')}, 'YYYY-MM-DD HH24:MI') AS started_at,
            count(*) FILTER (WHERE status <> 4)::int          AS attempted,
            count(*) FILTER (WHERE status IN (0,1,2))::int    AS sent,
            count(*) FILTER (WHERE status IN (1,2))::int      AS delivered,
            count(*) FILTER (WHERE status = 2)::int           AS read,
            count(*) FILTER (WHERE status = 3)::int           AS failed,
            count(*) FILTER (WHERE replied)::int              AS replied
       FROM scored
      GROUP BY run_id
      HAVING count(*) FILTER (WHERE status <> 4) > 0
      ORDER BY min(attempted_at)`,
    [accountId, id]
  );
}

// Preflight: Meta's 24h send budget for the account — the tier cap, minus distinct
// conversations messaged in the rolling 24h (drip sends + durable campaign attempts).
//
// The cap is read from drip.account_health, which the reconcile loop refreshes from the Graph
// API every ~30 minutes. A dashboard read must not trigger its own Graph call: it would be a
// second source of truth, and it would hit Meta once per page view.
//
// Advisory display only — the drip reconciler keeps enforcing its own budget. Best-effort:
// returns null on any query failure so the UI simply hides the line.
// _reads is kept in the signature (unused) so the store.js call site and the existing tests
// stay untouched — the cap now comes from drip.account_health, not from a Graph read.
export async function campaignsTierInfo(query, _reads, accountId, deps = {}, inboxId = null) {
  const { getCap = readCapFromHealth } = deps;
  try {
    // מאיפה המכסה, לפי סדר אמינות:
    //   1. drip.account_health — מה שהמנוע קרא ממטא לחשבון הזה.
    //   2. drip.number_quality — התצפית שסורקת את *כל* המספרים, גם של חשבונות שהמנוע
    //      לא שולח בשמם. inboxId (המספר שהקמפיין נשלח ממנו) מדויק יותר מהחשבון.
    //   3. כלום — ואז אומרים "לא ידוע" ולא מציגים מספר (ראו readCapFromHealth).
    let cap = await getCap(query, accountId);
    if (cap == null) {
      const q = (await query(
        `SELECT tier FROM drip.number_quality
          WHERE account_id = $1 AND tier IS NOT NULL AND ($2::int IS NULL OR inbox_id = $2::int)
          ORDER BY (inbox_id = $2::int) DESC NULLS LAST, checked_at DESC
          LIMIT 1`,
        [accountId, inboxId == null ? null : Number(inboxId)]
      ))[0];
      if (q?.tier) cap = tierToCap(q.tier);
    }
    if (cap == null) return { cap: null, unlimited: false, unknown: true, used_24h: null, remaining: null };
    const used = Number((await query(
      `SELECT count(DISTINCT cid)::int AS c FROM (
         SELECT sm.conversation_id AS cid
           FROM drip.sent_messages sm
           LEFT JOIN public.messages m ON m.id = sm.message_id
          WHERE sm.account_id = $1
            AND sm.sent_at > now() - interval '24 hours'
            AND (m.status IS NULL OR m.status <> 3)
         UNION
         SELECT s.conversation_id
           FROM drip.campaign_send_snapshots s
          WHERE s.account_id = $1
            AND s.attempted_at > now() - interval '24 hours'
            AND s.status <> 3
            AND s.conversation_id IS NOT NULL
         UNION
         SELECT m.conversation_id
           FROM public.messages m
          WHERE m.account_id = $1
            AND m.created_at > now() - interval '24 hours'
            AND ${hasCampaignId('m.content_attributes')}
            AND m.status <> 3
            AND ${notInLedger()}
       ) u`,
      [accountId]
    ))[0]?.c || 0);
    const unlimited = !Number.isFinite(cap);
    return {
      cap: unlimited ? null : cap,
      unlimited,
      unknown: false,
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
     ), attempt_rows AS (
       SELECT s.attempted_at AT TIME ZONE '${TZ}' AS local_created_at,
              CASE WHEN s.status = 3 THEN 3
                   ELSE greatest(s.status, coalesce(current_message.status, 0)) END AS status
         FROM drip.campaign_send_snapshots s
         LEFT JOIN LATERAL (
           SELECT m.status FROM public.messages m
            WHERE m.account_id = s.account_id
              AND (m.id = s.message_id OR (m.source_id IS NOT NULL AND m.source_id = s.source_id))
            ORDER BY (m.id = s.message_id) DESC, m.id DESC
            LIMIT 1
         ) current_message ON true
        WHERE s.account_id = $1
          AND s.attempted_at >= now() - ($2::int + 1) * interval '1 day'
       UNION ALL
       SELECT ${localTs('m.created_at')} AS local_created_at, m.status
         FROM public.messages m
        WHERE m.account_id = $1
          AND ${hasCampaignId('m.content_attributes')}
          AND m.created_at >= (now() AT TIME ZONE '${TZ}')::date - $2::int * interval '1 day'
          AND NOT EXISTS (
            SELECT 1 FROM drip.campaign_send_snapshots s
             WHERE s.account_id = m.account_id
               AND s.campaign_id = (${caObj('m.content_attributes')} ->> 'campaign_id')::int
          )
     ), agg AS (
       SELECT local_created_at::date AS day,
              count(*)::int AS attempted,
              count(*) FILTER (WHERE status IN (0,1,2))::int AS sent,
              count(*) FILTER (WHERE status IN (1,2))::int AS delivered,
              count(*) FILTER (WHERE status = 3)::int       AS failed
         FROM attempt_rows
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
