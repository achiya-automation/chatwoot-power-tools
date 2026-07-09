import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { listCampaigns } from '../src/campaigns.js';

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
