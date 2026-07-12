import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb } from './helpers.js';
import { getPool, query } from '../src/db.js';

/*
 * media.test.js — header-media support: media_url round-trips through
 * save_sequence / _sequence_json / list_sequences (migration 006).
 */

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

beforeEach(async () => {
  await setupDb(pool);
  await query('TRUNCATE drip.enrollments, drip.sequence_steps, drip.sequences CASCADE');
});

test('save_sequence persists media_url; empty → NULL; round-trips via list_sequences', async () => {
  const p = {
    account_id: 1, id: null, key: 'mediaseq', display_name: 'Media',
    enabled: true, stop_on_reply: false, skip_shabbat: true,
    steps: [
      { step_order: 1, template_name: 'promo_img', params: ['@name'], media_url: 'https://cdn.example/ad.jpg' },
      { step_order: 2, template_name: 'text_only', params: [], media_url: '' },
    ],
  };
  const saved = (await query('SELECT drip.save_sequence($1::jsonb) AS r', [JSON.stringify(p)]))[0].r;
  assert.equal(saved.steps[0].media_url, 'https://cdn.example/ad.jpg', 'media_url saved');
  assert.equal(saved.steps[1].media_url, null, 'empty media_url stored as NULL');

  const list = (await query('SELECT drip.list_sequences(1) AS r'))[0].r;
  assert.equal(list[0].steps[0].media_url, 'https://cdn.example/ad.jpg', 'media_url survives list');

  // and it's the column the reconciler reads (SELECT * FROM sequence_steps)
  const row = (await query(
    "SELECT media_url FROM drip.sequence_steps st JOIN drip.sequences s ON s.id=st.sequence_id WHERE s.key='mediaseq' AND st.step_order=1"
  ))[0];
  assert.equal(row.media_url, 'https://cdn.example/ad.jpg');
});

test('editing a sequence updates media_url (atomic step replace)', async () => {
  const base = {
    account_id: 1, id: null, key: 'edseq', display_name: 'Ed', enabled: true,
    steps: [{ step_order: 1, template_name: 'promo_img', params: [], media_url: 'https://cdn.example/old.jpg' }],
  };
  const first = (await query('SELECT drip.save_sequence($1::jsonb) AS r', [JSON.stringify(base)]))[0].r;
  const edited = { ...base, id: first.id, steps: [{ step_order: 1, template_name: 'promo_img', params: [], media_url: 'https://cdn.example/new.jpg' }] };
  const after = (await query('SELECT drip.save_sequence($1::jsonb) AS r', [JSON.stringify(edited)]))[0].r;
  assert.equal(after.steps[0].media_url, 'https://cdn.example/new.jpg', 'media_url updated on edit');
});
