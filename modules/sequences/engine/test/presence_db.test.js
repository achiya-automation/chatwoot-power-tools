/**
 * DB-backed proof for the presence ownership gate.
 *
 * Unlike presence.test.js (which validates generated SQL with injected mocks), this test
 * executes the real query under a deliberately restricted Postgres role. It prevents both
 * regressions that caused the production incident: a missing agent_bot_inboxes grant and a
 * non-bot conversation slipping through the positive ownership check.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPool } from '../src/db.js';
import { _internals } from '../src/presence.js';
import { setupDb } from './helpers.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);
const ROLE = 'presence_gate_test_role';
const CONVERSATION_IDS = [2_147_482_901, 2_147_482_902, 2_147_482_903, 2_147_482_904];
const INBOX_IDS = [2_147_482_801, 2_147_482_802, 2_147_482_803, 2_147_482_804];

test('restricted engine role admits only bot-connected conversations', async () => {
  await setupDb(pool);
  await pool.query(`DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
        CREATE ROLE ${ROLE} NOLOGIN;
      END IF;
    END $$`);

  try {
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await pool.query(`GRANT SELECT ON public.conversations, public.agent_bot_inboxes TO ${ROLE}`);
    await pool.query(
      `INSERT INTO public.conversations
         (id, inbox_id, assignee_id, assignee_agent_bot_id)
       VALUES
         ($1, $5, NULL, 12),
         ($2, $6, NULL, NULL),
         ($3, $7, NULL, NULL),
         ($4, $8, 62, 12)
       ON CONFLICT (id) DO UPDATE SET
         inbox_id = EXCLUDED.inbox_id,
         assignee_id = EXCLUDED.assignee_id,
         assignee_agent_bot_id = EXCLUDED.assignee_agent_bot_id`,
      [...CONVERSATION_IDS, ...INBOX_IDS]
    );
    await pool.query(
      `INSERT INTO public.agent_bot_inboxes (id, inbox_id, agent_bot_id, status)
       VALUES ($1, $2, 11, 0)
       ON CONFLICT (id) DO UPDATE SET inbox_id = EXCLUDED.inbox_id, status = 0`,
      [2_147_482_701, INBOX_IDS[1]]
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${ROLE}`);
      const restrictedQuery = async (sql, params) => (await client.query(sql, params)).rows;

      assert.equal(await _internals.isBotConnected(restrictedQuery, CONVERSATION_IDS[0], INBOX_IDS[0]), true);
      assert.equal(await _internals.isBotConnected(restrictedQuery, CONVERSATION_IDS[1], INBOX_IDS[1]), true);
      assert.equal(await _internals.isBotConnected(restrictedQuery, CONVERSATION_IDS[2], INBOX_IDS[2]), false);
      assert.equal(await _internals.isBotConnected(restrictedQuery, CONVERSATION_IDS[3], INBOX_IDS[3]), false);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  } finally {
    await pool.query('DELETE FROM public.agent_bot_inboxes WHERE id = $1', [2_147_482_701]).catch(() => {});
    await pool.query('DELETE FROM public.conversations WHERE id = ANY($1::int[])', [CONVERSATION_IDS]).catch(() => {});
    await pool.query(`DROP OWNED BY ${ROLE}`).catch(() => {});
    await pool.query(`DROP ROLE IF EXISTS ${ROLE}`).catch(() => {});
  }
});
