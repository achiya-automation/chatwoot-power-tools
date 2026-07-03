import { loadConfig } from './config.js';
import { createApp } from './api.js';
import { getPool, query } from './db.js';
import { runMigrations } from './migrate.js';
import { reconcileAccount } from './reconcile.js';
import { makeClient } from './chatwoot.js';
import { makeDbReads } from './reads.js';
import { fetchHebcal, refreshCalendar, loadWindows } from './calendar.js';

const config = loadConfig();
const pool = getPool(config);

// ── Run migrations on startup ─────────────────────────────────────────────
await runMigrations(pool);

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
      // Attribute definitions are provisioned once at onboarding (the AgentBot token can't
      // manage them), so the per-tick ensureAttributes call is gone — reconcile only.
      await reconcileAccount(pool, client, a.account_id, now, windows, {
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
