import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb } from './helpers.js';
import { getPool, query } from '../src/db.js';
import { listCampaigns } from '../src/campaigns.js';
import { startResend, resendStatus, liquidContactParams, _resetResendJobs } from '../src/campaignResend.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

beforeEach(async () => {
  await setupDb(pool);
  await pool.query(`TRUNCATE public.campaigns, public.messages, public.contacts, public.conversations,
    public.contact_inboxes, public.inboxes, drip.campaign_audience_snapshots,
    drip.campaign_send_snapshots, drip.contact_state`);
  _resetResendJobs();
});

// ── seed: campaign 50 with one failed recipient (no conversation — the common Meta-reject case),
//    one delivered recipient, and one failed recipient that DOES have a conversation ──
async function seedResendCampaign() {
  await query(`INSERT INTO public.inboxes(id, account_id, name, channel_type, channel_id)
               VALUES (10,1,'WA','Channel::Whatsapp',10) ON CONFLICT (id) DO NOTHING`);
  await query(`INSERT INTO public.campaigns(id, display_id, account_id, inbox_id, title, campaign_type, campaign_status, template_params, created_at)
               VALUES (50,50,1,10,'קמפיין ניסיון',1,1,$1, now())`,
    [JSON.stringify({ name: 'promo', language: 'he', category: 'MARKETING', processed_params: { 1: 'שלום {{contact.first_name}}' } })]);
  await query(`INSERT INTO public.contacts(id, account_id, name, phone_number, email) VALUES
    (60,1,'דנה לוי','0501111111','dana@x.com'),
    (61,1,'יוסי כהן','0502222222',NULL),
    (62,1,'רות אשר','0503333333',NULL)`);
  await query(`INSERT INTO drip.campaign_audience_snapshots(account_id,campaign_id,contact_id,contact_name,phone) VALUES
    (1,50,60,'דנה לוי','0501111111'),
    (1,50,61,'יוסי כהן','0502222222'),
    (1,50,62,'רות אשר','0503333333')`);
  // 60: failed, nothing was created in Chatwoot (typical 131049 rejection).
  // 61: delivered fine. 62: failed but a conversation row exists from the attempt.
  await query(`INSERT INTO public.conversations(id, display_id, account_id, contact_id, inbox_id) VALUES
    (700,9700,1,61,10), (702,9702,1,62,10)`);
  await query(`INSERT INTO drip.campaign_send_snapshots
    (account_id,campaign_id,contact_id,contact_name,phone,source_id,conversation_id,message_id,status,error_title) VALUES
    (1,50,60,'דנה לוי','0501111111','wamid-60',NULL,NULL,3,'131049: reached limit'),
    (1,50,61,'יוסי כהן','0502222222','wamid-61',700,8100,1,NULL),
    (1,50,62,'רות אשר','0503333333','wamid-62',702,8102,3,'131026: undeliverable')`);
}

// Fake Chatwoot client: records calls and creates the message row exactly like Chatwoot would.
function makeFakeClient({ failFor = new Set() } = {}) {
  const calls = { sendTemplate: [], createConversation: [] };
  let nextMsg = 9000;
  let nextConv = 800;
  const client = {
    calls,
    createConversation: async ({ sourceId, inboxId, contactId }) => {
      calls.createConversation.push({ sourceId, inboxId, contactId });
      const id = ++nextConv;
      await query(`INSERT INTO public.conversations(id, display_id, account_id, contact_id, inbox_id)
                   VALUES ($1,$2,1,$3,$4)`, [id, 9000 + id, contactId, inboxId]);
      return { id: 9000 + id };
    },
    sendTemplate: async (cid, t) => {
      calls.sendTemplate.push({ cid, t });
      if (failFor.has(cid)) throw new Error('Chatwoot POST → 422');
      const id = ++nextMsg;
      const conv = (await query(`SELECT id FROM public.conversations WHERE display_id = $1`, [cid]))[0];
      await query(`INSERT INTO public.messages(id,conversation_id,account_id,message_type,status,source_id,created_at)
                   VALUES ($1,$2,1,1,0,$3,now())`, [id, conv?.id || null, `wamid-retry-${id}`]);
      return { id, content: 'שלום' };
    },
  };
  return client;
}

const waitForDone = async (accountId, campaignId, ms = 3000) => {
  const until = Date.now() + ms;
  for (;;) {
    const s = resendStatus(accountId, campaignId);
    if (s && s.status === 'done') return s;
    if (Date.now() > until) throw new Error('resend job did not finish in time');
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('startResend: retries ONLY final-failed recipients, reuses/creates conversations, ledger flips the report', async () => {
  await seedResendCampaign();
  const client = makeFakeClient();
  const { total } = await startResend({ query, makeClientFor: async () => client, delayMs: 0 }, 1, 50);
  assert.equal(total, 2); // 60 + 62; the delivered 61 is untouched

  const s = await waitForDone(1, 50);
  assert.equal(s.sent, 2);
  assert.deepEqual(s.failed, []);

  // 60 had no conversation → one was created with the phone as source_id, on the campaign inbox.
  assert.deepEqual(client.calls.createConversation, [{ sourceId: '972501111111', inboxId: 10, contactId: 60 }]);
  // 62 reused its existing conversation (display 9702); no second create.
  const cids = client.calls.sendTemplate.map((c) => c.cid).sort();
  assert.deepEqual(cids, [9702, 9801].sort());

  // Liquid ran per contact: {{contact.first_name}} → the contact's first name.
  const forDana = client.calls.sendTemplate.find((c) => c.cid !== 9702);
  assert.deepEqual(forDana.t.params, { 1: 'שלום דנה' });
  assert.equal(forDana.t.name, 'promo');

  // Two retry ledger rows exist, keyed retry:*, pointing at the new messages.
  const ledger = await query(`SELECT source_id, status, message_id FROM drip.campaign_send_snapshots
                               WHERE campaign_id = 50 AND source_id LIKE 'retry:%' ORDER BY message_id`);
  assert.equal(ledger.length, 2);
  assert.ok(ledger.every((r) => r.status === 0 && r.message_id));

  // The report collapses each recipient to their BEST state: nobody is failed anymore.
  const summary = (await listCampaigns(query, 1)).find((c) => c.id === 50);
  assert.equal(summary.attempted, 3);
  assert.equal(summary.failed, 0);
  assert.equal(summary.sent, 3);
});

test('startResend: a recipient whose retry fails is reported, the rest still go out', async () => {
  await seedResendCampaign();
  const client = makeFakeClient({ failFor: new Set([9702]) }); // רות's conversation errors
  await startResend({ query, makeClientFor: async () => client, delayMs: 0 }, 1, 50);
  const s = await waitForDone(1, 50);
  assert.equal(s.sent, 1);
  assert.equal(s.failed.length, 1);
  assert.match(s.failed[0].error, /422/);
  assert.equal(s.failed[0].phone, '+972503333333');
});

test('startResend: suppressed (opted-out) recipients are never retried', async () => {
  await seedResendCampaign();
  await query(`INSERT INTO drip.contact_state(account_id, contact_id, suppressed_at, suppressed_reason)
               VALUES (1,60,now(),'opt_out')`);
  const client = makeFakeClient();
  await startResend({ query, makeClientFor: async () => client, delayMs: 0 }, 1, 50);
  const s = await waitForDone(1, 50);
  assert.equal(s.sent, 1);                       // only 62
  assert.equal(s.failed.length, 1);              // 60 reported as skipped, not silently dropped
  assert.match(s.failed[0].error, /הסרה/);
  assert.equal(client.calls.createConversation.length, 0); // no conversation opened for 60
});

test('startResend: refuses to double-start, and errors cleanly when nothing failed', async () => {
  await seedResendCampaign();
  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = {
    createConversation: makeFakeClient().createConversation,
    sendTemplate: async (...args) => { await gate; return makeFakeClient().sendTemplate(...args); },
  };
  await startResend({ query, makeClientFor: async () => slow, delayMs: 0 }, 1, 50);
  await assert.rejects(
    startResend({ query, makeClientFor: async () => slow, delayMs: 0 }, 1, 50),
    /כבר רצה/
  );
  release();
  await waitForDone(1, 50);

  // A campaign with zero failures has nothing to do — explicit error, not a silent no-op.
  await query(`UPDATE drip.campaign_send_snapshots SET status = 1 WHERE campaign_id = 50`);
  _resetResendJobs();
  await assert.rejects(
    startResend({ query, makeClientFor: async () => makeFakeClient(), delayMs: 0 }, 1, 50),
    /אין נמענים/
  );
});

test('liquidContactParams: substitutes contact fields; blank render is flagged', () => {
  const contact = { name: 'דנה לוי', phone_number: '+972501111111', email: 'd@x.com' };
  const { params, blank } = liquidContactParams(
    { 1: 'היי {{contact.first_name}}', 2: '{{ contact.phone_number }}', 3: 'קבוע' }, contact
  );
  assert.deepEqual(params, { 1: 'היי דנה', 2: '+972501111111', 3: 'קבוע' });
  assert.equal(blank, false);

  const empty = liquidContactParams({ 1: '{{contact.email}}' }, { name: 'x' });
  assert.equal(empty.blank, true);

  // ערך שאינו מחרוזת (מבנה header מקונן) עובר כמו שהוא, בלי להתרסק.
  const nested = liquidContactParams({ body: { 1: '{{contact.name}}' }, n: 5 }, contact);
  assert.deepEqual(nested.params, { body: { 1: 'דנה לוי' }, n: 5 });
});
