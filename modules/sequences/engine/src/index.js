import { loadConfig } from './config.js';
import { createApp } from './api.js';
import { getPool, query } from './db.js';
import { runMigrations } from './migrate.js';
import { reconcileAccount } from './reconcile.js';
import { refreshHealth } from './meta.js';
import { notifyNewLeads } from './notify.js';
import { makeClient } from './chatwoot.js';
import { makeDbReads } from './reads.js';
import { fetchHebcal, refreshCalendar, loadWindows } from './calendar.js';
import * as compliance from './compliance.js';

const config = loadConfig();
const pool = getPool(config);

// ── Run migrations on startup (with DB-ready retry) ───────────────────────
// The engine can start before Postgres is accepting connections — e.g. a full-stack reboot,
// now that docker-compose.addons.yml intentionally carries no `depends_on: postgres` (that
// hardcoded name broke non-standard DB service names). Retry the first DB contact so a cold
// start settles on its own instead of crash-looping the container into the same race.
// runMigrations is idempotent (CREATE ... IF NOT EXISTS + tracked versions), so re-entry is
// safe. restart: unless-stopped remains the backstop if the DB never comes up.
async function withDbRetry(fn, tries = 30, delayMs = 2000) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= tries) throw e;
      console.warn(`[drip] DB not ready (${i}/${tries}): ${e.message} — retrying in ${delayMs}ms`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}
await withDbRetry(() => runMigrations(pool));

// ── Shabbat/yom-tov calendar (self-refreshing from Hebcal, Jerusalem) ─────
// Held in memory; refreshed at most once/day. A failed refresh keeps the
// existing windows (and schedule.js fails closed if none are fresh).
let windows = [];
let lastCalRefresh = 0;
async function refreshCalendarIfDue(now) {
  if (now.getTime() - lastCalRefresh < 24 * 3600 * 1000) return;
  try {
    const { fetched } = await refreshCalendar(pool, fetchHebcal, now);
    windows = await loadWindows(pool);
    lastCalRefresh = now.getTime();   // only on success → a failure retries next tick
    if (fetched) console.log(`[drip] calendar refreshed: ${windows.length} no-send windows`);
  } catch (e) {
    console.error('[drip] calendar refresh failed (keeping existing):', e.message);
  }
}
await refreshCalendarIfDue(new Date());
if (!windows.length) { try { windows = await loadWindows(pool); } catch { /* empty on first boot */ } }

// ── Start HTTP server ─────────────────────────────────────────────────────
// Listen on 0.0.0.0 INSIDE the container so the docker port mapping reaches it.
// Host-side exposure is limited to 127.0.0.1 by the override's port mapping
// ("127.0.0.1:3100:3100") — so the engine is still loopback-only from the host.
createApp(config).listen(config.port, '0.0.0.0', () =>
  console.log(`drip-engine listening on :${config.port}`)
);

// ── Reconcile loop ────────────────────────────────────────────────────────
// Runs every config.reconcileIntervalMs, iterates all registered accounts,
// ensures Chatwoot custom attributes exist, then runs the drip reconciler.
async function tick() {
  const now = new Date();
  await refreshCalendarIfDue(now);

  // ── Phase −1: AUTO-ONBOARD ────────────────────────────────────────────────
  // A drip account used to have to be registered in drip.account_tokens BY HAND. Miss that
  // step and the account is simply not in this loop: the sequence is built, the leads are
  // enrolled, the switches are on — and nothing ever sends, with no error anywhere. Silent,
  // and indistinguishable from "no leads are due".
  //
  // So the loop no longer asks "who is registered?" but "who has a sequence?". An account
  // that has one and lacks a token onboards itself on the next tick: drip.ensure_account_bot
  // (SECURITY DEFINER — the engine holds no write grant on access_tokens) creates its
  // AgentBot, mints the token, and registers it. Idempotent; the token never comes back here.
  const unregistered = await query(
    `SELECT DISTINCT s.account_id
       FROM drip.sequences s
      WHERE NOT EXISTS (SELECT 1 FROM drip.account_tokens t WHERE t.account_id = s.account_id)`
  );
  for (const u of unregistered) {
    try {
      const [{ created }] = await query('SELECT drip.ensure_account_bot($1) AS created', [u.account_id]);
      if (created) console.log(`[drip] חשבון ${u.account_id} חובר אוטומטית למנוע`);
    } catch (e) {
      // Loud on purpose: this is the difference between "works" and "silently does nothing".
      console.error(`[drip] auto-onboard acct ${u.account_id} FAILED:`, e.message);
      try {
        await compliance.raiseAlert(
          pool, u.account_id, 'error', 'auto_onboard_failed',
          `החשבון לא חובר למנוע אוטומטית (${e.message}). הרצפים בו לא ישלחו כלום עד שזה ייפתר.`
        );
      } catch { /* alert is best-effort */ }
    }
  }

  const accts = await query(
    'SELECT account_id, chatwoot_token, base_url FROM drip.account_tokens'
  );
  // DB-backed reads injected into every client — the per-account AgentBot token can WRITE
  // (open conversation, send, set conv attrs) but can't READ inboxes/contacts/messages.
  const reads = makeDbReads(query);
  for (const a of accts) {
    const client = makeClient({
      baseUrl: a.base_url || config.chatwootBaseUrl,
      token: a.chatwoot_token,
      accountId: a.account_id,
      reads,
      query,          // sendMmLite writes the message row itself (Chatwoot has no MM Lite path)
    });
    try {
      // ── Phase 0: inbound scan ────────────────────────────────────────────────
      // Detects opt-out requests ("הסר") and records engagement, WITHOUT a webhook: the
      // engine already reads Chatwoot's Postgres and already wakes every 60s, so an
      // incremental scan on a message-id watermark gives the same answer within a minute
      // — and needs zero per-client setup. For a product sold to many clients that is the
      // difference between "works" and "needs an install step".
      //
      // Runs BEFORE the reconciler on purpose: someone who wrote "הסר" a minute ago must
      // be suppressed before this tick can send to them.
      try {
        const { optOuts } = await compliance.scanInbound(pool, a.account_id, now);
        if (optOuts) console.log(`[drip] acct ${a.account_id}: ${optOuts} opt-out(s) suppressed`);
        await compliance.reconcileEngagement(pool, a.account_id, now);
      } catch (e) {
        console.error(`[drip] inbound scan acct ${a.account_id} (non-fatal):`, e.message);
      }

      // ── איזה מספר וואטסאפ ─────────────────────────────────────────────────
      // חשבון עם כמה מספרים ובלי בחירה: לא מנחשים. שליחה מהמספר הלא נכון היא טעות
      // שהלקוח רואה ואי אפשר לבטל — עדיף לעצור ולצעוק.
      const inbox = await reads.resolveInbox(a.account_id);
      if (inbox.ambiguous) {
        // מתריעים רק למי שבאמת יש לו רצף. חשבון עם כמה מספרים ובלי רצפים עדיין לא צריך
        // להחליט כלום — התראה שם היא זאב-זאב, והיא מרעישה דווקא את מי שאין לו בעיה.
        const [{ n }] = await query(
          'SELECT count(*)::int AS n FROM drip.sequences WHERE account_id = $1', [a.account_id]
        );
        if (n > 0) {
          await compliance.raiseAlert(
            pool, a.account_id, 'error', 'whatsapp_inbox_not_chosen',
            `לחשבון יש ${inbox.count} מספרי וואטסאפ ולא נבחר מספר לרצפים. ` +
            `שום הודעה לא תישלח עד שתבחר — בהגדרות ← מספר הוואטסאפ.`
          );
          console.error(`[drip] acct ${a.account_id}: ${inbox.count} WhatsApp inboxes, none chosen — skipping`);
        }
        continue;   // בשום מקרה לא מנחשים ממי לשלוח
      }

      // Live tier + quality rating from Meta (cached ~30m). Fails safe: a Graph outage can
      // only keep the last known cap, never raise it. A RED quality rating halts the account.
      const { cap: tierCap } = await refreshHealth(pool, reads, a.account_id, now, { compliance });

      // Attribute definitions are provisioned once at onboarding (the AgentBot token can't
      // manage them), so the per-tick ensureAttributes call is gone — reconcile only.
      await reconcileAccount(pool, client, a.account_id, now, windows, {
        tierCap,
        inboxId: inbox.inboxId,
        intervalMs: config.reconcileIntervalMs,
        spreadWindowMs: config.spreadWindowMs,
        maxSendsPerTick: config.maxSendsPerTick,
        maxDeliveryRetries: config.maxDeliveryRetries,
        deliveryRetryHours: config.deliveryRetryHours,
        mmLiteExperiment: config.mmLiteExperiment,
        freeformInSession: config.freeformInSession,
      });

      // ── Phase 3: התראה על כל ליד חדש שנסגר ────────────────────────────────────
      // רץ אחרי ה-reconcile כי הוא זה שקרא ממטא את סטטוס המסירה. עטוף לגמרי: התראה
      // שנופלת לא תעצור שליחה — היא תישלח שוב בטיק הבא (alerted_at נחתם רק אחרי 2xx).
      try {
        const n = await notifyNewLeads(pool, a.account_id, { webhookUrl: config.notifyWebhookUrl });
        if (n) console.log(`[drip] acct ${a.account_id}: ${n} התראות ליד נשלחו`);
      } catch (e) {
        console.error(`[drip] notify acct ${a.account_id} (non-fatal):`, e.message);
      }
    } catch (e) {
      console.error(`[drip] reconcile acct ${a.account_id}:`, e.message);
      // חשבון עם רצף ובלי ערוץ וואטסאפ נכשל כאן בשקט, בלוג בלבד. זו בדיוק אותה משפחה
      // של תקלות "נראה שהכל מוגדר ושום דבר לא נשלח" — ולכן היא עולה להתראה בדשבורד.
      if (/no WhatsApp channel creds/i.test(e.message)) {
        try {
          await compliance.raiseAlert(
            pool, a.account_id, 'error', 'no_whatsapp_channel',
            'לחשבון יש רצף אבל אין ערוץ וואטסאפ מחובר (phone_number_id / api_key). שום הודעה לא תישלח.'
          );
        } catch { /* alert is best-effort */ }
      }
    }
  }
}

setInterval(() => tick().catch((e) => console.error('[drip] tick error:', e.message)),
  config.reconcileIntervalMs);
