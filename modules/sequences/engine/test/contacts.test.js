/**
 * contacts.test.js — the dashboard's account switcher (actionAccounts) and contact
 * search (actionContacts). Together they let a lead be added to / moved between
 * sequences straight from the dashboard, with no conversation and no per-account
 * Chatwoot membership (a super-admin manages every account from one place).
 *
 * Run: node --test test/contacts.test.js   (needs DATABASE_URL_TEST)
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleAction, initStore } from '../src/store.js';
import { getPool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);
initStore(cfg);

beforeEach(async () => {
  await runMigrations(pool);
  // Stand-ins for the Chatwoot public tables the actions read (production has the real ones).
  await pool.query(`CREATE TABLE IF NOT EXISTS public.contacts (
    id int PRIMARY KEY, account_id int, name text, phone_number text, email text,
    custom_attributes jsonb DEFAULT '{}'::jsonb)`);
  await pool.query('CREATE TABLE IF NOT EXISTS public.accounts (id int PRIMARY KEY, name text)');
  await pool.query('TRUNCATE public.contacts, public.accounts, drip.account_tokens');
});

// ─────────────────────────── contact search ────────────────────────────────
test('contacts: matches by name / phone / email and returns the current sequence attr', async () => {
  await pool.query(`INSERT INTO public.contacts(id, account_id, name, phone_number, email, custom_attributes) VALUES
    (1, 7, 'דנה כהן', '+972500000001', 'dana@x.com', '{"sequence":"bb_new"}'),
    (2, 7, 'רון לוי', '+972500000002', 'ron@x.com',  '{}'),
    (3, 9, 'זר',      '+972500000003', NULL,         '{}')`);

  const byName = await handleAction(7, 'contacts', { query: 'דנה' });
  assert.equal(byName.data.length, 1);
  assert.equal(byName.data[0].contact_id, 1);
  assert.equal(byName.data[0].sequence, 'bb_new', 'surfaces that the lead is already in a sequence');

  const byPhone = await handleAction(7, 'contacts', { query: '0000002' });
  assert.equal(byPhone.data[0].contact_id, 2);
  assert.equal(byPhone.data[0].sequence, null);

  const byEmail = await handleAction(7, 'contacts', { query: 'ron@' });
  assert.equal(byEmail.data[0].contact_id, 2);
});

test('contacts: account isolation — never returns another account\'s contacts', async () => {
  await pool.query("INSERT INTO public.contacts(id, account_id, name) VALUES (3, 9, 'זר')");
  const r = await handleAction(7, 'contacts', { query: 'זר' });
  assert.equal(r.data.length, 0);
});

test('contacts: empty query returns recent contacts (newest first), scoped to account', async () => {
  await pool.query("INSERT INTO public.contacts(id, account_id, name) VALUES (1,7,'A'),(2,7,'B'),(3,9,'C')");
  const r = await handleAction(7, 'contacts', {});
  assert.deepEqual(r.data.map((c) => c.contact_id), [2, 1], 'newest first, only account 7');
});

// ─────────────────── account switcher REMOVED (by-context only) ─────────────
// The cross-account picker was removed: a user's account follows the current Chatwoot
// URL, and a super-admin reaches a client's sequences through Chatwoot's super-admin
// console — not an in-dashboard switcher. The `accounts` action no longer exists.
test('accounts: action removed — handleAction falls through to "Unknown action"', async () => {
  await assert.rejects(
    () => handleAction(7, 'accounts', {}),
    /Unknown action: accounts/,
  );
});
