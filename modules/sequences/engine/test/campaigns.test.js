import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb } from './helpers.js';
import { getPool, query } from '../src/db.js';
import { listCampaigns, getCampaignDetail, campaignsTrend, campaignsTierInfo, normalizeCampaignPhone } from '../src/campaigns.js';
import { DEFAULT_CAP, _resetHealthCache } from '../src/meta.js';
import { handleAction } from '../src/store.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

// Shared beforeEach for Tasks 2/3/4/7B — creates the public stand-in tables (like reads.test.js).
// content_attributes is `json` (matches ci.yml + delivery.test.js); all campaign queries cast ::jsonb,
// which works on json here and on prod's jsonb column alike.
beforeEach(async () => {
  await setupDb(pool); // schema drip
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.campaigns (id int PRIMARY KEY, display_id int, account_id int, inbox_id int, title text, message text, campaign_type int, campaign_status int, audience jsonb DEFAULT '[]'::jsonb, template_params jsonb DEFAULT '{}'::jsonb, scheduled_at timestamp, created_at timestamp);
    CREATE TABLE IF NOT EXISTS public.messages (id int, conversation_id int, account_id int, message_type int, content text, status int, content_attributes json, source_id text, created_at timestamp);
    CREATE TABLE IF NOT EXISTS public.conversations (id int PRIMARY KEY, display_id int, account_id int, contact_id int, contact_inbox_id int, inbox_id int, campaign_id int);
    CREATE TABLE IF NOT EXISTS public.contact_inboxes (id int PRIMARY KEY, contact_id int, inbox_id int, source_id text);
    CREATE TABLE IF NOT EXISTS public.contacts (id int PRIMARY KEY, account_id int, name text, phone_number text, email text);
    CREATE TABLE IF NOT EXISTS public.inboxes (id int PRIMARY KEY, account_id int, name text, channel_type text, channel_id int);
    CREATE TABLE IF NOT EXISTS public.labels (id int PRIMARY KEY, account_id int, title text);
    CREATE TABLE IF NOT EXISTS public.tags (id int PRIMARY KEY, name text);
    CREATE TABLE IF NOT EXISTS public.taggings (id int PRIMARY KEY, tag_id int, taggable_type text, taggable_id int, context text);
  `);
  // drip.sent_messages משתתפת בחישוב ה-tier (union) — מנקים גם אותה כדי שבדיקות מקבצים
  // אחרים (delivery/send_cap) לא ידלפו לספירת ה-24h.
  await pool.query('TRUNCATE public.campaigns, public.messages, public.contacts, public.conversations, public.contact_inboxes, public.inboxes, public.labels, public.tags, public.taggings, drip.sent_messages, drip.campaign_audience_snapshots, drip.campaign_send_snapshots');
});

test('scaffold: campaigns table is queryable', async () => {
  await query(`INSERT INTO public.campaigns(id, account_id, inbox_id, title, campaign_type, campaign_status)
               VALUES (1, 1, 10, 'בדיקה', 1, 1)`);
  const rows = await query(`SELECT title FROM public.campaigns WHERE account_id = $1`, [1]);
  assert.equal(rows[0].title, 'בדיקה');
});

// ── listCampaigns: per-campaign status aggregation ──

async function seedCampaign({ id, account = 1, inbox = 10, type = 1, status = 1, title = 'קמפיין', tpl = { name: 'welcome', language: 'he', category: 'MARKETING' } }) {
  await query(`INSERT INTO public.campaigns(id, display_id, account_id, inbox_id, title, campaign_type, campaign_status, template_params, created_at)
               VALUES ($1,$1,$2,$3,$4,$5,$6,$7, now())`,
    [id, account, inbox, title, type, status, JSON.stringify(tpl)]);
  // WhatsApp inbox so the join filters it in
  await query(`INSERT INTO public.inboxes(id, account_id, name, channel_type, channel_id) VALUES ($1,$2,'WA','Channel::Whatsapp',$1) ON CONFLICT (id) DO NOTHING`, [inbox, account]);
}
// Explicit UTC-naive "now" for seeding created_at. A bare SQL `now()` is a timestamptz; assigning
// it into a naive `timestamp` column implicitly casts through the Postgres session's *default*
// TimeZone GUC, so the stored value silently becomes LOCAL wall-clock time whenever that GUC isn't
// UTC — true for a freshly created database that inherited the OS timezone instead of an explicit
// UTC override. Real Chatwoot/Rails never hits this: it formats a UTC instant into a plain,
// zone-less string at the app layer before sending it, so the column holds true UTC regardless of
// the DB session's timezone (see the localTs() comment in src/campaigns.js, which depends on that).
// Building the naive-UTC string here in JS mirrors that, so seeded rows land in the correct
// campaignsTrend day bucket on every machine, at every hour, independent of the session TimeZone.
const utcNow = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString().replace('Z', '').replace('T', ' ');

async function seedCampaignMessage({ id, account = 1, conv = 500, campaignId, status, sourceId = `wamid-${id}`, createdAt = utcNow() }) {
  await query(`INSERT INTO public.messages(id, conversation_id, account_id, message_type, status, content_attributes, source_id, created_at)
               VALUES ($1,$2,$3,1,$4,$5,$6,$7)`,
    // prod stores content_attributes DOUBLE-ENCODED (a JSON string, not an object) — mirror it
    [id, conv, account, status, JSON.stringify(JSON.stringify({ campaign_id: campaignId })), sourceId, createdAt]);
}

test('listCampaigns: aggregates status counts per campaign', async () => {
  await seedCampaign({ id: 16, title: 'השקה' });
  await seedCampaignMessage({ id: 1, campaignId: 16, status: 1 }); // delivered
  await seedCampaignMessage({ id: 2, campaignId: 16, status: 2 }); // read
  await seedCampaignMessage({ id: 3, campaignId: 16, status: 3 }); // failed
  const list = await listCampaigns(query, 1);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'השקה');
  assert.equal(list[0].attempted, 3);
  assert.equal(list[0].sent, 2); // failed is an attempt, not a successful send
  assert.equal(list[0].delivered, 2); // status 1 + 2
  assert.equal(list[0].read, 1);
  assert.equal(list[0].failed, 1);
  assert.equal(list[0].template_name, 'welcome');
});

test('listCampaigns: campaign 16 does not swallow campaign 160 (no LIKE bug)', async () => {
  await seedCampaign({ id: 16, title: 'A' });
  await seedCampaign({ id: 160, title: 'B' });
  await seedCampaignMessage({ id: 1, campaignId: 160, status: 1 });
  const list = await listCampaigns(query, 1);
  const c16 = list.find((c) => c.id === 16);
  assert.equal(c16.sent, 0); // messages for 160 must NOT count toward 16
});

test('listCampaigns: normalizes a plain-object content_attributes too (not only double-encoded)', async () => {
  await seedCampaign({ id: 50, title: 'obj' });
  // single-encoded plain jsonb object — caObj must handle this shape as well as the prod string
  await query(`INSERT INTO public.messages(id, conversation_id, account_id, message_type, status, content_attributes, created_at)
               VALUES (77, 500, 1, 1, 2, $1, now())`, [JSON.stringify({ campaign_id: 50 })]);
  const c = (await listCampaigns(query, 1)).find((x) => x.id === 50);
  assert.equal(c.sent, 1);
  assert.equal(c.read, 1);
});

// ── getCampaignDetail: funnel + recipients + engagement + not_sent ──

test('getCampaignDetail: funnel + recipients + engagement', async () => {
  await seedCampaign({ id: 20, title: 'מבצע' });
  await query(`INSERT INTO public.contacts(id, account_id, name, phone_number) VALUES (1,1,'דנה','+972500000001'),(2,1,'רון','+972500000002')`);
  await query(`INSERT INTO public.conversations(id, display_id, account_id, contact_id) VALUES (500,500,1,1),(501,501,1,2)`);
  await seedCampaignMessage({ id: 1, conv: 500, campaignId: 20, status: 2 }); // דנה קראה
  await seedCampaignMessage({ id: 2, conv: 501, campaignId: 20, status: 1 }); // רון נמסר
  // דנה הגיבה (incoming אחרי ה-outgoing)
  await query(`INSERT INTO public.messages(id, conversation_id, account_id, message_type, status, created_at)
               VALUES (99, 500, 1, 0, 0, now() + interval '1 minute')`);

  const d = await getCampaignDetail(query, 1, 20);
  assert.equal(d.campaign.title, 'מבצע');
  assert.equal(d.funnel.attempted, 2);
  assert.equal(d.funnel.sent, 2);
  assert.equal(d.funnel.delivered, 2); // status 1 + 2
  assert.equal(d.funnel.read, 1);
  assert.equal(d.engagement.replied, 1); // דנה
  assert.equal(d.recipients.length, 2);
  const dana = d.recipients.find((r) => r.phone === '+972500000001');
  assert.equal(dana.status, 2);
  const ron = d.recipients.find((r) => r.phone === '+972500000002');
  assert.equal(ron.status, 1); // רון לא הגיב — לא נספר ב-engagement
});

test('getCampaignDetail: unknown campaign returns null', async () => {
  const d = await getCampaignDetail(query, 1, 999999);
  assert.equal(d, null);
});

test('getCampaignDetail: failed message carries error_title + conversation_id', async () => {
  await seedCampaign({ id: 23, title: 'נכשל' });
  await query(`INSERT INTO public.contacts(id, account_id, name, phone_number) VALUES (3,1,'עומר','+972500000003')`);
  await query(`INSERT INTO public.conversations(id, display_id, account_id, contact_id) VALUES (502,502,1,3)`);
  await query(`INSERT INTO public.messages(id, conversation_id, account_id, message_type, status, content_attributes, created_at)
               VALUES (4, 502, 1, 1, 3, $1, now())`,
    [JSON.stringify(JSON.stringify({ campaign_id: 23, external_error: '131049: Recipient opted out' }))]);

  const d = await getCampaignDetail(query, 1, 23);
  assert.equal(d.funnel.failed, 1);
  const r = d.recipients[0];
  assert.equal(r.error_title, '131049: Recipient opted out');
  assert.equal(r.conversation_id, 502);
});

test('getCampaignDetail: not_sent = labeled audience minus recipients; excludes cross-account tag collisions', async () => {
  await seedCampaign({ id: 21, title: 'תזכורת' });
  await query(`UPDATE public.campaigns SET audience = $1 WHERE id = 21`, [JSON.stringify([{ id: 5, type: 'Label' }])]);
  await query(`INSERT INTO public.labels(id, account_id, title) VALUES (5, 1, 'VIP')`);
  await query(`INSERT INTO public.tags(id, name) VALUES (7, 'VIP')`);

  // שני אנשי קשר של account 1 מתויגים VIP: אחד קיבל הודעה, השני לא.
  await query(`INSERT INTO public.contacts(id, account_id, name, phone_number) VALUES (10,1,'שירה','+972500000010'),(11,1,'איתי','+972500000011')`);
  await query(`INSERT INTO public.conversations(id, display_id, account_id, contact_id) VALUES (510,510,1,10)`);
  await seedCampaignMessage({ id: 10, conv: 510, campaignId: 21, status: 1 }); // שירה קיבלה
  await query(`INSERT INTO public.taggings(id, tag_id, taggable_type, taggable_id, context) VALUES (100,7,'Contact',10,'labels'),(101,7,'Contact',11,'labels')`);

  // איש קשר של account אחר (2) מתויג באותו שם תג ('VIP' → אותה שורת tags גלובלית) — לא אמור לדלוף ל-not_sent של account 1.
  await query(`INSERT INTO public.contacts(id, account_id, name, phone_number) VALUES (12,2,'זר','+972500000012')`);
  await query(`INSERT INTO public.taggings(id, tag_id, taggable_type, taggable_id, context) VALUES (102,7,'Contact',12,'labels')`);

  const d = await getCampaignDetail(query, 1, 21);
  assert.equal(d.not_sent.length, 1);
  assert.equal(d.not_sent[0].phone, '+972500000011'); // איתי — לא קיבל
  assert.equal(d.funnel.audience, 2); // sent(1) + not_sent(1)
  assert.equal(d.audience_source, 'current_label');
});

test('getCampaignDetail: snapshot restores canonical names/phones and collapses retries', async () => {
  await seedCampaign({ id: 22, title: 'מקור אמת' });
  // Original imported audience contacts (correct business data).
  await query(`INSERT INTO public.contacts(id, account_id, name, phone_number) VALUES
    (20,1,'לקוחה מקורית','0501234567'),
    (21,1,'לא נוסתה','+972501234568'),
    (120,1,'WhatsApp 972501234567',NULL)`);
  await query(`INSERT INTO public.contact_inboxes(id, contact_id, inbox_id, source_id) VALUES
    (220,120,10,'972501234567')`);
  await query(`INSERT INTO public.conversations(id, display_id, account_id, contact_id, contact_inbox_id, inbox_id) VALUES
    (520,9520,1,120,220,10)`);
  await query(`INSERT INTO drip.campaign_audience_snapshots(account_id,campaign_id,contact_id,contact_name,phone) VALUES
    (1,22,20,'לקוחה מקורית','0501234567'),
    (1,22,21,'לא נוסתה','+972501234568')`);
  // Same logical contact: first attempt failed, retry was read. String campaign_id must match too.
  await query(`INSERT INTO public.messages(id,conversation_id,account_id,message_type,status,content_attributes,created_at) VALUES
    (2201,520,1,1,3,$1,now()),
    (2202,520,1,1,2,$2,now() + interval '1 minute')`, [
    JSON.stringify(JSON.stringify({ campaign_id: 22, external_error: '131049: failed' })),
    JSON.stringify(JSON.stringify({ campaign_id: '22' })),
  ]);

  const d = await getCampaignDetail(query, 1, 22);
  assert.equal(d.audience_source, 'snapshot');
  assert.deepEqual(d.funnel, { audience: 2, attempted: 1, sent: 1, delivered: 1, read: 1, failed: 0, pending: 0 });
  assert.equal(d.recipients.length, 1);
  assert.equal(d.recipients[0].contact_name, 'לקוחה מקורית');
  assert.equal(d.recipients[0].phone, '+972501234567');
  assert.equal(d.recipients[0].attempt_count, 2);
  assert.equal(d.recipients[0].status, 2);
  assert.equal(d.not_sent.length, 1);
  assert.equal(d.not_sent[0].contact_name, 'לא נוסתה');

  const summary = (await listCampaigns(query, 1)).find((c) => c.id === 22);
  assert.equal(summary.attempted, 1);
  assert.equal(summary.sent, 1);
  assert.equal(summary.failed, 0);
});

test('getCampaignDetail: durable send ledger recovers an untagged echo and preserves failure', async () => {
  await seedCampaign({ id: 24, title: 'היסטוריה יציבה' });
  await query(`INSERT INTO public.contacts(id, account_id, name, phone_number) VALUES
    (30,1,'לקוח מקורי','0501234570'),
    (130,1,'WhatsApp 972501234570',NULL)`);
  await query(`INSERT INTO public.contact_inboxes(id, contact_id, inbox_id, source_id) VALUES
    (230,130,10,'972501234570')`);
  await query(`INSERT INTO public.conversations(id, display_id, account_id, contact_id, contact_inbox_id, inbox_id, campaign_id) VALUES
    (530,9530,1,130,230,10,24)`);
  await query(`INSERT INTO drip.campaign_audience_snapshots(account_id,campaign_id,contact_id,contact_name,phone) VALUES
    (1,24,30,'לקוח מקורי','0501234570')`);

  // Chatwoot's outgoing echo has no campaign_id and currently says sent, but the durable ledger
  // retained the final Meta failure and the original target identity.
  await query(`INSERT INTO public.messages(id,conversation_id,account_id,message_type,status,content_attributes,source_id,created_at) VALUES
    (2401,530,1,1,0,NULL,'wamid-24',now())`);
  await query(`INSERT INTO drip.campaign_send_snapshots
    (account_id,campaign_id,contact_id,contact_name,phone,source_id,conversation_id,message_id,status,error_title)
    VALUES (1,24,30,'לקוח מקורי','0501234570','wamid-24',530,2401,3,'131049: failed')`);

  const d = await getCampaignDetail(query, 1, 24);
  assert.deepEqual(d.funnel, { audience: 1, attempted: 1, sent: 0, delivered: 0, read: 0, failed: 1, pending: 0 });
  assert.equal(d.not_sent.length, 0);
  assert.equal(d.recipients[0].contact_name, 'לקוח מקורי');
  assert.equal(d.recipients[0].phone, '+972501234570');
  assert.equal(d.recipients[0].status, 3);
  assert.equal(d.recipients[0].error_title, '131049: failed');

  const summary = (await listCampaigns(query, 1)).find((c) => c.id === 24);
  assert.equal(summary.attempted, 1);
  assert.equal(summary.sent, 0);
  assert.equal(summary.failed, 1);
});

test('listCampaigns: ledger and unmatched legacy retry collapse to one audience contact', async () => {
  await seedCampaign({ id: 25, title: 'ניסיון חוזר' });
  await query(`INSERT INTO public.contacts(id, account_id, name, phone_number) VALUES
    (40,1,'מקור','0501234580'),
    (140,1,'WhatsApp 972501234580',NULL)`);
  await query(`INSERT INTO public.contact_inboxes(id, contact_id, inbox_id, source_id) VALUES
    (240,140,10,'972501234580')`);
  await query(`INSERT INTO public.conversations(id, display_id, account_id, contact_id, contact_inbox_id, inbox_id, campaign_id) VALUES
    (540,9540,1,140,240,10,25)`);
  await query(`INSERT INTO drip.campaign_audience_snapshots(account_id,campaign_id,contact_id,contact_name,phone) VALUES
    (1,25,40,'מקור','0501234580')`);
  await query(`INSERT INTO public.messages(id,conversation_id,account_id,message_type,status,content_attributes,source_id,created_at) VALUES
    (2501,540,1,1,0,NULL,'wamid-25',now()),
    (2502,540,1,1,2,$1,'wamid-25-retry',now() + interval '1 minute')`,
    [JSON.stringify(JSON.stringify({ campaign_id: 25 }))]);
  await query(`INSERT INTO drip.campaign_send_snapshots
    (account_id,campaign_id,contact_id,contact_name,phone,source_id,conversation_id,message_id,status)
    VALUES (1,25,40,'מקור','0501234580','wamid-25',540,2501,0)`);

  const summary = (await listCampaigns(query, 1)).find((c) => c.id === 25);
  assert.equal(summary.attempted, 1);
  assert.equal(summary.sent, 1);
  assert.equal(summary.read, 1);
  assert.equal(summary.failed, 0);
});

test('normalizeCampaignPhone: local, international, JID, and blank values', () => {
  assert.equal(normalizeCampaignPhone('050-123-4567'), '+972501234567');
  assert.equal(normalizeCampaignPhone('00972 50 123 4567'), '+972501234567');
  assert.equal(normalizeCampaignPhone('972501234567@s.whatsapp.net'), '+972501234567');
  assert.equal(normalizeCampaignPhone(null), '');
});

// ── handleAction: campaigns + campaign_detail wiring (Task 4) ──

test('handleAction: campaigns + campaign_detail', async () => {
  await seedCampaign({ id: 30, title: 'רשימה' });
  await seedCampaignMessage({ id: 1, campaignId: 30, status: 2 });
  const list = await handleAction(1, 'campaigns', {});
  assert.equal(list.data[0].title, 'רשימה');
  const detail = await handleAction(1, 'campaign_detail', { campaign_id: 30 });
  assert.equal(detail.data.campaign.title, 'רשימה');
});

test('getCampaignDetail: missing/non-numeric campaign_id → null (no DB error)', async () => {
  assert.equal(await getCampaignDetail(query, 1, 'abc'), null);
  assert.equal(await getCampaignDetail(query, 1, undefined), null);
  assert.equal(await getCampaignDetail(query, 1, null), null);
});

// ── campaignsTrend: daily bucketing (Task 7B) ──

test('campaignsTrend: buckets campaign messages by day', async () => {
  await seedCampaign({ id: 40 });
  await seedCampaignMessage({ id: 1, campaignId: 40, status: 1 });
  await seedCampaignMessage({ id: 2, campaignId: 40, status: 3 });
  const trend = await campaignsTrend(query, 1, 14);
  assert.ok(trend.length >= 1);
  const last = trend[trend.length - 1];
  assert.equal(last.attempted, 2);
  assert.equal(last.sent, 1);
  assert.equal(last.delivered, 1);
  assert.equal(last.failed, 1);
});

// Real day-bucketing (not just same-day aggregation): a message from 2 days ago must land
// in its OWN bucket, distinct from today's, ordered oldest → newest — with the series
// zero-filled so quiet days appear as explicit zero rows (chart gaps stay visible).
test('campaignsTrend: separates messages into distinct day buckets, zero-filled, oldest → newest', async () => {
  await seedCampaign({ id: 41 });
  await seedCampaignMessage({ id: 3, campaignId: 41, status: 1 }); // today: delivered
  // 2 days ago: failed — same utcNow() basis as "today" above, just offset, so both land in their
  // exact intended calendar-day bucket regardless of the hour the suite happens to run at.
  await seedCampaignMessage({ id: 4, campaignId: 41, status: 3, createdAt: utcNow(-2 * 86400000) });
  const trend = await campaignsTrend(query, 1, 14);
  assert.equal(trend.length, 14); // one row per day in the window, empty days included
  const nonzero = trend.filter((r) => r.attempted > 0);
  assert.equal(nonzero.length, 2); // the two active days, still distinct buckets
  const [older, newer] = nonzero; // series order is oldest → newest
  assert.equal(older.sent, 0);
  assert.equal(older.attempted, 1);
  assert.equal(older.failed, 1);
  assert.equal(older.delivered, 0);
  assert.equal(newer.sent, 1);
  assert.equal(newer.attempted, 1);
  assert.equal(newer.delivered, 1);
  assert.equal(newer.failed, 0);
  // the day between them exists as an explicit zero row
  const between = trend[trend.indexOf(newer) - 1];
  assert.equal(between.sent, 0);
});

test('campaignsTrend: clamps client-supplied days to 1..90', async () => {
  await seedCampaign({ id: 43 });
  const huge = await campaignsTrend(query, 1, 100000);
  assert.equal(huge.length, 90);
  const neg = await campaignsTrend(query, 1, -5);
  assert.equal(neg.length, 1);
});

// Display timestamps are converted UTC → Asia/Jerusalem (Chatwoot stores naive UTC).
// 2026-01-01 22:00 UTC = 2026-01-02 00:00 Israel (IST, +02:00 in January — no DST ambiguity).
test('getCampaignDetail: sent_at renders in Asia/Jerusalem, not raw UTC', async () => {
  await seedCampaign({ id: 44, title: 'שעון' });
  await query(`INSERT INTO public.contacts(id, account_id, name, phone_number) VALUES (5,1,'נועה','+972500000005')`);
  await query(`INSERT INTO public.conversations(id, display_id, account_id, contact_id) VALUES (503,503,1,5)`);
  await query(
    `INSERT INTO public.messages(id, conversation_id, account_id, message_type, status, content_attributes, created_at)
     VALUES (6, 503, 1, 1, 1, $1, '2026-01-01 22:00:00')`,
    [JSON.stringify(JSON.stringify({ campaign_id: 44 }))]
  );
  const d = await getCampaignDetail(query, 1, 44);
  assert.equal(d.recipients[0].sent_at, '2026-01-02 00:00');
});

// Base cross-account ownership: account 2 must not read account 1's campaign via a tampered id.
test('getCampaignDetail: campaign of another account → null (IDOR)', async () => {
  await seedCampaign({ id: 45, account: 1, title: 'פרטי' });
  assert.equal(await getCampaignDetail(query, 2, 45), null);
});

// ── engagement.replies: the reply list (who answered, first message, conversation link) ──

test('getCampaignDetail: replies list carries name, first message, and display_id', async () => {
  await seedCampaign({ id: 46, title: 'שיחות' });
  await query(`INSERT INTO public.contacts(id, account_id, name, phone_number) VALUES (7,1,'הילה','+972500000007')`);
  await query(`INSERT INTO public.conversations(id, display_id, account_id, contact_id) VALUES (504,9504,1,7)`);
  await seedCampaignMessage({ id: 8, conv: 504, campaignId: 46, status: 2 });
  // שתי תגובות נכנסות — הרשימה חייבת להחזיר את הראשונה בלבד (DISTINCT ON לפי שיחה)
  await query(`INSERT INTO public.messages(id, conversation_id, account_id, message_type, content, status, created_at)
               VALUES (90, 504, 1, 0, 'מעוניינת בפרטים', 0, now() + interval '1 minute'),
                      (91, 504, 1, 0, 'עוד שאלה', 0, now() + interval '2 minutes')`);
  // שיחה שנייה שהגיבה מאוחר יותר — חייבת להופיע ראשונה (טריות קודם, לידים חדשים למעלה)
  await query(`INSERT INTO public.contacts(id, account_id, name, phone_number) VALUES (8,1,'יואב','+972500000008')`);
  await query(`INSERT INTO public.conversations(id, display_id, account_id, contact_id) VALUES (507,9507,1,8)`);
  await seedCampaignMessage({ id: 9, conv: 507, campaignId: 46, status: 1 });
  await query(`INSERT INTO public.messages(id, conversation_id, account_id, message_type, content, status, created_at)
               VALUES (92, 507, 1, 0, 'מגיב מאוחר', 0, now() + interval '10 minutes')`);

  const d = await getCampaignDetail(query, 1, 46);
  assert.equal(d.engagement.replied, 2);
  assert.equal(d.engagement.replies.length, 2);
  assert.equal(d.engagement.replies[0].contact_name, 'יואב'); // האחרון להגיב — ראשון ברשימה
  const r = d.engagement.replies[1];
  assert.equal(r.contact_name, 'הילה');
  assert.equal(r.conversation_display_id, 9504);
  assert.equal(r.content, 'מעוניינת בפרטים'); // הראשונה מבין שתי התגובות של אותה שיחה
  // ולנמענים יש כעת display_id לניווט
  assert.equal(d.recipients[0].conversation_display_id, 9504);
});

// ── campaignsTierInfo: 24h budget preflight ──

test('campaignsTierInfo: counts distinct 24h campaign conversations, failed excluded', async () => {
  await seedCampaign({ id: 47 });
  await query(`INSERT INTO public.conversations(id, display_id, account_id, contact_id) VALUES (505,505,1,1),(506,506,1,2) ON CONFLICT (id) DO NOTHING`);
  await seedCampaignMessage({ id: 20, conv: 505, campaignId: 47, status: 1 }); // נמסר — נספר
  await query(`INSERT INTO public.messages(id, conversation_id, account_id, message_type, status, content_attributes, created_at)
               VALUES (21, 506, 1, 1, 3, $1, now())`, // נכשל — לא פתח שיחה, לא נספר
    [JSON.stringify(JSON.stringify({ campaign_id: 47 }))]);
  const info = await campaignsTierInfo(query, {}, 1, { getCap: async () => 1000 });
  assert.deepEqual(info, { cap: 1000, unlimited: false, used_24h: 1, remaining: 999 });
});

test('campaignsTierInfo: unlimited tier → cap/remaining null, unlimited flag', async () => {
  const info = await campaignsTierInfo(query, {}, 1, { getCap: async () => Infinity });
  assert.equal(info.unlimited, true);
  assert.equal(info.cap, null);
  assert.equal(info.remaining, null);
});

test('handleAction: campaigns_tier wiring falls back to DEFAULT_CAP without creds (no network)', async () => {
  _resetHealthCache();
  const res = await handleAction(1, 'campaigns_tier', {});
  assert.equal(res.data.cap, DEFAULT_CAP); // scaffold has no WhatsApp channel → safe fallback
  assert.equal(typeof res.data.used_24h, 'number');
});

test('handleAction: campaigns_trend wiring', async () => {
  await seedCampaign({ id: 42 });
  await seedCampaignMessage({ id: 5, campaignId: 42, status: 1 });
  const res = await handleAction(1, 'campaigns_trend', {});
  assert.ok(Array.isArray(res.data));
  assert.equal(res.data[res.data.length - 1].sent, 1);
});
