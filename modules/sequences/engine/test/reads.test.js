/**
 * reads.test.js — DB-backed reads the engine uses instead of the AgentBot's limited API.
 *
 * The per-account AgentBot token can WRITE but can't READ inboxes/contacts/messages over
 * the API, so the engine reads them from Chatwoot's Postgres. These verify the three readers
 * against the scaffolded public.* stand-ins (deploy/run-tests.sh creates them).
 *
 * Run: DATABASE_URL_TEST=... node --test test/reads.test.js
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { makeDbReads } from '../src/reads.js';

const pool = getPool({ databaseUrl: process.env.DATABASE_URL_TEST });
const reads = makeDbReads(query);

beforeEach(async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.inboxes (id int PRIMARY KEY, account_id int, name text, channel_type text, channel_id int)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.channel_whatsapp (id int PRIMARY KEY, message_templates jsonb DEFAULT '[]'::jsonb)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.conversations (id int PRIMARY KEY, display_id int, account_id int, contact_id int)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.contacts (id int PRIMARY KEY, account_id int, name text, phone_number text, email text)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.messages (id int, conversation_id int, message_type int, created_at timestamp)`);
  await pool.query('TRUNCATE public.inboxes, public.channel_whatsapp, public.conversations, public.contacts, public.messages');
});

// ── loadTemplates: from the account's WhatsApp channel (AgentBot can't GET /inboxes) ──
test('loadTemplates reads templates off the account WhatsApp channel', async () => {
  await query(`INSERT INTO public.channel_whatsapp(id, message_templates) VALUES (6, '[{"name":"t1","language":"he","status":"APPROVED"},{"name":"t2","language":"he","status":"PENDING"}]'::jsonb)`);
  await query(`INSERT INTO public.inboxes(id, account_id, name, channel_type, channel_id) VALUES (26, 7, 'WA', 'Channel::Whatsapp', 6)`);
  const t = await reads.loadTemplates(7);
  assert.equal(t.length, 2, 'returns all templates (status filtered downstream)');
  assert.deepEqual(t.map((x) => x.name).sort(), ['t1', 't2']);
});

test('loadTemplates returns [] for an account with no WhatsApp inbox', async () => {
  assert.deepEqual(await reads.loadTemplates(999), []);
});

// ── getContact: contact behind a conversation, by display_id ──
test('getContact resolves the conversation contact name/phone', async () => {
  await query(`INSERT INTO public.contacts(id, account_id, name, phone_number) VALUES (50, 7, 'דנה', '+97250')`);
  await query(`INSERT INTO public.conversations(id, display_id, account_id, contact_id) VALUES (800, 12, 7, 50)`);
  const c = await reads.getContact(12, 7);
  assert.equal(c.name, 'דנה');
  assert.equal(c.phone, '+97250');
});

// ── incomingSince: only an INCOMING message strictly AFTER the cutoff counts ──
test('incomingSince is true for an incoming message after the cutoff, false before', async () => {
  await query(`INSERT INTO public.conversations(id, display_id, account_id, contact_id) VALUES (801, 13, 7, 50)`);
  await query(`INSERT INTO public.messages(id, conversation_id, message_type, created_at) VALUES (1, 801, 0, '2026-06-21 12:00:00')`);
  assert.equal(await reads.incomingSince(13, '2026-06-21T11:00:00Z', 7), true);
  assert.equal(await reads.incomingSince(13, '2026-06-21T13:00:00Z', 7), false);
});

test('incomingSince ignores outgoing messages (only customer replies stop a sequence)', async () => {
  await query(`INSERT INTO public.conversations(id, display_id, account_id, contact_id) VALUES (802, 14, 7, 50)`);
  await query(`INSERT INTO public.messages(id, conversation_id, message_type, created_at) VALUES (2, 802, 1, '2026-06-21 12:00:00')`);
  assert.equal(await reads.incomingSince(14, '2026-06-21T11:00:00Z', 7), false);
});
