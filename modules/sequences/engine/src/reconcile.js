import { isNoSendNow, nextSendAt, atJerusalemHour, addInterval, skipNoSendWindows, quietWindowEnd } from './schedule.js';
import { withTx } from './db.js';
import * as compliance from './compliance.js';

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

// כמה זמן לדחות רצף שנחסם ע"י מטא ברמת התבנית או הפורטפוליו (132015 / 135000).
// השהיית תבנית היא 3 שעות בפעם הראשונה — בדיקה כל 20 דקות מחזירה את הרצף לחיים
// כמעט מיד כשהיא משתחררת, בלי להטריד את מטא בינתיים.
const TEMPLATE_HOLD_MS = 20 * 60 * 1000;

/**
 * Pure send-budget calc: how many due steps may go out THIS tick.
 *
 * Balances the two goals from the brief:
 *   1. Never exceed Meta's tier — `tierCap` conversations per rolling 24h (past it → 131049).
 *   2. Keep each step close to its scheduled time — so this is a burst SMOOTHER, not a 24h
 *      spreader: `perTick` lets a full tier drain within ~`spreadWindowMs` (default 1h), which
 *      is prompt enough that normal due volume ships the same tick, yet never blasts Meta in
 *      one go (which reads as a spam burst → 135000 / quality hit).
 *
 * @param {object} a
 * @param {number} a.tierCap          - Meta 24h tier (Infinity = unlimited)
 * @param {number} [a.used24h]        - conversations already opened in the last 24h
 * @param {number} [a.intervalMs]     - reconciler cadence (default 60s)
 * @param {number} [a.spreadWindowMs] - window to spread a full tier over (default 1h)
 * @param {number} [a.staticCap]      - per-tick fallback for the unlimited tier (0 = no cap)
 * @returns {number} max sends this tick (Infinity = no limit)
 */
export function sendBudget({ tierCap, used24h = 0, intervalMs = 60000, spreadWindowMs = 3600000, staticCap = 0 }) {
  if (!Number.isFinite(tierCap)) {
    return Number(staticCap) > 0 ? Number(staticCap) : Infinity;   // unlimited tier
  }
  const tierRemaining = Math.max(0, tierCap - (Number(used24h) || 0));
  const perTick = Math.max(
    1,
    Math.ceil(tierCap * (Number(intervalMs) || 60000) / (Number(spreadWindowMs) || 3600000))
  );
  return Math.min(perTick, tierRemaining);
}

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
  // ⭐ סדר העדיפויות הוא ההחלטה החשובה כאן, לא רק התור.
  // התקציב בטיק הזה סופי (ה-tier של מטא), והשאלה היא על מי מוציאים אותו. מדידה על
  // החשבון הזה (n=4,998):
  //     חלון שירות פתוח (הגיבה ב-24ש׳)   →  25/25  = 100% מסירה, ובלי לגעת בשום מכסה
  //     נמענת שמטא מעולם לא חסמה          →  60-84%
  //     נמענת שמטא כבר חסמה               →  7.9%   — וכל כישלון גם שורף את התבנית לכולם
  // לכן: קודם מי שהחלון שלה פתוח, אחר כך מי שנקייה מחסימות, ורק אז השאר. בתוך כל שכבה —
  // הכי מאחרים בלוח הזמנים ראשונים, כך שהקצב שהוגדר ברצף נשמר.
  // זה לא משנה *מי* יקבל, רק את הסדר בתוך הטיק — ובזכותו התקציב לא נבזבז על חסומות.
  const dueIds = (await q(
    `SELECT e.id FROM drip.enrollments e
       LEFT JOIN drip.sequences s ON s.id = e.sequence_id
       LEFT JOIN drip.contact_state cs
              ON cs.account_id = e.account_id AND cs.contact_id = e.contact_id
      WHERE e.account_id   = $1
        AND e.status       = 'active'
        AND e.next_send_at <= $2
        AND (s.send_enabled OR e.sequence_id IS NULL)
      ORDER BY (cs.last_inbound_at > $2::timestamptz - interval '24 hours') DESC NULLS LAST,
               COALESCE(cs.cap_failures, 0) ASC,
               e.next_send_at, e.id`,
    [accountId, now]
  )).map((r) => r.id);

  // ── Send EXACTLY up to Meta's tier, favouring each step's original schedule ──────────
  // dueIds is already ORDER BY next_send_at — the MOST overdue steps first — so when we can't
  // send everything this tick, the ones sent are the ones closest to (or past) their intended
  // time. Throttling therefore preserves the sequence's original timing as much as possible;
  // it is a safety net, NOT an even-24h spreader (which would delay steps far from schedule).
  //
  // Two caps apply, whichever is tighter:
  //   • tierRemaining — Meta's 24h conversation tier (opts.tierCap, from meta.getDailyCap)
  //     minus the conversations we've already opened in the last rolling 24h. HARD limit:
  //     past it Meta returns 131049. Infinity = unlimited tier (no cap).
  //   • perTickCap — burst smoothing: spread a full tier over ~1h (opts.spreadWindowMs) so a
  //     large backlog can't blast in a single tick (which reads as a spam burst → 135000 /
  //     quality hit). Small enough to be safe, large enough that normal due volume goes out
  //     promptly (when few steps are due, all of them send this tick → timing preserved).
  // Count DISTINCT conversations opened in the last 24h that were NOT blocked — a 131049 never
  // opened a conversation, so it must not count against the tier (drip-initiated sends only;
  // ponytail: manual Chatwoot campaigns on the same number aren't counted — add them if that
  // ever becomes a real mixed-use case). Only needed for a finite tier.
  //
  // in_session sends are EXCLUDED. Meta defines the messaging limit as the number of users you
  // deliver to "outside of a customer service window" — a message sent to someone who replied
  // within the last 24h does not consume the limit at all. Counting them (as we did) throttled
  // the account below what Meta actually allows.
  let used24h = 0;
  if (Number.isFinite(opts.tierCap)) {
    used24h = Number((await q(
      `SELECT count(DISTINCT sm.conversation_id)::int AS c
         FROM drip.sent_messages sm
         LEFT JOIN public.messages m ON m.id = sm.message_id
        WHERE sm.account_id = $1
          AND sm.sent_at > $2::timestamptz - interval '24 hours'
          AND sm.in_session = false
          AND (m.status IS NULL OR m.status <> 3)`,
      [accountId, now]
    ))[0].c);
  }

  const budget = sendBudget({
    tierCap:        opts.tierCap,
    used24h,
    intervalMs:     opts.intervalMs,
    spreadWindowMs: opts.spreadWindowMs,
    staticCap:      opts.maxSendsPerTick,
  });
  const toSend = Number.isFinite(budget) ? dueIds.slice(0, budget) : dueIds;

  // ── Compliance context for this tick ────────────────────────────────────────
  // Loaded once, outside the per-enrollment loop: the same settings/health/template map
  // govern every send in this cycle, and re-reading them per lead would be N round-trips
  // for identical rows. Contact state IS per-lead, so it is fetched as one batched read.
  const cSettings  = await compliance.loadSettings(pool, accountId);
  const cHealth    = await compliance.loadHealth(pool, accountId);
  const cTemplates = await compliance.loadTemplateHealth(pool, accountId);

  // The phone comes from public.contacts, NOT from drip.enrollments.phone — that column
  // exists but is never written at enroll time, so reading it gave the US-number guard a
  // NULL and the guard silently never fired.
  const dueRows = toSend.length
    ? await q(
        `SELECT e.contact_id, c.phone_number AS phone
           FROM drip.enrollments e
           LEFT JOIN public.contacts c ON c.id = e.contact_id AND c.account_id = e.account_id
          WHERE e.id = ANY($1::uuid[]) AND e.contact_id IS NOT NULL`,
        [toSend]
      )
    : [];
  const dueContactIds = dueRows.map((r) => r.contact_id);
  const cPhones    = new Map(dueRows.map((r) => [r.contact_id, r.phone]));
  const cStates    = await compliance.loadContactStates(pool, accountId, dueContactIds);
  const cSentToday = await compliance.marketingSentToday(pool, accountId, dueContactIds, now);

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

        // ── Quiet hours / Shabbat / yom-tov ───────────────────────────────────
        // RESCHEDULE to the window edge rather than just returning. Returning left
        // next_send_at in the past, so every lead blocked overnight stayed due and they
        // all fired together the moment the window opened — a synchronised burst, exactly
        // what Meta reads as spam. The jitter spreads them over the first spreadWindowMs
        // (default 1h) instead, which is also when the tier budget can absorb them.
        const gateArgs = {
          now,
          windows,
          skipShabbat: seq.skip_shabbat,
          quietStart:  seq.quiet_start,
          quietEnd:    seq.quiet_end,
        };
        if (isNoSendNow(gateArgs)) {
          const edge = quietWindowEnd(gateArgs);
          if (edge) {
            const jitter = Math.floor(Math.random() * (opts.spreadWindowMs || 3600000));
            await c.query(
              `UPDATE drip.enrollments SET next_send_at = $2 WHERE id = $1`,
              [e.id, new Date(edge.getTime() + jitter)]
            );
          }
          return;
        }

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
        // ── A step whose copy REFERS BACK to the previous message ─────────────
        // "יצא לך לראות את הסרטון ששלחתי?" only makes sense if the video actually
        // arrived. It often doesn't: step 1 is a marketing template and Meta blocks it
        // with 131049 for most cold leads. Sending the follow-up anyway asks the lead
        // about a video she never received — 26 people got exactly that before this guard.
        //
        // Defer rather than skip: the previous step is still being retried (24h × attempt),
        // and if it lands, this step becomes coherent again. If it never lands the
        // enrollment fails on its own and this step never fires.
        if (step.require_prev_delivered && Number(step.step_order) > 1) {
          const landed = (await c.query(
            `SELECT 1 FROM drip.sent_messages sm
               JOIN public.messages m ON m.id = sm.message_id
              WHERE sm.enrollment_id = $1 AND sm.step_order = $2 AND m.status IN (1, 2)
              LIMIT 1`,
            [e.id, Number(step.step_order) - 1]
          )).rows.length > 0;
          if (!landed) {
            await c.query(
              `UPDATE drip.enrollments SET next_send_at = $2 WHERE id = $1`,
              [e.id, new Date(now.getTime() + 6 * 3600 * 1000)]
            );
            console.log(`[drip] gate DEFER acct ${accountId} enr ${e.id}: prev_step_not_delivered (step ${step.step_order})`);
            return;
          }
        }

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

        // ── COMPLIANCE GATE ──────────────────────────────────────────────────
        // Every one of Meta's rules is enforced here, in one place, before anything
        // irreversible happens (no conversation opened, no message sent, no cost).
        // Runs BEFORE lazy conversation creation on purpose: a blocked lead must not
        // leave a stray empty conversation behind.
        const cState = cStates.get(e.contact_id) || {};
        const session = compliance.inSession(cState, now);
        const verdict = compliance.canSend({
          category:  step.category,
          contact:   cState,
          phone:     cPhones.get(e.contact_id) || e.phone,
          settings:  cSettings,
          health:    cHealth,
          template:  cTemplates.get(`${step.template_name}|${step.language}`)
                     || cTemplates.get(step.template_name)
                     || null,
          sentToday: cSentToday.get(e.contact_id) || 0,
          inSession: session,
        });

        if (!verdict.ok) {
          if (verdict.action === 'drop') {
            // The lead is gone for good — opted out, saturated, or unreachable. Stop the
            // enrollment and clear the attribute so a later bulk enroll can't resurrect it.
            await c.query(`UPDATE drip.enrollments SET status = 'stopped' WHERE id = $1`, [e.id]);
            await c.query(
              `UPDATE public.contacts SET custom_attributes = custom_attributes - 'sequence'
                WHERE account_id = $1 AND id = $2`,
              [accountId, e.contact_id]
            );
            if (e.conversation_id) {
              try { await client.patchAttrs(e.conversation_id, { seq_state: 'stopped' }); }
              catch (pe) { console.error(`[drip] patchAttrs(gate-drop) conv ${e.conversation_id}:`, pe.message); }
            }
            console.log(`[drip] gate DROP acct ${accountId} contact ${e.contact_id}: ${verdict.reason} ${verdict.detail || ''}`);
            return;
          }

          // 'defer' — not now, but the lead keeps its exact place in the sequence.
          // A paused template lifts in 3h, a daily cap in 24h, an account halt when a
          // human clears it. Re-arm and check again; never burn the lead over a wait.
          //
          // template_burned — התבנית הגיעה לתקציב הכישלונות. זה לא נפתר מעצמו: צריך ליצור
          // תאומה ולהחליף. מתריעים (אידמפוטנטי) ומחזיקים את הליד יום, כדי שהתור לא יסתובב
          // סרק — הוא ימשיך מעצמו ברגע שהשלב יצביע על תבנית טרייה.
          // saturated — מטא חסמה את הנמענת. התקרה "מסתגלת עם הזמן", ותגובה שלה מבטלת אותה
          // מיידית (סורק ה-inbound מקדים אותה בחזרה). עד אז — לא רודפים.
          if (verdict.reason === 'template_burned') {
            await compliance.raiseAlert(
              pool, accountId, 'warn', `template_burned:${step.template_name}`,
              `התבנית "${step.template_name}" הגיעה ל-${cSettings.max_template_failures} כישלוני מסירה ` +
              `והשליחה בה נעצרה. צריך ליצור תאומה (_v3) ולהחליף את השלב, אחרת הרצף תקוע כאן.`
            );
          }
          const waitMs =
            verdict.reason === 'daily_cap'       ? 24 * 3600 * 1000 :
            verdict.reason === 'account_halted'  ? 60 * 60 * 1000 :
            verdict.reason === 'template_burned' ? 24 * 3600 * 1000 :
            verdict.reason === 'saturated'       ? 7 * 24 * 3600 * 1000
                                                 : TEMPLATE_HOLD_MS;
          await c.query(
            `UPDATE drip.enrollments SET next_send_at = $2 WHERE id = $1`,
            [e.id, new Date(now.getTime() + waitMs)]
          );
          console.log(`[drip] gate DEFER acct ${accountId} contact ${e.contact_id}: ${verdict.reason}`);
          return;
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

        // Send (irreversible — happens inside this tx so that if it throws the advance
        // never commits and the row stays at current_step).
        //
        // ⭐ Window open (`session`, computed at the gate above) → send FREE-FORM, not a
        // template. Meta's per-user marketing cap (131049) and the 24h tier apply only to
        // templates sent OUTSIDE a service window; a free-form message inside the window is
        // exempt from both. Same body, same media — the lead sees identical content, but it
        // actually arrives. (2026-07-12: templates to leads who had replied landed ~29%.)
        const sendArgs = {
          name:     step.template_name,
          language: step.language,
          category: step.category,
          params:   paramsResolve(step.params, contact),
          mediaUrl: step.media_url || null, // header media (IMAGE/VIDEO/DOCUMENT); the sender resolves the type
        };
        // MM Lite A/B (opts.mmLiteExperiment, default off). Meta claims its marketing API
        // "can overcome per-user message limits that might not allow delivery on Cloud API"
        // for high-engagement templates — unproven for this audience, so we measure instead
        // of guessing. Deterministic 50/50 on contact_id: the same lead always lands in the
        // same arm, so a retry doesn't switch rails mid-experiment and contaminate the result.
        // Only for MARKETING outside a session — in-session sends are free-form (no cap to beat)
        // and UTILITY is exempt from the per-user cap anyway.
        const mmLiteArm = opts.mmLiteExperiment
          && !session
          && String(step.category || '').toUpperCase() === 'MARKETING'
          && Number(e.contact_id) % 2 === 0;

        let sendResult;
        if (session) {
          sendResult = await client.sendFreeform(conversationId, sendArgs);
        } else if (mmLiteArm) {
          try {
            sendResult = await client.sendMmLite(conversationId, sendArgs);
          } catch (mmErr) {
            // An experiment must never cost a lead a message. Fall back to the proven path.
            console.error(`[drip] MM Lite failed for enr ${e.id}, falling back to template:`, mmErr.message);
            sendResult = await client.sendTemplate(conversationId, sendArgs);
          }
        } else {
          sendResult = await client.sendTemplate(conversationId, sendArgs);
        }

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
        // category + in_session + contact_id are what make the caps work: Meta counts a
        // marketing template against the daily tier and the per-user limit ONLY when it is
        // sent outside an open customer-service window. Without these three columns the
        // budget and the per-contact frequency cap are both blind.
        await c.query('SAVEPOINT hist');
        try {
          await c.query(
            `INSERT INTO drip.sent_messages
                   (account_id, conversation_id, enrollment_id, sequence_id, step_order,
                    template_name, content, message_id, category, in_session, contact_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [accountId, conversationId, e.id, e.sequence_id, e.current_step, step.template_name,
             sentContent, sentMessageId, step.category, session, e.contact_id]
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
export async function reconcileDeliveries(pool, client, accountId, now = new Date(), _opts = {}) {
  // ponytail: MAX_DELIVERY_RETRIES / DELIVERY_RETRY_HOURS אינם נקראים יותר — ה-cap שהיה
  // הצרכן היחיד שלהם עבר לצינון מתארך פר-נמענת (ראה case 'cap'), כי retry הוא בדיוק מה
  // שמטא מענישה עליו. החתימה נשמרת לתאימות לאחור עם הקוראים והטסטים.
  let pending = [];
  try {
    pending = (await pool.query(
      `SELECT sm.id AS sent_id, sm.enrollment_id, sm.conversation_id, sm.step_order,
              sm.template_name,
              COALESCE(sm.contact_id, e.contact_id, cv.contact_id) AS contact_id,
              m.status AS msg_status,
              m.content_attributes::text AS attrs_text
         FROM drip.sent_messages sm
         JOIN public.messages m ON m.id = sm.message_id
         LEFT JOIN drip.enrollments e ON e.id = sm.enrollment_id
         LEFT JOIN public.conversations cv
                ON cv.account_id = sm.account_id AND cv.display_id = sm.conversation_id
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

  const settings = await compliance.loadSettings(pool, accountId);

  // Re-arm the SAME step at now + hours, keeping the lead exactly where it is.
  const rearm = (enrollmentId, stepOrder, hours) =>
    pool.query(
      `UPDATE drip.enrollments
          SET status = 'active', current_step = $2,
              next_send_at = $3::timestamptz + make_interval(hours => $4)
        WHERE id = $1 AND status IN ('active', 'completed', 'failed')`,
      [enrollmentId, stepOrder, now, hours]
    );

  const failEnrollment = async (enrollmentId, conversationId) => {
    const upd = await pool.query(
      `UPDATE drip.enrollments SET status = 'failed'
        WHERE id = $1 AND status IN ('active', 'completed')`,
      [enrollmentId]
    );
    if (upd.rowCount > 0 && conversationId) {
      try { await client.patchAttrs(conversationId, { seq_state: 'failed' }); }
      catch (e) { console.error('[drip] patchAttrs(failed) error:', e.message); }
    }
  };

  for (const row of pending) {
    const s = Number(row.msg_status);

    if (s === 1 || s === 2) {
      await pool.query(
        `UPDATE drip.sent_messages SET delivery_status = 'delivered' WHERE id = $1`,
        [row.sent_id]
      );
      continue;
    }
    if (s !== 3) continue;   // 0 = sent, not yet confirmed → re-check next tick

    // FAILED — record the error first (history truth + retry counting).
    const parsed = parseExternalError(row.attrs_text);
    const code = parsed?.code || null;
    await pool.query(
      `UPDATE drip.sent_messages
          SET delivery_status = 'failed', error_code = $2, error_title = $3
        WHERE id = $1`,
      [row.sent_id, code, parsed?.title || null]
    );

    const kind = compliance.classifyError(code);

    // ── Account-level: nothing will send until a human fixes it ────────────────
    // 368 (policy block) / 133xxx (registration). Previously these silently failed one
    // lead at a time while the engine kept hammering at full pace — the fastest way to
    // turn a temporary block into a permanent ban.
    if (kind === 'policy') {
      const h = await compliance.loadHealth(pool, accountId);
      if (!h.halted) {
        await compliance.haltAccount(pool, accountId, `מטא החזירה קוד ${code}: ${parsed?.title || ''}`);
      }
      if (row.enrollment_id) await rearm(row.enrollment_id, row.step_order, 1);
      continue;
    }

    if (!row.enrollment_id) continue;   // re-assigned/deleted → history only

    // Suppression is keyed by contact_id. Without one there is nobody to suppress, so the
    // lead is failed instead — it still surfaces in the dashboard rather than vanishing.
    // A CAP failure is deliberately NOT in this list: the back-off is about the recipient's
    // window, not about our bookkeeping, so it must still retry even when we cannot count it.
    if (!row.contact_id && ['optout', 'invalid'].includes(kind)) {
      await failEnrollment(row.enrollment_id, row.conversation_id);
      continue;
    }

    switch (kind) {
      // ── Meta paused the template, or portfolio pacing dropped the message ────
      // Both are TEMPORARY (a pause is 3h, then 6h). Meta's own instruction is to halt
      // campaigns that rely on a paused template and resume when it goes Active — not to
      // throw the lead away. We re-arm the same step; the compliance gate will keep
      // deferring it until template_health shows APPROVED again.
      case 'template_paused':
      case 'pacing':
        if (code === '132015') {
          await pool.query(
            `UPDATE drip.template_health SET status = 'PAUSED', checked_at = now()
              WHERE account_id = $1 AND template_name = $2`,
            [accountId, row.template_name]
          );
          await compliance.raiseAlert(
            pool, accountId, 'warn', 'template_paused',
            `התבנית "${row.template_name}" הושהתה ע"י מטא. הרצף ממתין ויימשך אוטומטית כשהיא תחזור.`
          );
        }
        await rearm(row.enrollment_id, row.step_order, 1);
        continue;

      // ── The user told Meta they don't want marketing ─────────────────────────
      case 'optout':
        await compliance.suppressContact(
          pool, accountId, row.contact_id, 'meta_131050',
          'מטא: המשתמש אינו מקבל הודעות שיווקיות', 'marketing'
        );
        continue;

      // ── Not a reachable WhatsApp number ──────────────────────────────────────
      // Suppress the contact (nothing will ever reach them) AND fail the enrollment, so the
      // lead surfaces in the dashboard as stuck instead of silently sitting at 'completed'.
      case 'invalid':
        if (row.contact_id) {
          await compliance.suppressContact(
            pool, accountId, row.contact_id, 'invalid',
            parsed?.title || 'לא ניתן למסירה', 'all'
          );
        }
        await failEnrollment(row.enrollment_id, row.conversation_id);
        continue;

      // ── Per-user marketing cap (131049) — the Banana Book failure ────────────
      // cap_failures (per CONTACT) — how saturated is this person? Meta's per-user marketing
      // limit is cross-business and adaptive. Past max_cap_failures we stop initiating
      // marketing to her: chasing costs money, produces almost nothing (measured: 7.9%
      // delivery once Meta has capped a recipient, vs 60-84% before), and every failure
      // also burns the template for everyone else.
      case 'cap': {
        let failures = 1;
        if (row.contact_id) {
          const st = (await pool.query(
            `INSERT INTO drip.contact_state (account_id, contact_id, cap_failures)
             VALUES ($1, $2, 1)
             ON CONFLICT (account_id, contact_id) DO UPDATE
               SET cap_failures = drip.contact_state.cap_failures + 1, updated_at = now()
             RETURNING cap_failures`,
            [accountId, row.contact_id]
          )).rows[0];
          failures = Number(st?.cap_failures || 1);
          if (failures >= Number(settings.max_cap_failures)) {
            await compliance.suppressContact(
              pool, accountId, row.contact_id, 'saturated',
              `${failures} כשלי מכסה אישית (${code}) ברצף`, 'marketing'
            );
            // ההרשמה נשארת פעילה בכוונה. `saturated` נדחית ולא מסירה (ראה canSend): אם
            // הנמענת תגיב אי-פעם, ייפתח חלון שירות — והתקרה של מטא לא חלה בתוכו.
            continue;
          }
        }

        // ⛔ A CAP MUST NEVER FAIL THE ENROLLMENT.
        // 131049 is temporary by definition — Meta: the per-user limit "adapts automatically
        // over time based on a person's recent engagement levels", and it is lifted entirely
        // inside an open 24h service window. Failing the lead over it throws away someone who
        // is still reachable. It did exactly that here: 324 of the 335 failed enrollments on
        // this account died on 131049 — among them 65 leads who had REPLIED and 134 who had
        // READ. The best audience in the list, deleted by a soft error.
        //
        // ⚠️ And chasing them makes it worse. Meta: "If your WABA attempts to resend marketing
        // messages multiple times within a 24-hour period to users who have already reached
        // their messaging limit, further delivery attempts to these users may be unavailable
        // for up to 24 hours" — the retry loop MANUFACTURES the very block it is fighting.
        // (35% of this account's sends were such retries.)
        //
        // So: an escalating cooldown on the SAME step (3 → 6 → 9 … capped at 12 days), the
        // lead stays active, and the only stop is contact-level saturation above. If she ever
        // replies, the window opens and she gets everything she missed.
        const cooldownDays = Math.min(3 * failures, 12);
        await rearm(row.enrollment_id, row.step_order, 24 * cooldownDays);
        continue;
      }

      // ── Transient Meta hiccup ────────────────────────────────────────────────
      case 'transient':
        await rearm(row.enrollment_id, row.step_order, 1);
        continue;

      default:
        await failEnrollment(row.enrollment_id, row.conversation_id);
    }
  }
}
