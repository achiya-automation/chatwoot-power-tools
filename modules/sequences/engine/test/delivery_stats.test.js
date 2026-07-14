/**
 * delivery_stats.test.js — the dashboard's numbers must survive a deleted message row.
 *
 * Deleting an inbox in Chatwoot cascade-deletes its conversations AND their messages, while
 * drip.sent_messages survives with a message_id pointing at nothing. The stats query used to
 * LEFT JOIN public.messages and read `m.status`, so every one of those rows came back NULL —
 * and a BLOCKED send was silently recounted as "awaiting Meta".
 *
 * Measured on banana-book (2026-07-14, hours after an inbox swap): Chatwoot held 6 failures
 * for the day, the dashboard showed 1. Four of the five it lost were 131049 caps on brand-new
 * leads. The success rate read 97% when the truth was 91% — the one number the operator uses
 * to decide whether to keep sending.
 *
 * The fix: read the outcome from sent_messages.delivery_status, the engine's OWN column
 * (written by reconcileDeliveries). It cannot be cascade-deleted out from under us.
 *
 * Run: DATABASE_URL_TEST=... node --test test/delivery_stats.test.js
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { setupDb } from './helpers.js';
import { handleAction } from '../src/store.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

beforeEach(async () => {
  await setupDb(pool);
  await query('TRUNCATE drip.enrollments, drip.sequence_steps, drip.sequences, drip.sent_messages CASCADE');
  await pool.query('TRUNCATE public.conversations, public.contacts, public.messages');
});

/** One sent_messages row. `messageId = null` ⇒ its message row was cascade-deleted. */
async function sent({ id, messageId, status, code = null }) {
  await query(
    `INSERT INTO drip.sent_messages
       (account_id, conversation_id, contact_id, template_name, step_order,
        message_id, delivery_status, error_code, sent_at)
     VALUES (1, 7001, $1::int, 't1', 1, $2::int, $3::text, $4::text, now())`,
    [id, messageId, status, code]
  );
}

/** The Chatwoot message row, when it still exists. status: 1=delivered 2=read 3=failed */
async function message(id, status) {
  await pool.query(
    `INSERT INTO public.messages(id, conversation_id, account_id, message_type, status, created_at)
     VALUES ($1, 7001, 1, 1, $2, now())`,
    [id, status]
  );
}

test('⭐ a blocked send whose message row was deleted is still counted as BLOCKED, not "awaiting"', async () => {
  // survived the cascade: one delivered, one blocked
  await message(901, 1); await sent({ id: 1, messageId: 901, status: 'delivered' });
  await message(902, 3); await sent({ id: 2, messageId: 902, status: 'failed', code: '131049' });

  // the inbox was swapped — these two message rows are GONE, but the sends happened
  await sent({ id: 3, messageId: 903, status: 'failed', code: '131049' });  // 903 does not exist
  await sent({ id: 4, messageId: 904, status: 'delivered' });               // 904 does not exist

  // genuinely still waiting on Meta
  await message(905, 0); await sent({ id: 5, messageId: 905, status: 'pending' });

  const { data } = await handleAction(1, 'delivery_stats', {});
  const t = data.today;

  assert.equal(t.sent, 5);
  assert.equal(t.failed, 2, 'BOTH blocks counted — the one whose message row is gone included');
  assert.equal(t.delivered, 2, 'and both deliveries, likewise');
  assert.equal(t.pending, 1, 'only the send Meta has genuinely not answered is "awaiting"');
  assert.equal(t.block_cap, 2, 'the 131049 reason survives the deletion too');

  // the number the operator actually reads
  const decided = t.delivered + t.failed;
  assert.equal(Math.round((t.delivered / decided) * 100), 50,
    'success rate is computed over what was DECIDED — deleting a row must not flatter it');
});

test('a NULL delivery_status (row written, reconciler has not run yet) counts as awaiting', async () => {
  await sent({ id: 1, messageId: null, status: null });
  const { data } = await handleAction(1, 'delivery_stats', {});
  assert.equal(data.today.pending, 1);
  assert.equal(data.today.failed, 0, 'unknown is not failure');
});

test('the 7-day trend keeps blocks whose message rows were deleted (history is where they vanish)', async () => {
  await sent({ id: 1, messageId: 911, status: 'failed', code: '131049' });   // 911 deleted
  await sent({ id: 2, messageId: 912, status: 'delivered' });                // 912 deleted
  const { data } = await handleAction(1, 'delivery_stats', {});
  const today = data.trend.at(-1);
  assert.equal(today.failed, 1, 'the trend chart must not lose the block');
  assert.equal(today.delivered, 1);
});
