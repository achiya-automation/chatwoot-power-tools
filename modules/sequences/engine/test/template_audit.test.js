/**
 * template_audit.test.js — template studio audit log (Task 1, Migration 031)
 *
 * Records who did what on which WABA template, when. Also drives the
 * pending-status poll (recent-writes window). Meta is the source of truth
 * for template state; this table only records actions taken from the UI.
 *
 * Run: DATABASE_URL_TEST=postgres://localhost:5432/drip_test node --test test/template_audit.test.js
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb } from './helpers.js';
import { getPool } from '../src/db.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

beforeEach(async () => {
  await setupDb(pool);
  await pool.query('TRUNCATE drip.template_audit CASCADE');
});

test('031: template_audit accepts a create row and rejects bad action', async () => {
  await pool.query(
    `INSERT INTO drip.template_audit (account_id, actor_uid, actor_name, action, waba_id, template_name, template_language, detail)
     VALUES (1, 'u@x', 'User', 'create', 'WABA1', 'promo_a', 'he', '{"status":"PENDING"}')`
  );
  const { rows } = await pool.query(`SELECT action, waba_id FROM drip.template_audit WHERE template_name='promo_a'`);
  assert.equal(rows[0].action, 'create');
  await assert.rejects(pool.query(
    `INSERT INTO drip.template_audit (account_id, action, waba_id, template_name) VALUES (1,'rename','W','x')`
  ));
});
