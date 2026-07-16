import { runMigrations } from '../src/migrate.js';

/**
 * Shared test setup.
 *
 * ── setupDb ────────────────────────────────────────────────────────────────────
 * Several migrations define SQL functions over Chatwoot's own tables (007 reads
 * public.conversations, 013 reads public.contacts.custom_attributes, …). Postgres validates
 * the body of a LANGUAGE sql function AT CREATION, so those migrations fail outright if the
 * Chatwoot tables do not exist yet.
 *
 * In production they always do. In tests they exist only because each file scaffolds the
 * handful of tables IT needs with CREATE TABLE IF NOT EXISTS — against one shared database,
 * in whatever order `node --test` happens to walk the directory (readdir order, not
 * alphabetical, and not stable across filesystems). The suite therefore only passed when the
 * file that happened to run first created the right tables with the right columns. Adding a
 * test file reshuffled the order and made unrelated tests fail.
 *
 * setupDb removes the dependency on that accident: scaffold the FULL Chatwoot surface first,
 * then migrate. Idempotent, and safe to call from every beforeEach.
 */
export async function setupDb(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.accounts (
    id int PRIMARY KEY, name text)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.contacts (
    id int PRIMARY KEY, account_id int, name text, phone_number text, email text,
    custom_attributes jsonb DEFAULT '{}'::jsonb)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.conversations (
    id int PRIMARY KEY, display_id int, account_id int, contact_id int,
    contact_inbox_id int, inbox_id int, campaign_id int,
    custom_attributes jsonb DEFAULT '{}'::jsonb, cached_label_list text)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.messages (
    id int, conversation_id int, account_id int, message_type int, content text,
    status int, content_attributes json, source_id text, created_at timestamp)`);
  await pool.query('ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS contact_inbox_id int');
  await pool.query('ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS inbox_id int');
  await pool.query('ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS campaign_id int');
  await pool.query('ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS source_id text');
  await pool.query(`CREATE TABLE IF NOT EXISTS public.inboxes (
    id int PRIMARY KEY, account_id int, name text, channel_type text, channel_id int)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.channel_whatsapp (
    id int PRIMARY KEY, message_templates jsonb DEFAULT '[]'::jsonb,
    provider_config jsonb DEFAULT '{}'::jsonb)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.contact_inboxes (
    id int PRIMARY KEY, contact_id int, inbox_id int, source_id text)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.tags (
    id int PRIMARY KEY, name text)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS public.taggings (
    id int PRIMARY KEY, tag_id int, taggable_type text, taggable_id int, context text)`);
  await runMigrations(pool);
}

/**
 * ── relaxCompliance ────────────────────────────────────────────────────────────
 * The compliance gate ships with production-safe defaults: marketing requires a consent
 * record (Meta's "Expected" rule) and one marketing template per contact per 24h. Every
 * pre-existing test in this suite seeds bare contacts with no consent row, because they
 * were written before the gate existed — and they are about SCHEDULING and DELIVERY, not
 * consent. Leaving the gate on would make them all assert "nothing was sent", which tests
 * the gate rather than the thing they exist to test.
 *
 * So those files relax the gate explicitly. The gate itself is covered where it belongs:
 *   - compliance.test.js — every rule, as pure logic
 *   - gate.test.js       — the gate wired into the real reconciler, against a real DB
 */
export async function relaxCompliance(pool, accounts = [1, 2, 3, 5, 7, 9]) {
  for (const id of accounts) {
    await pool.query(
      `INSERT INTO drip.compliance (account_id, require_consent, max_marketing_per_day)
       VALUES ($1, false, 9999)
       ON CONFLICT (account_id) DO UPDATE
         SET require_consent = false, max_marketing_per_day = 9999`,
      [id]
    );
  }
}

/** Grant consent to every contact that currently exists — for tests that keep the gate ON. */
export async function grantConsentToAll(pool, source = 'lead_ad') {
  await pool.query(
    `INSERT INTO drip.contact_state (account_id, contact_id, consent_source, consent_at)
     SELECT c.account_id, c.id, $1, now()
       FROM public.contacts c
      WHERE c.account_id IS NOT NULL
     ON CONFLICT (account_id, contact_id) DO UPDATE
       SET consent_source = EXCLUDED.consent_source, consent_at = EXCLUDED.consent_at`,
    [source]
  );
}
