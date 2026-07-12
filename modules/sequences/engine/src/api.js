import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { handleAction, initStore } from './store.js';
import { authGate } from './auth.js';
import { query } from './db.js';
import { validateWhatsAppMedia, extForMime } from './media.js';

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

export function createApp(config) {
  // Initialize store so it can access Chatwoot (needed for templates / enrollment_status)
  initStore(config);

  const app = express();
  app.use(express.json());

  // נתיב המדיה — ברירת מחדל גם כשה-config לא מספק אותו (טסטים), כדי ש-express.static
  // תמיד יקבל root תקין ולא יזרוק "root path required".
  const mediaDir = config.mediaDir || '/app/media';

  // ── health check (PUBLIC — registered before the auth gate) ────────────────
  app.get('/drip-api/health', (_req, res) => res.json({ ok: true }));

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
  app.use(authGate(config));

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
