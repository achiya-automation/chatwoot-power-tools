import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { handleAction, initStore } from './store.js';
import { authGate } from './auth.js';
import { query, getPool } from './db.js';
import { validateWhatsAppMedia, extForMime } from './media.js';
import { uploadExampleMedia, hasTemplateAccess } from './templates.js';

/**
 * createApp(config) — express app factory.
 *
 * Routes:
 *   GET  /drip-api/health          → { ok: true }
 *   POST /drip-api?account_id=N    → { ok: true, data: <result> } | { ok: false, error: '...' }
 *   *    /                         → static webapp (config.webappDist), registered last
 *
 * account_id is always taken from the query string.
 * Body: { action: string, payload?: object }
 *
 * Wire format: api.js wraps store.js results in { ok, data } to match
 * sequencesApi.js expectations (call() returns json.data).
 *
 * Action → data mapping:
 *   list              → data = sequences array      (store.sequences)
 *   save              → data = sequence object      (store.sequence)
 *   delete            → data = null                 (store.data)
 *   enrollments       → data = enrollments array    (store.data)
 *   enrollment_status → data = object|null          (store.data)
 *   templates         → data = templates array      (store.data)
 */

/**
 * buildIdFromHtml(html) → the 14-digit build id of the served bundle, or '' if none.
 * Vite names assets `[name]-[hash]-${BUILD_ID}.<ext>` (see webapp/vite.config.js) and index.html
 * references them, so the id rides on the asset suffix. Matching the `-<id>.<ext>` shape (not any
 * 14 digits on the page) keeps an unrelated number from being mistaken for a build id.
 */
export function buildIdFromHtml(html) {
  return (String(html || '').match(/-(\d{14})\.(?:js|css)\b/) || [])[1] || '';
}

/**
 * isTplAdmin(access, accountId) → boolean.
 *
 * Template Studio writes touch the client's REAL WhatsApp Business Account (create/edit/
 * delete live templates, upload example media for review) — restricted to administrators,
 * unlike the rest of the API which any member of the account may use. Shared by the
 * /drip-api tpl_* guard and the template-example upload route below.
 *
 * access is req.dripAccess, set by authGate. A mobile-ticket session carries role:'' on its
 * one account (see auth.js's accessFromClaims) — never 'administrator' — so on mobile only
 * an explicitly granted user (below) reaches a tpl_* action.
 */
function isTplAdmin(access, accountId) {
  return !!access && (access.isSuperAdmin ||
    (access.accounts || []).some((x) => x.id === accountId && x.role === 'administrator'));
}

// Managing WHO may use the studio is never delegated — otherwise a granted agent could
// grant themselves company. Administrators only, always.
const TPL_ADMIN_ONLY = new Set(['tpl_access', 'tpl_set_access']);
// "May I?" — answerable to any member of the account (it returns booleans about the caller
// and nothing else), so the sidebar can decide whether to show the Templates item.
const TPL_ANY_MEMBER = new Set(['tpl_my_access']);

/**
 * mayUseTemplates(access, accountId, action) → Promise<boolean>.
 * Administrator of the account (or super-admin), or a user an administrator explicitly
 * granted access to (drip.template_access, migration 032). The grant is read per request —
 * revoking it in the UI takes effect on the very next call, with no session to expire.
 */
async function mayUseTemplates(access, accountId, action = '') {
  if (isTplAdmin(access, accountId)) return true;
  if (TPL_ADMIN_ONLY.has(action)) return false;
  try {
    return await hasTemplateAccess(accountId, access && access.userId);
  } catch (err) {
    console.error('[drip-api] template access lookup failed:', err.message);
    return false;   // DB unreachable → deny (an admin still passes above, without a query)
  }
}

export function createApp(config) {
  // Initialize store so it can access Chatwoot (needed for templates / enrollment_status)
  initStore(config);

  const app = express();
  app.use(express.json());

  // נתיב המדיה — ברירת מחדל גם כשה-config לא מספק אותו (טסטים), כדי ש-express.static
  // תמיד יקבל root תקין ולא יזרוק "root path required".
  const mediaDir = config.mediaDir || '/app/media';

  // The build id of the SPA we serve, read once from index.html. The dashboard polls it on
  // /drip-api/health and shows a "refresh" banner when its own compiled-in __BUILD_ID__ differs —
  // so a client on a cached old bundle (the mobile WebView especially) learns an update shipped.
  const buildId = (() => {
    try { return buildIdFromHtml(fs.readFileSync(`${config.webappDist}/index.html`, 'utf8')); }
    catch { return ''; }   // dev / no dist → empty, banner simply never fires
  })();

  // ── health check (PUBLIC — registered before the auth gate) ────────────────
  app.get('/drip-api/health', (_req, res) => res.json({ ok: true, build: buildId }));

  // ── uploaded media (PUBLIC — Meta must fetch it, so it bypasses the auth gate) ──
  // Served from a persistent volume at <publicBase>/media/<file>. Only static GETs;
  // a missing file is a clean 404 (never falls through to the SPA shell).
  app.use(
    '/media',
    express.static(mediaDir, { fallthrough: true, index: false, maxAge: '7d' }),
    (_req, res) => res.status(404).json({ ok: false, error: 'not found' })
  );

  // ── built SPA assets (PUBLIC — registered BEFORE the auth gate) ────────────
  // /assets/* is Vite's content-hashed output: the same JavaScript and CSS for every tenant,
  // carrying no customer data. Gating it bought nothing (the app is inert without an API
  // session) and cost two real problems:
  //
  //   1. Latency — the gate verifies every request against Chatwoot's /api/v1/profile, so
  //      each asset paid a Rails round-trip. Measured in production: 10.8 s for one bundle.
  //   2. A cacheable 401 — an asset request without a session got a 401, and a proxy that
  //      stamps `Cache-Control: max-age` on anything ending in .js then pinned that 401 to
  //      the bundle's URL at the CDN. Every logged-in user got the cached 401 instead of the
  //      JavaScript, and the dashboard rendered as a blank white page for a full day.
  //
  // Serving them publicly removes the failure mode at its root: there is no 401 left to cache.
  // The API below stays gated — that is where the tenant data actually lives.
  if (config.webappDist) {
    app.use(
      '/assets',
      express.static(`${config.webappDist}/assets`, {
        index: false,
        fallthrough: true,
        immutable: true,      // the filename IS the content hash — safe forever
        maxAge: '1y',
      }),
      (_req, res) => res.status(404).json({ ok: false, error: 'not found' })
    );
  }

  // ── auth gate ──────────────────────────────────────────────────────────────
  // The panel + API are reachable on the open web (Caddy /drip/ → engine). Everything
  // below this line requires a valid Chatwoot session cookie (verified against
  // GET /api/v1/profile). This guards the JSON API (incl. `enrollments`, which returns real
  // customer phone numbers) and the SPA shell.
  //
  // The gate also opens for a ticket signed by Chatwoot (config.ssoSecret) — that is the only way
  // the mobile app's WebView, which has no cookie jar, can get in without a second login. It needs
  // the pool to spend the ticket exactly once (src/sso.js). Tests pass their own pool/secret.
  app.use(authGate({ pool: config.pool || getPool(config), ...config }));

  // ── media upload (AUTHED) ──────────────────────────────────────────────────
  // Drag-drop a file → validated against WhatsApp limits → stored on the volume →
  // returns a public URL (no link to paste). Raw body (no multer dependency).
  app.post(
    '/drip-api/media',
    express.raw({ type: () => true, limit: 110 * 1024 * 1024 }),
    async (req, res) => {
      const locale = req.query.locale === 'en' ? 'en' : 'he'; // שפת שגיאות ל-UI (מחוץ ל-try כדי שה-catch יראה)
      try {
        const accountId = parseInt(req.query.account_id || '0', 10);
        if (!accountId) return res.status(400).json({ ok: false, error: 'account_id required' });
        const format = String(req.query.format || '').toUpperCase();
        const mime = String(req.headers['content-type'] || '');
        let origName = String(req.headers['x-filename'] || '');
        try { origName = decodeURIComponent(origName); } catch { /* keep raw */ }
        const buf = Buffer.isBuffer(req.body) ? req.body : null;
        const byteSize = buf ? buf.length : 0;

        const v = validateWhatsAppMedia({ format, mime, byteSize }, locale);
        if (!v.ok) return res.status(400).json({ ok: false, error: v.error });

        const id = randomUUID();
        const file = `${id}.${extForMime(mime)}`;
        await fs.promises.mkdir(mediaDir, { recursive: true });
        await fs.promises.writeFile(path.join(mediaDir, file), buf);
        await query(
          `INSERT INTO drip.media (id, account_id, file, orig_name, mime, byte_size)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, accountId, file, origName.slice(0, 255), mime.slice(0, 255), byteSize]
        );
        return res.json({ ok: true, data: { url: `${config.publicBase}/media/${file}`, file, byteSize, mime } });
      } catch (err) {
        console.error('[drip-api] media upload error:', err.message);
        return res.status(500).json({ ok: false, error: locale === 'en' ? 'Upload failed' : 'העלאה נכשלה' });
      }
    }
  );

  // ── template example media (AUTHED, ADMIN ONLY) ─────────────────────────────
  // A template with a media header (IMAGE/VIDEO/DOCUMENT) needs one example file at
  // *creation* time for Meta's review — a separate flow from /drip-api/media (which stores
  // a file for a live send). Same raw-body pattern as that route; Meta's Resumable Upload
  // API does the actual work (src/templates.js's uploadExampleMedia).
  //
  // The admin check runs in its OWN middleware, BEFORE express.raw(): a non-admin request is
  // rejected without ever buffering its (up to 110MB) body.
  app.post(
    '/drip-api/template-example',
    async (req, res, next) => {
      const accountId = parseInt(req.query.account_id || '0', 10);
      if (!(await mayUseTemplates(req.dripAccess, accountId))) {
        return res.status(403).json({ ok: false, error: 'administrator role required' });
      }
      next();
    },
    express.raw({ type: () => true, limit: 110 * 1024 * 1024 }),
    async (req, res) => {
      const locale = req.query.locale === 'en' ? 'en' : 'he';
      try {
        const accountId = parseInt(req.query.account_id || '0', 10);
        const inboxId = parseInt(req.query.inbox_id || '0', 10);
        if (!accountId || !inboxId) {
          return res.status(400).json({ ok: false, error: 'account_id and inbox_id required' });
        }
        const mime = String(req.headers['content-type'] || '');
        const buf = Buffer.isBuffer(req.body) ? req.body : null;
        if (!buf || !buf.length) {
          return res.status(400).json({ ok: false, error: locale === 'en' ? 'The file is empty' : 'הקובץ ריק' });
        }

        const { handle } = await uploadExampleMedia({ accountId, inboxId, mime, buf });
        return res.json({ ok: true, data: { handle } });
      } catch (err) {
        console.error('[drip-api] template-example upload error:', err.message);
        // "validation/meta" (a rejected file, an unavailable capability) → 400, matching
        // /drip-api/media's shape; a genuine unexpected failure (e.g. the DB read that
        // resolves the channel) falls through to 500, same as every other action's errors.
        const status = err.status === 400 || err.metaCode != null ? 400 : 500;
        const msg = status === 400 && locale !== 'en' && err.reasonHe ? err.reasonHe : err.message;
        return res.status(status).json({ ok: false, error: msg || (locale === 'en' ? 'Upload failed' : 'העלאה נכשלה') });
      }
    }
  );

  // ── main API endpoint ─────────────────────────────────────────────────────
  app.post('/drip-api', async (req, res) => {
    const accountId = parseInt(req.query.account_id || '0', 10);
    if (!accountId) {
      return res.status(400).json({ ok: false, error: 'account_id required in query string' });
    }

    const body = req.body || {};
    const action = String(body.action || '').toLowerCase();
    if (!action) {
      return res.status(400).json({ ok: false, error: 'action required in request body' });
    }

    const payload = body.payload && typeof body.payload === 'object'
      ? body.payload
      : (body || {});

    // Template Studio actions operate on the client's real WABA — administrators of the
    // account, plus any user an administrator granted access to. req.dripAccess is attached
    // by authGate. tpl_my_access is the one exception: every member may ask about itself.
    if (/^tpl_/.test(action)) {
      const admin = isTplAdmin(req.dripAccess, accountId);
      if (!TPL_ANY_MEMBER.has(action) && !(await mayUseTemplates(req.dripAccess, accountId, action))) {
        return res.status(403).json({ ok: false, error: 'administrator role required' });
      }
      // The server's own session identity always wins — never trust a client-sent __actor
      // or __isAdmin. payload is attacker-controlled up to this point, __actor lands straight
      // in the template_audit log and __isAdmin decides tpl_my_access's answer, so overwriting
      // them (not merely defaulting them) is what keeps both honest.
      payload.__actor = { uid: String(req.dripAccess.userId ?? ''), name: '' };
      payload.__isAdmin = admin;
    }

    try {
      const result = await handleAction(accountId, action, payload);

      // Unwrap the store result into the { ok, data } wire format.
      // sequencesApi.js's call() does: return json.data
      //   list      → json.data must be the array   → use result.sequences
      //   save      → json.data must be the object  → use result.sequence
      //   others    → json.data = result.data
      let data;
      if (action === 'list') {
        data = result.sequences;
      } else if (action === 'save') {
        data = result.sequence;
      } else {
        data = result.data;
      }

      return res.json({ ok: true, data });
    } catch (err) {
      console.error(`[drip-api] action=${action} account_id=${accountId}:`, err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── static serving of webapp (LAST — catch-all) ───────────────────────────
  // Caddy serves /drip/ → engine; express serves the built webapp from webappDist.
  // Must be registered after all API routes so API paths take priority.
  //
  // Cache policy is set HERE rather than left to the proxy, because getting it wrong is
  // invisible and lethal: assets pass through the auth gate, so any blanket "cache every .js
  // for a day" rule at the proxy also caches the gate's 401 — and a single unauthenticated
  // request for a freshly-deployed bundle pins that 401 at the CDN edge, blanking the
  // dashboard for everyone (see the `deny` comment in auth.js).
  //   /assets/*  — Vite content-hashes these, so the URL changes whenever the bytes do.
  //                Immutable is safe and correct.
  //   everything else (index.html, the SPA shell) — must be revalidated, or a deploy would
  //                keep serving an index.html that points at bundles that no longer exist.
  if (config.webappDist) {
    app.use(express.static(config.webappDist, {
      setHeaders: (res, filePath) => {
        res.set(
          'Cache-Control',
          /[\\/]assets[\\/]/.test(filePath)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache'
        );
      },
    }));
  }

  return app;
}
