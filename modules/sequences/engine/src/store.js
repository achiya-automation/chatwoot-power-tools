/**
 * store.js — handleAction(accountId, action, payload)
 *
 * Implements the actions dispatched from POST /drip-api:
 *   list, save, delete, enrollments, enrollment_status, sent_history,
 *   labels, bulk_enroll, set_sequence, templates
 *
 * DB writes only to schema `drip`. Chatwoot data via client API.
 * account_id is always passed as the first argument (enforced by api.js from query string).
 *
 * Response shapes match webapp/src/api/sequencesApi.js (frontend contract is authoritative):
 *   list              → { sequences: [...] }          (sequencesApi maps .data → toUi())
 *   save              → { sequence: {...} }           (sequencesApi maps .data → toUi())
 *   delete            → { data: null }
 *   enrollments       → { data: [...] }
 *   enrollment_status → { data: {...}|null }
 *   templates         → { data: [...] }
 *
 * NOTE on the wire contract (originally shaped by the old n8n Router, kept identical):
 *   Results are wrapped in { ok: true, data: <result> } and the frontend's call()
 *   returns json.data. So the store returns the inner shape, and api.js wraps it in
 *   { ok: true, data: <result> } — matching what sequencesApi expects.
 *
 *   Exception: list/save — sequencesApi uses json.data as the array/object directly,
 *   which means:
 *     list → data must be the sequences array → we return it as { sequences: [...] }
 *       and api.js sends { ok: true, data: { sequences: [...] } }
 *       BUT sequencesApi does: const data = json.data → then (data||[]).map(toUi)
 *       — it treats data as an array, so data MUST be the raw array.
 *
 *   Re-reading sequencesApi.js carefully:
 *     listSequences: const data = await call('list',{},accountId); return (data||[]).map(toUi)
 *     → call() returns json.data, and data is mapped as an array directly.
 *     → So list must return { ok: true, data: [...] } where data IS the array.
 *
 *     saveSequence: const saved = await call('save', toDb(seq), accountId); return toUi(saved)
 *     → call() returns json.data, and saved is passed to toUi() directly.
 *     → So save must return { ok: true, data: <sequence_object> } where data IS the object.
 *
 *   The handleAction return values below are the inner "data" portion.
 *   api.js wraps them: { ok: true, data: result }
 *
 *   For internal use (tests), handleAction returns { sequences: [...] } for list
 *   and { sequence: {...} } for save so tests can inspect shapes clearly.
 *   api.js unwraps appropriately.
 */

import { query, withTx, getPool } from './db.js';
import { makeDbReads } from './reads.js';
import { projectSchedule } from './schedule.js';
import { listCampaigns, getCampaignDetail, campaignsTrend, campaignsTierInfo } from './campaigns.js';

let _config = null;

/**
 * Initialize store with config (called from api.js / index.js).
 * Optional: if not called, DB-only actions still work via existing pool.
 */
export function initStore(config) {
  _config = config;
  // Ensure pool is initialized with the config
  getPool(config);
}

/**
 * Resolve a conversation id from the panel — which may be the per-account
 * display_id OR the global conversations.id — to the display_id used by the
 * Chatwoot REST API and by drip.enrollments. Prefers the display_id reading;
 * falls back to the input as-is when public.conversations isn't available (tests).
 */
export async function resolveDisplayId(accountId, convId) {
  try {
    const rows = await query(
      `SELECT display_id FROM public.conversations WHERE account_id=$1 AND display_id=$2
       UNION ALL
       SELECT display_id FROM public.conversations WHERE account_id=$1 AND id=$2
       LIMIT 1`,
      [accountId, convId]
    );
    return rows[0]?.display_id ?? convId;
  } catch {
    return convId;
  }
}

/**
 * Main dispatcher.
 *
 * @param {number} accountId  - Chatwoot account ID (from query string, always trusted)
 * @param {string} action     - one of: list, save, delete, enrollments, enrollment_status, templates
 * @param {object} payload    - action-specific payload from request body
 * @returns {object}          - action result; api.js wraps in { ok: true, data: ... }
 */
export async function handleAction(accountId, action, payload) {
  const accId = Number(accountId);
  if (!accId) throw new Error('account_id required');

  switch (action) {
    case 'list':
      return actionList(accId);
    case 'save':
      return actionSave(accId, payload);
    case 'delete':
      return actionDelete(accId, payload);
    case 'enrollments':
      return actionEnrollments(accId);
    case 'enrollment_status':
      return actionEnrollmentStatus(accId, payload);
    case 'sent_history':
      return actionSentHistory(accId, payload);
    case 'projected_schedule':
      return actionProjectedSchedule(accId, payload);
    case 'labels':
      return actionLabels(accId);
    case 'bulk_enroll':
      return actionBulkEnroll(accId, payload);
    case 'set_sequence':
      return actionSetSequence(accId, payload);
    case 'templates':
      return actionTemplates(accId);
    case 'storage_usage':
      return actionStorageUsage(accId);
    case 'delivery_stats':
      return actionDeliveryStats(accId);
    case 'campaigns':
      return { data: await listCampaigns(query, accId) };
    case 'campaign_detail':
      return { data: await getCampaignDetail(query, accId, payload?.campaign_id) };
    case 'campaigns_trend':
      return { data: await campaignsTrend(query, accId, payload?.days || 14) };
    case 'campaigns_tier':
      return { data: await campaignsTierInfo(query, makeDbReads(query), accId) };
    case 'contacts':
      return actionContacts(accId, payload);
    case 'template_media':
      return actionTemplateMedia(accId);
    case 'save_template_media':
      return actionSaveTemplateMedia(accId, payload);
    // ── מספר הוואטסאפ שהמנוע עובד מולו ──────────────────────────────────────
    // לחשבון יכולים להיות כמה מספרים. יש לבחור אחד — אחרת המנוע היה מנחש, ושולח
    // ממספר אחד בזמן שהוא קורא תבניות ובריאות ממספר אחר.
    case 'whatsapp_inboxes':
      return { data: await rpc('drip.whatsapp_inboxes', accId) };
    case 'set_whatsapp_inbox':
      return { data: await rpcJson('drip.set_whatsapp_inbox', { ...payload, account_id: accId }) };

    // ── ציות (מטא) ──────────────────────────────────────────────────────────
    case 'compliance':
      return { data: await rpc('drip.compliance_overview', accId) };
    case 'save_compliance':
      return { data: await rpcJson('drip.save_compliance', { ...payload, account_id: accId }) };
    case 'record_consent':
      return { data: await rpcJson('drip.record_consent', { ...payload, account_id: accId }) };
    case 'consent_by_label':
      return { data: await rpcJson('drip.consent_by_label', { ...payload, account_id: accId }) };
    case 'set_suppression':
      return { data: await rpcJson('drip.set_suppression', { ...payload, account_id: accId }) };
    case 'resume_account':
      return { data: await rpcJson('drip.resume_account', { account_id: accId }) };
    case 'ack_alert':
      return { data: await rpcJson('drip.ack_alert', { ...payload, account_id: accId }) };
    case 'suppressed':
      return actionSuppressed(accId, payload);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// RPC helpers — the compliance surface is entirely SQL functions, so the JS side is a
// thin pass-through. Keeps tenant isolation in one place: account_id is always taken from
// the authenticated session (accId), never from the client payload.
const rpc = async (fn, accountId) => {
  const rows = await query(`SELECT ${fn}($1) AS j`, [accountId]);
  return rows[0]?.j ?? {};
};
const rpcJson = async (fn, obj) => {
  const rows = await query(`SELECT ${fn}($1::jsonb) AS j`, [JSON.stringify(obj)]);
  return rows[0]?.j ?? {};
};

// ── suppressed ────────────────────────────────────────────────────────────────
// The opt-out / blocked list, with the contact's name and phone so the client can see
// exactly who stopped receiving and why — and un-block a false positive in one click.
async function actionSuppressed(accountId, payload) {
  const limit = Math.min(Number(payload?.limit) || 200, 1000);
  const rows = await query(
    `SELECT cs.contact_id, cs.suppressed_at, cs.suppressed_reason, cs.suppressed_detail,
            cs.suppressed_scope, cs.unengaged_streak, cs.cap_failures,
            cs.consent_source, cs.consent_at,
            c.name, c.phone_number AS phone
       FROM drip.contact_state cs
       LEFT JOIN public.contacts c ON c.id = cs.contact_id AND c.account_id = cs.account_id
      WHERE cs.account_id = $1 AND cs.suppressed_at IS NOT NULL
      ORDER BY cs.suppressed_at DESC
      LIMIT $2`,
    [accountId, limit]
  );
  return { data: rows };
}

// ── list ──────────────────────────────────────────────────────────────────────
// Returns raw DB sequences array.
// api.js sends: { ok: true, data: [...] }
// sequencesApi.js: (data||[]).map(toUi) — data IS the array.
async function actionList(accountId) {
  const rows = await query('SELECT drip.list_sequences($1::int) AS result', [accountId]);
  const sequences = rows[0]?.result ?? [];
  // Return shape for tests. api.js extracts .sequences for the wire format.
  return { sequences };
}

// ── save ──────────────────────────────────────────────────────────────────────
// Upserts sequence + atomically replaces steps.
// payload = DB-shaped sequence from sequencesApi.toDb()
// Returns the saved sequence object.
// api.js sends: { ok: true, data: <sequence> }
// sequencesApi.js: toUi(saved) — saved IS the sequence object.
async function actionSave(accountId, payload) {
  // Merge account_id into payload (n8n Router did this too)
  const p = {
    account_id: accountId,
    id: payload.id || null,
    key: String(payload.key || '').trim() || `seq_${Date.now().toString(36)}`,
    display_name: String(payload.display_name || payload.name || '').trim(),
    enabled: !!payload.enabled,
    // Two independent kill switches (migration 018): enroll_enabled ("stop new entries")
    // and send_enabled ("stop messages to active runs"). Passed through to save_sequence,
    // which falls back to `enabled` for either one when it's absent (older-client compat).
    enroll_enabled: payload.enroll_enabled,
    send_enabled: payload.send_enabled,
    stop_on_reply: !!payload.stop_on_reply,
    skip_shabbat: !!payload.skip_shabbat,
    quiet_start: payload.quiet_start || '',
    quiet_end: payload.quiet_end || '',
    steps: Array.isArray(payload.steps) ? payload.steps : [],
  };

  // ── validate before persisting ──────────────────────────────────────────────
  // The panel guards these, but the API is publicly reachable (behind auth) and a
  // malformed sequence would silently fail to send for a real client, so reject early.
  for (const s of p.steps) {
    if (!s || !String(s.template_name || '').trim()) {
      throw new Error('each step must reference a template_name');
    }
    if (s.send_hour != null && s.send_hour !== '') {
      const h = Number(s.send_hour);
      if (!Number.isInteger(h) || h < 0 || h > 23) throw new Error('send_hour must be 0-23');
    }
    if (s.send_condition != null && s.send_condition !== '' &&
        !['always', 'no_reply', 'replied'].includes(s.send_condition)) {
      throw new Error('send_condition must be always|no_reply|replied');
    }
    if (s.on_condition_fail != null && s.on_condition_fail !== '' &&
        !['skip', 'stop'].includes(s.on_condition_fail)) {
      throw new Error('on_condition_fail must be skip|stop');
    }
    if (s.send_date != null && s.send_date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(s.send_date))) {
      throw new Error('send_date must be YYYY-MM-DD');
    }
    if (s.repeat_interval != null && s.repeat_interval !== '') {
      const n = Number(s.repeat_interval);
      if (!Number.isInteger(n) || n < 1) throw new Error('repeat_interval must be a positive integer');
      if (!['day', 'week', 'month'].includes(s.repeat_unit)) throw new Error('repeat_unit must be day|week|month');
    }
    if (Array.isArray(s.allowed_dow) && s.allowed_dow.some((d) => !Number.isInteger(Number(d)) || Number(d) < 0 || Number(d) > 6)) {
      throw new Error('allowed_dow must be integers 0-6');
    }
  }
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/; // 00:00–23:59
  if (p.quiet_start && !HHMM.test(p.quiet_start)) throw new Error('quiet_start must be HH:MM');
  if (p.quiet_end && !HHMM.test(p.quiet_end)) throw new Error('quiet_end must be HH:MM');

  if (!_config) throw new Error('store not initialized — call initStore(config) first');
  const pool = getPool(_config);
  const sequence = await withTx(pool, async (c) => {
    const rows = (await c.query(
      'SELECT drip.save_sequence($1::jsonb) AS result',
      [JSON.stringify(p)]
    )).rows;
    return rows[0]?.result ?? null;
  });
  // Return shape for tests. api.js extracts .sequence for the wire format.
  return { sequence };
}

// ── delete ────────────────────────────────────────────────────────────────────
// payload = { key }
// Returns { data: null } (both wire format and store return)
async function actionDelete(accountId, payload) {
  const p = {
    account_id: accountId,
    key: String(payload.key || ''),
  };
  await query('SELECT drip.delete_sequence($1::jsonb)', [JSON.stringify(p)]);
  return { data: null };
}

// ── enrollments ───────────────────────────────────────────────────────────────
// Returns all enrollments for the account.
// api.js sends: { ok: true, data: [...] }
// sequencesApi.js: data || [] — data IS the array.
async function actionEnrollments(accountId) {
  const rows = await query('SELECT drip.list_enrollments($1::int) AS result', [accountId]);
  const data = rows[0]?.result ?? [];
  return { data };
}

// ── enrollment_status ─────────────────────────────────────────────────────────
// payload = { conversation_id }
// api.js sends: { ok: true, data: {...}|null }
// sequencesApi.js: return call(...) directly → data is the object or null.
async function actionEnrollmentStatus(accountId, payload) {
  const raw = payload.conversation_id || payload.conversationId;
  if (!raw) throw new Error('conversation_id required');
  const convId = await resolveDisplayId(accountId, raw);
  const rows = await query(
    'SELECT drip.enrollment_status($1::int, $2::int) AS result',
    [accountId, convId]
  );
  const data = rows[0]?.result ?? null;
  return { data };
}

// ── sent_history ──────────────────────────────────────────────────────────────
// payload = { conversation_id }
// Returns the ordered log of template messages already delivered to this contact
// (transparency: "see exactly what was sent"). api.js sends { ok: true, data: [...] }.
async function actionSentHistory(accountId, payload) {
  const raw = payload.conversation_id || payload.conversationId;
  if (!raw) throw new Error('conversation_id required');
  const convId = await resolveDisplayId(accountId, raw);
  const rows = await query(
    'SELECT drip.sent_history($1::int, $2::int) AS result',
    [accountId, convId]
  );
  return { data: rows[0]?.result ?? [] };
}

// ── projected_schedule ──────────────────────────────────────────────────────────
// payload = { conversation_id }
// For a running enrollment, project the send date of the CURRENT + every FUTURE step
// (the engine only persists next_send_at for the current step). Computed exactly like the
// reconciler will — same cumulative delays, per-step hour snap, and shabbat/chag skip — so
// the panel can show "this message goes out on <date> at <hour>" instead of a relative "in N
// days". Returns [{ step_order, send_at }] in Israel local time (YYYY-MM-DD HH:MM), matching
// sent_history's format. [] when the conversation has no active enrollment.
async function actionProjectedSchedule(accountId, payload) {
  const raw = payload.conversation_id || payload.conversationId;
  if (!raw) throw new Error('conversation_id required');
  const convId = await resolveDisplayId(accountId, raw);

  const e = (await query(
    `SELECT e.current_step, e.next_send_at, e.sequence_id, s.skip_shabbat
       FROM drip.enrollments e
       JOIN drip.sequences s ON s.id = e.sequence_id
      WHERE e.account_id = $1
        AND ( e.conversation_id = $2
              OR e.contact_id = (SELECT contact_id FROM public.conversations
                                  WHERE account_id = $1 AND display_id = $2 LIMIT 1) )
      ORDER BY e.id DESC
      LIMIT 1`,
    [accountId, convId]
  ))[0];
  if (!e || !e.next_send_at || !e.current_step) return { data: [] };

  const steps = await query(
    `SELECT step_order, delay_days, delay_hours, send_hour, send_date, allowed_dow
       FROM drip.sequence_steps WHERE sequence_id = $1 ORDER BY step_order`,
    [e.sequence_id]
  );

  // Shabbat/chag windows only when the sequence opts in. Same freshness filter as
  // calendar.loadWindows (current + future), covering the projection horizon.
  let windows = [];
  if (e.skip_shabbat) {
    try {
      windows = await query(
        `SELECT starts_at, ends_at, kind FROM drip.no_send_windows
          WHERE ends_at >= now() - interval '2 days' ORDER BY starts_at`
      );
    } catch { windows = []; }
  }

  const sched = projectSchedule(steps, e.current_step, new Date(e.next_send_at), windows);
  const data = Object.entries(sched).map(([stepOrder, date]) => ({
    step_order: Number(stepOrder),
    send_at: fmtIsraelDateTime(date),
  }));
  return { data };
}

// Format a Date as "YYYY-MM-DD HH:MM" in Israel local time — matches drip.fmt_il so the
// frontend parses projected dates exactly like sent_at (no extra timezone handling needed).
function fmtIsraelDateTime(date) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// ── set_sequence ────────────────────────────────────────────────────────────────
// payload = { conversation_id | contact_id, sequence } — sequence falsy ('' / null) = opt-out.
// Assignment is now CONTACT-level: the lead is a contact, and the conversation is opened
// lazily at the first send. The panel passes a conversation_id, so we resolve its contact;
// a contact_id may also be passed directly. We write the `sequence` attribute on the CONTACT
// (the enroll trigger); the per-minute reconciler then enrolls / switches / stops.
async function actionSetSequence(accountId, payload) {
  const key = payload.sequence || null;

  // Resolve the lead's CONTACT: explicit contact_id, or via the conversation's contact.
  let contactId = (payload.contact_id || payload.contactId)
    ? Number(payload.contact_id || payload.contactId)
    : null;
  if (!contactId) {
    const raw = payload.conversation_id || payload.conversationId;
    if (!raw) throw new Error('contact_id or conversation_id required');
    const convId = await resolveDisplayId(accountId, raw);
    try {
      const rows = await query(
        'SELECT contact_id FROM public.conversations WHERE account_id=$1 AND display_id=$2 LIMIT 1',
        [accountId, convId]
      );
      contactId = rows[0]?.contact_id ?? null;
    } catch { /* public.conversations absent (test env) */ }
    if (!contactId) throw new Error('could not resolve a contact for this conversation');
  }

  // A suppressed contact cannot be (re)assigned to a sequence. Removing from a sequence
  // (key=null) is always allowed. `force` lets an agent deliberately override — the
  // dashboard asks for confirmation and the un-suppress is recorded — because a false
  // positive on an opt-out keyword must be recoverable without editing the DB by hand.
  if (key) {
    try {
      const sup = await query(
        `SELECT suppressed_reason FROM drip.contact_state
          WHERE account_id=$1 AND contact_id=$2 AND suppressed_at IS NOT NULL`,
        [accountId, contactId]
      );
      if (sup.length && !payload.force) {
        const err = new Error(`איש הקשר חסום (${sup[0].suppressed_reason}) ולא ניתן לשייך אותו לרצף`);
        err.code = 'SUPPRESSED';
        throw err;
      }
      if (sup.length && payload.force) {
        await query(
          `UPDATE drip.contact_state
              SET suppressed_at = NULL, suppressed_reason = NULL, suppressed_detail = NULL,
                  cap_failures = 0, unengaged_streak = 0, updated_at = now()
            WHERE account_id=$1 AND contact_id=$2`,
          [accountId, contactId]
        );
      }
    } catch (e) {
      if (e.code === 'SUPPRESSED') throw e;
      /* drip.contact_state absent (test env) → no suppression to honour */
    }
  }

  // Write the `sequence` attribute on the CONTACT directly in Chatwoot's DB. The per-account
  // AgentBot token can't PUT /contacts, and this is the single attribute the engine owns.
  await setContactSequenceAttr(accountId, contactId, key);
  // Clear any existing enrollment. For an EXPLICIT (re)assign this lets the reconciler
  // start a FRESH run (re-run even after completion). For an opt-out (key=null) it fully
  // removes the lead — otherwise a completed/stopped enrollment lingers and the panel's
  // "הסר מהרצף" looks broken (the reconciler only auto-stops ACTIVE enrollments).
  try {
    await query(
      'DELETE FROM drip.enrollments WHERE account_id=$1 AND contact_id=$2',
      [accountId, contactId]
    );
  } catch { /* enrollments table absent (test env) */ }
  return { data: { ok: true } };
}

// Set or clear the contact-level `sequence` attribute in Chatwoot's DB (drip_engine has
// UPDATE on public.contacts). Truthy key assigns; falsy removes the key (clean opt-out).
async function setContactSequenceAttr(accountId, contactId, key) {
  if (key) {
    await query(
      `UPDATE public.contacts
          SET custom_attributes = COALESCE(custom_attributes, '{}'::jsonb) || jsonb_build_object('sequence', $2::text)
        WHERE account_id = $1 AND id = $3`,
      [accountId, key, contactId]
    );
  } else {
    await query(
      `UPDATE public.contacts
          SET custom_attributes = COALESCE(custom_attributes, '{}'::jsonb) - 'sequence'
        WHERE account_id = $1 AND id = $2`,
      [accountId, contactId]
    );
  }
}

// ── labels ────────────────────────────────────────────────────────────────────
// Distinct conversation labels for the account + count (from Chatwoot cached_label_list).
async function actionLabels(accountId) {
  let rows = [];
  try {
    rows = await query(
      `SELECT label, count(*)::int AS count
         FROM public.conversations c,
              LATERAL unnest(string_to_array(c.cached_label_list, ', ')) AS label
        WHERE c.account_id = $1 AND coalesce(c.cached_label_list, '') <> ''
        GROUP BY label
        ORDER BY count DESC, label`,
      [accountId]
    );
  } catch { rows = []; }
  return { data: rows };
}

// ── bulk_enroll ───────────────────────────────────────────────────────────────
// Assign a sequence to every conversation carrying a given label. payload={label,sequence}.
// Writes the `sequence` attribute on each (the reconciler enrolls them on its next tick)
// and clears any prior enrollment for a fresh run. Returns { count, total }.
async function actionBulkEnroll(accountId, payload) {
  const label = String(payload.label || '').trim();
  const key = String(payload.sequence || '').trim();
  if (!label || !key) throw new Error('label and sequence required');

  const seqRows = await query(
    'SELECT 1 FROM drip.sequences WHERE account_id=$1 AND key=$2',
    [accountId, key]
  );
  if (seqRows.length === 0) throw new Error('sequence not found');

  // Conversations carrying the label → their CONTACTS (assignment is contact-level now).
  //
  // SUPPRESSED CONTACTS ARE EXCLUDED. This was the hole that made every other protection
  // pointless: someone who wrote "הסר", whom Meta told us opted out (131050), or whom we
  // suppressed as saturated, would be silently re-added by the next bulk enroll — and start
  // receiving again. A suppression that a later action can undo is not a suppression.
  const convs = await query(
    `SELECT DISTINCT cv.contact_id
       FROM public.conversations cv
      WHERE cv.account_id = $1
        AND string_to_array(cv.cached_label_list, ', ') @> ARRAY[$2]
        AND cv.contact_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM drip.contact_state cs
           WHERE cs.account_id = $1 AND cs.contact_id = cv.contact_id
             AND cs.suppressed_at IS NOT NULL)`,
    [accountId, label]
  );

  // How many the label DID cover — so the dashboard can say "42 enrolled, 8 skipped
  // (blocked)" instead of quietly showing a smaller number than the client expects.
  const totalRows = await query(
    `SELECT count(DISTINCT contact_id)::int AS n FROM public.conversations
      WHERE account_id = $1 AND string_to_array(cached_label_list, ', ') @> ARRAY[$2]
        AND contact_id IS NOT NULL`,
    [accountId, label]
  );
  const labelled = Number(totalRows[0]?.n || convs.length);

  let ok = 0;
  const BATCH = 5; // a few concurrent writes — keeps a large label responsive
  for (let i = 0; i < convs.length; i += BATCH) {
    const slice = convs.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      slice.map(async (cv) => {
        await setContactSequenceAttr(accountId, cv.contact_id, key);
        await query(
          'DELETE FROM drip.enrollments WHERE account_id=$1 AND contact_id=$2',
          [accountId, cv.contact_id]
        );
      })
    );
    ok += results.filter((r) => r.status === 'fulfilled').length;
  }
  return {
    data: {
      count: ok,
      total: convs.length,
      skipped_suppressed: Math.max(0, labelled - convs.length),
      label,
      sequence: key,
    },
  };
}

// ── contacts ──────────────────────────────────────────────────────────────────
// Search the account's contacts so a lead can be added to a sequence straight from the
// dashboard (no need to open a conversation). With a query → name/phone/email match;
// without one → most-recent contacts so the picker isn't empty. Each row carries the
// contact's current `sequence` attribute (so the UI can show "already in X"). DB read —
// drip_engine has SELECT on public.contacts.
async function actionContacts(accountId, payload) {
  const q = String(payload?.query || payload?.q || '').trim();
  const cols = `id AS contact_id, name, phone_number AS phone, email,
                custom_attributes->>'sequence' AS sequence`;
  let rows = [];
  try {
    if (q) {
      rows = await query(
        `SELECT ${cols} FROM public.contacts
          WHERE account_id = $1
            AND (name ILIKE $2 OR phone_number ILIKE $2 OR email ILIKE $2)
          ORDER BY (name IS NULL), name
          LIMIT 25`,
        [accountId, `%${q}%`]
      );
    } else {
      rows = await query(
        `SELECT ${cols} FROM public.contacts
          WHERE account_id = $1
          ORDER BY id DESC
          LIMIT 25`,
        [accountId]
      );
    }
  } catch { rows = []; }
  return { data: rows };
}

// ── templates ─────────────────────────────────────────────────────────────────
// Fetches APPROVED WhatsApp templates from Chatwoot.
// Shapes result to match n8n "Shape Templates" node:
//   { name, language, category, params_count, body_preview }
// api.js sends: { ok: true, data: [...] }
// sequencesApi.js: data || [] — data IS the array.
async function actionTemplates(accountId) {
  // Read templates straight from Chatwoot's WhatsApp channel (the AgentBot token can't
  // GET /inboxes). Keep only APPROVED, deduped by name+language — matching the old API path.
  const reads = makeDbReads(query);
  const raw = await reads.loadTemplates(accountId);
  const seen = new Set();
  const rawTemplates = raw.filter((t) => {
    if (String(t.status || '').toUpperCase() !== 'APPROVED') return false;
    const k = `${t.name}|${t.language}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const data = rawTemplates
    .map((t) => {
      const body = (t.components || []).find(
        (c) => String(c.type || '').toUpperCase() === 'BODY'
      );
      const text = body ? (body.text || '') : '';
      const header = (t.components || []).find(
        (c) => String(c.type || '').toUpperCase() === 'HEADER'
      );
      const footer = (t.components || []).find(
        (c) => String(c.type || '').toUpperCase() === 'FOOTER'
      );
      const buttons = (t.components || []).find(
        (c) => String(c.type || '').toUpperCase() === 'BUTTONS'
      );
      // Extract example values for {{N}} placeholders
      const examples = body?.example?.body_text?.[0] || [];
      return {
        name: t.name,
        language: t.language,
        category: t.category || 'MARKETING',
        params_count: text.split('{{').length - 1,
        body_preview: text.slice(0, 120),
        // Extended fields (full body, header, footer, buttons, examples)
        body: text,
        header_text: header?.text || '',
        // header_format: TEXT/IMAGE/VIDEO/DOCUMENT/null — the UI requires a media_url
        // for media headers (IMAGE/VIDEO/DOCUMENT); the engine sends it as an enhanced header param.
        header_format: header ? String(header.format || '').toUpperCase() : null,
        footer_text: footer?.text || '',
        buttons: (buttons?.buttons || []).map((b) => ({ type: b.type, text: b.text })),
        examples,
      };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  // "זיכרון מדיה" — לכל תבנית, הקישור (media_url) שכבר שימש אותה בשלב קיים. כך העורך
  // ממלא אוטומטית את המדיה לתבנית-header, ואין צורך להזין קישור שוב (אחרי הפעם הראשונה).
  try {
    const mediaRows = await query(
      `SELECT DISTINCT ON (st.template_name) st.template_name, st.media_url
         FROM drip.sequence_steps st
         JOIN drip.sequences s ON s.id = st.sequence_id
        WHERE s.account_id = $1 AND coalesce(st.media_url, '') <> ''
        ORDER BY st.template_name, st.id DESC`,
      [accountId]
    );
    const mediaByTemplate = new Map(mediaRows.map((r) => [r.template_name, r.media_url]));
    for (const t of data) {
      if (mediaByTemplate.has(t.name)) t.media_url = mediaByTemplate.get(t.name);
    }
  } catch { /* sequence_steps absent — skip media memory */ }

  return { data };
}

// ── storage_usage ───────────────────────────────────────────────────────────────
// Per-account storage: media WE uploaded (drip.media) + the Chatwoot account's own
// message-attachment storage (active_storage). Counted together for the storage view.
async function actionStorageUsage(accountId) {
  // Media uploaded through the drip library (exact — we own this table).
  let dripBytes = 0;
  let dripCount = 0;
  try {
    const r = (await query(
      `SELECT coalesce(sum(byte_size), 0)::bigint AS bytes, count(*)::int AS count
         FROM drip.media WHERE account_id = $1`,
      [accountId]
    ))[0];
    dripBytes = Number(r?.bytes || 0);
    dripCount = Number(r?.count || 0);
  } catch { /* drip.media absent (pre-migration) */ }

  // Chatwoot's own storage for this account — message attachments (the bulk of WA media).
  // Requires SELECT on active_storage_* (granted in provision-db-role.sh); 0 if unavailable.
  let chatwootBytes = 0;
  try {
    const r = (await query(
      `SELECT coalesce(sum(b.byte_size), 0)::bigint AS bytes
         FROM public.active_storage_attachments a
         JOIN public.active_storage_blobs b ON b.id = a.blob_id
         JOIN public.messages m ON m.id = a.record_id
        WHERE a.record_type = 'Message' AND m.account_id = $1`,
      [accountId]
    ))[0];
    chatwootBytes = Number(r?.bytes || 0);
  } catch { /* no grant / tables absent → report drip media only */ }

  return {
    data: {
      drip_bytes: dripBytes,
      drip_count: dripCount,
      chatwoot_bytes: chatwootBytes,
      total_bytes: dripBytes + chatwootBytes,
    },
  };
}

// ── delivery_stats ──────────────────────────────────────────────────────────────
// Read-only send/delivery analytics for the Overview "פעילות שליחה" card. Joins
// drip.sent_messages → public.messages.status (0/null=pending, 1=delivered, 2=read,
// 3=failed). All buckets in Asia/Jerusalem. error_code is set on sent_messages by
// reconcileDeliveries from the WhatsApp external_error.
async function actionDeliveryStats(accountId) {
  const TZ = 'Asia/Jerusalem';
  const dayStart = `date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}'`;

  // ⭐ "נחסמו" = מטא/הנמענת מנעה את המסירה, ולא כל כישלון.
  // יש שני מיני כישלון שונים לגמרי, ומיזוגם למספר אחד גורם ל"רשימה שרופה" מזויפת:
  //   • חסימת מטא — תקרת שיווק, opt-out, מספר לא קיים. הנמענת אבודה, זה סיפור הרשימה.
  //   • שגיאת שליחה שלנו — פרמטרים לא תואמים לתבנית, מדיה שבורה. ההודעה מעולם לא יצאה
  //     כי הבקשה שגויה, וזה משהו שמתקנים בקוד/בתבנית, לא סימן שהנמענת שרופה.
  // נמדד בבננה בוק 15/07: כל 8 "החסימות" של היום היו 132000 (חוסר פרמטר ב-bb_existing_07)
  // — אפס חסימות מטא אמיתיות. הצגתן כ"נחסמו" ניפחה את שיעור החסימה מ-0% ל-22%.
  // הרשימה מתואמת ל-classifyError ('cap' / 'optout' / 'invalid' — כולם צד הנמענת).
  const META_BLOCK = `('131049','130472','131056','131050','131026','131021')`;

  // Today: totals + WhatsApp block-reason breakdown
  //
  // ⚠️ The outcome is read from `sent_messages.delivery_status` — the engine's OWN column,
  // written by reconcileDeliveries — and NOT from a JOIN to public.messages.status.
  // The JOIN silently loses history: deleting a Chatwoot inbox cascade-deletes its
  // conversations and messages, and every sent_messages row then points at a message id
  // that no longer exists. `m.status` comes back NULL, and a BLOCKED send is counted as
  // "awaiting Meta". Measured 2026-07-14 (banana-book, hours after an inbox swap): Chatwoot
  // held 6 failures for the day, the dashboard showed 1 — four of the five it lost were
  // 131049 caps on brand-new leads. The success rate read 97% when it was 91%.
  // ⭐ `delivery_status` has FOUR values, not three: reconcileDeliveries writes 'delivered'
  // and 'failed', but a read receipt (Meta status 2) is recorded as 'read' — and 'read' means
  // the message both ARRIVED and was opened. Counting only ds='delivered' as arrived dropped
  // every read message from the arrived total (banana-book 2026-07-15: top card said 6 arrived,
  // the source split said 0/4 — the missing one was 'read'). notify.js already treats
  // ('delivered','read') as delivered; the dashboard must too. `read` is still detected via the
  // message row (status=2) OR the ds value, so a deleted message that we last saw as 'read'
  // still counts — and a read is by definition also arrived.
  const today = (await query(
    `WITH t AS (
       SELECT sm.error_code                     AS ec,
              COALESCE(sm.delivery_status, 'pending') AS ds,
              m.status                          AS s
         FROM drip.sent_messages sm
         LEFT JOIN public.messages m ON m.id = sm.message_id
        WHERE sm.account_id = $1 AND sm.sent_at >= ${dayStart}
     )
     SELECT count(*)::int AS sent,
            count(*) FILTER (WHERE ds IN ('delivered','read'))::int AS delivered,
            count(*) FILTER (WHERE ds = 'read' OR s = 2)::int        AS read,
            count(*) FILTER (WHERE ds = 'failed')::int    AS failed,
            -- "נחסמו" = מטא/הנמענת בלבד; שגיאת שליחה שלנו נספרת בנפרד
            count(*) FILTER (WHERE ds = 'failed' AND ec IN ${META_BLOCK})::int        AS blocked,
            count(*) FILTER (WHERE ds = 'failed' AND (ec IS NULL OR ec NOT IN ${META_BLOCK}))::int AS send_error,
            count(*) FILTER (WHERE ds = 'pending')::int   AS pending,
            count(*) FILTER (WHERE ds = 'failed' AND ec IN ('131049','130472','131056'))::int AS block_cap,
            count(*) FILTER (WHERE ds = 'failed' AND ec IN ('131026','131021'))::int  AS block_invalid,
            count(*) FILTER (WHERE ds = 'failed' AND ec = '131050')::int              AS block_optout,
            -- סיבות שגיאת השליחה (לא חסימה) — כדי שאפשר להראות מה לתקן
            count(*) FILTER (WHERE ds = 'failed' AND ec IN ('132000','132012','132001','132005','132007'))::int AS err_template,
            count(*) FILTER (WHERE ds = 'failed' AND ec IN ('131052','131053'))::int  AS err_media,
            count(*) FILTER (WHERE ds = 'failed' AND ec NOT IN ${META_BLOCK}
                          AND (ec IS NULL OR ec NOT IN ('132000','132012','132001','132005','132007','131052','131053')))::int AS err_other
       FROM t`,
    [accountId]
  ))[0];

  // Failed-by-template today (top 5) — which message clusters the failures, and whether each
  // cluster is a Meta block or OUR send error (so the UI can label bb_existing_07's parameter
  // mismatch as "fix the template", not "the recipients are burned").
  const byTemplate = (await query(
    `SELECT sm.template_name AS template,
            count(*) FILTER (WHERE sm.delivery_status = 'failed')::int AS failed,
            count(*) FILTER (WHERE sm.delivery_status = 'failed'
                             AND sm.error_code IN ${META_BLOCK})::int  AS blocked,
            count(*) FILTER (WHERE sm.delivery_status = 'failed'
                             AND (sm.error_code IS NULL OR sm.error_code NOT IN ${META_BLOCK}))::int AS send_error
       FROM drip.sent_messages sm
      WHERE sm.account_id = $1 AND sm.sent_at >= ${dayStart}
      GROUP BY sm.template_name
     HAVING count(*) FILTER (WHERE sm.delivery_status = 'failed') > 0
      ORDER BY 2 DESC LIMIT 5`,
    [accountId]
  ));

  // Waiting for auto-retry (active enrollment, future next_send, after a transient block)
  const retryWaiting = Number((await query(
    `SELECT count(DISTINCT e.id)::int AS c
       FROM drip.enrollments e
       JOIN drip.sent_messages sm ON sm.enrollment_id = e.id
            AND sm.delivery_status = 'failed' AND sm.error_code IN ('131049','130472')
      WHERE e.account_id = $1 AND e.status = 'active' AND e.next_send_at > now()`,
    [accountId]
  ))[0]?.c || 0);

  // 7-day trend (oldest → newest). The JOIN mattered most HERE: history is exactly where
  // message rows get deleted, so the older a day was, the more of its blocks the chart
  // quietly dropped — the one view whose whole job is to show a trend.
  const trend = (await query(
    `SELECT to_char(sm.sent_at AT TIME ZONE '${TZ}', 'DD/MM') AS day,
            count(*)::int AS sent,
            count(*) FILTER (WHERE sm.delivery_status IN ('delivered','read'))::int AS delivered,
            -- המגמה מראה חסימות מטא בלבד; שגיאת תבנית שלנו אינה "חסימה"
            count(*) FILTER (WHERE sm.delivery_status = 'failed'
                             AND sm.error_code IN ${META_BLOCK})::int               AS failed
       FROM drip.sent_messages sm
      WHERE sm.account_id = $1 AND sm.sent_at >= ${dayStart} - interval '6 days'
      GROUP BY 1, date_trunc('day', sm.sent_at AT TIME ZONE '${TZ}')
      ORDER BY date_trunc('day', sm.sent_at AT TIME ZONE '${TZ}')`,
    [accountId]
  ));

  // ── חסימות: ליד חדש מול המשך הרצף ───────────────────────────────────────────
  // שתי החסימות האלה הן שתי בעיות שונות לגמרי, ומיזוגן למספר אחד מסתיר את שתיהן:
  //   • ליד חדש שנחסם בהודעה הראשונה בחייו = הוא הגיע רווי מעסקים אחרים. זו בעיית
  //     מקור לידים, ושום שינוי בתוכן או בקצב לא יתקן אותה.
  //   • חסימה בהמשך הרצף = אנחנו עשינו משהו — קצב, תוכן, או תבנית שנשרפה.
  // נמדד בבננה בוק 14/07: ליד חדש נחסם ב-40%, המשך הרצף ב-2%. פי עשרים.
  //
  // ⚠️ "ליד חדש" הוא ההודעה הראשונה *בחייו*, ולא step_order=1: ליד שנרשם מחדש לרצף
  // חוזר לשלב 1 בלי להיות חדש. מתוך 1,506 שליחות של שלב 1 בחשבון הזה, 571 היו ללידים
  // שכבר קיבלו הודעות קודם — פיצול לפי step_order בלבד היה מנפח את "הלידים החדשים"
  // ביותר משליש ומשקר בדיוק על המספר שהפיצול נועד לחשוף.
  // ה-window function רץ על כל ההיסטוריה של איש הקשר (אחרת "ראשונה" הייתה נמדדת בתוך
  // היום ולא בתוך חייו), ורק אז מסננים ליום — אחרת כל שליחה ראשונה של היום נראית כמו
  // ליד חדש, גם למי שברצף כבר חודש.
  const bySource = (await query(
    `WITH s AS (
       SELECT sm.sent_at, sm.error_code AS ec,
              COALESCE(sm.delivery_status, 'pending') AS ds,
              row_number() OVER (PARTITION BY sm.contact_id ORDER BY sm.sent_at, sm.id) = 1
                AS is_first_ever
         FROM drip.sent_messages sm
        WHERE sm.account_id = $1
     )
     SELECT is_first_ever                                        AS "isNewLead",
            count(*)::int                                        AS sent,
            count(*) FILTER (WHERE ds IN ('delivered','read'))::int AS arrived,
            -- "נחסמו" בפיצול = חסימת מטא בלבד, כמו הכרטיס העליון
            count(*) FILTER (WHERE ds = 'failed' AND ec IN ${META_BLOCK})::int AS blocked,
            count(*) FILTER (WHERE ds = 'failed' AND (ec IS NULL OR ec NOT IN ${META_BLOCK}))::int AS "sendError"
       FROM s
      WHERE sent_at >= ${dayStart}
      GROUP BY 1`,
    [accountId]
  ));

  // ── מי מהרשימה עוד ניתן להשגה ────────────────────────────────────────────────
  // התקרה האישית של מטא (131049) היא המשתנה היחיד שבאמת מנבא מסירה — לא "קר/חם".
  // נמדד בחשבון הזה: נמענת שמטא מעולם לא חסמה נמסרת ב-60-84%; אחרי שנחסמה — 7.9%.
  // ומעל max_cap_failures המנוע מפסיק ליזום אליה שיווק בכלל. שלוש הקבוצות האלה הן
  // הסיפור של הרשימה, ובלעדיהן "856 פעילים" נשמע כמו 856 אנשים שאפשר להגיע אליהם.
  const burn = (await query(
    `WITH cap AS (
       SELECT COALESCE((SELECT max_cap_failures FROM drip.compliance WHERE account_id = $1), 4) AS m
     )
     SELECT (SELECT m FROM cap)::int AS "maxCap",
            count(*) FILTER (WHERE COALESCE(cs.cap_failures, 0) = 0)::int                                  AS clean,
            count(*) FILTER (WHERE COALESCE(cs.cap_failures, 0) BETWEEN 1 AND (SELECT m FROM cap) - 1)::int AS capped,
            count(*) FILTER (WHERE COALESCE(cs.cap_failures, 0) >= (SELECT m FROM cap))::int               AS refused
       FROM drip.enrollments e
       LEFT JOIN drip.contact_state cs
              ON cs.account_id = e.account_id AND cs.contact_id = e.contact_id
      WHERE e.account_id = $1 AND e.status = 'active'`,
    [accountId]
  ))[0];

  // bySource → { newLead: {...}, inSequence: {...} } — צורה יציבה גם כשאחד מהם ריק
  const src = (isNew) => bySource.find((r) => r.isNewLead === isNew)
    || { sent: 0, arrived: 0, blocked: 0, sendError: 0 };

  return {
    data: {
      today, byTemplate, retryWaiting, trend, burn,
      bySource: { newLead: src(true), inSequence: src(false) },
    },
  };
}

// ── template_media ──────────────────────────────────────────────────────────────
// מאגר "מדיה קבועה לכל תבנית" (migration 019). מקור-אמת יחיד שכל מקום ששולח תבנית
// קורא ממנו — הצ'אט, מודאל הקמפיינים, והרצפים. list מחזיר map { template_name: media_url }
// שה-dashboard-script טוען פעם אחת וממלא ממנו את שדה ה-media_url אוטומטית כשבוחרים תבנית
// עם media header, במקום לבחור/להעלות מדיה בכל שליחה.
async function actionTemplateMedia(accountId) {
  let rows = [];
  try {
    rows = await query(
      `SELECT template_name, media_url FROM drip.template_media WHERE account_id = $1`,
      [accountId]
    );
  } catch { /* טבלה חסרה (pre-migration) → map ריק, ה-UI פשוט לא ממלא אוטומטית */ }
  const map = {};
  for (const r of rows) map[r.template_name] = r.media_url;
  return { data: map };
}

// upsert: כשמעלים/מדביקים מדיה חדשה לתבנית — נשמרת למאגר → זמינה בכל מקום מיד (מסונכרן).
async function actionSaveTemplateMedia(accountId, payload) {
  const name = String(payload?.template_name || '').trim();
  const url = String(payload?.media_url || '').trim();
  if (!name) throw new Error('template_name required');
  if (!/^https?:\/\//i.test(url)) throw new Error('media_url must be an http(s) URL');
  await query(
    `INSERT INTO drip.template_media (account_id, template_name, media_url, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (account_id, template_name)
     DO UPDATE SET media_url = excluded.media_url, updated_at = now()`,
    [accountId, name, url]
  );
  return { data: { template_name: name, media_url: url } };
}
