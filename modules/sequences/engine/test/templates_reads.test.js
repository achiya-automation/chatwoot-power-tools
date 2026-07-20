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
import { getPool } from '../src/db.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

beforeEach(async () => {
  // Drop and recreate to ensure clean schema
  await pool.query('DROP TABLE IF EXISTS public.channel_whatsapp CASCADE');
  await setupDb(pool);
  // setupDb already creates both inboxes and channel_whatsapp; just truncate
  await pool.query('TRUNCATE public.inboxes, public.channel_whatsapp');

  // Fixture: account 9401 has three channels, two usable (with token+waba), one incomplete
  await pool.query(`INSERT INTO public.inboxes (id, account_id, name, channel_type, channel_id) VALUES
    (9401, 9401, 'A', 'Channel::Whatsapp', 9411),
    (9402, 9401, 'B', 'Channel::Whatsapp', 9412),
    (9403, 9401, 'C', 'Channel::Whatsapp', 9413)
    ON CONFLICT (id) DO NOTHING`);

  await pool.query(`INSERT INTO public.channel_whatsapp (id, phone_number, provider, provider_config) VALUES
    (9411, '+9721', 'whatsapp_cloud', '{"api_key":"t1","phone_number_id":"p1","business_account_id":"W1"}'),
    (9412, '+9722', 'whatsapp_cloud', '{"api_key":"t2","phone_number_id":"p2","business_account_id":"W1"}'),
    (9413, '+9723', 'whatsapp_cloud', '{}')
    ON CONFLICT (id) DO NOTHING`);
});

test('getWhatsappCredsAll returns only usable cloud channels', async () => {
  const reads = makeDbReads((sql, params) => pool.query(sql, params).then((r) => r.rows));
  const all = await reads.getWhatsappCredsAll(9401);
  assert.equal(all.length, 2, 'should return only 2 usable channels, not the incomplete one');
  assert.deepEqual(all.map((c) => c.wabaId), ['W1', 'W1'], 'both channels share the same WABA');
  assert.equal(all[0].inboxId, 9401, 'first inbox id should be 9401');
  assert.equal(all[0].token, 't1', 'first token should be t1');
  assert.equal(all[1].inboxId, 9402, 'second inbox id should be 9402');
  assert.equal(all[1].token, 't2', 'second token should be t2');
});

test('getWhatsappCredsAll returns empty array for account with no channels', async () => {
  const reads = makeDbReads((sql, params) => pool.query(sql, params).then((r) => r.rows));
  const all = await reads.getWhatsappCredsAll(9999);
  assert.equal(all.length, 0, 'should return empty array for non-existent account');
});

test('getWhatsappCredsAll filters out non-cloud providers', async () => {
  // Add a WAHA channel (provider != 'whatsapp_cloud')
  await pool.query(`INSERT INTO public.inboxes (id, account_id, name, channel_type, channel_id) VALUES
    (9404, 9401, 'D', 'Channel::Whatsapp', 9414)
    ON CONFLICT (id) DO NOTHING`);
  await pool.query(`INSERT INTO public.channel_whatsapp (id, phone_number, provider, provider_config) VALUES
    (9414, '+9724', 'whatsapp_business', '{"api_key":"t3","phone_number_id":"p3","business_account_id":"W2"}')
    ON CONFLICT (id) DO NOTHING`);

  const reads = makeDbReads((sql, params) => pool.query(sql, params).then((r) => r.rows));
  const all = await reads.getWhatsappCredsAll(9401);
  assert.equal(all.length, 2, 'should still return only 2 cloud channels');
  assert.equal(all.every((c) => c.wabaId === 'W1'), true, 'all should have W1 WABA');
});
