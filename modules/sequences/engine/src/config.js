const ALL_MODULES = ['import', 'sequences', 'enhancements'];

export function parseEnabledModules(raw) {
  const values = String(raw || ALL_MODULES.join(','))
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(values)];
  if (!unique.length) throw new Error('CWPT_ENABLED_MODULES must select at least one module');
  const unknown = unique.filter(value => !ALL_MODULES.includes(value));
  if (unknown.length) throw new Error(`unknown CWPT_ENABLED_MODULES: ${unknown.join(',')}`);
  return unique;
}

export function loadConfig(env = process.env) {
  const enabledModules = parseEnabledModules(env.CWPT_ENABLED_MODULES);
  const databaseFeaturesEnabled = enabledModules.some(name => name !== 'import');
  if (databaseFeaturesEnabled && !env.DATABASE_URL) throw new Error('DATABASE_URL required');
  if (!env.CHATWOOT_BASE_URL) throw new Error('CHATWOOT_BASE_URL required');
  return {
    databaseUrl: env.DATABASE_URL || '',
    enabledModules,
    databaseFeaturesEnabled,
    deployId: String(env.CWPT_DEPLOY_ID || ''),
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
    // (MAX_DELIVERY_RETRIES / DELIVERY_RETRY_HOURS removed — they were dead config.)
    // A 131049 retry policy is exactly the wrong instinct: Meta states that resending a
    // marketing message to someone already at her cap makes further delivery unavailable
    // for another 24h and lowers the sender's delivery rate. The retry MANUFACTURES the
    // block it is fighting. What replaced it: an escalating cooldown on the SAME step
    // (3 → 6 → 9 … capped at 12 days), and a lead who is never failed over a soft cap.
    // Don't reintroduce a retry knob here without reading reconcileDeliveries' `cap` branch.
    // MM Lite A/B: route a deterministic 50% of MARKETING sends (contact_id even) through
    // Meta's marketing API instead of Cloud API, and compare delivery. OFF by default —
    // this is an experiment, not a default. Turn on only while measuring.
    mmLiteExperiment: String(env.MM_LITE_EXPERIMENT || '').toLowerCase() === 'true',
    // Inside an open 24h service window, send FREE-FORM instead of the template. OFF, and it
    // should stay off — this buys nothing and costs the message.
    // Meta's window exemption is a property of the WINDOW, not of the message format: it
    // covers TEMPLATES too ("Marketing messages sent within this window do not count towards
    // the limit"), measured 25/25 = 100% delivery. So free-form gains no cap relief, while
    // it carries BODY text ONLY — dropping the template's BUTTONS and degrading its media
    // header into a file attachment with a raw UUID filename.
    // Worse: a Quick-Reply tap is an inbound message, i.e. the thing that RE-OPENS the window.
    // Stripping buttons from the lead who just replied removes the mechanism keeping her
    // window alive — so the hottest lead was the only one getting the worst message.
    // (production, 2026-07-14.)
    freeformInSession: String(env.FREEFORM_IN_SESSION || '').toLowerCase() === 'true',
    // Webhook that turns "Meta answered about a new lead" into a WhatsApp ping to the operator.
    // The URL's path IS the secret (n8n webhook, no credential). Empty = alerts off.
    notifyWebhookUrl: String(env.NOTIFY_WEBHOOK_URL || ''),
    webappDist: env.WEBAPP_DIST || '/app/webapp-dist',
    // Uploaded media: stored on a persistent volume, served PUBLICLY at <publicBase>/media/<file>
    // so Meta can fetch it (the rest of the addons route is auth-gated; /media is the one
    // exception). No portable default exists (it must be a fully-qualified https:// origin so
    // Meta can fetch it) — each deployment sets PUBLIC_BASE_URL explicitly; an empty string is
    // a safe, neutral fallback (never a hardcoded private domain).
    mediaDir: env.MEDIA_DIR || '/app/media',
    publicBase: env.PUBLIC_BASE_URL || '',
    // Shared with the Chatwoot-side jbuilder override that signs sign-in tickets into the mobile
    // app's dashboard-app URL (see src/sso.js). It is the ONLY way the mobile WebView — which has
    // no cookie jar and no way to prove who it is — gets in without a second login.
    //
    // Empty means the ticket door does not exist; everything else keeps working. NEVER give this a
    // default: a guessable value here would let anyone mint a ticket into any account.
    ssoSecret: String(env.DRIP_SSO_SECRET || ''),
    // בונה פלואו: אירועי זמן-אמת מ-Chatwoot נכנסים ב-POST /drip-api/journey-hook/<token>.
    // 🔒 ה-token אינו סוד גלובלי — הוא HMAC(JOURNEY_HOOK_SECRET, account_id) לכל חשבון
    // בנפרד, מחושב ב-perAccountHookToken. סוד-האב JOURNEY_HOOK_SECRET לעולם לא נכנס לנתיב
    // ולא נשמר ב-public.webhooks (רק ה-HMAC הפר-חשבוני נשמר שם). ריק = הדלת לא קיימת
    // והפלואו עובד רק על סריקת ה-tick (איטי אך תקין). JOURNEY_HOOK_BASE = מקור המנוע ברשת
    // ה-Docker הפנימית (בלי סוד!), למשל http://cwpt-engine:3100 או http://drip-engine:3100.
    journeyHookSecret: String(env.JOURNEY_HOOK_SECRET || ''),
    // תאימות-לאחור: אם ניתנה רק JOURNEY_HOOK_URL הישנה (שכללה נתיב+סוד), נגזור ממנה את המקור.
    journeyHookBase: String(env.JOURNEY_HOOK_BASE
      || (env.JOURNEY_HOOK_URL ? String(env.JOURNEY_HOOK_URL).replace(/\/drip-api\/journey-hook\/.*$/, '') : '')),
    // Make/Facebook Lead Ads starts a journey through a separate, synchronous intake door.
    // Authentication is HTTP Basic with HMAC(this master, "intake:<account_id>") as the
    // password, so no credential appears in the URL or reverse-proxy access logs. It is
    // intentionally independent of JOURNEY_HOOK_SECRET; rotating either cannot open the other.
    journeyIntakeSecret: String(env.JOURNEY_INTAKE_SECRET || ''),
  };
}
