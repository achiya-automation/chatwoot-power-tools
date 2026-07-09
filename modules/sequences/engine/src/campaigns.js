/**
 * campaigns.js — read-only campaign analytics from Chatwoot's own tables.
 *
 * Campaign→message link is ONLY messages.content_attributes.campaign_id (written by the
 * whatsapp_campaign_conversations initializer). We use jsonb containment (@>) — NOT LIKE —
 * so campaign 16 never swallows 160/216. conversations.campaign_id is NULL for WhatsApp.
 *
 * Status enum: sent:0, delivered:1, read:2, failed:3. "delivered" = status IN (1,2).
 */

// Per-campaign status counts, aggregated in ONE pass over messages carrying a campaign_id.
// content_attributes may be json OR jsonb depending on the column type; cast to jsonb for `?`/`->>'`.
const AGG_CTE = `
  WITH msg AS (
    SELECT (content_attributes::jsonb ->> 'campaign_id')::int AS campaign_id, status
      FROM public.messages
     WHERE account_id = $1
       AND content_attributes::jsonb ? 'campaign_id'
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
            to_char(c.scheduled_at, 'YYYY-MM-DD HH24:MI') AS scheduled_at,
            to_char(c.created_at,  'YYYY-MM-DD HH24:MI') AS created_at,
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
