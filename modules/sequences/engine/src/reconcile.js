import { isNoSendNow, nextSendAt, atJerusalemHour, addInterval, skipNoSendWindows } from './schedule.js';
import { withTx } from './db.js';

/**
 * Clean a contact name for use as a template parameter. WAHA-synced contacts can
 * have a JID as their "name" (e.g. "972...@c.us", "...@lid"), which makes an ugly
 * greeting. Real names have no "@", so we strip an "@suffix" — leaving real names
 * untouched and turning a JID-name into just its leading part. (Display nicety;
 * the JID itself does NOT block delivery — a JID-named contact received fine.)
 * @param {string} name
 * @returns {string}
 */
export const cleanName = (name) => {
  const n = String(name || '').trim();
  const at = n.indexOf('@');
  return at > 0 ? n.slice(0, at) : n;
};

/**
 * First name only — the leading word of the cleaned name. Nicer for a WhatsApp greeting
 * ("היי Vered" instead of "היי Vered Ganima Zilberman", when the contact name is a full name).
 * @param {string} name
 * @returns {string}
 */
export const firstName = (name) => cleanName(name).split(/\s+/).filter(Boolean)[0] || '';

/**
 * Resolve template params, substituting @first_name/@name/@phone/@email tokens from contact.
 * @param {string[]|null} params - raw param list from sequence_steps.params
 * @param {object}        c      - contact { name, phone, email }
 * @returns {string[]}
 */
export const paramsResolve = (params, c) =>
  (params || []).map((p) =>
    p === '@first_name' ? firstName(c.name) :
    p === '@name'  ? cleanName(c.name) :
    p === '@phone' ? (c.phone || '') :
    p === '@email' ? (c.email || '') :
    p
  );

/**
 * Extract the WhatsApp error from a Chatwoot message's content_attributes.
 * Chatwoot stores it DOUBLE-ENCODED for failed WA messages: content_attributes is a
 * json *string* whose text is itself json, e.g. "{\"external_error\":\"131026: …\"}".
 * Handles both the double-encoded string and a plain object, and pulls the numeric
 * Meta code out of forms like "131026: Message undeliverable" or "(#132012) …".
 * @param {string|null} attrsText - content_attributes rendered as text (::text)
 * @returns {{code: string|null, title: string}|null}
 */
export function parseExternalError(attrsText) {
  if (!attrsText) return null;
  let obj;
  try { obj = JSON.parse(attrsText); } catch { return null; }
  if (typeof obj === 'string') {           // double-encoded → parse the inner json
    try { obj = JSON.parse(obj); } catch { return null; }
  }
  const raw = obj && typeof obj === 'object' ? obj.external_error : null;
  if (!raw) return null;
  const title = String(raw);
  const m = title.match(/#?(\d{4,7})/);    // "131026:" | "(#132012)"
  return { code: m ? m[1] : null, title };
}

// After this many consecutive throwing sends we stop retrying and flag the lead
// 'failed' — so a permanently-broken step (deleted template, unreachable media)
// surfaces in the dashboard instead of looping once a minute forever.
const MAX_SEND_ATTEMPTS = 3;

// Meta delivery-failure codes that are TRANSIENT — the per-user marketing-message
// frequency cap (Meta limits how many marketing templates a user gets per window).
// These lift as the user's window resets, so we retry the step after a backoff instead
// of abandoning the lead. Everything else (e.g. 131026 "undeliverable") is permanent.
const TRANSIENT_DELIVERY_CODES = new Set(['131049', '130472']);

/**
 * Record a failed send (the send tx already rolled back, so the advance never
 * committed). Increment the attempt counter and back off next_send_at by an hour
 * per attempt; after MAX_SEND_ATTEMPTS, flag the enrollment 'failed'. Runs on the
 * pool (not the rolled-back tx). Best-effort — never throws into the reconcile loop.
 *
 * @param {import('pg').Pool} pool
 * @param {object}            client       - Chatwoot client (patchAttrs only)
 * @param {number}            enrollmentId
 * @param {Date}              now
 */
async function recordSendFailure(pool, client, enrollmentId, now) {
  try {
    const e = (await pool.query(
      `UPDATE drip.enrollments
          SET send_attempts = send_attempts + 1,
              next_send_at  = $2::timestamptz + make_interval(hours => send_attempts + 1)
        WHERE id = $1
        RETURNING send_attempts, conversation_id`,
      [enrollmentId, now]
    )).rows[0];
    if (e && e.send_attempts >= MAX_SEND_ATTEMPTS) {
      await pool.query(`UPDATE drip.enrollments SET status = 'failed' WHERE id = $1`, [enrollmentId]);
      try { await client.patchAttrs(e.conversation_id, { seq_state: 'failed' }); }
      catch (pe) { console.error('[drip] patchAttrs(send-failed) error:', pe.message); }
    }
  } catch (e2) {
    console.error(`[drip] recordSendFailure error for ${enrollmentId}:`, e2.message);
  }
}

/**
 * Run one reconcile cycle for a single Chatwoot account.
 *
 * Phases:
 *   1. ENROLL/SWITCH — conversations whose `sequence` custom_attr disagrees with active enrollment
 *   2. SEND          — due active enrollments; each in its OWN short transaction so one
 *                      failure cannot roll back advances already committed for other rows.
 *   3. OPT-OUT       — stop_on_reply sequences where customer replied since last send
 *
 * DB writes: drip schema only. Chatwoot writes: via client API (never direct DB).
 * Idempotent: every action derived from current DB state, safe to re-run.
 *
 * @param {import('pg').Pool} pool       - pg Pool (drip schema access)
 * @param {object}            client     - Chatwoot client from makeClient()
 * @param {number}            accountId  - Chatwoot account ID
 * @param {Date}              [now]      - current time (injectable for tests)
 * @param {Array}             [windows]  - no-send windows (shabbat/yom-tov) from calendar
 * @param {object}            [opts]     - { maxSendsPerTick } cap on sends per cycle (0/undefined = unlimited)
 */
export async function reconcileAccount(pool, client, accountId, now = new Date(), windows = [], opts = {}) {
  // Helper: query against pool, return rows array
  const q = (text, params) => pool.query(text, params).then((r) => r.rows);

  // ── Phase 1: ENROLL / SWITCH (contact-level) ───────────────────────────────
  // A lead is a CONTACT carrying custom_attributes.sequence — NOT a pre-opened
  // conversation. We enroll keyed by contact_id; the conversation is created lazily
  // at the first send (Phase 2). So no conversation is opened or touched here.
  let contactsList = [];
  try {
    contactsList = await q(
      `SELECT id AS contact_id, custom_attributes->>'sequence' AS seq
         FROM public.contacts
        WHERE account_id = $1
          AND custom_attributes ? 'sequence'`,
      [accountId]
    );
  } catch (err) {
    // public.contacts absent (tests) or without custom_attributes — skip phase 1
    if (err.code === '42P01' || err.code === '42703') {
      console.warn('[drip] public.contacts unavailable; skipping enroll phase');
      contactsList = [];
    }
    else throw err;
  }

  for (const ct of contactsList) {
    // Find the LATEST enrollment (any status) for this contact.
    // Using the latest — not only active — prevents a re-enroll loop: a COMPLETED
    // (or stopped) enrollment whose `sequence` attr is still set must NOT be
    // re-enrolled. Only enroll when there is none, or the sequence KEY changed.
    const enr = (await q(
      `SELECT e.id, e.status, s.key
         FROM drip.enrollments e
         JOIN drip.sequences    s ON s.id = e.sequence_id
        WHERE e.account_id  = $1
          AND e.contact_id  = $2
        ORDER BY e.id DESC
        LIMIT 1`,
      [accountId, ct.contact_id]
    ))[0];

    if (ct.seq && (!enr || enr.key !== ct.seq)) {
      // Contact wants a sequence that differs from (or has no) active enrollment — enroll
      // `enroll_enabled` gate (switch #1, "stop new entries"): when off, no NEW lead is
      // added to this sequence — but leads already enrolled keep going (that's switch #2).
      const seq = (await q(
        `SELECT id, skip_shabbat FROM drip.sequences
          WHERE account_id = $1 AND key = $2 AND enroll_enabled`,
        [accountId, ct.seq]
      ))[0];
      if (!seq) continue;

      const s1 = (await q(
        `SELECT delay_days, delay_hours, send_hour, send_date, allowed_dow
           FROM drip.sequence_steps
          WHERE sequence_id = $1
          ORDER BY step_order
          LIMIT 1`,
        [seq.id]
      ))[0];

      const next = nextSendAt(now, s1?.delay_days || 0, s1?.delay_hours || 0, s1?.send_hour, s1?.send_date, s1?.allowed_dow, seq.skip_shabbat ? windows : []);

      // Keyed by contact_id; conversation_id stays NULL until the first message is sent.
      await pool.query(
        `INSERT INTO drip.enrollments
               (account_id, contact_id, sequence_id, current_step, next_send_at, status)
         VALUES ($1, $2, $3, 1, $4, 'active')
         ON CONFLICT (account_id, contact_id)
         DO UPDATE SET sequence_id     = $3,
                       current_step    = 1,
                       next_send_at    = $4,
                       status          = 'active',
                       last_sent_at    = NULL,
                       conversation_id = NULL`,
        [accountId, ct.contact_id, seq.id, next]
      );
      // No conversation yet → no Chatwoot attrs to patch; seq_* are set at first send.

    } else if (!ct.seq && enr && enr.status === 'active') {
      // Sequence attribute was emptied — stop the active enrollment
      await pool.query(
        `UPDATE drip.enrollments SET status = 'stopped' WHERE id = $1`,
        [enr.id]
      );
    }
  }

  // ── Phase 2: SEND — per-enrollment short transactions ──────────────────────
  // Fetch the list of candidate enrollment IDs with a plain SELECT (no lock).
  // Each enrollment is then processed in its OWN short transaction so that:
  //   - A send failure only rolls back THAT enrollment's advance (which never
  //     happened, so no double-send on the next cycle).
  //   - Other enrollments already committed are unaffected.
  // FOR UPDATE SKIP LOCKED inside each per-enrollment tx guards against
  // concurrent reconciler runs picking up the same row.
  // `s.send_enabled` gate (switch #2, "stop messages to active runs"): when off, the
  // sequence is PAUSED — already-enrolled leads stop receiving, but keep their place
  // (status/current_step untouched) so re-enabling resumes from exactly where they were.
  // LEFT JOIN + `sequence_id IS NULL` keeps ORPHANED enrollments (sequence deleted) flowing
  // through so the tx below can stop them gracefully — filtering them here would leave them
  // stuck 'active' forever.
  const dueIds = (await q(
    `SELECT e.id FROM drip.enrollments e
       LEFT JOIN drip.sequences s ON s.id = e.sequence_id
      WHERE e.account_id   = $1
        AND e.status       = 'active'
        AND e.next_send_at <= $2
        AND (s.send_enabled OR e.sequence_id IS NULL)
      ORDER BY e.next_send_at, e.id`,
    [accountId, now]
  )).map((r) => r.id);

  // Per-tick send cap (safety guardrail): never blast a large backlog in one cycle.
  // 0/undefined = unlimited. The rest stay due and drain on subsequent ticks.
  const cap = Number(opts.maxSendsPerTick) || 0;
  const toSend = cap > 0 ? dueIds.slice(0, cap) : dueIds;

  for (const enrollmentId of toSend) {
    try {
      await withTx(pool, async (c) => {
        // Re-acquire the row with SKIP LOCKED — bail if already locked by a
        // concurrent run or no longer active/due.
        const rows = (await c.query(
          `SELECT * FROM drip.enrollments
            WHERE id           = $1
              AND status       = 'active'
              AND next_send_at <= $2
            FOR UPDATE SKIP LOCKED`,
          [enrollmentId, now]
        )).rows;

        if (rows.length === 0) return; // locked by peer or no longer due

        const e = rows[0];

        // ── Critical 2 guard: orphaned enrollment (sequence deleted) ──────────
        // sequence_id is ON DELETE SET NULL; if the sequence was deleted the
        // row would have sequence_id=NULL and seq would be undefined.
        const seqRows = e.sequence_id
          ? (await c.query(
              `SELECT send_enabled, stop_on_reply, skip_shabbat, quiet_start, quiet_end
                 FROM drip.sequences WHERE id = $1`,
              [e.sequence_id]
            )).rows
          : [];

        const seq = seqRows[0];

        if (!seq) {
          // Orphaned enrollment — stop it gracefully, never dereference undefined
          await c.query(
            `UPDATE drip.enrollments SET status = 'stopped' WHERE id = $1`,
            [e.id]
          );
          if (e.conversation_id) await client.patchAttrs(e.conversation_id, { seq_state: 'stopped' });
          return;
        }

        // ── Sends paused (send_enabled=false) = PAUSE (defense-in-depth) ──────
        // The due-list query already excludes paused sequences, but `send_enabled` can
        // flip between that snapshot and this tx. A paused sequence must send nothing
        // and leave the enrollment exactly as-is (active, same step) — NOT 'stopped',
        // which would drop the lead permanently — so re-enabling resumes from here.
        if (!seq.send_enabled) return;

        // Respect quiet hours / Shabbat / yom-tov (exact Hebcal windows)
        if (
          isNoSendNow({
            now,
            windows,
            skipShabbat: seq.skip_shabbat,
            quietStart:  seq.quiet_start,
            quietEnd:    seq.quiet_end,
          })
        ) return;

        // Load the step to send
        const step = (await c.query(
          `SELECT * FROM drip.sequence_steps
            WHERE sequence_id = $1 AND step_order = $2`,
          [e.sequence_id, e.current_step]
        )).rows[0];

        if (!step) {
          // No step found — sequence is exhausted, complete enrollment
          await c.query(
            `UPDATE drip.enrollments SET status = 'completed' WHERE id = $1`,
            [e.id]
          );
          if (e.conversation_id) await client.patchAttrs(e.conversation_id, { seq_state: 'completed' });
          return;
        }

        // ── Per-step send condition (flexible reply gate) ─────────────────────
        // A step may be conditioned on the customer's reply since our previous message:
        //   send_condition: 'always' (default) | 'no_reply' | 'replied'
        // When the condition is NOT met, on_condition_fail decides what happens:
        //   'skip' (default) — skip THIS step (no send) and keep the sequence going
        //   'stop'           — halt the enrollment
        // Only meaningful once a message has gone out (last_sent_at) on a real
        // conversation; on step 1 there is no previous send, so it's a no-op.
        const cond = step.send_condition || 'always';
        if (cond !== 'always' && e.last_sent_at && e.conversation_id) {
          const replied = await client.incomingSince(
            e.conversation_id,
            e.last_sent_at.toISOString()
          );
          const conditionMet = cond === 'replied' ? replied : !replied; // 'no_reply' → !replied
          if (!conditionMet) {
            if ((step.on_condition_fail || 'skip') === 'stop') {
              await c.query(`UPDATE drip.enrollments SET status = 'stopped' WHERE id = $1`, [e.id]);
              try { await client.patchAttrs(e.conversation_id, { seq_state: 'stopped' }); }
              catch (pe) { console.error(`[drip] patchAttrs(cond-stop) conv ${e.conversation_id}:`, pe.message); }
              return;
            }
            // 'skip' — advance PAST this step without sending; the sequence continues.
            // next_send_at is the NEXT step's own delay (or complete if none remain).
            const skipNext = (await c.query(
              `SELECT delay_days, delay_hours, send_hour, send_date, allowed_dow FROM drip.sequence_steps
                WHERE sequence_id = $1 AND step_order = $2`,
              [e.sequence_id, e.current_step + 1]
            )).rows[0];
            if (skipNext) {
              const nx = nextSendAt(now, skipNext.delay_days, skipNext.delay_hours, skipNext.send_hour, skipNext.send_date, skipNext.allowed_dow, seq.skip_shabbat ? windows : []);
              await c.query(
                `UPDATE drip.enrollments SET current_step = current_step + 1, next_send_at = $2 WHERE id = $1`,
                [e.id, nx]
              );
              try { await client.patchAttrs(e.conversation_id, { seq_step: e.current_step + 1, seq_next: Math.floor(nx.getTime() / 1000) }); }
              catch (pe) { console.error(`[drip] patchAttrs(cond-skip) conv ${e.conversation_id}:`, pe.message); }
            } else {
              await c.query(`UPDATE drip.enrollments SET status = 'completed' WHERE id = $1`, [e.id]);
              try { await client.patchAttrs(e.conversation_id, { seq_state: 'completed' }); }
              catch (pe) { console.error(`[drip] patchAttrs(cond-complete) conv ${e.conversation_id}:`, pe.message); }
            }
            return;
          }
        }

        // ── Lazy conversation creation ───────────────────────────────────────
        // The conversation is opened only now, as the first message is actually
        // sent (the requirement: "open a conversation only when a message is sent").
        // We use the contact's WhatsApp contact_inbox source_id (which survives a
        // conversation deletion). Once created, the id is stored so later steps reuse it.
        let conversationId = e.conversation_id;
        if (!conversationId) {
          if (!e.contact_id) {
            // No contact to open a conversation for → stop gracefully (nothing to send to).
            await c.query(`UPDATE drip.enrollments SET status = 'stopped' WHERE id = $1`, [e.id]);
            return;
          }
          // Requirement: open a conversation only at the first send, and only IF the contact
          // doesn't already have one — otherwise reuse the existing conversation.
          const existing = (await c.query(
            `SELECT display_id FROM public.conversations
              WHERE account_id = $1 AND contact_id = $2
              ORDER BY id DESC
              LIMIT 1`,
            [accountId, e.contact_id]
          )).rows[0];
          if (existing) {
            conversationId = existing.display_id;
          } else {
            const ci = (await c.query(
              `SELECT ci.source_id, ci.inbox_id
                 FROM public.contact_inboxes ci
                 JOIN public.inboxes i ON i.id = ci.inbox_id
                WHERE ci.contact_id = $1 AND i.channel_type = 'Channel::Whatsapp'
                ORDER BY ci.id
                LIMIT 1`,
              [e.contact_id]
            )).rows[0];
            if (!ci) throw new Error(`no WhatsApp contact_inbox for contact ${e.contact_id}`);
            const conv = await client.createConversation({
              sourceId: ci.source_id,
              inboxId:  ci.inbox_id,
              contactId: e.contact_id,
            });
            conversationId = conv.id;
          }
          await c.query(`UPDATE drip.enrollments SET conversation_id = $2 WHERE id = $1`, [e.id, conversationId]);
        }

        // Resolve contact for param substitution
        const contact = await client.getContact(conversationId);

        // Send the template (irreversible — happens inside this tx so that if
        // it throws the advance never commits and the row stays at current_step).
        const sendResult = await client.sendTemplate(conversationId, {
          name:     step.template_name,
          language: step.language,
          category: step.category,
          params:   paramsResolve(step.params, contact),
          mediaUrl: step.media_url || null, // header media (IMAGE/VIDEO/DOCUMENT); sendTemplate resolves the type
        });

        // Record what was delivered (send history → "see exactly what was sent").
        // Best-effort and SAVEPOINT-isolated: a logging failure must NEVER abort the
        // advance below — an aborted advance would re-send this step on the next cycle.
        const sentContent =
          sendResult && typeof sendResult === 'object' ? sendResult.content || '' : '';
        // Capture the Chatwoot message id so a later tick can read its delivery
        // status (public.messages.status) and surface "stuck" sends in the dashboard.
        const sentMessageId =
          sendResult && typeof sendResult === 'object' && Number.isFinite(Number(sendResult.id))
            ? Number(sendResult.id)
            : null;
        await c.query('SAVEPOINT hist');
        try {
          await c.query(
            `INSERT INTO drip.sent_messages
                   (account_id, conversation_id, enrollment_id, sequence_id, step_order, template_name, content, message_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [accountId, conversationId, e.id, e.sequence_id, e.current_step, step.template_name, sentContent, sentMessageId]
          );
          await c.query('RELEASE SAVEPOINT hist');
        } catch (histErr) {
          await c.query('ROLLBACK TO SAVEPOINT hist');
          console.error(`[drip] history insert failed (non-fatal) for enrollment ${e.id}:`, histErr.message);
        }

        // The seq_* conversation attrs are COSMETIC (Chatwoot sidebar display). The message is
        // already sent, so a patch failure must NEVER throw out of the tx — that would roll back
        // the committed advance and re-send on the next tick. Best-effort, always.
        const safePatch = async (attrs) => {
          try { await client.patchAttrs(conversationId, attrs); }
          catch (pe) { console.error(`[drip] patchAttrs (non-fatal) conv ${conversationId}:`, pe.message); }
        };

        // ── Recurring step ("every day/week/month") ───────────────────────────
        // When the step just sent repeats, it re-arms ITSELF at now + interval (snapped to its
        // send_hour if set) and the enrollment stays on this step — a standing cadence until
        // opt-out. Powers "כל חודש קבוע": a monthly keep-in-touch message that never completes.
        if (step.repeat_interval) {
          let nextR = addInterval(now, step.repeat_interval, step.repeat_unit);
          if (step.send_hour != null) nextR = atJerusalemHour(nextR, Number(step.send_hour));
          // A recurring occurrence landing on shabbat/chag is pushed forward too.
          if (seq.skip_shabbat && Array.isArray(windows) && windows.length) {
            nextR = skipNoSendWindows(nextR, windows, step.send_hour ?? null);
          }
          await c.query(
            `UPDATE drip.enrollments
                SET next_send_at  = $2,
                    last_sent_at  = $3,
                    send_attempts = 0
              WHERE id = $1`,
            [e.id, nextR, now]
          );
          await safePatch({ seq_next: Math.floor(nextR.getTime() / 1000) });
          return;
        }

        // Check if there is a next step
        const nextStep = (await c.query(
          `SELECT delay_days, delay_hours, send_hour, send_date, allowed_dow
             FROM drip.sequence_steps
            WHERE sequence_id = $1 AND step_order = $2`,
          [e.sequence_id, e.current_step + 1]
        )).rows[0];

        if (nextStep) {
          // Advance to next step
          const next = nextSendAt(now, nextStep.delay_days, nextStep.delay_hours, nextStep.send_hour, nextStep.send_date, nextStep.allowed_dow, seq.skip_shabbat ? windows : []);
          await c.query(
            `UPDATE drip.enrollments
                SET current_step  = current_step + 1,
                    next_send_at  = $2,
                    last_sent_at  = $3,
                    send_attempts = 0
              WHERE id = $1`,
            [e.id, next, now]
          );
          await safePatch({
            seq_step: e.current_step + 1,
            seq_next: Math.floor(next.getTime() / 1000),
          });
        } else {
          // Last step sent — mark completed
          await c.query(
            `UPDATE drip.enrollments
                SET status       = 'completed',
                    last_sent_at = $2
              WHERE id = $1`,
            [e.id, now]
          );
          await safePatch({ seq_state: 'completed' });
        }
      });
    } catch (err) {
      // One enrollment's failure must never abort the others
      console.error(`[drip] send error for enrollment ${enrollmentId}:`, err);
      // Back off (and eventually give up) so a permanently-failing step doesn't
      // retry every tick forever. Runs on the pool — the send tx already rolled back.
      await recordSendFailure(pool, client, enrollmentId, now);
    }
  }

  // ── Phase 3: OPT-OUT — stop_on_reply sequences ───────────────────────────
  // Only watch enrollments that have already sent at least one message (last_sent_at IS NOT NULL)
  const watch = await q(
    `SELECT e.*
       FROM drip.enrollments e
       JOIN drip.sequences    s ON s.id = e.sequence_id
      WHERE e.account_id  = $1
        AND e.status      = 'active'
        AND s.stop_on_reply
        AND e.last_sent_at IS NOT NULL`,
    [accountId]
  );

  for (const e of watch) {
    const replied = await client.incomingSince(
      e.conversation_id,
      e.last_sent_at.toISOString()
    );
    if (replied) {
      await pool.query(
        `UPDATE drip.enrollments SET status = 'stopped' WHERE id = $1`,
        [e.id]
      );
      await client.patchAttrs(e.conversation_id, { seq_state: 'stopped' });
    }
  }

  // ── Phase 4: DELIVERY CHECK — surface "stuck" sends ──────────────────────────
  // Best-effort: read the real delivery status of messages we already sent (Meta
  // rejects async, minutes later). A failed send (e.g. 131026 undeliverable) flips the
  // enrollment to 'failed' so the dashboard shows exactly who got stuck and why.
  // Never allowed to break sending — fully wrapped.
  try {
    await reconcileDeliveries(pool, client, accountId, now, opts);
  } catch (err) {
    console.error('[drip] delivery check failed (non-fatal):', err.message);
  }
}

/**
 * Phase 4 — reconcile delivery outcomes for already-sent messages.
 *
 * Reads public.messages.status for each pending sent_messages row (joined by the
 * Chatwoot message id we captured at send time) and:
 *   - status 3 (failed)        → mark sent_messages 'failed' + error, flag enrollment 'failed'
 *   - status 1/2 (delivered/read) → mark sent_messages 'delivered'
 *   - status 0 (sent, unconfirmed) → leave 'pending' (re-checked next tick, within 48h)
 *
 * Exported for direct testing. Reads public.messages (drip_engine has SELECT); the
 * only Chatwoot write is a seq_state attr on a confirmed failure.
 *
 * @param {import('pg').Pool} pool
 * @param {object}            client    - Chatwoot client (patchAttrs only)
 * @param {number}            accountId
 * @param {Date}              [now]
 */
export async function reconcileDeliveries(pool, client, accountId, now = new Date(), opts = {}) {
  const { maxDeliveryRetries = 3, deliveryRetryHours = 24 } = opts;
  let pending = [];
  try {
    pending = (await pool.query(
      `SELECT sm.id AS sent_id, sm.enrollment_id, sm.conversation_id, sm.step_order,
              m.status AS msg_status,
              m.content_attributes::text AS attrs_text
         FROM drip.sent_messages sm
         JOIN public.messages m ON m.id = sm.message_id
        WHERE sm.account_id      = $1
          AND sm.delivery_status = 'pending'
          AND sm.message_id IS NOT NULL
          AND sm.sent_at > $2::timestamptz - interval '48 hours'`,
      [accountId, now]
    )).rows;
  } catch (err) {
    // public.messages absent / lacks status|content_attributes (minimal env) → skip
    if (err.code === '42P01' || err.code === '42703') {
      console.warn('[drip] delivery check skipped (public.messages unavailable)');
      return;
    }
    throw err;
  }

  for (const row of pending) {
    const s = Number(row.msg_status);
    if (s === 3) {
      // FAILED — record the error first (history truth + retry counting).
      const parsed = parseExternalError(row.attrs_text);
      const code = parsed?.code || null;
      await pool.query(
        `UPDATE drip.sent_messages
            SET delivery_status = 'failed', error_code = $2, error_title = $3
          WHERE id = $1`,
        [row.sent_id, code, parsed?.title || null]
      );

      // No enrollment to act on (re-assigned/deleted) → history only.
      if (!row.enrollment_id) continue;

      // ── TRANSIENT per-user marketing cap (131049/130472) → retry, don't abandon ──
      if (TRANSIENT_DELIVERY_CODES.has(code)) {
        const tries = Number((await pool.query(
          `SELECT count(*)::int AS c FROM drip.sent_messages
            WHERE enrollment_id = $1 AND step_order = $2 AND delivery_status = 'failed'`,
          [row.enrollment_id, row.step_order]
        )).rows[0].c);
        if (tries < maxDeliveryRetries) {
          // Re-send the SAME step after a backoff (escalating per attempt) — by then the
          // user's marketing window has likely reset. Keeps the lead in the sequence.
          await pool.query(
            `UPDATE drip.enrollments
                SET status = 'active', current_step = $2,
                    next_send_at = $3::timestamptz + make_interval(hours => $4)
              WHERE id = $1 AND status IN ('active', 'completed', 'failed')`,
            [row.enrollment_id, row.step_order, now, deliveryRetryHours * tries]
          );
          continue; // retrying — not stuck
        }
        // retries exhausted → fall through to permanent fail
      }

      // PERMANENT failure (131026 etc.) or transient retries exhausted → flag stuck.
      const upd = await pool.query(
        `UPDATE drip.enrollments SET status = 'failed'
          WHERE id = $1 AND status IN ('active', 'completed')`,
        [row.enrollment_id]
      );
      if (upd.rowCount > 0) {
        try { await client.patchAttrs(row.conversation_id, { seq_state: 'failed' }); }
        catch (e) { console.error('[drip] patchAttrs(failed) error:', e.message); }
      }
    } else if (s === 1 || s === 2) {
      // DELIVERED / READ
      await pool.query(
        `UPDATE drip.sent_messages SET delivery_status = 'delivered' WHERE id = $1`,
        [row.sent_id]
      );
    }
    // s === 0 (sent, not yet confirmed) → leave pending for the next tick
  }
}
