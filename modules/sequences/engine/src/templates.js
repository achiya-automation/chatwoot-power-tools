// templates.js — Template Studio backend: manage WhatsApp message templates on the WABA
// through Meta's Graph API, using the same channel token Chatwoot already stores.
// Every write here is triggered by an explicit admin action in the UI — nothing in this
// module creates or edits templates on its own (poll = read-only status refresh).
import { query as defaultQuery } from './db.js';
import { makeDbReads } from './reads.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const TPL_FIELDS = 'id,name,status,category,language,components,quality_score,rejected_reason';

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
async function graphGet(url, token, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
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

  return { data: { wabas } };
}

export async function handleTemplatesAction(accountId, action, payload, deps = {}) {
  const {
    query: q = defaultQuery,
    reads = makeDbReads(q),
    fetchImpl = fetch,
  } = deps;

  switch (action) {
    case 'tpl_list':
      return actionTplList(accountId, payload, { reads, fetchImpl });
    default:
      throw new Error('unknown action');
  }
}
