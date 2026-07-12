import { loadConfig } from './config.js';
import { createApp } from './api.js';
import { getPool, query } from './db.js';
import { runMigrations } from './migrate.js';
import { reconcileAccount } from './reconcile.js';
import { refreshHealth } from './meta.js';
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

      // Live tier + quality rating from Meta (cached ~30m). Fails safe: a Graph outage can
      // only keep the last known cap, never raise it. A RED quality rating halts the account.
      const { cap: tierCap } = await refreshHealth(pool, reads, a.account_id, now, { compliance });

      // Attribute definitions are provisioned once at onboarding (the AgentBot token can't
      // manage them), so the per-tick ensureAttributes call is gone — reconcile only.
      await reconcileAccount(pool, client, a.account_id, now, windows, {
        tierCap,
        intervalMs: config.reconcileIntervalMs,
        spreadWindowMs: config.spreadWindowMs,
        maxSendsPerTick: config.maxSendsPerTick,
        maxDeliveryRetries: config.maxDeliveryRetries,
        deliveryRetryHours: config.deliveryRetryHours,
      });
    } catch (e) {
      console.error(`[drip] reconcile acct ${a.account_id}:`, e.message);
    }
  }
}

setInterval(() => tick().catch((e) => console.error('[drip] tick error:', e.message)),
  config.reconcileIntervalMs);
