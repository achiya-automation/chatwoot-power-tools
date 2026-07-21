// templates.js — Template Studio backend: manage WhatsApp message templates on the WABA
// through Meta's Graph API, using the same channel token Chatwoot already stores.
// Every write here is triggered by an explicit admin action in the UI — nothing in this
// module creates or edits templates on its own (poll = read-only status refresh).
import { createHash } from 'node:crypto';
import { query as defaultQuery } from './db.js';
import { makeDbReads } from './reads.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const TPL_FIELDS = 'id,name,status,category,language,components,quality_score,rejected_reason,last_updated_time';

export function metaError(body) {
  const e = (body && body.error) || {};
  const msg = [e.error_user_title, e.error_user_msg || e.message].filter(Boolean).join(' — ')
    || 'Meta API error';
  const err = new Error(msg);
  err.metaCode = e.code ?? null;
  err.metaSubcode = e.error_subcode ?? null;
  return err;
}

// Auth via header, never via URL: an access_token in the URL is a loggable surface (access
// logs, proxies, browser history). Mirrors src/meta.js's fetchNumberHealth/fetchTemplateHealth.
// Single chokepoint for every Graph call, read or write: opts.method/opts.body cover
// POST (create/edit) and DELETE, but auth always rides the header, never the URL.
async function graphGet(url, token, fetchImpl, opts = {}) {
  const init = { method: opts.method || 'GET', headers: { Authorization: `Bearer ${token}` } };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetchImpl(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw metaError(json);
  return json;
}

export async function listWabaTemplates(wabaId, token, fetchImpl = fetch) {
  const out = [];
  let url = `${GRAPH}/${wabaId}/message_templates?fields=${TPL_FIELDS}&limit=100`;
  while (url) {
    const json = await graphGet(url, token, fetchImpl);
    out.push(...(json.data || []));
    const next = json.paging && json.paging.next;
    if (next) {
      // Meta embeds access_token directly in paging.next URLs. Strip it here so no token
      // ever rides in a URL on our side — graphGet re-authenticates via the header, as always.
      const nextUrl = new URL(next);
      nextUrl.searchParams.delete('access_token');
      url = nextUrl.toString();
    } else {
      url = null;
    }
  }
  return out;
}

// ── capabilities ────────────────────────────────────────────────────────────
// What the WABA can do beyond plain template listing: upload media for a template header
// sample (needs the app id behind the token — Task 0 spike: GET /app?fields=id) and
// WhatsApp Flows (GET /{waba}/flows). Each is a separate Graph call that can fail on its
// own (missing scope, feature not enabled for this business) — a failure never throws,
// it just turns that one capability off and explains why, in both languages, for the
// admin UI. Cached per token (not per waba — a token only ever covers one WABA in this
// schema, see reads.js getWhatsappCredsAll) so repeated tpl_list calls don't re-check on
// every poll.
const _capCache = new Map();          // token -> { at, value }
const CAP_TTL_MS = 10 * 60 * 1000;    // 10 minutes

export async function wabaCapabilities(wabaId, token, fetchImpl = fetch) {
  const cached = _capCache.get(token);
  if (cached && Date.now() - cached.at < CAP_TTL_MS) return cached.value;

  const reasonsHe = [];
  const reasonsEn = [];

  let appId = null;
  let mediaUpload = false;
  try {
    const json = await graphGet(`${GRAPH}/app?fields=id`, token, fetchImpl);
    if (!json.id) throw new Error('no app id in response');
    appId = json.id;
    mediaUpload = true;
  } catch (e) {
    reasonsHe.push(`העלאת מדיה לתבניות אינה זמינה: ${e.message}`);
    reasonsEn.push(`Media upload unavailable: ${e.message}`);
  }

  let flows = false;
  let flowsList = [];
  try {
    const json = await graphGet(`${GRAPH}/${wabaId}/flows?fields=id,name,status`, token, fetchImpl);
    flowsList = (json.data || []).map((f) => ({ id: f.id, name: f.name, status: f.status }));
    flows = true;
  } catch (e) {
    reasonsHe.push(`WhatsApp Flows אינם זמינים לחשבון עסקי זה: ${e.message}`);
    reasonsEn.push(`WhatsApp Flows unavailable for this business account: ${e.message}`);
  }

  const value = { flows, flowsList, mediaUpload, appId };
  if (reasonsHe.length) {
    value.reason_he = reasonsHe.join(' | ');
    value.reason_en = reasonsEn.join(' | ');
  }

  _capCache.set(token, { at: Date.now(), value });
  return value;
}

/** Test-only: clear the module-level capabilities cache. */
export function _resetCapCacheForTests() { _capCache.clear(); }

// ── writes: shared helpers ───────────────────────────────────────────────────

async function resolveChannel(reads, accountId, inboxId) {
  const channels = await reads.getWhatsappCredsAll(accountId);
  const wanted = Number(inboxId);
  const found = channels.find((c) => c.inboxId === wanted);
  if (!found) throw new Error('inbox not found in this account');
  return found;
}

const NAME_RE = /^[a-z0-9_]{1,512}$/;
const CATEGORIES = new Set(['MARKETING', 'UTILITY', 'AUTHENTICATION']);
const EDIT_KEYS = ['components', 'category', 'message_send_ttl_seconds'];

// Server-side gate before any Graph call — a rejected template here never touches Meta.
function validateTemplate(t) {
  if (!NAME_RE.test((t && t.name) || '')) {
    throw new Error('invalid template name: must match /^[a-z0-9_]{1,512}$/');
  }
  if (!CATEGORIES.has(t && t.category)) {
    throw new Error(`invalid category: must be one of ${[...CATEGORIES].join(', ')}`);
  }
  if (!Array.isArray(t && t.components) || t.components.length === 0) {
    throw new Error('components must be a non-empty array');
  }
}

// ── access grants (migration 032) ───────────────────────────────────────────
// Administrators of the account always pass (decided from the Chatwoot profile role in
// api.js). These helpers cover the second door only: named non-admin users an admin let in.

/** hasTemplateAccess(accountId, userId, q) → boolean. A missing/0 userId is never granted. */
export async function hasTemplateAccess(accountId, userId, q = defaultQuery) {
  const uid = Number(userId) || 0;
  if (!uid) return false;
  const rows = await q(
    'SELECT 1 FROM drip.template_access WHERE account_id = $1 AND user_id = $2',
    [Number(accountId), uid]
  );
  return rows.length > 0;   // db.js's query() hands back .rows, not the pg result
}

/** The granted (non-admin) user ids for this account — the admin's grant screen. */
async function actionTplAccess(accountId, q) {
  const rows = await q(
    'SELECT user_id FROM drip.template_access WHERE account_id = $1 ORDER BY user_id',
    [Number(accountId)]
  );
  return { data: { user_ids: rows.map((x) => Number(x.user_id)) } };
}

/**
 * Replace the whole grant list for the account (admin-only — enforced in api.js).
 * Replace, not merge: the UI sends the complete list of toggled-on agents, so an agent
 * switched off there must actually lose access rather than linger from an earlier save.
 * Runs as one statement pair on a pooled connection — a partial apply would silently keep
 * a revoked agent in, so the delete is scoped by NOT IN and the insert is idempotent.
 */
async function actionTplSetAccess(accountId, p, q) {
  const acc = Number(accountId);
  const ids = [...new Set(
    (Array.isArray(p.user_ids) ? p.user_ids : []).map((x) => Number(x)).filter((x) => x > 0)
  )];
  const grantedBy = (p.__actor && p.__actor.uid) || null;

  await q(
    'DELETE FROM drip.template_access WHERE account_id = $1 AND NOT (user_id = ANY($2::int[]))',
    [acc, ids]
  );
  if (ids.length) {
    await q(
      `INSERT INTO drip.template_access (account_id, user_id, granted_by)
         SELECT $1, u, $3 FROM unnest($2::int[]) AS u
       ON CONFLICT (account_id, user_id) DO NOTHING`,
      [acc, ids, grantedBy]
    );
  }
  return { data: { user_ids: ids } };
}

/**
 * "May I open the Template Studio?" — the one tpl_ action any member of the account may
 * call, so the sidebar can decide whether to show the item at all (see inject/templates-nav.js).
 * Returns only booleans: never leaks who else was granted.
 */
async function actionTplMyAccess(accountId, p, q) {
  const admin = !!p.__isAdmin;
  const allowed = admin || await hasTemplateAccess(accountId, p.__actor && p.__actor.uid, q);
  return { data: { allowed, admin } };
}

// Attempt = action: called for both success and Graph failure. Its own failure must never
// mask the Graph result, so it swallows and logs rather than throwing — no token in the log.
export async function logAudit(query, { accountId, actor, action, wabaId, name, language, detail }) {
  try {
    await query(
      `INSERT INTO drip.template_audit
         (account_id, actor_uid, actor_name, action, waba_id, template_name, template_language, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [accountId, (actor && actor.uid) || null, (actor && actor.name) || null, action, wabaId, name,
        language || null, JSON.stringify(detail || {})]
    );
  } catch (e) {
    console.error('template_audit insert failed:', e.message);
  }
}

// Fetches the fresh full template list and writes it back to Chatwoot's own channel row, so
// the inbox UI (which reads message_templates straight off channel_whatsapp) doesn't wait for
// the poll job. Returns the number of channel rows updated (0 = no channel_whatsapp row for
// this WABA — should not happen, but not our job to fix here).
export async function syncWabaToChatwoot(query, wabaId, token, fetchImpl) {
  const templates = await listWabaTemplates(wabaId, token, fetchImpl);
  const rows = await query(
    `UPDATE public.channel_whatsapp
        SET message_templates = $1::jsonb, message_templates_last_updated = now()
      WHERE provider = 'whatsapp_cloud' AND provider_config->>'business_account_id' = $2
      RETURNING id`,
    [JSON.stringify(templates), wabaId]
  );
  return rows.length;
}

// Sync-back runs after every successful write but must never fail the write itself — the
// poll job catches up on any miss. Only the call site (not syncWabaToChatwoot itself, which
// Task 7's poll job may want to call directly and observe failures from) swallows.
async function syncBack(query, wabaId, token, fetchImpl) {
  try {
    await syncWabaToChatwoot(query, wabaId, token, fetchImpl);
  } catch (e) {
    console.error('syncWabaToChatwoot failed:', e.message);
  }
}

// ── poll: read-only status refresh ───────────────────────────────────────────
// Runs from index.js's tick() on its own 10-minute throttle — independent of the 60s tick
// interval, since neither Meta's rate limits nor a DB scan need checking that often. Finds
// every WABA that was touched (create/edit/delete) in the last 48h via drip.template_audit,
// re-lists its templates, and only when the list actually changed since the last time we
// looked (sha1 of the JSON, kept in a module-level Map) does it write that back into
// Chatwoot via syncWabaToChatwoot. READ-ONLY, per this module's header invariant: this
// function never calls a Graph write endpoint (no POST/DELETE) — it only ever GETs
// (listWabaTemplates) and mirrors that read into Chatwoot's own channel_whatsapp row.
const POLL_THROTTLE_MS = 10 * 60 * 1000;
let _lastPoll = 0;              // epoch ms; 0 = never polled → the first call always runs
const _wabaHash = new Map();    // wabaId -> sha1(JSON.stringify(templates)) as of last sync

/** Test-only: reset the poll throttle and the seen-hash cache. */
export function _resetPollForTests() {
  _lastPoll = 0;
  _wabaHash.clear();
}

export async function pollTemplateStatuses(deps = {}, now = new Date()) {
  const nowMs = now.getTime();
  if (_lastPoll && nowMs - _lastPoll < POLL_THROTTLE_MS) return;
  _lastPoll = nowMs;

  const { query: q = defaultQuery, fetchImpl = fetch } = deps;

  const recent = await q(
    `SELECT DISTINCT waba_id FROM drip.template_audit WHERE created_at > now() - interval '48 hours'`
  );

  for (const { waba_id: wabaId } of recent) {
    try {
      const tok = await q(
        `SELECT provider_config->>'api_key' AS token
           FROM public.channel_whatsapp
          WHERE provider = 'whatsapp_cloud'
            AND provider_config->>'business_account_id' = $1
            AND COALESCE(provider_config->>'api_key', '') <> ''
          LIMIT 1`,
        [wabaId]
      );
      const token = tok[0] && tok[0].token;
      if (!token) { console.error(`[tpl] poll: no channel token found for WABA ${wabaId}`); continue; }

      const templates = await listWabaTemplates(wabaId, token, fetchImpl);
      const hash = createHash('sha1').update(JSON.stringify(templates)).digest('hex');
      if (_wabaHash.get(wabaId) === hash) continue;   // unchanged since the last sync

      await syncWabaToChatwoot(q, wabaId, token, fetchImpl);
      _wabaHash.set(wabaId, hash);
    } catch (e) {
      console.error(`[tpl] poll: WABA ${wabaId} failed:`, e.message);
    }
  }
}

// ── writes: create / edit / delete / flows ───────────────────────────────────

async function actionTplCreate(accountId, payload, { reads, fetchImpl, query }) {
  const channel = await resolveChannel(reads, accountId, payload.inbox_id);
  const template = payload.template || {};
  validateTemplate(template);

  let result;
  try {
    result = await graphGet(`${GRAPH}/${channel.wabaId}/message_templates`, channel.token, fetchImpl, {
      method: 'POST', body: template,
    });
    await logAudit(query, {
      accountId, actor: payload.__actor, action: 'create', wabaId: channel.wabaId,
      name: template.name, language: template.language, detail: { ok: true, id: result.id, status: result.status },
    });
  } catch (e) {
    await logAudit(query, {
      accountId, actor: payload.__actor, action: 'create', wabaId: channel.wabaId,
      name: template.name, language: template.language, detail: { ok: false, error: e.message },
    });
    throw e;
  }

  await syncBack(query, channel.wabaId, channel.token, fetchImpl);
  return { data: { id: result.id, status: result.status, category: result.category } };
}

async function actionTplEdit(accountId, payload, { reads, fetchImpl, query }) {
  const channel = await resolveChannel(reads, accountId, payload.inbox_id);
  const templateId = payload.template_id;
  if (!templateId) throw new Error('template_id is required');
  // Meta template ids are numeric; blocks path injection into the Graph URL.
  if (!/^\d+$/.test(String(templateId))) throw new Error('invalid template_id');
  const changes = payload.changes || {};
  const body = {};
  for (const k of EDIT_KEYS) if (k in changes) body[k] = changes[k];
  // Prevent empty requests to Graph API: at least one editable field must be present.
  if (Object.keys(body).length === 0) throw new Error('no editable fields in changes');

  try {
    await graphGet(`${GRAPH}/${templateId}`, channel.token, fetchImpl, { method: 'POST', body });
    await logAudit(query, {
      accountId, actor: payload.__actor, action: 'edit', wabaId: channel.wabaId,
      name: String(templateId), language: null, detail: { ok: true, changes: body },
    });
  } catch (e) {
    await logAudit(query, {
      accountId, actor: payload.__actor, action: 'edit', wabaId: channel.wabaId,
      name: String(templateId), language: null, detail: { ok: false, error: e.message },
    });
    throw e;
  }

  await syncBack(query, channel.wabaId, channel.token, fetchImpl);
  return { data: { success: true } };
}

async function actionTplDelete(accountId, payload, { reads, fetchImpl, query }) {
  const channel = await resolveChannel(reads, accountId, payload.inbox_id);
  const name = payload.name;
  if (!name) throw new Error('name is required');
  const qs = new URLSearchParams({ name });
  if (payload.hsm_id) qs.set('hsm_id', payload.hsm_id);
  const url = `${GRAPH}/${channel.wabaId}/message_templates?${qs.toString()}`;

  try {
    await graphGet(url, channel.token, fetchImpl, { method: 'DELETE' });
    await logAudit(query, {
      accountId, actor: payload.__actor, action: 'delete', wabaId: channel.wabaId,
      name, language: null, detail: { ok: true },
    });
  } catch (e) {
    await logAudit(query, {
      accountId, actor: payload.__actor, action: 'delete', wabaId: channel.wabaId,
      name, language: null, detail: { ok: false, error: e.message },
    });
    throw e;
  }

  await syncBack(query, channel.wabaId, channel.token, fetchImpl);
  return { data: { success: true } };
}

async function actionTplFlows(accountId, payload, { reads, fetchImpl }) {
  const channel = await resolveChannel(reads, accountId, payload.inbox_id);
  const caps = await wabaCapabilities(channel.wabaId, channel.token, fetchImpl);
  return { data: caps.flowsList };
}

// ── uploadExampleMedia ───────────────────────────────────────────────────────
// A template with a media header (IMAGE/VIDEO/DOCUMENT) needs one example file at
// *creation* time so Meta can review it — a different flow from sending a live message
// (that one just needs a public URL). This is Meta's two-step Resumable Upload API:
//   1. open a session for the WABA's app  → session id
//   2. push the raw bytes to that session → a reusable media `handle`
// The handle then goes straight into the template's header component's example field.
// Called directly from the api.js route (not through handleTemplatesAction — this isn't a
// tpl_* dispatcher action, it has its own raw-body HTTP route mirroring /drip-api/media).
export async function uploadExampleMedia({ accountId, inboxId, mime, buf }, deps = {}) {
  const { reads = makeDbReads(defaultQuery), fetchImpl = fetch } = deps;
  const channel = await resolveChannel(reads, accountId, inboxId);

  const caps = await wabaCapabilities(channel.wabaId, channel.token, fetchImpl);
  if (caps.mediaUpload === false) {
    const err = new Error(caps.reason_en || 'Media upload is unavailable for this WhatsApp account');
    err.status = 400;
    err.reasonHe = caps.reason_he || 'העלאת מדיה אינה זמינה עבור חשבון וואטסאפ זה';
    throw err;
  }

  // Step 1 — open an upload session. A normal Graph call: Bearer header, JSON in and out.
  const size = buf ? buf.length : 0;
  const session = await graphGet(
    `${GRAPH}/${caps.appId}/uploads?file_length=${size}&file_type=${encodeURIComponent(mime || '')}`,
    channel.token, fetchImpl, { method: 'POST' }
  );
  if (!session.id) throw new Error('Meta did not return an upload session id');

  // Step 2 — push the bytes to the session Meta just opened. Meta quirk (Resumable Upload
  // docs): this call authenticates with the 'OAuth' scheme, not 'Bearer' like every other
  // Graph call in this file — and takes the raw binary body, not JSON. Auth still rides the
  // header, never the URL, matching this module's invariant (see graphGet above).
  const res = await fetchImpl(`${GRAPH}/${session.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${channel.token}`, file_offset: '0' },
    body: buf,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw metaError(json);
  if (!json.h) throw new Error('Meta did not return a media handle');

  return { handle: json.h };
}

// ── dispatcher ──────────────────────────────────────────────────────────────

// tpl_list: group the account's usable Cloud-API channels by WABA (several phone numbers
// can share one business account) and fetch that WABA's templates + capabilities once,
// using the FIRST channel's token — never the caller's, never re-fetched per inbox.
async function actionTplList(accountId, payload, { reads, fetchImpl }) {
  const channels = await reads.getWhatsappCredsAll(accountId);

  const groups = new Map();   // wabaId -> { wabaId, inboxes: [...], token: <first channel's> }
  for (const c of channels) {
    if (!groups.has(c.wabaId)) groups.set(c.wabaId, { wabaId: c.wabaId, inboxes: [], token: c.token });
    groups.get(c.wabaId).inboxes.push({ inboxId: c.inboxId, name: c.name, phone: c.phone });
  }

  let selected = [...groups.values()];
  if (payload && payload.inbox_id != null) {
    const wanted = Number(payload.inbox_id);
    const found = selected.find((g) => g.inboxes.some((i) => i.inboxId === wanted));
    if (!found) throw new Error('inbox not found in this account');
    selected = [found];
  }

  const wabas = await Promise.all(selected.map(async (g) => {
    const { token, ...pub } = g;   // strip the channel token — must never reach the response
    const [templates, capabilities] = await Promise.all([
      listWabaTemplates(pub.wabaId, token, fetchImpl),
      wabaCapabilities(pub.wabaId, token, fetchImpl),
    ]);
    return { ...pub, templates, capabilities };
  }));

  // is_admin rides along so the list screen knows whether to offer the access-management
  // button — a granted agent uses the studio but never sees who else was let in.
  return { data: { wabas, is_admin: !!payload.__isAdmin } };
}

export async function handleTemplatesAction(accountId, action, payload, deps = {}) {
  const {
    query: q = defaultQuery,
    reads = makeDbReads(q),
    fetchImpl = fetch,
  } = deps;

  const p = payload || {};
  switch (action) {
    case 'tpl_list':
      return actionTplList(accountId, p, { reads, fetchImpl });
    case 'tpl_create':
      return actionTplCreate(accountId, p, { reads, fetchImpl, query: q });
    case 'tpl_edit':
      return actionTplEdit(accountId, p, { reads, fetchImpl, query: q });
    case 'tpl_delete':
      return actionTplDelete(accountId, p, { reads, fetchImpl, query: q });
    case 'tpl_flows':
      return actionTplFlows(accountId, p, { reads, fetchImpl });
    case 'tpl_access':
      return actionTplAccess(accountId, q);
    case 'tpl_set_access':
      return actionTplSetAccess(accountId, p, q);
    case 'tpl_my_access':
      return actionTplMyAccess(accountId, p, q);
    default:
      throw new Error('unknown action');
  }
}
