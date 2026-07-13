export function loadConfig(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL required');
  if (!env.CHATWOOT_BASE_URL) throw new Error('CHATWOOT_BASE_URL required');
  return {
    databaseUrl: env.DATABASE_URL,
    chatwootBaseUrl: env.CHATWOOT_BASE_URL,
    port: Number(env.PORT || 3100),
    reconcileIntervalMs: Number(env.RECONCILE_INTERVAL || 60000),
    // Safety guardrail: max template sends per account per reconcile cycle. Now only a
    // fallback for the unlimited tier — the dynamic tier throttle (meta.getDailyCap) governs
    // the real per-tick pace for every capped tier. Kept for the unlimited-tier edge case.
    maxSendsPerTick: Number(env.MAX_SENDS_PER_TICK || 30),
    // Burst-smoothing window: a full messaging tier is spread over this long so a backlog
    // drains promptly (preserving each step's schedule) without blasting Meta in one tick.
    // NOT a 24h spread — that would delay steps far past their intended send time.
    spreadWindowMs: Number(env.SPREAD_WINDOW_MS || 3600000), // 1h
    // Transient per-user marketing-cap (131049/130472) retry policy: re-send the step
    // after deliveryRetryHours×attempt, up to maxDeliveryRetries, then give up.
    maxDeliveryRetries: Number(env.MAX_DELIVERY_RETRIES || 3),
    deliveryRetryHours: Number(env.DELIVERY_RETRY_HOURS || 24),
    // MM Lite A/B: route a deterministic 50% of MARKETING sends (contact_id even) through
    // Meta's marketing API instead of Cloud API, and compare delivery. OFF by default —
    // this is an experiment, not a default. Turn on only while measuring.
    mmLiteExperiment: String(env.MM_LITE_EXPERIMENT || '').toLowerCase() === 'true',
    // Meta app id — needed to open a resumable upload session when the engine re-creates a
    // worn-out template (POST /{app-id}/uploads). Empty = template rotation is off.
    metaAppId: String(env.META_APP_ID || ''),
    // The "master" Chatwoot account whose administrators are super-admins of the drip
    // dashboard: they can pick and manage ANY drip-managed account. Everyone else is
    // limited to the accounts they're a member of (tenant isolation in the auth gate).
    masterAccountId: Number(env.MASTER_ACCOUNT_ID || 1),
    webappDist: env.WEBAPP_DIST || '/app/webapp-dist',
    // Uploaded media: stored on a persistent volume, served PUBLICLY at <publicBase>/media/<file>
    // so Meta can fetch it (the rest of the addons route is auth-gated; /media is the one
    // exception). No portable default exists (it must be a fully-qualified https:// origin so
    // Meta can fetch it) — each deployment sets PUBLIC_BASE_URL explicitly; an empty string is
    // a safe, neutral fallback (never a hardcoded private domain).
    mediaDir: env.MEDIA_DIR || '/app/media',
    publicBase: env.PUBLIC_BASE_URL || '',
  };
}
