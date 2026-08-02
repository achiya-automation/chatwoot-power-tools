/**
 * Secure external entry point for visual journeys (Make / Facebook Lead Ads).
 *
 * The caller supplies a stable external lead id plus the current lead details. We resolve the
 * contact by the WhatsApp channel identity first, open/reuse the official WhatsApp conversation,
 * and start exactly one journey run. drip.journey_intakes makes retries at-most-once even after
 * the original run has completed.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { executeFrom, startRun } from './journeys.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const E164_RE = /^\+[1-9]\d{7,14}$/;
const ALLOWED_ATTRIBUTES = new Set(['airtable_lead_id', 'facebook_lead_id', 'lead_source']);
const INTAKE_LEASE_SECONDS = 120;

export class IntakeError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'IntakeError';
    this.code = code;
    this.status = status;
  }
}

export function perAccountIntakeToken(masterSecret, accountId) {
  return createHmac('sha256', String(masterSecret))
    .update(`intake:${Number(accountId)}`)
    .digest('hex');
}

/** Basic auth keeps the credential out of the URL/access logs. */
export function validIntakeAuthorization(header, expectedPassword) {
  const match = /^Basic\s+(.+)$/i.exec(String(header || ''));
  if (!match || !expectedPassword) return false;
  let decoded = '';
  try { decoded = Buffer.from(match[1], 'base64').toString('utf8'); } catch { return false; }
  const colon = decoded.indexOf(':');
  if (colon < 0 || decoded.slice(0, colon) !== 'make') return false;
  const got = decoded.slice(colon + 1);
  const expected = String(expectedPassword);
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/** Accept formatted E.164, bare country-code digits, or the 00 international prefix. */
export function normalizeLeadPhone(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new IntakeError('phone_required');
  // Formatting punctuation is fine, but silently deleting letters or an embedded '+' could
  // turn corrupt Facebook data into a different person's valid WhatsApp number.
  if (!/^[+\d\s().-]+$/.test(value)) throw new IntakeError('phone_must_be_e164');
  const compact = value.replace(/[\s().-]/g, '');
  if ((compact.match(/\+/g) || []).length > 1 || (compact.includes('+') && !compact.startsWith('+'))) {
    throw new IntakeError('phone_must_be_e164');
  }
  let e164;
  if (compact.startsWith('+')) e164 = `+${compact.slice(1).replace(/\D/g, '')}`;
  else if (compact.startsWith('00')) e164 = `+${compact.slice(2).replace(/\D/g, '')}`;
  else e164 = `+${compact.replace(/\D/g, '')}`;
  if (!E164_RE.test(e164)) throw new IntakeError('phone_must_be_e164');
  return e164;
}

const bounded = (value, max = 255) => String(value ?? '').trim().slice(0, max);

export function normalizeIntakePayload(payload = {}) {
  const journeyId = bounded(payload.journey_id, 64);
  const externalId = bounded(payload.external_id, 200);
  const source = bounded(payload.source || 'facebook_lead_ads', 50);
  const inboxId = Number(payload.inbox_id);
  if (!UUID_RE.test(journeyId)) throw new IntakeError('invalid_journey_id');
  if (!Number.isInteger(inboxId) || inboxId <= 0) throw new IntakeError('invalid_inbox_id');
  if (source !== 'facebook_lead_ads') throw new IntakeError('unsupported_source');
  if (!externalId) throw new IntakeError('external_id_required');

  const contact = payload.contact || {};
  const email = bounded(contact.email, 320);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new IntakeError('invalid_email');
  const phone = normalizeLeadPhone(contact.phone);

  const customAttributes = {};
  for (const [key, value] of Object.entries(payload.custom_attributes || {})) {
    if (!ALLOWED_ATTRIBUTES.has(key)) continue;
    const clean = bounded(value, 500);
    if (clean) customAttributes[key] = clean;
  }
  // One stable Facebook identity drives both idempotency and contact resolution. Letting these
  // values diverge could resolve lead B by attribute and then overwrite it with lead A's phone.
  if (customAttributes.facebook_lead_id && customAttributes.facebook_lead_id !== externalId) {
    throw new IntakeError('facebook_lead_id_mismatch');
  }
  customAttributes.facebook_lead_id = externalId;
  customAttributes.lead_source ||= 'Facebook Lead Ads';
  if (!customAttributes.airtable_lead_id) throw new IntakeError('airtable_lead_id_required');

  return {
    journeyId,
    inboxId,
    source,
    externalId,
    contact: { name: bounded(contact.name), email, phone },
    customAttributes,
  };
}

async function existingRun(query, key) {
  const rows = await query(
    `SELECT id, status, current_node, contact_id, display_id, answers,
            last_error, created_at, updated_at
       FROM drip.journey_runs
      WHERE account_id = $1 AND journey_id = $2::uuid
        AND answers->>'_intake_source' = $3
        AND answers->>'_intake_external_id' = $4
      ORDER BY created_at DESC LIMIT 1`,
    [key.accountId, key.journeyId, key.source, key.externalId]
  );
  return rows[0] || null;
}

async function syncReceiptFromRun(query, key, run) {
  const failed = run.status === 'failed';
  await query(
    `INSERT INTO drip.journey_intakes
       (account_id, journey_id, source, external_id, status, contact_id, display_id,
        run_id, lease_until, last_error, updated_at)
     VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8::uuid, NULL, $9, now())
     ON CONFLICT (account_id, journey_id, source, external_id) DO UPDATE
       SET status = EXCLUDED.status, contact_id = EXCLUDED.contact_id,
           display_id = EXCLUDED.display_id, run_id = EXCLUDED.run_id,
           attempt_id = NULL, lease_until = NULL,
           last_error = EXCLUDED.last_error, updated_at = now()`,
    [key.accountId, key.journeyId, key.source, key.externalId, failed ? 'failed' : 'started',
      run.contact_id || null, run.display_id || null, run.id,
      failed ? bounded(run.last_error || 'journey_run_failed', 100) : null]
  );
}

async function receiptForKey(query, key) {
  return (await query(
    `SELECT * FROM drip.journey_intakes
      WHERE account_id = $1 AND journey_id = $2::uuid AND source = $3 AND external_id = $4`,
    [key.accountId, key.journeyId, key.source, key.externalId]
  ))[0] || null;
}

/**
 * Atomically claims one external lead.
 *
 * `attempt_id` is a fencing token: a request that outlived its lease cannot mark a newer
 * attempt started/failed. Chatwoot requests are individually capped at 15s, comfortably below
 * the 120s lease; the token is renewed between external side effects.
 */
export async function claimJourneyIntake(query, key) {
  let [run, receipt] = await Promise.all([existingRun(query, key), receiptForKey(query, key)]);
  if (receipt?.status === 'started') {
    return { claimed: false, duplicate: true, run, receipt };
  }
  if (run?.status === 'failed') {
    await syncReceiptFromRun(query, key, run);
    return { claimed: false, duplicate: true, failed: true, run };
  }
  if (run && run.status !== 'active') {
    await syncReceiptFromRun(query, key, run);
    return { claimed: false, duplicate: true, run };
  }

  const attemptId = randomUUID();
  const inserted = await query(
    `INSERT INTO drip.journey_intakes
       (account_id, journey_id, source, external_id, status, attempt_id, lease_until)
     VALUES ($1, $2::uuid, $3, $4, 'processing', $5::uuid,
             now() + ($6 * interval '1 second'))
     ON CONFLICT (account_id, journey_id, source, external_id) DO NOTHING
     RETURNING *`,
    [key.accountId, key.journeyId, key.source, key.externalId, attemptId, INTAKE_LEASE_SECONDS]
  );
  if (inserted[0]) {
    return {
      claimed: true,
      duplicate: false,
      attemptId,
      receipt: inserted[0],
      ...(run?.status === 'active' ? { resumeRun: run } : {}),
    };
  }

  [run, receipt] = await Promise.all([existingRun(query, key), receiptForKey(query, key)]);
  if (receipt?.status === 'started') {
    return { claimed: false, duplicate: true, run, receipt };
  }
  if (run?.status === 'failed') {
    await syncReceiptFromRun(query, key, run);
    return { claimed: false, duplicate: true, failed: true, run };
  }
  if (run && run.status !== 'active') {
    await syncReceiptFromRun(query, key, run);
    return { claimed: false, duplicate: true, run };
  }

  const reclaimed = await query(
    `UPDATE drip.journey_intakes
        SET status = 'processing', attempt_id = $5::uuid,
            lease_until = now() + ($6 * interval '1 second'), last_error = NULL,
            updated_at = now()
      WHERE account_id = $1 AND journey_id = $2::uuid AND source = $3 AND external_id = $4
        AND (status = 'failed' OR (status = 'processing' AND lease_until <= now()))
      RETURNING *`,
    [key.accountId, key.journeyId, key.source, key.externalId, attemptId, INTAKE_LEASE_SECONDS]
  );
  if (reclaimed[0]) {
    return {
      claimed: true,
      duplicate: false,
      attemptId,
      receipt: reclaimed[0],
      ...(run?.status === 'active' ? { resumeRun: run } : {}),
    };
  }

  receipt = await receiptForKey(query, key);
  return {
    claimed: false,
    duplicate: true,
    processing: receipt?.status === 'processing',
    receipt,
    ...(run?.status === 'active' ? { run } : {}),
  };
}

async function renewAttempt(query, key, attemptId) {
  const rows = await query(
    `UPDATE drip.journey_intakes
        SET lease_until = now() + ($6 * interval '1 second'), updated_at = now()
      WHERE account_id = $1 AND journey_id = $2::uuid AND source = $3 AND external_id = $4
        AND status = 'processing' AND attempt_id = $5::uuid
      RETURNING attempt_id`,
    [key.accountId, key.journeyId, key.source, key.externalId, attemptId, INTAKE_LEASE_SECONDS]
  );
  if (!rows.length) throw new IntakeError('intake_attempt_superseded', 503);
}

async function markStarted(query, key, attemptId, { contactId, displayId, runId }) {
  const rows = await query(
    `UPDATE drip.journey_intakes
        SET status = 'started', contact_id = $5, display_id = $6, run_id = $7::uuid,
            attempt_id = NULL, lease_until = NULL, last_error = NULL, updated_at = now()
      WHERE account_id = $1 AND journey_id = $2::uuid AND source = $3 AND external_id = $4
        AND status = 'processing' AND attempt_id = $8::uuid
      RETURNING run_id`,
    [key.accountId, key.journeyId, key.source, key.externalId,
      contactId, displayId, runId, attemptId]
  );
  if (!rows.length) throw new IntakeError('intake_attempt_superseded', 503);
}

async function markFailed(query, key, attemptId, error) {
  const code = bounded(error?.code || error?.name || 'intake_failed', 100);
  await query(
    `UPDATE drip.journey_intakes
        SET status = 'failed', attempt_id = NULL, lease_until = NULL,
            last_error = $6, updated_at = now()
      WHERE account_id = $1 AND journey_id = $2::uuid AND source = $3 AND external_id = $4
        AND status = 'processing' AND attempt_id = $5::uuid`,
    [key.accountId, key.journeyId, key.source, key.externalId, attemptId, code]
  ).catch(() => {});
}

async function recoverSentInitialTemplate(query, key, journey, run) {
  if (run?.status !== 'active') return null;
  const node = (journey.graph?.nodes || []).find((candidate) => candidate.id === run.current_node);
  if (node?.type !== 'template' || node.data?.waitForReply !== true) return null;

  // Chatwoot commits the outgoing message row before its API responds. This closes the only
  // irreducible crash window: if the process died after Meta/Chatwoot accepted the template but
  // before waiting_answer was persisted, a retry recognizes that send instead of duplicating it.
  const sent = await query(
    `SELECT m.id
       FROM public.messages m
       JOIN public.conversations c ON c.id = m.conversation_id
       JOIN public.agent_bots ab
         ON ab.id = m.sender_id AND ab.account_id = c.account_id
        AND ab.name = '🤖 רצפי הודעות'
      WHERE c.account_id = $1 AND c.display_id = $2
        AND m.message_type = 1 AND m.sender_type = 'AgentBot'
        AND m.private IS NOT TRUE AND COALESCE(m.status, 0) <> 3
        AND m.created_at >= ($3::timestamptz AT TIME ZONE 'UTC')
        AND m.additional_attributes->'template_params'->>'name' = $4
      ORDER BY m.id ASC LIMIT 1`,
    [key.accountId, run.display_id, run.created_at, node.data.name]
  );
  if (!sent.length) return null;

  const recovered = (await query(
    `UPDATE drip.journey_runs
        SET status = 'waiting_answer', waiting_since = COALESCE(waiting_since, now()),
            next_action_at = NULL, retry_count = 0, updated_at = now()
      WHERE id = $1::uuid AND account_id = $2 AND status = 'active'
      RETURNING *`,
    [run.id, key.accountId]
  ))[0] || (await existingRun(query, key));
  if (recovered?.status !== 'waiting_answer') return null;
  await syncReceiptFromRun(query, key, recovered);
  return recovered;
}

async function findSourceContact(query, accountId, inboxId, sourceId) {
  const rows = await query(
    `SELECT c.id
       FROM public.contact_inboxes ci
       JOIN public.inboxes i ON i.id = ci.inbox_id
       JOIN public.contacts c ON c.id = ci.contact_id
      WHERE i.account_id = $1 AND c.account_id = $1
        AND ci.inbox_id = $2 AND ci.source_id = $3
      ORDER BY c.id LIMIT 2`,
    [accountId, inboxId, sourceId]
  );
  if (rows.length > 1) throw new IntakeError('ambiguous_channel_contact', 409);
  return rows[0] || null;
}

async function findAttributeContact(query, accountId, attrs) {
  const rows = await query(
    `SELECT id
       FROM public.contacts
      WHERE account_id = $1
        AND (custom_attributes->>'facebook_lead_id' = $2
          OR custom_attributes->>'airtable_lead_id' = $3)
      ORDER BY id LIMIT 3`,
    [accountId, attrs.facebook_lead_id, attrs.airtable_lead_id]
  );
  const ids = [...new Set(rows.map((r) => Number(r.id)))];
  if (ids.length > 1) throw new IntakeError('conflicting_external_identity', 409);
  return ids.length ? { id: ids[0] } : null;
}

async function findPhoneContact(query, accountId, phone) {
  const rows = await query(
    `SELECT id FROM public.contacts
      WHERE account_id = $1 AND phone_number = $2
      ORDER BY id LIMIT 1`,
    [accountId, phone]
  );
  return rows[0] || null;
}

export async function resolveOrCreateContact({ query, client, accountId, inboxId, contact, customAttributes }) {
  const sourceId = contact.phone.slice(1);
  const [bySource, byAttribute, byPhone] = await Promise.all([
    findSourceContact(query, accountId, inboxId, sourceId),
    findAttributeContact(query, accountId, customAttributes),
    findPhoneContact(query, accountId, contact.phone),
  ]);
  const resolvedIds = [...new Set(
    [bySource, byAttribute, byPhone].filter(Boolean).map((found) => Number(found.id))
  )];
  if (resolvedIds.length > 1) {
    throw new IntakeError('lead_identity_conflict', 409);
  }

  let contactId = resolvedIds[0] || 0;
  if (!contactId) {
    const created = await client.createContact({
      ...contact, inboxId, sourceId, customAttributes,
    });
    contactId = Number(created.id);
  } else {
    await client.updateContact(contactId, { ...contact, customAttributes });
  }
  if (!contactId) throw new IntakeError('contact_create_failed', 502);
  return { contactId, sourceId };
}

export async function ensureConversation({ query, client, accountId, inboxId, contactId, sourceId }) {
  const opened = await client.createConversation({ sourceId, inboxId, contactId });
  const displayId = Number(opened?.id);
  if (!displayId) throw new IntakeError('conversation_create_failed', 502);

  const rows = await query(
    `SELECT c.display_id, c.contact_id, c.inbox_id, ci.source_id
       FROM public.conversations c
       JOIN public.contacts ct ON ct.id = c.contact_id
       JOIN public.inboxes i ON i.id = c.inbox_id
       JOIN public.contact_inboxes ci ON ci.id = c.contact_inbox_id
      WHERE c.account_id = $1 AND ct.account_id = $1 AND i.account_id = $1
        AND c.display_id = $2 AND c.inbox_id = $3
      LIMIT 1`,
    [accountId, displayId, inboxId]
  );
  const row = rows[0];
  if (!row || Number(row.contact_id) !== Number(contactId) || String(row.source_id) !== String(sourceId)) {
    throw new IntakeError('conversation_identity_mismatch', 409);
  }
  return { displayId };
}

export async function handleJourneyIntake(ctx, payload, accountId) {
  const { query } = ctx;
  const input = normalizeIntakePayload(payload);
  const journeyRows = await query(
    `SELECT * FROM drip.journeys
      WHERE id = $1::uuid AND account_id = $2 AND status = 'active' LIMIT 1`,
    [input.journeyId, accountId]
  );
  const journey = journeyRows[0];
  if (!journey) throw new IntakeError('journey_not_active', 404);
  if (journey.trigger?.external !== true) throw new IntakeError('journey_not_external', 403);
  const allowedInboxes = (journey.trigger?.inbox_ids || []).map(Number);
  if (!allowedInboxes.includes(input.inboxId)) throw new IntakeError('inbox_not_allowed', 403);
  const inbox = (await query(
    `SELECT channel_type FROM public.inboxes WHERE account_id = $1 AND id = $2 LIMIT 1`,
    [accountId, input.inboxId]
  ))[0];
  if (inbox?.channel_type !== 'Channel::Whatsapp') throw new IntakeError('official_whatsapp_inbox_required', 400);

  const key = { accountId, journeyId: input.journeyId, source: input.source, externalId: input.externalId };
  const claim = await claimJourneyIntake(query, key);
  if (!claim.claimed) {
    const recovered = claim.run
      ? await recoverSentInitialTemplate(query, key, journey, claim.run)
      : null;
    if (recovered) {
      return {
        started: false,
        duplicate: true,
        processing: false,
        run_id: recovered.id,
        conversation_id: recovered.display_id,
      };
    }
    // Never acknowledge an in-flight or failed first attempt as success. Make must keep the
    // execution incomplete/retryable instead of silently losing a lead. A failed run remains
    // the idempotency anchor so an uncertain Chatwoot response cannot send the template twice.
    if (claim.processing) throw new IntakeError('intake_processing', 503);
    if (claim.failed) throw new IntakeError('journey_initial_node_failed', 502);
    return {
      started: false,
      duplicate: true,
      processing: !!claim.processing,
      run_id: claim.run?.id || claim.receipt?.run_id || null,
      conversation_id: claim.run?.display_id || claim.receipt?.display_id || null,
    };
  }

  const attemptId = claim.attemptId;
  try {
    const client = await ctx.makeClientFor(accountId);
    if (claim.resumeRun) {
      const recovered = await recoverSentInitialTemplate(query, key, journey, claim.resumeRun);
      if (recovered) {
        return {
          started: false,
          duplicate: true,
          run_id: recovered.id,
          conversation_id: recovered.display_id,
        };
      }
      const resumeNode = (journey.graph?.nodes || [])
        .find((candidate) => candidate.id === claim.resumeRun.current_node);
      if (resumeNode?.type !== 'template' || resumeNode.data?.waitForReply !== true) {
        throw new IntakeError('intake_resume_unsafe', 502);
      }
      await renewAttempt(query, key, attemptId);
      await executeFrom({ ...ctx, client }, claim.resumeRun, journey, claim.resumeRun.current_node);
      const resumed = await existingRun(query, key);
      if (resumed?.status === 'failed') throw new IntakeError('journey_initial_node_failed', 502);
      if (!resumed || resumed.status === 'active') throw new IntakeError('intake_processing', 503);
      await renewAttempt(query, key, attemptId);
      await markStarted(query, key, attemptId, {
        contactId: resumed.contact_id,
        displayId: resumed.display_id,
        runId: resumed.id,
      });
      return {
        started: true,
        duplicate: false,
        run_id: resumed.id,
        conversation_id: resumed.display_id,
      };
    }

    await renewAttempt(query, key, attemptId);
    const { contactId, sourceId } = await resolveOrCreateContact({
      query, client, accountId, inboxId: input.inboxId,
      contact: input.contact, customAttributes: input.customAttributes,
    });
    await renewAttempt(query, key, attemptId);
    const { displayId } = await ensureConversation({
      query, client, accountId, inboxId: input.inboxId, contactId, sourceId,
    });
    await renewAttempt(query, key, attemptId);
    const run = await startRun({ ...ctx, client }, journey, {
      accountId,
      displayId,
      contactId,
      initialAnswers: {
        _intake_source: input.source,
        _intake_external_id: input.externalId,
        // Keep the Airtable record on the run itself. A returning phone number may submit a
        // newer Facebook lead while this run is waiting, which legitimately updates the shared
        // contact attributes; the eventual reply must still update the record that started it.
        _intake_airtable_lead_id: input.customAttributes.airtable_lead_id,
      },
    });
    if (!run) throw new IntakeError('conversation_has_active_flow', 409);
    if (run.status === 'failed') throw new IntakeError('journey_initial_node_failed', 502);
    if (run.status === 'active') throw new IntakeError('intake_processing', 503);
    await renewAttempt(query, key, attemptId);
    await markStarted(query, key, attemptId, { contactId, displayId, runId: run.id });
    return { started: true, duplicate: false, run_id: run.id, conversation_id: displayId };
  } catch (error) {
    if (error?.code !== 'intake_processing' && error?.code !== 'intake_attempt_superseded') {
      await markFailed(query, key, attemptId, error);
    }
    throw error;
  }
}
