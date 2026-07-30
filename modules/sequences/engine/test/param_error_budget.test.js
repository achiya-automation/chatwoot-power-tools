import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { setupDb, relaxCompliance } from './helpers.js';
import { marketingSentToday, checkLiveSendBudget, DEFAULT_SETTINGS } from '../src/compliance.js';

// שגיאות 132xxx (אי-התאמת פרמטרים / תבנית זרה ל-Chatwoot) הן תקלת תשתית — שום
// דבר לא הגיע לנמענת, ולכן הן לא נספרות במכסה היומית שלה. כשלי תקרה אמיתיים
// (131049) כן נספרים — הלקח של 29/07 נשאר על כנו.

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);
const NOW = new Date('2026-06-21T10:00:00Z');

beforeEach(async () => {
  await setupDb(pool);
  await query('TRUNCATE drip.sent_messages CASCADE');
  await relaxCompliance(pool);
});

async function seedSends() {
  await query(
    `INSERT INTO drip.sent_messages(account_id,conversation_id,contact_id,template_name,delivery_status,error_code,sent_at)
     VALUES (1, 9001, 42, 't', 'failed', '132000', $1),
            (1, 9002, 42, 't', 'failed', '131049', $1),
            (1, 9003, 43, 't', 'failed', '132000', $1)`,
    [new Date(NOW.getTime() - 3600_000).toISOString()]
  );
}

test('marketingSentToday מתעלמת מ-132xxx וסופרת 131049', async () => {
  await seedSends();
  const m = await marketingSentToday(pool, 1, [42, 43], NOW);
  assert.equal(m.get(42) || 0, 1, '42: רק ה-131049 נספר');
  assert.equal(m.get(43) || 0, 0, '43: כשל 132000 בלבד ⇒ המכסה פנויה');
});

test('checkLiveSendBudget: נמענת עם 132000 בלבד עוברת את המכסה היומית', async () => {
  await seedSends();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const blocked = await checkLiveSendBudget(client, {
      accountId: 1, contactId: 42, templateName: null, category: 'MARKETING',
      settings: { ...DEFAULT_SETTINGS, max_marketing_per_day: 1 }, now: NOW,
    });
    assert.equal(blocked.ok, false, '42 חסומה — יש לה 131049 אמיתי היום');
    const open = await checkLiveSendBudget(client, {
      accountId: 1, contactId: 43, templateName: null, category: 'MARKETING',
      settings: { ...DEFAULT_SETTINGS, max_marketing_per_day: 1 }, now: NOW,
    });
    assert.equal(open.ok, true, '43 פתוחה — ה-132000 לא נספר');
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});
