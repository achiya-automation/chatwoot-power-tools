import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';

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
