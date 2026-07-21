import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { setupDb, relaxCompliance } from './helpers.js';
import { reconcileAccount, paramsResolve } from '../src/reconcile.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);
beforeEach(async () => {
  await setupDb(pool);
  // Scaffold a minimal public.conversations table so enroll-phase tests can run.
  // Production uses the real Chatwoot table; this is test-only scaffolding.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.conversations (
      id               int PRIMARY KEY,
      display_id       int,
      account_id       int,
      custom_attributes jsonb DEFAULT '{}'::jsonb
    )
  `);
  await pool.query('TRUNCATE public.conversations');
  await query('TRUNCATE drip.enrollments, drip.sequence_steps, drip.sequences, drip.no_send_windows, drip.sent_messages CASCADE');
  await relaxCompliance(pool);
});


test('paramsResolve substitutes system tokens', () => {
  assert.deepEqual(
    paramsResolve(['@name', 'hi', '@phone'], { name: 'Dan', phone: '050' }),
    ['Dan', 'hi', '050']
  );
});

test('paramsResolve handles @email token', () => {
  assert.deepEqual(
    paramsResolve(['@email', '@name'], { name: 'Dan', email: 'dan@x.com' }),
    ['dan@x.com', 'Dan']
  );
});

test('paramsResolve strips @suffix from JID-as-name (WAHA contacts) for a cleaner greeting', () => {
  // WAHA-synced contacts can have a JID as their name; strip the @suffix for display.
  assert.deepEqual(paramsResolve(['@name'], { name: '972524947060@c.us' }), ['972524947060']);
  assert.deepEqual(paramsResolve(['@name'], { name: '272804125610136@lid' }), ['272804125610136']);
  assert.deepEqual(paramsResolve(['@name'], { name: 'ניב' }), ['ניב']); // real name untouched
});

test('paramsResolve @first_name uses only the first word (nicer WhatsApp greeting)', () => {
  assert.deepEqual(paramsResolve(['@first_name'], { name: 'Vered Ganima Zilberman' }), ['Vered']);
  assert.deepEqual(paramsResolve(['@first_name'], { name: 'אתי רזיאל אלקוצר' }), ['אתי']);
  assert.deepEqual(paramsResolve(['@first_name'], { name: 'מוריה' }), ['מוריה']); // single word → itself
  assert.deepEqual(paramsResolve(['@first_name'], { name: '972524947060@c.us' }), ['972524947060']); // JID cleaned first
  assert.deepEqual(paramsResolve(['@first_name'], { name: '' }), ['']); // empty → empty, no throw
});

test('paramsResolve returns empty array for null params', () => {
  assert.deepEqual(paramsResolve(null, { name: 'Dan' }), []);
});

test('paramsResolve leaves unknown tokens unchanged', () => {
  assert.deepEqual(paramsResolve(['@unknown', 'literal'], { name: 'Dan' }), ['@unknown', 'literal']);
});

// Matches the brief's exact test — uses a fixed past next_send_at and a weekday "now"
test('due active enrollment sends and advances', async () => {
  const seq = (await query(
    // skip_shabbat=false so this test is not day-of-week sensitive
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,'k','K',false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days) VALUES ($1,1,'t1',0),($1,2,'t2',3)`,
    [seq]
  );
  // Use a fixed past timestamp so it's always due regardless of when tests run
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,42,$1,1,'2020-01-01 00:00:00+00','active')`,
    [seq]
  );
  const sent = [];
  const client = {
    sendTemplate: (_cid, t) => { sent.push(t.name); return 99; },
    getContact: async () => ({ name: 'D' }),
    patchAttrs: async () => {},
    incomingSince: async () => false,
    outgoingByHumanSince: async () => false,
  };
  await reconcileAccount(pool, client, 1, new Date());
  assert.deepEqual(sent, ['t1']);
  const e = (await query('SELECT current_step,status FROM drip.enrollments WHERE conversation_id=42'))[0];
  assert.equal(e.current_step, 2);
  assert.equal(e.status, 'active');
});

test('advance pushes a step landing on shabbat to the next working day (skip_shabbat)', async () => {
  const summerShabbat = [{ starts_at: '2026-06-19T19:13:00+03:00', ends_at: '2026-06-20T20:25:00+03:00', kind: 'shabbat' }];
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,'sk','SK',true) RETURNING id`
  ))[0].id;
  // step 2 = +2 days @ 19:00 — from a Thursday send that lands on Saturday.
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days,send_hour)
     VALUES ($1,1,'s1',0,NULL),($1,2,'s2',2,19)`,
    [seq]
  );
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,142,$1,1,'2020-01-01 00:00:00+00','active')`,
    [seq]
  );
  const client = {
    sendTemplate: () => 1,
    getContact: async () => ({ name: 'D' }),
    patchAttrs: async () => {},
    incomingSince: async () => false,
    outgoingByHumanSince: async () => false,
  };
  // Send step 1 on Thu 2026-06-18 12:00Z (not shabbat) → advance to step 2.
  // Step 2 = +2d @19:00 = Sat 06-20 19:00 (in window) → must skip to Sun 06-21 19:00 = 16:00 UTC.
  await reconcileAccount(pool, client, 1, new Date('2026-06-18T12:00:00Z'), summerShabbat);
  const e = (await query('SELECT current_step, next_send_at FROM drip.enrollments WHERE conversation_id=142'))[0];
  assert.equal(e.current_step, 2);
  assert.equal(new Date(e.next_send_at).toISOString(), '2026-06-21T16:00:00.000Z');
});

test('advance does NOT skip shabbat when skip_shabbat is false', async () => {
  const summerShabbat = [{ starts_at: '2026-06-19T19:13:00+03:00', ends_at: '2026-06-20T20:25:00+03:00', kind: 'shabbat' }];
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,'nsk','NSK',false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days,send_hour)
     VALUES ($1,1,'s1',0,NULL),($1,2,'s2',2,19)`,
    [seq]
  );
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,143,$1,1,'2020-01-01 00:00:00+00','active')`,
    [seq]
  );
  const client = {
    sendTemplate: () => 1, getContact: async () => ({ name: 'D' }),
    patchAttrs: async () => {}, incomingSince: async () => false,
    outgoingByHumanSince: async () => false,
  };
  // skip_shabbat=false → no skip; step 2 stays on Sat 06-20 19:00 = 16:00 UTC.
  await reconcileAccount(pool, client, 1, new Date('2026-06-18T12:00:00Z'), summerShabbat);
  const e = (await query('SELECT next_send_at FROM drip.enrollments WHERE conversation_id=143'))[0];
  assert.equal(new Date(e.next_send_at).toISOString(), '2026-06-20T16:00:00.000Z');
});

test('last step sends and sets completed', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,'last','Last',false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days) VALUES ($1,1,'only',0)`,
    [seq]
  );
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,55,$1,1,'2020-01-01 00:00:00+00','active')`,
    [seq]
  );
  const sent = [];
  const patchedStates = [];
  const client = {
    sendTemplate: (_cid, t) => { sent.push(t.name); return 88; },
    getContact: async () => ({ name: 'X' }),
    patchAttrs: async (_cid, attrs) => { if (attrs.seq_state) patchedStates.push(attrs.seq_state); },
    incomingSince: async () => false,
    outgoingByHumanSince: async () => false,
  };
  await reconcileAccount(pool, client, 1, new Date());
  assert.deepEqual(sent, ['only']);
  const e = (await query('SELECT status FROM drip.enrollments WHERE conversation_id=55'))[0];
  assert.equal(e.status, 'completed');
  assert.ok(patchedStates.includes('completed'));
});

test('no follow-up send when isNoSendNow quiet hours', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,quiet_start,quiet_end,skip_shabbat) VALUES (1,'q','Q','22:00','08:00',false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days) VALUES
       ($1,1,'first',0),
       ($1,2,'qt',1)`,
    [seq]
  );
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,77,$1,2,'2020-01-01 00:00:00+00','active')`,
    [seq]
  );
  const sent = [];
  const client = {
    sendTemplate: (_cid, t) => { sent.push(t.name); return 1; },
    getContact: async () => ({ name: 'Y' }),
    patchAttrs: async () => {},
    incomingSince: async () => false,
    outgoingByHumanSince: async () => false,
  };
  // 23:30 Israel time (UTC+3 in summer) = 20:30 UTC — inside 22:00-08:00 quiet window
  await reconcileAccount(pool, client, 1, new Date('2026-06-16T20:30:00Z'));
  assert.deepEqual(sent, []);
  const e = (await query('SELECT status FROM drip.enrollments WHERE conversation_id=77'))[0];
  assert.equal(e.status, 'active');
});

test('no send on Shabbat when skip_shabbat=true', async () => {
  const seq = (await query(
    // skip_shabbat defaults to true in schema
    `INSERT INTO drip.sequences(account_id,key,display_name) VALUES (1,'shabbat','Shabbat') RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days) VALUES ($1,1,'sb_t',0)`,
    [seq]
  );
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,88,$1,1,'2020-01-01 00:00:00+00','active')`,
    [seq]
  );
  const sent = [];
  const client = {
    sendTemplate: (_cid, t) => { sent.push(t.name); return 1; },
    getContact: async () => ({ name: 'S' }),
    patchAttrs: async () => {},
    incomingSince: async () => false,
    outgoingByHumanSince: async () => false,
  };
  // Saturday at 12:00 Israel time
  await reconcileAccount(pool, client, 1, new Date('2026-06-20T09:00:00Z'));
  assert.deepEqual(sent, [], 'should not send on Shabbat');
});

test('no send inside a Hebcal no-send window via the window path (weekday yom-tov)', async () => {
  const seq = (await query(
    // skip_shabbat defaults to true
    `INSERT INTO drip.sequences(account_id,key,display_name) VALUES (1,'win','Win') RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days) VALUES ($1,1,'win_t',0)`,
    [seq]
  );
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,89,$1,1,'2020-01-01 00:00:00+00','active')`,
    [seq]
  );
  const sent = [];
  const client = {
    sendTemplate: (_cid, t) => { sent.push(t.name); return 1; },
    getContact: async () => ({ name: 'S' }),
    patchAttrs: async () => {},
    incomingSince: async () => false,
    outgoingByHumanSince: async () => false,
  };
  // Yom Kippur window. `now` is MONDAY 10:00 IL inside it — Monday is neither Friday
  // nor Saturday, so the fail-closed fallback would NOT block. Blocking here proves
  // the window path is wired end-to-end through reconcileAccount.
  const ykWindow = [{ starts_at: '2026-09-20T17:58:00+03:00', ends_at: '2026-09-21T19:14:00+03:00', kind: 'yomtov' }];
  await reconcileAccount(pool, client, 1, new Date('2026-09-21T07:00:00Z'), ykWindow);
  assert.deepEqual(sent, [], 'should not send inside a yom-tov window');
});

test('stop_on_reply stops enrollment when customer replies', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,stop_on_reply,skip_shabbat) VALUES (1,'sor','SOR',true,false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days) VALUES ($1,1,'sor_t',5)`,
    [seq]
  );
  // Enrollment already sent step 1 (last_sent_at set), waiting for step 2 in future
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status,last_sent_at)
     VALUES (1,99,$1,2,now()+interval '3 days','active',now()-interval '1 hour')`,
    [seq]
  );
  const client = {
    sendTemplate: async () => 1,
    getContact: async () => ({ name: 'Z' }),
    patchAttrs: async () => {},
    incomingSince: async () => true, // customer replied!
    outgoingByHumanSince: async () => false,
  };
  await reconcileAccount(pool, client, 1, new Date());
  const e = (await query('SELECT status FROM drip.enrollments WHERE conversation_id=99'))[0];
  assert.equal(e.status, 'stopped');
});

// ── per-step send condition (flexible reply gate) ───────────────────────────
// Each step carries send_condition (always|no_reply|replied) + on_condition_fail
// (skip|stop). When the condition is NOT met: 'skip' advances past the step and KEEPS
// the sequence going (no send); 'stop' halts the enrollment. When the condition IS
// met, the step is sent normally. Independent of the sequence-level stop_on_reply.

test('no_reply + skip: customer replied → skips the step but CONTINUES the sequence', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,'sc1','SC1',false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days,send_condition,on_condition_fail)
     VALUES ($1,1,'first',0,'always','skip'),($1,2,'reminder',0,'no_reply','skip'),($1,3,'third',0,'always','skip')`,
    [seq]
  );
  // At step 2 (gated reminder); step 1 already sent, due now.
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status,last_sent_at)
     VALUES (1,2001,$1,2,'2020-01-01 00:00:00+00','active',now()-interval '1 hour')`,
    [seq]
  );
  const sent = [];
  const client = {
    sendTemplate: (_cid, t) => { sent.push(t.name); return 1; },
    getContact: async () => ({ name: 'R' }),
    patchAttrs: async () => {},
    incomingSince: async () => true, // replied
    outgoingByHumanSince: async () => false,
  };
  await reconcileAccount(pool, client, 1, new Date());
  assert.deepEqual(sent, [], 'gated step is skipped (not sent) when the customer replied');
  const e = (await query('SELECT current_step,status FROM drip.enrollments WHERE conversation_id=2001'))[0];
  assert.equal(e.status, 'active', 'sequence CONTINUES — not stopped');
  assert.equal(e.current_step, 3, 'advanced past the skipped step to step 3');
});

test('no_reply + skip: customer did NOT reply → sends the step, then advances', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,'sc2','SC2',false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days,send_condition,on_condition_fail)
     VALUES ($1,1,'first',0,'always','skip'),($1,2,'reminder',0,'no_reply','skip'),($1,3,'third',0,'always','skip')`,
    [seq]
  );
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status,last_sent_at)
     VALUES (1,2002,$1,2,'2020-01-01 00:00:00+00','active',now()-interval '1 hour')`,
    [seq]
  );
  const sent = [];
  const client = {
    sendTemplate: (_cid, t) => { sent.push(t.name); return 1; },
    getContact: async () => ({ name: 'R' }),
    patchAttrs: async () => {},
    incomingSince: async () => false, // no reply
    outgoingByHumanSince: async () => false,
  };
  await reconcileAccount(pool, client, 1, new Date());
  assert.deepEqual(sent, ['reminder'], 'step is sent when the customer did not reply');
  const e = (await query('SELECT current_step,status FROM drip.enrollments WHERE conversation_id=2002'))[0];
  assert.equal(e.status, 'active');
  assert.equal(e.current_step, 3, 'advanced to next step after sending');
});

test('no_reply + stop: customer replied → stops the sequence (no send)', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,'sc3','SC3',false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days,send_condition,on_condition_fail)
     VALUES ($1,1,'first',0,'always','skip'),($1,2,'reminder',0,'no_reply','stop')`,
    [seq]
  );
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status,last_sent_at)
     VALUES (1,2003,$1,2,'2020-01-01 00:00:00+00','active',now()-interval '1 hour')`,
    [seq]
  );
  const sent = [];
  const client = {
    sendTemplate: (_cid, t) => { sent.push(t.name); return 1; },
    getContact: async () => ({ name: 'R' }),
    patchAttrs: async () => {},
    incomingSince: async () => true, // replied
    outgoingByHumanSince: async () => false,
  };
  await reconcileAccount(pool, client, 1, new Date());
  assert.deepEqual(sent, [], 'nothing sent');
  const e = (await query('SELECT status FROM drip.enrollments WHERE conversation_id=2003'))[0];
  assert.equal(e.status, 'stopped', 'on_condition_fail=stop halts the enrollment');
});

test('replied condition: customer replied → sends the step (e.g. a thank-you)', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,'sc4','SC4',false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days,send_condition,on_condition_fail)
     VALUES ($1,1,'first',0,'always','skip'),($1,2,'thankyou',0,'replied','skip')`,
    [seq]
  );
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status,last_sent_at)
     VALUES (1,2004,$1,2,'2020-01-01 00:00:00+00','active',now()-interval '1 hour')`,
    [seq]
  );
  const sent = [];
  const client = {
    sendTemplate: (_cid, t) => { sent.push(t.name); return 1; },
    getContact: async () => ({ name: 'R' }),
    patchAttrs: async () => {},
    incomingSince: async () => true, // replied → condition met
    outgoingByHumanSince: async () => false,
  };
  await reconcileAccount(pool, client, 1, new Date());
  assert.deepEqual(sent, ['thankyou'], 'replied-gated step is sent when the customer replied');
});

test('no_reply + skip on the LAST step: replied → skips and completes', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,'sc5','SC5',false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days,send_condition,on_condition_fail)
     VALUES ($1,1,'first',0,'always','skip'),($1,2,'reminder',0,'no_reply','skip')`,
    [seq]
  );
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status,last_sent_at)
     VALUES (1,2005,$1,2,'2020-01-01 00:00:00+00','active',now()-interval '1 hour')`,
    [seq]
  );
  const sent = [];
  const client = {
    sendTemplate: (_cid, t) => { sent.push(t.name); return 1; },
    getContact: async () => ({ name: 'R' }),
    patchAttrs: async () => {},
    incomingSince: async () => true, // replied
    outgoingByHumanSince: async () => false,
  };
  await reconcileAccount(pool, client, 1, new Date());
  assert.deepEqual(sent, [], 'last gated step skipped');
  const e = (await query('SELECT status FROM drip.enrollments WHERE conversation_id=2005'))[0];
  assert.equal(e.status, 'completed', 'skipping the last step completes the enrollment');
});

test('enroll phase: no error when public.conversations table missing', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,enabled,skip_shabbat) VALUES (1,'myseq','My Seq',true,false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days) VALUES ($1,1,'enroll_t',0)`,
    [seq]
  );
  const client = {
    sendTemplate: async () => 1,
    getContact: async () => ({ name: 'E' }),
    patchAttrs: async () => {},
    incomingSince: async () => false,
    outgoingByHumanSince: async () => false,
  };
  // Should not throw even if public.conversations is absent
  await reconcileAccount(pool, client, 1, new Date());
});

test('idempotent: running twice does not double-send', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,'idem','Idem',false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days) VALUES ($1,1,'t_idem',0),($1,2,'t_idem2',1)`,
    [seq]
  );
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,300,$1,1,'2020-01-01 00:00:00+00','active')`,
    [seq]
  );
  const sent = [];
  const client = {
    sendTemplate: (_cid, t) => { sent.push(t.name); return 5; },
    getContact: async () => ({ name: 'I' }),
    patchAttrs: async () => {},
    incomingSince: async () => false,
    outgoingByHumanSince: async () => false,
  };
  const now = new Date();
  await reconcileAccount(pool, client, 1, now);
  await reconcileAccount(pool, client, 1, now);
  // First run: sends t_idem, advances to step 2 (next_send_at = now+1day, not due)
  // Second run: step 2 not due yet, so nothing sent
  assert.deepEqual(sent, ['t_idem']);
});

test('category is passed through to sendTemplate', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat) VALUES (1,'cat','Cat',false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days,category) VALUES ($1,1,'tmpl',0,'MARKETING')`,
    [seq]
  );
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,400,$1,1,'2020-01-01 00:00:00+00','active')`,
    [seq]
  );
  const calls = [];
  const client = {
    sendTemplate: (_cid, t) => { calls.push({ name: t.name, category: t.category }); return 1; },
    getContact: async () => ({ name: 'C' }),
    patchAttrs: async () => {},
    incomingSince: async () => false,
    outgoingByHumanSince: async () => false,
  };
  await reconcileAccount(pool, client, 1, new Date());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'tmpl');
  assert.equal(calls[0].category, 'MARKETING');
});

// ── Two independent kill switches (migration 018) ───────────────────────────
// send_enabled=false = PAUSE (not stop): an already-enrolled lead stops receiving while
// sends are paused, but keeps its place so re-enabling resumes from the same step.
// enroll_enabled gates ONLY new entries (Phase 1) — it must NOT affect active runs.

test('PAUSE: send_enabled=false stops sends to already-active enrollments; state untouched', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,send_enabled,skip_shabbat) VALUES (1,'paused','Paused',false,false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days) VALUES ($1,1,'p1',0),($1,2,'p2',3)`,
    [seq]
  );
  // Lead is already mid-sequence and overdue — the only thing stopping the send is send_enabled=false.
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,77,$1,1,'2020-01-01 00:00:00+00','active')`,
    [seq]
  );
  const sent = [];
  const client = {
    sendTemplate: (_cid, t) => { sent.push(t.name); return 99; },
    getContact: async () => ({ name: 'D' }),
    patchAttrs: async () => {},
    incomingSince: async () => false,
    outgoingByHumanSince: async () => false,
  };
  await reconcileAccount(pool, client, 1, new Date());
  assert.deepEqual(sent, [], 'paused sequence must not send to active enrollments');
  const e = (await query('SELECT current_step,status FROM drip.enrollments WHERE conversation_id=77'))[0];
  assert.equal(e.current_step, 1, 'step unchanged while paused');
  assert.equal(e.status, 'active', 'stays active (paused, not stopped) so re-enabling resumes');
});

test('RESUME: re-enabling send_enabled continues from the exact step it left off', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,send_enabled,skip_shabbat) VALUES (1,'resume','Resume',false,false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days) VALUES ($1,1,'r1',0),($1,2,'r2',3),($1,3,'r3',3)`,
    [seq]
  );
  // Lead already advanced to step 2 BEFORE the pause.
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,78,$1,2,'2020-01-01 00:00:00+00','active')`,
    [seq]
  );
  const sent = [];
  const client = {
    sendTemplate: (_cid, t) => { sent.push(t.name); return 99; },
    getContact: async () => ({ name: 'D' }),
    patchAttrs: async () => {},
    incomingSince: async () => false,
    outgoingByHumanSince: async () => false,
  };
  // Paused → nothing goes out, however overdue.
  await reconcileAccount(pool, client, 1, new Date());
  assert.deepEqual(sent, [], 'still paused');
  // Re-enable sends → resumes from step 2 (where it paused), NOT step 1.
  await query('UPDATE drip.sequences SET send_enabled=true WHERE id=$1', [seq]);
  await reconcileAccount(pool, client, 1, new Date());
  assert.deepEqual(sent, ['r2'], 'resumes the exact step it was paused on');
  const e = (await query('SELECT current_step,status FROM drip.enrollments WHERE conversation_id=78'))[0];
  assert.equal(e.current_step, 3, 'advanced one step after the resumed send');
});

test('SWITCHES INDEPENDENT: enroll off + send on → an already-active lead still receives', async () => {
  // "Stop new entries" (enroll_enabled=false) must NOT stop messages to runs already in
  // progress — that's the whole point of the two switches being separate.
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,enroll_enabled,send_enabled,skip_shabbat)
     VALUES (1,'mix','Mix',false,true,false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days) VALUES ($1,1,'m1',0),($1,2,'m2',3)`,
    [seq]
  );
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,79,$1,1,'2020-01-01 00:00:00+00','active')`,
    [seq]
  );
  const sent = [];
  const client = {
    sendTemplate: (_cid, t) => { sent.push(t.name); return 99; },
    getContact: async () => ({ name: 'D' }),
    patchAttrs: async () => {},
    incomingSince: async () => false,
    outgoingByHumanSince: async () => false,
  };
  await reconcileAccount(pool, client, 1, new Date());
  assert.deepEqual(sent, ['m1'], 'enroll switch off must not block sends to active leads');
});

// ── Enroll-phase tests moved to contact_enroll.test.js ──────────────────────
// The enroll trigger is now CONTACT-level (public.contacts.custom_attributes.sequence)
// with lazy conversation creation at first send, so the enroll/switch/clear/loop-guard/
// re-run behaviours are exercised against contacts in test/contact_enroll.test.js.

// ── Critical 1: per-enrollment tx — 2nd send error must not roll back 1st ───

test('CRITICAL1: send error on 2nd enrollment does not roll back 1st advance', async () => {
  const seq = (await query(
    `INSERT INTO drip.sequences(account_id,key,display_name,skip_shabbat)
     VALUES (1,'c1','C1',false) RETURNING id`
  ))[0].id;
  await query(
    `INSERT INTO drip.sequence_steps(sequence_id,step_order,template_name,delay_days)
     VALUES ($1,1,'msg1',0),($1,2,'msg1b',1)`,
    [seq]
  );
  // Two due enrollments
  await query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,601,$1,1,'2020-01-01 00:00:00+00','active'),
            (1,602,$1,1,'2020-01-01 00:00:00+00','active')`,
    [seq]
  );

  const sent = [];
  const client = {
    sendTemplate: async (_cid, _t) => {
      if (_cid === 602) throw new Error('Simulated Chatwoot 5xx');
      sent.push(_cid);
    },
    getContact: async () => ({ name: 'X' }),
    patchAttrs: async () => {},
    incomingSince: async () => false,
    outgoingByHumanSince: async () => false,
  };

  // Cycle 1 — conv 601 succeeds, conv 602 throws
  const now = new Date();
  await reconcileAccount(pool, client, 1, now);

  // Conv 601 must be advanced (step 2, not re-sendable yet)
  const e601 = (await query(
    `SELECT current_step, status FROM drip.enrollments WHERE conversation_id=601`
  ))[0];
  assert.equal(e601.current_step, 2, 'conv 601 must have advanced to step 2');
  assert.equal(e601.status, 'active');

  // Conv 602 must still be at step 1 (send failed, never advanced)
  const e602 = (await query(
    `SELECT current_step, status FROM drip.enrollments WHERE conversation_id=602`
  ))[0];
  assert.equal(e602.current_step, 1, 'conv 602 must stay at step 1 after failed send');

  // Cycle 2 — conv 602's failed send backed off ~1h; conv 601 step 2 isn't due (now+1day).
  // Advance the clock past 602's backoff window so it retries here (601 still must not).
  sent.length = 0;
  // Fix the client so 602 succeeds this time
  const client2 = {
    sendTemplate: async (_cid, _t) => { sent.push(_cid); },
    getContact: async () => ({ name: 'X' }),
    patchAttrs: async () => {},
    incomingSince: async () => false,
    outgoingByHumanSince: async () => false,
  };
  const now2 = new Date(now.getTime() + 2 * 3600 * 1000); // past 602's 1h backoff
  await reconcileAccount(pool, client2, 1, now2);

  // 601 must NOT have been re-sent (no double-send)
  assert.ok(!sent.includes(601), 'conv 601 must NOT be re-sent in cycle 2 (no double-send)');
  // 602 retries its step 1
  assert.ok(sent.includes(602), 'conv 602 must be retried in cycle 2');
});

// ── Critical 2: orphaned enrollment (sequence_id=NULL) ──────────────────────

test('CRITICAL2: enrollment with sequence_id=NULL is stopped gracefully without throw', async () => {
  // Insert enrollment with NULL sequence_id directly (simulates ON DELETE SET NULL)
  await pool.query(
    `INSERT INTO drip.enrollments(account_id,conversation_id,sequence_id,current_step,next_send_at,status)
     VALUES (1,700,NULL,1,'2020-01-01 00:00:00+00','active')`
  );
  const client = {
    sendTemplate: async () => { throw new Error('should not be called'); },
    getContact: async () => ({ name: 'O' }),
    patchAttrs: async () => {},
    incomingSince: async () => false,
    outgoingByHumanSince: async () => false,
  };
  // Must not throw
  await reconcileAccount(pool, client, 1, new Date());
  const e = (await query(
    `SELECT status FROM drip.enrollments WHERE conversation_id=700`
  ))[0];
  assert.equal(e.status, 'stopped', 'orphaned enrollment must be stopped');
});
