import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb } from './helpers.js';
import { getPool, query } from '../src/db.js';
import { listCampaigns, campaignExperiments, campaignsTierInfo } from '../src/campaigns.js';
import {
  startResend, resendStatus, liquidContactParams, _resetResendJobs,
  scheduleResend, pendingResend, cancelScheduledResend, runDueResends,
} from '../src/campaignResend.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

beforeEach(async () => {
  await setupDb(pool);
  await pool.query(`TRUNCATE public.campaigns, public.messages, public.contacts, public.conversations,
    public.contact_inboxes, public.inboxes, public.channel_whatsapp, drip.campaign_audience_snapshots,
    drip.campaign_send_snapshots, drip.contact_state, drip.campaign_resend_schedule,
    drip.account_health, drip.number_quality`);
  _resetResendJobs();
});

// The approved templates of the campaign's own number — what a chosen template is validated
// against. `rescue_utility` is the realistic experiment: same people, no-marketing wording.
const INBOX_TEMPLATES = [
  { name: 'promo', language: 'he', status: 'APPROVED', category: 'MARKETING',
    components: [{ type: 'BODY', text: 'שלום {{1}}, מבצע!' }] },
  { name: 'rescue_utility', language: 'he', status: 'APPROVED', category: 'UTILITY',
    components: [{ type: 'BODY', text: 'היי {{1}}, בקשר לפנייה שלך מ-{{2}}' }] },
  { name: 'with_image', language: 'he', status: 'APPROVED', category: 'MARKETING',
    components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'שלום {{1}}' }] },
  { name: 'still_pending', language: 'he', status: 'PENDING', category: 'MARKETING',
    components: [{ type: 'BODY', text: 'טיוטה' }] },
];

async function seedInboxTemplates() {
  await query(`INSERT INTO public.channel_whatsapp(id, phone_number, message_templates)
               VALUES (10,'+972500000000',$1)
               ON CONFLICT (id) DO UPDATE SET message_templates = EXCLUDED.message_templates`,
    [JSON.stringify(INBOX_TEMPLATES)]);
}

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

test('startResend: a chosen template is sent instead of the campaign one, and tagged as its own run', async () => {
  await seedResendCampaign();
  await seedInboxTemplates();
  const client = makeFakeClient();
  const chosen = {
    name: 'rescue_utility',
    language: 'he',
    params: { 1: '{{contact.first_name}}', 2: 'האתר' },
  };
  const res = await startResend(
    { query, makeClientFor: async () => client, delayMs: 0 }, 1, 50, 'he', { template: chosen }
  );
  assert.equal(res.template_name, 'rescue_utility');
  assert.ok(res.run_id);

  const s = await waitForDone(1, 50);
  assert.equal(s.sent, 2);
  assert.equal(s.template_name, 'rescue_utility');

  // The NEW template went out — with its own category/language and per-contact Liquid.
  const forDana = client.calls.sendTemplate.find((c) => c.cid !== 9702);
  assert.equal(forDana.t.name, 'rescue_utility');
  assert.equal(forDana.t.category, 'UTILITY');
  assert.deepEqual(forDana.t.params, { 1: 'דנה', 2: 'האתר' });

  // Every ledger row of this run carries the run id and the template it used.
  const rows = await query(`SELECT resend_run_id, template_name FROM drip.campaign_send_snapshots
                             WHERE campaign_id = 50 AND source_id LIKE 'retry:%'`);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.resend_run_id === res.run_id && r.template_name === 'rescue_utility'));
});

test('startResend: a chosen template is validated before a single message goes out', async () => {
  await seedResendCampaign();
  await seedInboxTemplates();
  const client = makeFakeClient();
  const run = (template) => startResend(
    { query, makeClientFor: async () => client, delayMs: 0 }, 1, 50, 'he', { template }
  );

  // Not approved on this number / does not exist at all.
  await assert.rejects(run({ name: 'still_pending', params: { 1: 'x' } }), /אינה מאושרת/);
  await assert.rejects(run({ name: 'no_such_template', params: {} }), /אינה מאושרת/);
  // Declares {{1}} and {{2}} — a missing or blank value is caught here, not by Meta.
  await assert.rejects(run({ name: 'rescue_utility', params: { 1: 'שלום' } }), /2 ערכי משתנים/);
  await assert.rejects(run({ name: 'rescue_utility', params: { 1: 'שלום', 2: '  ' } }), /2 ערכי משתנים/);
  // Media header without a link.
  await assert.rejects(run({ name: 'with_image', params: { 1: 'שלום' } }), /קישור מדיה/);

  assert.deepEqual(client.calls.sendTemplate, []); // nothing was sent by any of them
  _resetResendJobs();
});

test('campaignExperiments: one row per run, each with its template, results and replies', async () => {
  await seedResendCampaign();
  await seedInboxTemplates();
  // The original send needs message rows for its delivered recipient (61 → message 8100).
  await query(`INSERT INTO public.messages(id,conversation_id,account_id,message_type,status,created_at)
               VALUES (8100,700,1,1,1, now() - interval '2 hours'),
                      (8102,702,1,1,3, now() - interval '2 hours')`);
  await query(`UPDATE drip.campaign_send_snapshots SET attempted_at = now() - interval '2 hours'`);

  const client = makeFakeClient();
  const { run_id } = await startResend(
    { query, makeClientFor: async () => client, delayMs: 0 }, 1, 50, 'he',
    { template: { name: 'rescue_utility', language: 'he', params: { 1: '{{contact.first_name}}', 2: 'האתר' } } }
  );
  await waitForDone(1, 50);

  // רות (conversation 702) answers AFTER the retry — the reply belongs to the experiment,
  // not to the original send that failed two hours earlier.
  await query(`INSERT INTO public.messages(id,conversation_id,account_id,message_type,status,content,created_at)
               VALUES (8200,702,1,0,1,'מעוניינת', now())`);

  const rows = await campaignExperiments(query, 1, 50);
  assert.equal(rows.length, 2);

  const [original, experiment] = rows;
  assert.equal(original.run_id, null);
  assert.equal(original.attempted, 3);
  assert.equal(original.failed, 2);
  assert.equal(original.delivered, 1);
  assert.equal(original.replied, 0);          // the reply came after the retry, not this send

  assert.equal(experiment.run_id, run_id);
  assert.equal(experiment.template_name, 'rescue_utility');
  assert.equal(experiment.attempted, 2);
  assert.equal(experiment.replied, 1);
});

test('startResend: the client reads templates from the SENDING number, not the account default', async () => {
  await seedResendCampaign();
  await seedInboxTemplates();
  // בדיוק התקלה של 11.8.26: חשבון עם כמה מספרים ובלי מספר "נבחר" — loadTemplates ברמת
  // חשבון החזיר ריק, ולכן ההודעה יצאה בלי גוף ובלי כותרת-מדיה ומטא דחתה 451 מהן ב-132012.
  await query(`INSERT INTO public.inboxes(id, account_id, name, channel_type, channel_id)
               VALUES (11,1,'WA-2','Channel::Whatsapp',11) ON CONFLICT (id) DO NOTHING`);

  const seen = [];
  const client = makeFakeClient();
  const makeClientFor = async (_acct, templatesInboxId) => { seen.push(templatesInboxId); return client; };
  await startResend({ query, makeClientFor, delayMs: 0 }, 1, 50);
  await waitForDone(1, 50);
  assert.deepEqual(seen, [10]);   // המספר של הקמפיין, לא null וגם לא ניחוש
});

test('startResend: sending from a different number of the account, and only that account', async () => {
  await seedResendCampaign();
  await query(`INSERT INTO public.inboxes(id, account_id, name, channel_type, channel_id)
               VALUES (11,1,'WA-2','Channel::Whatsapp',11), (12,2,'other-acct','Channel::Whatsapp',12)
               ON CONFLICT (id) DO NOTHING`);
  await query(`INSERT INTO public.channel_whatsapp(id, phone_number, message_templates)
               VALUES (11,'+972511111111',$1) ON CONFLICT (id) DO UPDATE SET message_templates = EXCLUDED.message_templates`,
    [JSON.stringify(INBOX_TEMPLATES)]);

  // תיבה של חשבון אחר נדחית — המזהה מגיע מהדפדפן.
  await assert.rejects(
    startResend({ query, makeClientFor: async () => makeFakeClient(), delayMs: 0 }, 1, 50, 'he', { inboxId: 12 }),
    /אינו מספר וואטסאפ של החשבון/
  );
  _resetResendJobs();

  const seen = [];
  const client = makeFakeClient();
  const makeClientFor = async (_acct, templatesInboxId) => { seen.push(templatesInboxId); return client; };
  const res = await startResend({ query, makeClientFor, delayMs: 0 }, 1, 50, 'he', { inboxId: 11 });
  assert.equal(res.inbox_id, 11);
  await waitForDone(1, 50);
  assert.deepEqual(seen, [11]);

  // ⚠️ לא נכנסים לשיחה הקיימת של המספר הישן — היא שייכת לתיבה ההיא, וההודעה הייתה
  // יוצאת מהמספר שברחנו ממנו. כל נמען מקבל שיחה חדשה בתיבה החדשה.
  assert.equal(client.calls.createConversation.length, 2);
  assert.ok(client.calls.createConversation.every((c) => c.inboxId === 11));
});

test('scheduleResend: one pending run per campaign, executed by the tick when it comes due', async () => {
  await seedResendCampaign();
  await seedInboxTemplates();

  // מועד עתידי — הטיק לא נוגע בו.
  const future = new Date(Date.now() + 3600_000).toISOString();
  await scheduleResend(query, 1, 50, future);
  assert.equal((await pendingResend(query, 1, 50)).run_at.toISOString(), future);

  const client = makeFakeClient();
  assert.deepEqual(await runDueResends({ query, makeClientFor: async () => client, delayMs: 0 }), { due: 0, started: 0 });

  // תזמון שני מחליף את הראשון במקום להצטבר — אחרת "שיניתי את השעה" = שתי שליחות.
  await scheduleResend(query, 1, 50, new Date(Date.now() - 1000).toISOString(),
    { template: { name: 'rescue_utility', language: 'he', params: { 1: '{{contact.first_name}}', 2: 'האתר' } } });
  const rows = await query('SELECT count(*)::int AS n FROM drip.campaign_resend_schedule WHERE started_at IS NULL');
  assert.equal(rows[0].n, 1);

  // הגיע הזמן → הטיק מריץ, בתבנית שנשמרה איתו.
  const res = await runDueResends({ query, makeClientFor: async () => client, delayMs: 0 });
  assert.deepEqual(res, { due: 1, started: 1 });
  const s = await waitForDone(1, 50);
  assert.equal(s.sent, 2);
  assert.equal(s.template_name, 'rescue_utility');

  // סומן כרץ → טיק שני לא שולח שוב, ואין יותר תזמון ממתין.
  assert.deepEqual(await runDueResends({ query, makeClientFor: async () => client, delayMs: 0 }), { due: 0, started: 0 });
  assert.equal(await pendingResend(query, 1, 50), null);
});

test('cancelScheduledResend: removes the pending run and nothing fires', async () => {
  await seedResendCampaign();
  await scheduleResend(query, 1, 50, new Date(Date.now() - 1000).toISOString());
  assert.deepEqual(await cancelScheduledResend(query, 1, 50), { cancelled: 1 });
  assert.equal(await pendingResend(query, 1, 50), null);

  const client = makeFakeClient();
  assert.deepEqual(await runDueResends({ query, makeClientFor: async () => client, delayMs: 0 }), { due: 0, started: 0 });
  assert.deepEqual(client.calls.sendTemplate, []);
});

test('campaignsTierInfo: never invents a cap — unknown when Meta was never read', async () => {
  await seedResendCampaign();

  // אין account_health ואין number_quality → "לא ידוע", ולא DEFAULT_CAP=250 שהוצג
  // ללקוח עם מכסת 2,000 כ"נותרו 194" והרתיע אותו משליחה.
  const none = await campaignsTierInfo(query, null, 1);
  assert.equal(none.unknown, true);
  assert.equal(none.cap, null);
  assert.equal(none.remaining, null);

  // תצפית המספרים (שסורקת גם חשבונות בלי רצפים) מספיקה כדי לדעת את המכסה.
  await query(`INSERT INTO drip.number_quality(phone_id, inbox_id, account_id, phone, quality, tier)
               VALUES ('pid-10', 10, 1, '+972500000000', 'GREEN', 'TIER_2K')`);
  const known = await campaignsTierInfo(query, null, 1, {}, 10);
  assert.equal(known.unknown, false);
  assert.equal(known.cap, 2000);
  assert.ok(known.remaining <= 2000);
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
