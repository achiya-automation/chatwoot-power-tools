/**
 * backoff.test.js — a send that THROWS must not retry every tick forever.
 *
 * Before: a throwing sendTemplate (deleted template, bad media, network) left the
 * enrollment 'active' with the same next_send_at → retried once a minute, flooding
 * the API and never surfacing the problem. Now: each failure counts + backs off,
 * and after MAX attempts the enrollment is flagged 'failed' (visible in the panel).
 *
 * Run: DATABASE_URL_TEST=... node --test test/backoff.test.js
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { setupDb, relaxCompliance } from './helpers.js';
import { reconcileAccount } from '../src/reconcile.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

beforeEach(async () => {
  await setupDb(pool);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS public.conversations (id int PRIMARY KEY, display_id int, account_id int, custom_attributes jsonb DEFAULT '{}'::jsonb)`
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS public.contacts (id int PRIMARY KEY, account_id int, name text, phone_number text, email text, custom_attributes jsonb DEFAULT '{}'::jsonb)`
  );
  await pool.query('TRUNCATE public.conversations, public.contacts');
  await query('TRUNCATE drip.enrollments, drip.sequence_steps, drip.sequences, drip.no_send_windows, drip.sent_messages CASCADE');
  await relaxCompliance(pool);
});

const SUNDAY = new Date('2026-06-21T10:00:00Z'); // not shabbat, daytime

async function seqWithStep(key, attempts = 0, convId = 70) {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,$1,$1,false) RETURNING id`,
    [key]
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days) VALUES ($1,1,'a',0),($1,2,'b',3)`,
    [seq]
  );
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status,send_attempts)
     VALUES (1,$2,$1,1,'2020-01-01 00:00:00+00','active',$3)`,
    [seq, convId, attempts]
  );
  return seq;
}

const throwingClient = {
  sendTemplate: async () => { throw new Error('template not found'); },
  getContact: async () => ({ name: 'D' }),
  patchAttrs: async () => {},
  incomingSince: async () => false,
};

// ── a throwing send backs off (counts the attempt, pushes next_send_at out) ──
test('a send that throws counts the attempt and backs off next_send_at (no per-tick retry)', async () => {
  await seqWithStep('bk1', 0, 71);
  await reconcileAccount(pool, { ...throwingClient }, 1, SUNDAY);
  const e = (await query('SELECT status, send_attempts, next_send_at FROM drip.enrollments WHERE conversation_id=71'))[0];
  assert.equal(e.status, 'active', 'still active — retries later, not given up');
  assert.equal(e.send_attempts, 1);
  assert.ok(new Date(e.next_send_at) > SUNDAY, 'next_send_at backed off into the future');
});

// ── after MAX attempts the lead is flagged failed (surfaces in dashboard, stops looping) ──
test('after the 3rd failed send the enrollment is flagged failed + seq_state failed', async () => {
  await seqWithStep('bk3', 2, 72); // already 2 prior failures; this is the 3rd
  let failedState = null;
  const client = { ...throwingClient, patchAttrs: async (_c, a) => { if (a.seq_state) failedState = a.seq_state; } };
  await reconcileAccount(pool, client, 1, SUNDAY);
  const e = (await query('SELECT status, send_attempts FROM drip.enrollments WHERE conversation_id=72'))[0];
  assert.equal(e.status, 'failed', 'gives up after MAX attempts instead of looping forever');
  assert.equal(failedState, 'failed', 'panel sees the failure via seq_state');
});

// ── a successful send clears any prior backoff counter ──
test('a successful send resets send_attempts to 0', async () => {
  await seqWithStep('rst', 2, 73);
  const client = { ...throwingClient, sendTemplate: async () => ({ id: 5, content: 'x' }) };
  await reconcileAccount(pool, client, 1, SUNDAY);
  const e = (await query('SELECT current_step, send_attempts FROM drip.enrollments WHERE conversation_id=73'))[0];
  assert.equal(e.current_step, 2, 'advanced to next step');
  assert.equal(e.send_attempts, 0, 'counter reset on success');
});

// ── send_hour: enroll snaps next_send_at to the exact Jerusalem hour (the sheet's "at HH:00") ──
test('a step send_hour snaps next_send_at to that Jerusalem hour on enroll', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,'sh','SH',false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days,send_hour) VALUES ($1,1,'t1',0,10)`,
    [seq]
  );
  await pool.query(
    `INSERT INTO public.contacts(id,account_id,name,custom_attributes) VALUES (900,1,'SH','{"sequence":"sh"}'::jsonb)`
  );
  await reconcileAccount(pool, { ...throwingClient }, 1, new Date('2026-06-21T05:00:00Z')); // 08:00 IDT
  const e = (await query('SELECT next_send_at FROM drip.enrollments WHERE contact_id=900'))[0];
  // delay 0 from 08:00 IDT, snapped to 10:00 IDT = 07:00 UTC
  assert.equal(new Date(e.next_send_at).toISOString(), '2026-06-21T07:00:00.000Z');
});
