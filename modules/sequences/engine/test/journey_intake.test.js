/**
 * External journey intake: pure authentication/normalization plus DB-backed idempotency.
 * No test in this file sends a real message or calls Chatwoot/Make.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb } from './helpers.js';
import { getPool, query } from '../src/db.js';
import {
  IntakeError,
  claimJourneyIntake,
  handleJourneyIntake,
  normalizeIntakePayload,
  normalizeLeadPhone,
  perAccountIntakeToken,
  resolveOrCreateContact,
  stopSupersededRuns,
  validIntakeAuthorization,
} from '../src/journeyIntake.js';

const pool = getPool({ databaseUrl: process.env.DATABASE_URL_TEST });
const JOURNEY_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(async () => {
  await setupDb(pool);
  await query('TRUNCATE drip.journey_intakes, drip.journey_runs, drip.journeys CASCADE');
  await query(`TRUNCATE public.contact_inboxes, public.conversations, public.contacts,
                        public.inboxes, public.agent_bots CASCADE`);
});

const basic = (password, username = 'make') =>
  `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;

test('intake token is purpose/account scoped and Basic auth uses the fixed Make username', () => {
  const token14 = perAccountIntakeToken('intake-master', 14);
  assert.equal(token14, perAccountIntakeToken('intake-master', 14));
  assert.notEqual(token14, perAccountIntakeToken('intake-master', 15));
  assert.notEqual(token14, perAccountIntakeToken('different-master', 14));

  assert.equal(validIntakeAuthorization(basic(token14), token14), true);
  assert.equal(validIntakeAuthorization(basic(token14, 'someone-else'), token14), false);
  assert.equal(validIntakeAuthorization(basic(`${token14.slice(0, -1)}0`), token14), false);
  assert.equal(validIntakeAuthorization(`Bearer ${token14}`, token14), false);
  assert.equal(validIntakeAuthorization('Basic %%%not-base64%%%', token14), false);
  assert.equal(validIntakeAuthorization('', token14), false);
});

test('normalizeLeadPhone accepts international forms and enforces E.164 length', () => {
  assert.equal(normalizeLeadPhone('+972 50-123-4567'), '+972501234567');
  assert.equal(normalizeLeadPhone('00972 (50) 123-4567'), '+972501234567');
  assert.equal(normalizeLeadPhone('972501234567'), '+972501234567');
  assert.equal(normalizeLeadPhone('+123456789012345'), '+123456789012345'); // 15 digits

  assert.throws(() => normalizeLeadPhone(''), (e) => e instanceof IntakeError && e.code === 'phone_required');
  assert.throws(() => normalizeLeadPhone('+1234567890123456'),
    (e) => e instanceof IntakeError && e.code === 'phone_must_be_e164'); // 16 digits / possible LID
  assert.throws(() => normalizeLeadPhone('+972-ABC-501234567'),
    (e) => e instanceof IntakeError && e.code === 'phone_must_be_e164');
});

test('normalizeIntakePayload keeps only the lead identifiers the intake is allowed to write', () => {
  const normalized = normalizeIntakePayload({
    journey_id: JOURNEY_ID,
    inbox_id: 40,
    source: 'facebook_lead_ads',
    external_id: 'fb-lead-123',
    contact: { name: '  דנה לוי  ', email: 'dana@example.com', phone: '972501234567' },
    custom_attributes: {
      airtable_lead_id: 'rec-airtable-7',
      arbitrary_admin_field: 'must-not-pass',
    },
  });

  assert.deepEqual(normalized, {
    journeyId: JOURNEY_ID,
    inboxId: 40,
    source: 'facebook_lead_ads',
    externalId: 'fb-lead-123',
    contact: { name: 'דנה לוי', email: 'dana@example.com', phone: '+972501234567' },
    customAttributes: {
      airtable_lead_id: 'rec-airtable-7',
      facebook_lead_id: 'fb-lead-123',
      lead_source: 'Facebook Lead Ads',
    },
  });
  assert.equal('arbitrary_admin_field' in normalized.customAttributes, false);
});

test('normalizeIntakePayload uses the Airtable record as identity without overwriting Facebook attribution', () => {
  const normalized = normalizeIntakePayload({
    journey_id: JOURNEY_ID,
    inbox_id: 40,
    source: 'airtable_status',
    external_id: 'rec-airtable-9',
    contact: { name: 'דנה לוי', phone: '972501234567' },
    custom_attributes: {
      facebook_lead_id: 'must-not-overwrite-the-original',
      lead_source: 'Airtable – אין מענה',
    },
  });

  assert.deepEqual(normalized.customAttributes, {
    airtable_lead_id: 'rec-airtable-9',
  });
  assert.equal(normalized.source, 'airtable_status');
  assert.equal(normalized.externalId, 'rec-airtable-9');
});

test('normalizeIntakePayload requires a direct Airtable record id and validates routing fields', () => {
  const base = {
    journey_id: JOURNEY_ID,
    inbox_id: 40,
    external_id: 'fb-1',
    contact: { phone: '+972501234567' },
    custom_attributes: {},
  };
  assert.throws(() => normalizeIntakePayload(base),
    (e) => e instanceof IntakeError && e.code === 'airtable_lead_id_required');
  assert.throws(() => normalizeIntakePayload({ ...base, journey_id: 'not-a-uuid' }),
    (e) => e instanceof IntakeError && e.code === 'invalid_journey_id');
  assert.throws(() => normalizeIntakePayload({ ...base, source: 'untrusted-source' }),
    (e) => e instanceof IntakeError && e.code === 'unsupported_source');
  assert.throws(() => normalizeIntakePayload({
    ...base,
    custom_attributes: { airtable_lead_id: 'rec-1', facebook_lead_id: 'different-facebook-lead' },
  }), (e) => e instanceof IntakeError && e.code === 'facebook_lead_id_mismatch');
  assert.throws(() => normalizeIntakePayload({
    ...base,
    source: 'airtable_status',
    external_id: 'rec-1',
    custom_attributes: { airtable_lead_id: 'rec-2' },
  }), (e) => e instanceof IntakeError && e.code === 'airtable_lead_id_mismatch');
});

test('stopSupersededRuns is opt-in and stops only another live flow on the same conversation', async () => {
  const calls = [];
  const mockQuery = async (sql, params) => {
    calls.push({ sql, params });
    return [{ id: 'old-run' }];
  };

  assert.equal(await stopSupersededRuns(mockQuery, {
    accountId: 14,
    displayId: 900,
    journeyId: JOURNEY_ID,
    enabled: false,
  }), 0);
  assert.equal(calls.length, 0, 'ordinary intakes never stop another flow');

  assert.equal(await stopSupersededRuns(mockQuery, {
    accountId: 14,
    displayId: 900,
    journeyId: JOURNEY_ID,
    enabled: true,
  }), 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /journey_id <> \$3::uuid/);
  assert.match(calls[0].sql, /waiting_answer/);
  assert.deepEqual(calls[0].params, [14, 900, JOURNEY_ID]);
});

async function insertJourney(id = JOURNEY_ID) {
  const [journey] = await query(
    `INSERT INTO drip.journeys (id, account_id, name, status, trigger, graph)
     VALUES ($1::uuid, 14, 'קליטת ליד', 'active', '{"external":true,"inbox_ids":[40]}',
             '{"nodes":[{"id":"t","type":"trigger","data":{}}],"edges":[]}')
     RETURNING *`,
    [id]
  );
  return journey;
}

const intakeKey = (journeyId = JOURNEY_ID, externalId = 'fb-claim-1') => ({
  accountId: 14,
  journeyId,
  source: 'facebook_lead_ads',
  externalId,
});

const intakePayload = (externalId) => ({
  journey_id: JOURNEY_ID,
  inbox_id: 40,
  source: 'facebook_lead_ads',
  external_id: externalId,
  contact: { name: 'דנה', phone: '+972501234567' },
  custom_attributes: { airtable_lead_id: `rec-${externalId}` },
});

test('claimJourneyIntake atomically lets exactly one concurrent request own a Facebook lead', async () => {
  await insertJourney();
  const [a, b] = await Promise.all([
    claimJourneyIntake(query, intakeKey()),
    claimJourneyIntake(query, intakeKey()),
  ]);

  assert.equal([a, b].filter((x) => x.claimed).length, 1);
  assert.equal([a, b].filter((x) => !x.claimed && x.duplicate).length, 1);
  const [count] = await query(
    `SELECT count(*)::int AS n FROM drip.journey_intakes
      WHERE account_id = 14 AND journey_id = $1::uuid AND external_id = 'fb-claim-1'`,
    [JOURNEY_ID]
  );
  assert.equal(count.n, 1);
});

test('claimJourneyIntake treats a completed run as permanent proof that the lead already started', async () => {
  await insertJourney();
  const [run] = await query(
    `INSERT INTO drip.journey_runs
       (journey_id, account_id, display_id, contact_id, status, answers)
     VALUES ($1::uuid, 14, 901, 77, 'done', $2::jsonb)
     RETURNING *`,
    [JOURNEY_ID, JSON.stringify({
      _intake_source: 'facebook_lead_ads',
      _intake_external_id: 'fb-completed-1',
    })]
  );

  const result = await claimJourneyIntake(query, intakeKey(JOURNEY_ID, 'fb-completed-1'));
  assert.equal(result.claimed, false);
  assert.equal(result.duplicate, true);
  assert.equal(result.run.id, run.id);

  const [receipt] = await query(
    `SELECT status, run_id, contact_id, display_id
       FROM drip.journey_intakes
      WHERE account_id = 14 AND journey_id = $1::uuid AND external_id = 'fb-completed-1'`,
    [JOURNEY_ID]
  );
  assert.deepEqual({
    status: receipt.status,
    run_id: receipt.run_id,
    contact_id: Number(receipt.contact_id),
    display_id: Number(receipt.display_id),
  }, {
    status: 'started', run_id: run.id, contact_id: 77, display_id: 901,
  });
});

test('claimJourneyIntake reclaims a failed receipt but not a live processing lease', async () => {
  await insertJourney();
  const first = await claimJourneyIntake(query, intakeKey());
  assert.equal(first.claimed, true);

  const duplicate = await claimJourneyIntake(query, intakeKey());
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.processing, true);

  await query(
    `UPDATE drip.journey_intakes SET status = 'failed', lease_until = NULL
      WHERE account_id = 14 AND journey_id = $1::uuid AND external_id = 'fb-claim-1'`,
    [JOURNEY_ID]
  );
  const reclaimed = await claimJourneyIntake(query, intakeKey());
  assert.equal(reclaimed.claimed, true);
  assert.equal(reclaimed.duplicate, false);
  assert.notEqual(reclaimed.attemptId, first.attemptId, 'a reclaimed lease gets a new fencing token');
});

test('claimJourneyIntake does not acknowledge an active pre-wait run as started', async () => {
  await insertJourney();
  const first = await claimJourneyIntake(query, intakeKey(JOURNEY_ID, 'fb-active'));
  await query(
    `INSERT INTO drip.journey_runs
       (journey_id, account_id, display_id, contact_id, status, current_node, answers)
     VALUES ($1::uuid, 14, 903, 79, 'active', 'tp', $2::jsonb)`,
    [JOURNEY_ID, JSON.stringify({
      _intake_source: 'facebook_lead_ads',
      _intake_external_id: 'fb-active',
    })]
  );

  const duplicate = await claimJourneyIntake(query, intakeKey(JOURNEY_ID, 'fb-active'));
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.processing, true);
  assert.equal(duplicate.run.status, 'active');
  assert.equal(duplicate.receipt.attempt_id, first.attemptId);

  await query(
    `UPDATE drip.journey_intakes SET lease_until = now() - interval '1 second'
      WHERE account_id = 14 AND journey_id = $1::uuid AND external_id = 'fb-active'`,
    [JOURNEY_ID]
  );
  const resumed = await claimJourneyIntake(query, intakeKey(JOURNEY_ID, 'fb-active'));
  assert.equal(resumed.claimed, true);
  assert.equal(resumed.resumeRun.status, 'active');
  assert.notEqual(resumed.attemptId, first.attemptId);
});

test('handleJourneyIntake returns a retryable error while the first request still owns the lease', async () => {
  await insertJourney();
  await query(`INSERT INTO public.inboxes (id, account_id, name, channel_type)
               VALUES (40, 14, 'Daniel WhatsApp', 'Channel::Whatsapp')`);
  await claimJourneyIntake(query, intakeKey(JOURNEY_ID, 'fb-processing'));

  await assert.rejects(
    () => handleJourneyIntake({
      query,
      makeClientFor: async () => assert.fail('a duplicate in-flight intake must not reach Chatwoot'),
    }, intakePayload('fb-processing'), 14),
    (e) => e instanceof IntakeError && e.code === 'intake_processing' && e.status === 503
  );
});

test('handleJourneyIntake recovers a template accepted before a crash without resending it', async () => {
  const [journey] = await query(
    `INSERT INTO drip.journeys (id, account_id, name, status, trigger, graph)
     VALUES ($1::uuid, 14, 'קליטת ליד', 'active', '{"external":true,"inbox_ids":[40]}',
             $2::jsonb) RETURNING *`,
    [JOURNEY_ID, JSON.stringify({
      nodes: [
        { id: 't', type: 'trigger', data: {} },
        { id: 'tp', type: 'template', data: {
          name: 'initial_consultation', waitForReply: true,
          saveTo: { scope: 'contact', key: 'callback_window' },
        } },
      ],
      edges: [{ source: 't', target: 'tp' }],
    })]
  );
  assert.equal(journey.id, JOURNEY_ID);
  await query(`INSERT INTO public.inboxes (id, account_id, name, channel_type)
               VALUES (40, 14, 'Daniel WhatsApp', 'Channel::Whatsapp')`);
  await query(`INSERT INTO public.agent_bots (id, account_id, name)
               VALUES (555, 14, '🤖 רצפי הודעות')`);
  await query(`INSERT INTO public.conversations
                 (id, display_id, account_id, contact_id, inbox_id)
               VALUES (9003, 903, 14, 79, 40)`);
  await claimJourneyIntake(query, intakeKey(JOURNEY_ID, 'fb-recover'));
  const [run] = await query(
    `INSERT INTO drip.journey_runs
       (journey_id, account_id, display_id, contact_id, status, current_node, answers)
     VALUES ($1::uuid, 14, 903, 79, 'active', 'tp', $2::jsonb) RETURNING *`,
    [JOURNEY_ID, JSON.stringify({
      _intake_source: 'facebook_lead_ads',
      _intake_external_id: 'fb-recover',
      _intake_airtable_lead_id: 'rec-fb-recover',
    })]
  );
  await query(
    `INSERT INTO public.messages
       (id, conversation_id, account_id, message_type, sender_type, sender_id, private,
        status, additional_attributes, created_at)
     VALUES (9902, 9003, 14, 1, 'AgentBot', 555, false, 0,
             '{"template_params":{"name":"a_different_template"}}'::jsonb,
             ($1::timestamptz AT TIME ZONE 'UTC'))`,
    [run.created_at]
  );
  await assert.rejects(
    () => handleJourneyIntake({
      query,
      makeClientFor: async () => assert.fail('a different template is not recovery evidence'),
    }, intakePayload('fb-recover'), 14),
    (e) => e instanceof IntakeError && e.code === 'intake_processing' && e.status === 503
  );

  await query(
    `INSERT INTO public.messages
       (id, conversation_id, account_id, message_type, sender_type, sender_id, private,
        status, additional_attributes, created_at)
     VALUES (9903, 9003, 14, 1, 'AgentBot', 555, false, 0,
             '{"template_params":{"name":"initial_consultation"}}'::jsonb,
             ($1::timestamptz AT TIME ZONE 'UTC'))`,
    [run.created_at]
  );

  const result = await handleJourneyIntake({
    query,
    makeClientFor: async () => assert.fail('recovery evidence must prevent a second send'),
  }, intakePayload('fb-recover'), 14);
  assert.equal(result.duplicate, true);
  assert.equal(result.run_id, run.id);
  const [recovered] = await query('SELECT status FROM drip.journey_runs WHERE id = $1', [run.id]);
  assert.equal(recovered.status, 'waiting_answer');
  const [receipt] = await query(
    `SELECT status FROM drip.journey_intakes
      WHERE account_id = 14 AND journey_id = $1::uuid AND external_id = 'fb-recover'`,
    [JOURNEY_ID]
  );
  assert.equal(receipt.status, 'started');
});

test('handleJourneyIntake never acknowledges an existing failed initial run as success', async () => {
  await insertJourney();
  await query(`INSERT INTO public.inboxes (id, account_id, name, channel_type)
               VALUES (40, 14, 'Daniel WhatsApp', 'Channel::Whatsapp')`);
  await query(
    `INSERT INTO drip.journey_runs
       (journey_id, account_id, display_id, contact_id, status, answers, last_error)
     VALUES ($1::uuid, 14, 902, 78, 'failed', $2::jsonb, 'template: rejected')`,
    [JOURNEY_ID, JSON.stringify({
      _intake_source: 'facebook_lead_ads',
      _intake_external_id: 'fb-failed',
    })]
  );

  await assert.rejects(
    () => handleJourneyIntake({
      query,
      makeClientFor: async () => assert.fail('a failed idempotency anchor must not resend'),
    }, intakePayload('fb-failed'), 14),
    (e) => e instanceof IntakeError && e.code === 'journey_initial_node_failed' && e.status === 502
  );
  const [receipt] = await query(
    `SELECT status, last_error FROM drip.journey_intakes
      WHERE account_id = 14 AND journey_id = $1::uuid AND external_id = 'fb-failed'`,
    [JOURNEY_ID]
  );
  assert.equal(receipt.status, 'failed');
  assert.match(receipt.last_error, /template/);
});

test('resolveOrCreateContact trusts the inbox source identity even when phone_number is hidden', async () => {
  await query(`INSERT INTO public.inboxes (id, account_id, name, channel_type)
               VALUES (40, 14, 'Daniel WhatsApp', 'Channel::Whatsapp')`);
  await query(`INSERT INTO public.contacts (id, account_id, name, phone_number)
               VALUES (77, 14, 'placeholder', NULL)`);
  await query(`INSERT INTO public.contact_inboxes (id, contact_id, inbox_id, source_id)
               VALUES (700, 77, 40, '972501234567')`);
  const calls = [];
  const client = {
    createContact: async (...args) => { calls.push(['createContact', ...args]); return { id: 999 }; },
    updateContact: async (...args) => { calls.push(['updateContact', ...args]); return { id: 77 }; },
  };

  const result = await resolveOrCreateContact({
    query,
    client,
    accountId: 14,
    inboxId: 40,
    contact: { name: 'דנה', email: '', phone: '+972501234567' },
    customAttributes: {
      facebook_lead_id: 'fb-hidden-phone',
      airtable_lead_id: 'rec-hidden-phone',
      lead_source: 'Facebook Lead Ads',
    },
  });

  assert.deepEqual(result, { contactId: 77, sourceId: '972501234567' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'updateContact');
  assert.equal(calls[0][1], 77);
});

test('resolveOrCreateContact fails closed when channel identity and external identity disagree', async () => {
  await query(`INSERT INTO public.inboxes (id, account_id, name, channel_type)
               VALUES (40, 14, 'Daniel WhatsApp', 'Channel::Whatsapp')`);
  await query(`INSERT INTO public.contacts (id, account_id, name, phone_number, custom_attributes)
               VALUES (77, 14, 'channel contact', NULL, '{}'),
                      (78, 14, 'airtable contact', '+972599999999', '{"airtable_lead_id":"rec-conflict"}')`);
  await query(`INSERT INTO public.contact_inboxes (id, contact_id, inbox_id, source_id)
               VALUES (700, 77, 40, '972501234567')`);
  const client = {
    createContact: async () => assert.fail('must not create on identity conflict'),
    updateContact: async () => assert.fail('must not update on identity conflict'),
  };

  await assert.rejects(
    () => resolveOrCreateContact({
      query,
      client,
      accountId: 14,
      inboxId: 40,
      contact: { name: 'דנה', email: '', phone: '+972501234567' },
      customAttributes: {
        facebook_lead_id: 'fb-conflict',
        airtable_lead_id: 'rec-conflict',
        lead_source: 'Facebook Lead Ads',
      },
    }),
    (e) => e instanceof IntakeError && e.code === 'lead_identity_conflict' && e.status === 409
  );
});
