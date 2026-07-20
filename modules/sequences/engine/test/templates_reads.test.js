/**
 * templates_reads.test.js — getWhatsappCredsAll for Template Studio
 * Reads all usable Cloud-API WhatsApp channels for an account (not just the chosen one).
 * Template Studio operates per-WABA; several numbers may share one.
 *
 * Run: node --test test/templates_reads.test.js   (needs DATABASE_URL_TEST)
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb } from './helpers.js';
import { makeDbReads } from '../src/reads.js';
import { getPool, query } from '../src/db.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);
const reads = makeDbReads(query);

beforeEach(async () => {
  await setupDb(pool);
  // setupDb creates both inboxes and channel_whatsapp; truncate for test isolation
  await pool.query('TRUNCATE public.inboxes, public.channel_whatsapp');

  // Fixture: account 9401 has four channels, two usable (with token+waba), two incomplete
  await pool.query(`INSERT INTO public.inboxes (id, account_id, name, channel_type, channel_id) VALUES
    (9401, 9401, 'Inbox-A', 'Channel::Whatsapp', 9411),
    (9402, 9401, 'Inbox-B', 'Channel::Whatsapp', 9412),
    (9403, 9401, 'Inbox-C', 'Channel::Whatsapp', 9413),
    (9404, 9401, 'Inbox-D', 'Channel::Whatsapp', 9414)
    ON CONFLICT (id) DO NOTHING`);

  await pool.query(`INSERT INTO public.channel_whatsapp (id, phone_number, provider, provider_config) VALUES
    (9411, '+9721', 'whatsapp_cloud', '{"api_key":"t1","phone_number_id":"p1","business_account_id":"W1"}'),
    (9412, '+9722', 'whatsapp_cloud', '{"api_key":"t2","phone_number_id":"p2","business_account_id":"W1"}'),
    (9413, '+9723', 'whatsapp_cloud', '{"phone_number_id":"p3","business_account_id":"W1"}'),
    (9414, '+9724', 'whatsapp_cloud', '{"api_key":"t4","phone_number_id":"p4"}')
    ON CONFLICT (id) DO NOTHING`);
});

test('getWhatsappCredsAll returns only usable cloud channels', async () => {
  const all = await reads.getWhatsappCredsAll(9401);
  assert.equal(all.length, 2, 'should return only 2 complete channels (with api_key AND business_account_id)');
  assert.deepEqual(all.map((c) => c.wabaId), ['W1', 'W1'], 'both channels share the same WABA');
  assert.equal(all[0].inboxId, 9401, 'first inbox id should be 9401');
  assert.equal(all[0].name, 'Inbox-A', 'first inbox name should be Inbox-A');
  assert.equal(all[0].phone, '+9721', 'first phone should be +9721');
  assert.equal(all[0].phoneId, 'p1', 'first phoneId should be p1');
  assert.equal(all[0].token, 't1', 'first token should be t1');
  assert.equal(all[1].inboxId, 9402, 'second inbox id should be 9402');
  assert.equal(all[1].name, 'Inbox-B', 'second inbox name should be Inbox-B');
  assert.equal(all[1].phone, '+9722', 'second phone should be +9722');
  assert.equal(all[1].phoneId, 'p2', 'second phoneId should be p2');
  assert.equal(all[1].token, 't2', 'second token should be t2');
});

test('getWhatsappCredsAll returns empty array for account with no channels', async () => {
  const all = await reads.getWhatsappCredsAll(9999);
  assert.equal(all.length, 0, 'should return empty array for non-existent account');
});

test('getWhatsappCredsAll filters out non-cloud providers', async () => {
  // Add a WAHA channel (provider != 'whatsapp_cloud')
  await pool.query(`INSERT INTO public.inboxes (id, account_id, name, channel_type, channel_id) VALUES
    (9405, 9401, 'Inbox-E', 'Channel::Whatsapp', 9415)
    ON CONFLICT (id) DO NOTHING`);
  await pool.query(`INSERT INTO public.channel_whatsapp (id, phone_number, provider, provider_config) VALUES
    (9415, '+9725', 'whatsapp_business', '{"api_key":"t5","phone_number_id":"p5","business_account_id":"W2"}')
    ON CONFLICT (id) DO NOTHING`);

  const all = await reads.getWhatsappCredsAll(9401);
  assert.equal(all.length, 2, 'should still return only 2 cloud channels (whatsapp_business is excluded)');
  assert.equal(all.every((c) => c.wabaId === 'W1'), true, 'all should have W1 WABA');
});

test('getWhatsappCredsAll enforces account isolation', async () => {
  // Seed a second account (9402) with its own usable channels
  await pool.query(`INSERT INTO public.inboxes (id, account_id, name, channel_type, channel_id) VALUES
    (9501, 9402, 'Inbox-X', 'Channel::Whatsapp', 9451),
    (9502, 9402, 'Inbox-Y', 'Channel::Whatsapp', 9452)
    ON CONFLICT (id) DO NOTHING`);
  await pool.query(`INSERT INTO public.channel_whatsapp (id, phone_number, provider, provider_config) VALUES
    (9451, '+9731', 'whatsapp_cloud', '{"api_key":"tx1","phone_number_id":"px1","business_account_id":"W2"}'),
    (9452, '+9732', 'whatsapp_cloud', '{"api_key":"tx2","phone_number_id":"px2","business_account_id":"W2"}')
    ON CONFLICT (id) DO NOTHING`);

  // Account 9401 should return only its two channels (9401, 9402)
  const all9401 = await reads.getWhatsappCredsAll(9401);
  assert.equal(all9401.length, 2, 'account 9401 should return exactly 2 channels');
  const inboxIds9401 = all9401.map((c) => c.inboxId).sort();
  assert.deepEqual(inboxIds9401, [9401, 9402], 'account 9401 channels must be 9401 and 9402 only');

  // Account 9402 should return only its two channels (9501, 9502)
  const all9402 = await reads.getWhatsappCredsAll(9402);
  assert.equal(all9402.length, 2, 'account 9402 should return exactly 2 channels');
  const inboxIds9402 = all9402.map((c) => c.inboxId).sort();
  assert.deepEqual(inboxIds9402, [9501, 9502], 'account 9402 channels must be 9501 and 9502 only');
});
