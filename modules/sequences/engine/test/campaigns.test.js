import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { listCampaigns, getCampaignDetail } from '../src/campaigns.js';
import { handleAction } from '../src/store.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

// Shared beforeEach for Tasks 2/3/4/7B — creates the public stand-in tables (like reads.test.js).
// content_attributes is `json` (matches ci.yml + delivery.test.js); all campaign queries cast ::jsonb,
// which works on json here and on prod's jsonb column alike.
beforeEach(async () => {
  await runMigrations(pool); // schema drip
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.campaigns (id int PRIMARY KEY, display_id int, account_id int, inbox_id int, title text, message text, campaign_type int, campaign_status int, audience jsonb DEFAULT '[]'::jsonb, template_params jsonb DEFAULT '{}'::jsonb, scheduled_at timestamp, created_at timestamp);
    CREATE TABLE IF NOT EXISTS public.messages (id int, conversation_id int, account_id int, message_type int, content text, status int, content_attributes json, created_at timestamp);
    CREATE TABLE IF NOT EXISTS public.conversations (id int PRIMARY KEY, display_id int, account_id int, contact_id int);
    CREATE TABLE IF NOT EXISTS public.contacts (id int PRIMARY KEY, account_id int, name text, phone_number text, email text);
    CREATE TABLE IF NOT EXISTS public.inboxes (id int PRIMARY KEY, account_id int, name text, channel_type text, channel_id int);
    CREATE TABLE IF NOT EXISTS public.labels (id int PRIMARY KEY, account_id int, title text);
    CREATE TABLE IF NOT EXISTS public.tags (id int PRIMARY KEY, name text);
    CREATE TABLE IF NOT EXISTS public.taggings (id int PRIMARY KEY, tag_id int, taggable_type text, taggable_id int, context text);
  `);
  await pool.query('TRUNCATE public.campaigns, public.messages, public.contacts, public.conversations, public.inboxes, public.labels, public.tags, public.taggings');
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
async function seedCampaignMessage({ id, account = 1, conv = 500, campaignId, status }) {
  await query(`INSERT INTO public.messages(id, conversation_id, account_id, message_type, status, content_attributes, created_at)
               VALUES ($1,$2,$3,1,$4,$5, now())`,
    [id, conv, account, status, JSON.stringify({ campaign_id: campaignId })]);
}

test('listCampaigns: aggregates status counts per campaign', async () => {
  await seedCampaign({ id: 16, title: 'השקה' });
  await seedCampaignMessage({ id: 1, campaignId: 16, status: 1 }); // delivered
  await seedCampaignMessage({ id: 2, campaignId: 16, status: 2 }); // read
  await seedCampaignMessage({ id: 3, campaignId: 16, status: 3 }); // failed
  const list = await listCampaigns(query, 1);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'השקה');
  assert.equal(list[0].sent, 3);
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
    [JSON.stringify({ campaign_id: 23, external_error: { title: 'Recipient opted out' } })]);

  const d = await getCampaignDetail(query, 1, 23);
  assert.equal(d.funnel.failed, 1);
  const r = d.recipients[0];
  assert.equal(r.error_title, 'Recipient opted out');
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
